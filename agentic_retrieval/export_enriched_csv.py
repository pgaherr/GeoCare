#!/usr/bin/env python3
"""
Export enriched facilities data from SQLite database to CSV.
Merges normalized capability codes back with deduplicated facility data.
"""

import sqlite3
import pandas as pd
import json
from pathlib import Path
from datetime import datetime

# Configuration
_DIR = Path(__file__).parent
DB_PATH = _DIR / "data" / "output" / "facilities_20260208_0233.db"
RAW_CSV_PATH = _DIR / "data" / "source" / "Virtue Foundation Ghana v0.3 - Sheet1.csv"
OUTPUT_CSV = _DIR / "data" / "output" / f"facilities_enriched_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"

# Import preprocessing logic
try:
    from preprocessing import load_and_parse_csv, deduplicate_facilities
except ImportError:
    # Fallback if running from a different directory context
    import sys
    sys.path.append(str(Path(__file__).parent))
    from preprocessing import load_and_parse_csv, deduplicate_facilities


def main():
    print(f"Loading database: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    
    # 1. Load and deduplicate raw data (using NEW logic)
    # This ensures we get the best addresses and filled fields
    print(f"Loading raw data from: {RAW_CSV_PATH}")
    if not RAW_CSV_PATH.exists():
        print(f"❌ Error: Raw CSV not found at {RAW_CSV_PATH}")
        return

    raw_df = load_and_parse_csv(RAW_CSV_PATH)
    facilities_df = deduplicate_facilities(raw_df)
    facilities_df["pk_unique_id"] = facilities_df["pk_unique_id"].astype(str)
    print(f"  Processed {len(facilities_df)} facilities with enhanced deduplication")
    
    # Load facts with normalized codes
    facts_df = pd.read_sql("SELECT * FROM facts_exploded", conn)
    print(f"  Loaded {len(facts_df)} facts")
    
    # Aggregate mapped codes and confidence per facility
    def aggregate_codes_and_confidence(group):
        all_codes = set()
        confidences = []
        for _, row in group.iterrows():
            codes_json = row.get("mapped_codes")
            confidence = row.get("confidence")
            if codes_json:
                try:
                    codes = json.loads(codes_json)
                    all_codes.update(codes)
                    if codes and confidence is not None:
                        try:
                            confidences.append(float(confidence))
                        except (ValueError, TypeError):
                            pass
                except (json.JSONDecodeError, TypeError):
                    pass
        
        avg_conf = sum(confidences) / len(confidences) if confidences else None
        min_conf = min(confidences) if confidences else None
        
        return pd.Series({
            "normalized_capability_codes": json.dumps(sorted(all_codes)),
            "avg_confidence": round(avg_conf, 3) if avg_conf else None,
            "min_confidence": round(min_conf, 3) if min_conf else None,
        })
    
    codes_per_facility = facts_df.groupby("facility_id").apply(
        aggregate_codes_and_confidence, include_groups=False
    ).reset_index()
    codes_per_facility = codes_per_facility.rename(columns={"facility_id": "pk_unique_id"})
    codes_per_facility["pk_unique_id"] = codes_per_facility["pk_unique_id"].astype(str)
    
    print(f"  Aggregated codes for {len(codes_per_facility)} facilities")
    
    # Merge with facilities
    enriched = facilities_df.merge(codes_per_facility, on="pk_unique_id", how="left")
    
    # Fill missing with empty array
    enriched["normalized_capability_codes"] = enriched["normalized_capability_codes"].fillna("[]")
    
    # Count capabilities per facility
    enriched["capability_count"] = enriched["normalized_capability_codes"].apply(
        lambda x: len(json.loads(x)) if x else 0
    )
    
    # Save to CSV
    enriched.to_csv(OUTPUT_CSV, index=False)
    print(f"\n✅ Exported to: {OUTPUT_CSV}")
    print(f"   {len(enriched)} facilities with normalized capability codes")
    
    # Summary stats
    total_with_codes = (enriched["capability_count"] > 0).sum()
    print(f"   {total_with_codes} facilities have at least one capability code")
    print(f"   Avg codes per facility: {enriched['capability_count'].mean():.1f}")
    
    conn.close()


if __name__ == "__main__":
    main()
