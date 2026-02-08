"""
Merge geocoding data from the enriched CSV into the SQLite database and source CSV.

Columns to merge: address_and_name, address_complete, address_only_city, geometry, geometry_source
Key: pk_unique_id
"""

import csv
import sqlite3
from pathlib import Path

# Paths
DATA_DIR = Path(__file__).parent / "data"
GEOCODED_CSV = DATA_DIR / "source" / "Virtue-Foundation-Ghana-enriched_geocoded.csv"
SOURCE_CSV = DATA_DIR / "source" / "Virtue Foundation Ghana v0.3 - Sheet1.csv"
DB_PATH = DATA_DIR / "output" / "facilities_20260208_0233.db"

# Columns to merge
GEO_COLUMNS = ["address_and_name", "address_complete", "address_only_city", "geometry", "geometry_source"]


def load_geocoding_data(csv_path: Path) -> dict[int, dict]:
    """Load geocoding data keyed by pk_unique_id."""
    data = {}
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                pk_id = int(row["pk_unique_id"])
                data[pk_id] = {col: row.get(col, "") for col in GEO_COLUMNS}
            except (ValueError, KeyError):
                continue
    return data


def update_database(db_path: Path, geo_data: dict[int, dict]):
    """Add geocoding columns to the database and update rows."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check existing columns
    existing_cols = {row[1] for row in cursor.execute("PRAGMA table_info(facilities_canonical)")}
    
    # Add missing columns
    for col in GEO_COLUMNS:
        if col not in existing_cols:
            print(f"  Adding column: {col}")
            cursor.execute(f"ALTER TABLE facilities_canonical ADD COLUMN \"{col}\" TEXT")
    
    # Update rows
    updated = 0
    for pk_id, values in geo_data.items():
        set_clause = ", ".join(f"\"{col}\" = ?" for col in GEO_COLUMNS)
        cursor.execute(
            f"UPDATE facilities_canonical SET {set_clause} WHERE pk_unique_id = ?",
            [values[col] for col in GEO_COLUMNS] + [pk_id]
        )
        if cursor.rowcount > 0:
            updated += 1
    
    conn.commit()
    conn.close()
    return updated


def update_source_csv(source_csv: Path, geo_data: dict[int, dict]):
    """Update the source CSV with geocoding columns."""
    # Read existing data
    with open(source_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    
    # Add new columns if missing
    for col in GEO_COLUMNS:
        if col not in fieldnames:
            fieldnames.append(col)
    
    # Update rows
    updated = 0
    for row in rows:
        try:
            pk_id = int(row.get("pk_unique_id", 0))
            if pk_id in geo_data:
                for col in GEO_COLUMNS:
                    row[col] = geo_data[pk_id].get(col, "")
                updated += 1
        except (ValueError, KeyError):
            continue
    
    # Write back
    with open(source_csv, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    return updated


def main():
    print(f"Loading geocoding data from: {GEOCODED_CSV}")
    geo_data = load_geocoding_data(GEOCODED_CSV)
    print(f"  Loaded {len(geo_data)} records with geocoding data")
    
    print(f"\nUpdating database: {DB_PATH}")
    db_updated = update_database(DB_PATH, geo_data)
    print(f"  Updated {db_updated} rows in database")
    
    print(f"\nUpdating source CSV: {SOURCE_CSV}")
    csv_updated = update_source_csv(SOURCE_CSV, geo_data)
    print(f"  Updated {csv_updated} rows in CSV")
    
    print("\nDone!")


if __name__ == "__main__":
    main()
