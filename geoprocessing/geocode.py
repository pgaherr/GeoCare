#!/usr/bin/env python3
import sys
from pathlib import Path
import os
import re
import time
import pandas as pd
import geopandas as gpd
from shapely import wkt
from tqdm import tqdm

# Add parent directory to sys.path for custom modules
parent_dir = Path().resolve().parent
sys.path.append(str(parent_dir))

import geoutils
import api_keys

# -------------------------------
# Launch parameters
# -------------------------------
if len(sys.argv) != 5:
    print(
        "Usage: python geocode_data.py <countrycode> <data_path> <geocoded_path> <aoi_path>"
    )
    sys.exit(1)

countrycode = sys.argv[1]
data_path = sys.argv[2]
geocoded_path = sys.argv[3]
aoi_path = sys.argv[4]
batch_size = 50  # rows per batch

# -------------------------------
# Load AOI
# -------------------------------
aoi = gpd.read_file(aoi_path).to_crs(4326)

# -------------------------------
# Load data
# -------------------------------
if os.path.isfile(geocoded_path):
    data = pd.read_csv(geocoded_path)
else:
    data = pd.read_csv(data_path)

    # Function to concatenate address parts
    def concat_address(row, level=0):
        cols = [
            "name",
            "address_line1",
            "address_line2",
            "address_line3",
            "address_city",
            "address_stateOrRegion",
            "address_zipOrPostcode",
            "address_country",
        ]
        if level == 1:
            cols = cols[1:]
        elif level == 2:
            cols = cols[4:]

        parts = [
            str(row[c]).strip()
            for c in cols
            if pd.notna(row[c]) and str(row[c]).strip()
        ]
        return " , ".join(parts)

    data["address_and_name"] = data.apply(concat_address, axis=1)
    data["address_complete"] = data.apply(lambda x: concat_address(x, level=1), axis=1)
    data["address_only_city"] = data.apply(lambda x: concat_address(x, level=2), axis=1)

    # Initialize new columns
    data["geometry"] = None
    data["geometry_source"] = None


# -------------------------------
# Geocode function
# -------------------------------
def geocode(row):
    for col in ["address_and_name", "address_complete", "address_only_city"]:
        try:
            geo = geoutils.get_address_point_opencage(
                row[col], api_keys.OPENCAGE, countrycode=countrycode
            )
            if geo:
                return pd.Series({"geometry": geo, "geometry_source": col})
        except Exception as e:
            if "You have used the requests available on your plan" in str(e):
                raise  # stop execution if API limit reached
            else:
                continue
    return pd.Series({"geometry": None, "geometry_source": None})


# -------------------------------
# Run batch geocoding if needed
# -------------------------------
if data["geometry"].isna().any():
    for start in tqdm(range(0, len(data), batch_size), desc="Geocoding batches"):
        end = min(start + batch_size, len(data))
        batch = data.iloc[start:end].copy()

        # Only geocode rows where geometry is None
        mask = batch["geometry"].isna()
        if mask.any():
            batch.loc[mask, ["geometry", "geometry_source"]] = batch.loc[mask].apply(
                geocode, axis=1
            )
            data.loc[start : end - 1, ["geometry", "geometry_source"]] = batch[
                ["geometry", "geometry_source"]
            ]

        data.to_csv(geocoded_path, index=False)  # always save full CSV
        print(f"Processed rows {start} to {end-1}")
        time.sleep(1)

    # -------------------------------
    # Clean geometry
    # -------------------------------
    def extract_wkt(s):
        if isinstance(s, str):
            match = re.search(r"(POINT|LINESTRING|POLYGON)\s*\(.*\)", s)
            if match:
                return match.group(0)
        return None

    data["geometry"] = data["geometry"].apply(
        lambda x: wkt.loads(str(x)) if x else None
    )

    # Convert to GeoDataFrame and filter by AOI
    data = gpd.GeoDataFrame(data, geometry="geometry", crs=4326)
    data = data[data.geometry.intersects(aoi.to_crs(4326).union_all())]

    # Drop unnamed columns
    data = data[[col for col in data.columns if "Unnamed:" not in col]]

    # Convert geometry to WKT for CSV
    data["geometry"] = data.geometry.to_wkt().astype(str)
    data.to_csv(geocoded_path)
    print(f"Geocoding completed. Saved to {geocoded_path}")
else:
    print("Data is already complete")
