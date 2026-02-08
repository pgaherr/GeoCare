"""
Preprocessing pipeline for Virtue Foundation Ghana healthcare facility data.

Pipeline steps:
1. Load CSV and parse JSON columns
2. Deduplicate by pk_unique_id (keep richest row)
3. Explode facts with provenance tracking
4. LLM-based fact normalization to capability codes
5. Output to SQLite (facilities_canonical, facts_exploded, facts_normalized)
"""

import json
import sqlite3
import hashlib
from pathlib import Path
from typing import Optional
import pandas as pd
from collections import defaultdict

from capabilities import (
    CapabilityVocabulary,
    build_normalization_prompt,
    NormalizedFact,
)

# =============================================================================
# CONFIGURATION
# =============================================================================

DATA_DIR = Path(__file__).parent
CSV_PATH = DATA_DIR / "data" / "source" / "Virtue Foundation Ghana v0.3 - Sheet1.csv"
DB_PATH = DATA_DIR / "data" / "output" / "facilities.db"

# Columns that contain JSON-encoded lists
JSON_COLUMNS = ["specialties", "procedure", "equipment", "capability", "phone_numbers", 
                "websites", "affiliationTypeIds", "countries"]

# Columns to use for deduplication richness scoring
RICHNESS_COLUMNS = ["procedure", "equipment", "capability", "description", 
                    "phone_numbers", "email", "websites"]

# Ghana region normalization (handles inconsistent naming)
GHANA_REGIONS = {
    # Standard 16 regions
    "greater accra": "Greater Accra",
    "greater accra region": "Greater Accra",
    "accra": "Greater Accra",
    "ashanti": "Ashanti",
    "ashanti region": "Ashanti", 
    "western": "Western",
    "western region": "Western",
    "western north": "Western North",
    "central": "Central",
    "central region": "Central",
    "eastern": "Eastern",
    "eastern region": "Eastern",
    "volta": "Volta",
    "volta region": "Volta",
    "oti": "Oti",
    "oti region": "Oti",
    "northern": "Northern",
    "northern region": "Northern",
    "savannah": "Savannah",
    "savannah region": "Savannah",
    "north east": "North East",
    "north east region": "North East",
    "upper east": "Upper East",
    "upper east region": "Upper East",
    "upper west": "Upper West",
    "upper west region": "Upper West",
    "bono": "Bono",
    "bono region": "Bono",
    "bono east": "Bono East",
    "bono east region": "Bono East",
    "ahafo": "Ahafo",
    "ahafo region": "Ahafo",
    "brong ahafo": "Bono",  # Old name, now split into Bono/Bono East/Ahafo
    "brong ahafo region": "Bono",
}


def normalize_region(region: str) -> Optional[str]:
    """Normalize region name to standard Ghana region."""
    if pd.isna(region) or not region:
        return None
    clean = region.strip().lower()
    return GHANA_REGIONS.get(clean, region.strip())


# =============================================================================
# STEP 1: LOAD AND PARSE
# =============================================================================

def parse_json_field(value: str) -> list:
    """Parse a JSON-encoded field, handling various edge cases."""
    if pd.isna(value) or value in ("", "null", "[]", "[[]]"):
        return []
    
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            # Filter out empty strings and None
            return [item for item in parsed if item and item.strip()]
        return []
    except (json.JSONDecodeError, TypeError):
        # Sometimes values are just strings
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return []


def load_and_parse_csv(csv_path: Path) -> pd.DataFrame:
    """Load CSV and parse JSON columns."""
    df = pd.read_csv(csv_path, skipinitialspace=True, on_bad_lines="skip")
        
    # Clean column names just in case
    df.columns = df.columns.str.strip()
    
    print(f"  Loaded {len(df)} rows")
    
    # Parse JSON columns
    for col in JSON_COLUMNS:
        if col in df.columns:
            df[col] = df[col].apply(parse_json_field)
            non_empty = df[col].apply(len).sum()
            print(f"  Parsed {col}: {non_empty} total items")
    
    return df


# =============================================================================
# STEP 2: DEDUPLICATION
# =============================================================================

def calculate_richness(row: pd.Series) -> int:
    """Calculate richness score for deduplication - higher is better."""
    score = 0
    for col in RICHNESS_COLUMNS:
        if col in row.index:
            val = row[col]
            if isinstance(val, list):
                score += len(val) * 2  # Lists count more
            elif pd.notna(val) and val:
                score += 1
    return score


def _has_number(val) -> bool:
    """Check if a string contains any digit."""
    if pd.isna(val) or not isinstance(val, str):
        return False
    return any(c.isdigit() for c in val)


def _is_empty(val) -> bool:
    """Check if a value is empty/null."""
    try:
        if pd.isna(val):
            return True
    except (ValueError, TypeError):
        # Handle case where val is an array/list and pd.isna fails or ambiguous
        pass
    
    if isinstance(val, str) and val.strip() == "":
        return True
    if isinstance(val, (list, tuple)) and len(val) == 0:
        return True
    return False


def deduplicate_facilities(df: pd.DataFrame) -> pd.DataFrame:
    """
    Deduplicate by pk_unique_id, keeping the richest row.
    Also merges facts from duplicate rows.
    Fills empty fields from less-rich rows.
    For address conflicts, prefers values with numbers.
    """
    print(f"\nDeduplicating {len(df)} rows by pk_unique_id...")
    
    # Add richness score
    df["_richness"] = df.apply(calculate_richness, axis=1)
    
    # Group by pk_unique_id
    grouped = df.groupby("pk_unique_id")
    
    # Address columns to apply number-preference logic
    address_cols = [
        "address_line1", "address_line2", "address_line3",
        "address_city", "address_stateOrRegion", "address_zipOrPostcode"
    ]
    
    deduped_rows = []
    merged_facts = defaultdict(lambda: {"procedure": [], "equipment": [], "capability": []})
    
    for pk_id, group in grouped:
        # Sort by richness and take the best row
        sorted_group = group.sort_values("_richness", ascending=False)
        best_row = sorted_group.iloc[0].copy()
        
        # Merge facts from all duplicate rows
        for _, row in group.iterrows():
            for fact_col in ["procedure", "equipment", "capability"]:
                if fact_col in row.index and isinstance(row[fact_col], list):
                    merged_facts[pk_id][fact_col].extend(row[fact_col])
        
        # Assign merged facts (keeping all, no dedup)
        for fact_col in ["procedure", "equipment", "capability"]:
            best_row[fact_col] = merged_facts[pk_id][fact_col]
        
        # Fill empty fields from less-rich rows + address number preference
        for col in best_row.index:
            if col in ["_richness", "procedure", "equipment", "capability"]:
                continue  # Skip internal/fact columns
            
            best_val = best_row[col]
            
            # If best_row has empty value, try to fill from other rows
            if _is_empty(best_val):
                for _, other_row in sorted_group.iloc[1:].iterrows():
                    other_val = other_row[col]
                    if not _is_empty(other_val):
                        best_row[col] = other_val
                        break
            
            # For address columns with conflict: prefer values with numbers
            elif col in address_cols:
                if not _has_number(best_val):
                    # Check if any other row has a value with numbers
                    for _, other_row in sorted_group.iloc[1:].iterrows():
                        other_val = other_row[col]
                        if not _is_empty(other_val) and _has_number(other_val):
                            best_row[col] = other_val
                            break
        
        deduped_rows.append(best_row)
    
    result = pd.DataFrame(deduped_rows)
    result = result.drop(columns=["_richness"])
    
    # Normalize region names
    if "address_stateOrRegion" in result.columns:
        result["address_stateOrRegion"] = result["address_stateOrRegion"].apply(normalize_region)
        print(f"  Normalized region names")
    
    print(f"  Reduced to {len(result)} unique facilities")
    return result


# =============================================================================
# STEP 3: FACT EXPLOSION
# =============================================================================

def explode_facts(df: pd.DataFrame) -> pd.DataFrame:
    """
    Create facts_exploded table with one row per fact.
    Tracks provenance (source facility, fact type, original text).
    """
    print("\nExploding facts...")
    
    facts = []
    fact_columns = ["procedure", "equipment", "capability"]
    
    for _, row in df.iterrows():
        facility_id = row["pk_unique_id"]
        source_url = row.get("source_url", "")
        
        for fact_type in fact_columns:
            if fact_type in row.index and isinstance(row[fact_type], list):
                for fact_text in row[fact_type]:
                    if fact_text and isinstance(fact_text, str):
                        # Create deterministic fact ID
                        fact_hash = hashlib.md5(
                            f"{facility_id}:{fact_type}:{fact_text}".encode()
                        ).hexdigest()[:12]
                        
                        facts.append({
                            "fact_id": fact_hash,
                            "facility_id": facility_id,
                            "fact_type": fact_type,
                            "fact_text": fact_text.strip(),
                            "source_url": source_url,
                        })
    
    facts_df = pd.DataFrame(facts)
    print(f"  Created {len(facts_df)} fact records")
    print(f"    procedure: {len(facts_df[facts_df['fact_type'] == 'procedure'])}")
    print(f"    equipment: {len(facts_df[facts_df['fact_type'] == 'equipment'])}")
    print(f"    capability: {len(facts_df[facts_df['fact_type'] == 'capability'])}")
    
    return facts_df


# =============================================================================
# STEP 4: LLM NORMALIZATION
# =============================================================================

def normalize_facts_batch(
    facts: list[str],
    llm_client,  # Expects a function that takes (system_prompt, user_prompt) -> str
    vocabulary: CapabilityVocabulary,
) -> list[NormalizedFact]:
    """
    Normalize a batch of facts using LLM.
    Updates vocabulary with proposed new codes.
    """
    system_prompt, user_prompt = build_normalization_prompt(facts)
    
    # Call LLM
    response = llm_client(system_prompt, user_prompt)
    
    # Parse response
    try:
        results = json.loads(response)
        if not isinstance(results, list):
            results = [results]
    except json.JSONDecodeError:
        print(f"  Warning: Failed to parse LLM response")
        return []
    
    # Process results and update vocabulary
    normalized = []
    for result in results:
        # Handle proposed new codes
        if result.get("proposed_code") and result.get("is_capability", True):
            vocabulary.add_proposed_code(
                code=result["proposed_code"],
                description=result.get("proposed_description", ""),
                example_fact=result.get("fact_text", ""),
            )
        normalized.append(result)
    
    return normalized


def normalize_all_facts(
    facts_df: pd.DataFrame,
    llm_client,
    batch_size: int = 10,
    max_workers: int = 20,
) -> tuple[pd.DataFrame, CapabilityVocabulary]:
    """
    Normalize all facts in batches (parallel).
    Returns updated facts dataframe and final vocabulary.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    print(f"\nNormalizing {len(facts_df)} facts in batches of {batch_size} (parallel, {max_workers} workers)...")
    
    vocabulary = CapabilityVocabulary()
    all_results = []
    
    fact_texts = facts_df["fact_text"].tolist()
    
    # Create batches
    batches = []
    for i in range(0, len(fact_texts), batch_size):
        batches.append(fact_texts[i:i + batch_size])
    
    total_batches = len(batches)
    completed = 0
    errors = {"rate_limit": 0, "timeout": 0, "parse_error": 0, "other": 0}
    error_details = []
    
    # Process batches in parallel
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(normalize_facts_batch, batch, llm_client, vocabulary): i 
            for i, batch in enumerate(batches)
        }
        
        for future in as_completed(futures):
            batch_idx = futures[future]
            try:
                results = future.result(timeout=90)
                all_results.extend(results)
                completed += 1
                print(f"  Completed batch {completed}/{total_batches}")
            except TimeoutError:
                errors["timeout"] += 1
                error_details.append(f"Batch {batch_idx}: Timeout after 90s")
                print(f"  ⚠️  Batch {batch_idx} TIMEOUT")
            except Exception as e:
                error_str = str(e).lower()
                if "rate" in error_str or "429" in error_str or "quota" in error_str:
                    errors["rate_limit"] += 1
                    error_details.append(f"Batch {batch_idx}: RATE LIMIT - {e}")
                    print(f"  🚫 Batch {batch_idx} RATE LIMITED: {e}")
                elif "json" in error_str or "parse" in error_str or "decode" in error_str:
                    errors["parse_error"] += 1
                    error_details.append(f"Batch {batch_idx}: Parse error - {e}")
                    print(f"  ❌ Batch {batch_idx} PARSE ERROR: {e}")
                else:
                    errors["other"] += 1
                    error_details.append(f"Batch {batch_idx}: {e}")
                    print(f"  ❌ Batch {batch_idx} FAILED: {e}")
    
    # Print error summary if any errors
    total_errors = sum(errors.values())
    if total_errors > 0:
        print(f"\n  ⚠️  ERROR SUMMARY: {total_errors}/{total_batches} batches failed")
        print(f"    Rate limits: {errors['rate_limit']}")
        print(f"    Timeouts: {errors['timeout']}")
        print(f"    Parse errors: {errors['parse_error']}")
        print(f"    Other: {errors['other']}")
    
    # Initialize columns before merge (will store JSON arrays as strings)
    facts_df = facts_df.copy()
    facts_df["mapped_codes"] = None
    facts_df["proposed_codes"] = None
    facts_df["proposed_descriptions"] = None
    facts_df["confidence"] = None
    facts_df["is_capability"] = None
    
    # Merge results
    print(f"\n  Merging results: {len(all_results)} LLM results for {len(facts_df)} facts")
    
    if all_results:
        # Match by fact_text since order might vary
        result_map = {r.get("fact_text"): r for r in all_results if isinstance(r, dict)}
        
        matched_facts = 0
        total_codes = 0
        for idx, row in facts_df.iterrows():
            fact_text = row["fact_text"]
            if fact_text in result_map:
                r = result_map[fact_text]
                # Store arrays as JSON strings for SQLite
                mapped = r.get("mapped_codes", [])
                proposed = r.get("proposed_codes", [])
                proposed_desc = r.get("proposed_descriptions", [])
                facts_df.at[idx, "mapped_codes"] = json.dumps(mapped) if mapped else "[]"
                facts_df.at[idx, "proposed_codes"] = json.dumps(proposed) if proposed else "[]"
                facts_df.at[idx, "proposed_descriptions"] = json.dumps(proposed_desc) if proposed_desc else "[]"
                facts_df.at[idx, "confidence"] = r.get("confidence")
                facts_df.at[idx, "is_capability"] = r.get("is_capability")
                matched_facts += 1
                total_codes += len(mapped) + len(proposed)

        print(f"    Matched {matched_facts}/{len(facts_df)} facts → {total_codes} codes assigned")
    
    # Report on vocabulary
    print(f"\n  Vocabulary status:")
    print(f"    Accepted codes: {len(vocabulary.get_all_codes())}")
    print(f"    Pending proposals: {len(vocabulary.get_pending_proposals())}")
    
    return facts_df, vocabulary


# =============================================================================
# STEP 5: OUTPUT TO SQLITE
# =============================================================================

def create_database(
    facilities_df: pd.DataFrame,
    facts_df: pd.DataFrame,
    vocabulary: CapabilityVocabulary,
    db_path: Path,
):
    """Create SQLite database with all tables."""
    print(f"\nCreating database at {db_path}...")
    
    # Remove existing database
    if db_path.exists():
        db_path.unlink()
    
    conn = sqlite3.connect(db_path)
    
    # Facilities table - convert list columns to JSON strings for SQLite
    facilities_for_db = facilities_df.copy()
    for col in JSON_COLUMNS:
        if col in facilities_for_db.columns:
            facilities_for_db[col] = facilities_for_db[col].apply(json.dumps)
    
    facilities_for_db.to_sql("facilities_canonical", conn, index=False)
    print(f"  Created facilities_canonical: {len(facilities_df)} rows")
    
    # Facts table
    facts_df.to_sql("facts_exploded", conn, index=False)
    print(f"  Created facts_exploded: {len(facts_df)} rows")
    
    # Vocabulary table
    vocab_data = [
        {"code": code, "description": desc, "is_seed": code in vocabulary.codes}
        for code, desc in vocabulary.get_all_codes().items()
    ]
    vocab_df = pd.DataFrame(vocab_data)
    vocab_df.to_sql("capability_vocabulary", conn, index=False)
    print(f"  Created capability_vocabulary: {len(vocab_df)} rows")
    
    # Create useful views
    conn.execute("""
        CREATE VIEW facility_capabilities AS
        SELECT 
            f.pk_unique_id,
            f.name,
            f.address_city,
            f.address_stateOrRegion,
            fe.fact_type,
            fe.fact_text,
            fe.mapped_codes,
            fe.confidence
        FROM facilities_canonical f
        JOIN facts_exploded fe ON f.pk_unique_id = fe.facility_id
        WHERE fe.is_capability = 1 OR fe.is_capability IS NULL
    """)
    
    conn.execute("""
        CREATE VIEW capabilities_by_region AS
        SELECT 
            f.address_stateOrRegion as region,
            fe.mapped_codes,
            COUNT(DISTINCT f.pk_unique_id) as facility_count
        FROM facilities_canonical f
        JOIN facts_exploded fe ON f.pk_unique_id = fe.facility_id
        WHERE fe.mapped_codes IS NOT NULL AND fe.mapped_codes != '[]'
        GROUP BY f.address_stateOrRegion, fe.mapped_codes
        ORDER BY region, facility_count DESC
    """)
    
    conn.commit()
    conn.close()
    print("  Created views: facility_capabilities, capabilities_by_region")


# =============================================================================
# MAIN PIPELINE
# =============================================================================

def run_pipeline(
    csv_path: Path = CSV_PATH,
    db_path: Optional[Path] = None,
    llm_client = None,
    skip_normalization: bool = False,
    fact_limit: Optional[int] = None,
):
    """
    Run the full preprocessing pipeline.
    
    Args:
        csv_path: Path to input CSV
        db_path: Path for output SQLite database (if None, generates timestamped name)
        llm_client: Function(system_prompt, user_prompt) -> str for LLM calls
        skip_normalization: If True, skip LLM normalization step
        fact_limit: Limit number of facts to normalize (for testing)
    """
    import datetime
    
    if db_path is None:
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
        db_path = DATA_DIR / "data" / "output" / f"facilities_{timestamp}.db"
    
    print("=" * 60)
    print("HEALTHCARE FACILITY PREPROCESSING PIPELINE")
    print(f"Output DB: {db_path}")
    print("=" * 60)
    
    # Step 1: Load and parse
    df = load_and_parse_csv(csv_path)
    
    # Step 2: Deduplicate
    facilities_df = deduplicate_facilities(df)
    
    # Step 3: Explode facts
    facts_df = explode_facts(facilities_df)
    
    # Apply fact limit if specified
    if fact_limit and fact_limit < len(facts_df):
        print(f"\n  Limiting to first {fact_limit} facts for testing")
        facts_df = facts_df.head(fact_limit).copy()
    
    # Step 4: Normalize (optional)
    vocabulary = CapabilityVocabulary()
    if not skip_normalization and llm_client:
        facts_df, vocabulary = normalize_all_facts(facts_df, llm_client)
    else:
        print("\nSkipping LLM normalization (no client provided or skip_normalization=True)")
        # Add placeholder columns
        facts_df["mapped_code"] = None
        facts_df["proposed_code"] = None
        facts_df["confidence"] = None
        facts_df["is_capability"] = None
    
    # Step 5: Output to SQLite
    create_database(facilities_df, facts_df, vocabulary, db_path)
    
    print("\n" + "=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)
    
    return facilities_df, facts_df, vocabulary


# =============================================================================
# CLI
# =============================================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Preprocess healthcare facility data")
    parser.add_argument("--skip-normalize", action="store_true", 
                        help="Skip LLM normalization step")
    parser.add_argument("--normalize", action="store_true",
                        help="Enable LLM normalization (requires API key in .env)")
    parser.add_argument("--provider", choices=["openai", "gemini"], default="openai",
                        help="LLM provider for normalization (default: openai)")
    parser.add_argument("--csv", type=Path, default=CSV_PATH,
                        help="Path to input CSV")
    parser.add_argument("--db", type=Path, default=None,
                        help="Path for output SQLite database (default: timestamped)")
    parser.add_argument("--batch-size", type=int, default=50,
                        help="Batch size for LLM normalization")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit number of facts to normalize (for testing)")
    parser.add_argument("--list-facts", action="store_true",
                        help="List all extracted facts and exit (no normalization)")
    
    args = parser.parse_args()
    
    # Handle --list-facts: load, parse, deduplicate, explode, print, exit
    if args.list_facts:
        df = load_and_parse_csv(args.csv)
        df = deduplicate_facilities(df)  # Re-enable dedup
        facts_df = explode_facts(df)
        print(f"\n=== ALL {len(facts_df)} EXTRACTED FACTS (merged/deduplicated) ===\n")
        for _, row in facts_df.iterrows():
            print(f"[pk={row['facility_id']}] [{row['fact_type']}] {row['fact_text']}")
        exit(0)
    
    # Determine if we should run normalization
    llm_client = None
    skip_normalization = args.skip_normalize
    
    if args.normalize and not args.skip_normalize:
        try:
            if args.provider == "gemini":
                from clients.gemini_client import create_gemini_client
                llm_client = create_gemini_client()
            else:
                from clients.llm_client import create_openai_client
                llm_client = create_openai_client()
            skip_normalization = False
        except Exception as e:
            print(f"Warning: Could not create {args.provider} client: {e}")
            print("Running without normalization.")
            skip_normalization = True
    
    run_pipeline(
        csv_path=args.csv,
        db_path=args.db,
        llm_client=llm_client,
        skip_normalization=skip_normalization,
        fact_limit=args.limit,
    )

