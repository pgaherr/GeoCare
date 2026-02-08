"""
Full geoprocessing pipeline: Query → Ranking → Coverage → GeoJSON

This script:
1. Queries the ranking agent for facilities matching a user query
2. Computes accessibility coverage with distance decay
3. Aggregates to H3 hexagons with population data
4. Outputs GeoJSON for Leaflet frontend integration

Usage:
    python run_pipeline.py "AIDS treatment centers"
"""

import sys
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box

# Add parent directories to path
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "agentic_retrieval"))

import geoprocessing
from ranking_agent import rank_facilities_gdf

# ============================================================================
# Configuration
# ============================================================================

RESULTS_PATH = Path(__file__).parent / "results"
RESULTS_PATH.mkdir(exist_ok=True)

# Distance decay parameters (meters)
REFERENCE_DISTANCE = 1000   # Quality = 1 at 1km
MAX_DISTANCE = 50000        # Quality = 0 at 50km
ELASTICITY = 0.5            # Moderate decay

# H3 resolution: 7 ≈ 1.22km hexagons
H3_RESOLUTION = 7


def get_ghana_boundary() -> gpd.GeoDataFrame:
    """Get Ghana's national boundary from Natural Earth via geopandas."""
    try:
        # Try to load from cache first
        cache_path = RESULTS_PATH / "ghana_boundary.geojson"
        if cache_path.exists():
            return gpd.read_file(cache_path)
        
        # Download from Natural Earth
        world = gpd.read_file(
            "https://naciscdn.org/naturalearth/110m/cultural/ne_110m_admin_0_countries.zip"
        )
        ghana = world[world["ADMIN"] == "Ghana"].copy()
        
        if ghana.empty:
            raise ValueError("Ghana not found in Natural Earth data")
        
        ghana = ghana.to_crs("EPSG:4326")
        ghana.to_file(cache_path, driver="GeoJSON")
        return ghana
    
    except Exception as e:
        print(f"Warning: Could not download Ghana boundary: {e}")
        print("Using approximate bounding box instead")
        # Fallback: approximate bounding box for Ghana
        ghana_bbox = box(-3.5, 4.5, 1.5, 11.5)
        return gpd.GeoDataFrame(geometry=[ghana_bbox], crs="EPSG:4326")


def run_pipeline(query: str, output_path: Path = None) -> dict:
    """
    Run the full geoprocessing pipeline.
    
    Parameters
    ----------
    query : str
        User query for facility search
    output_path : Path, optional
        Where to save the GeoJSON output
    
    Returns
    -------
    dict
        Pipeline results including paths to output files
    """
    print(f"\n{'='*60}")
    print(f"Running pipeline for: {query}")
    print(f"{'='*60}\n")
    
    # Step 1: Get Ghana boundary as AOI
    print("Step 1: Loading Ghana boundary...")
    aoi = get_ghana_boundary()
    print(f"  AOI loaded: {len(aoi)} features")
    
    # Step 2: Query ranking agent for facilities
    print(f"\nStep 2: Querying ranking agent...")
    facilities_gdf = rank_facilities_gdf(query)
    
    if facilities_gdf.empty:
        print("  No facilities found!")
        return {"error": "No facilities found", "facilities": 0}
    
    # Filter to facilities with valid geometry
    facilities_gdf = facilities_gdf[facilities_gdf["geometry"].notna()]
    print(f"  Found {len(facilities_gdf)} facilities with geometry")
    
    if facilities_gdf.empty:
        print("  No facilities have geometry data!")
        return {"error": "No facilities with geometry", "facilities": 0}
    
    # Step 3: Get population data (cached)
    print(f"\nStep 3: Loading population data (H3 resolution {H3_RESOLUTION})...")
    pop_h3 = geoprocessing.get_pop_h3(
        aoi, 
        str(RESULTS_PATH), 
        h3_pop_resolution=H3_RESOLUTION
    )
    print(f"  Population data: {len(pop_h3)} H3 cells")
    
    # Step 4: Run coverage analysis
    print(f"\nStep 4: Computing coverage (ref={REFERENCE_DISTANCE}m, max={MAX_DISTANCE}m)...")
    iso_df, iso_df_h3, iso_df_h3_pop = geoprocessing.coverage(
        facilities_gdf,
        elasticity=ELASTICITY,
        reference_distance=REFERENCE_DISTANCE,
        max_distance=MAX_DISTANCE,
        pop_h3=pop_h3,
        h3_resolution=H3_RESOLUTION,
    )
    print(f"  Isochrones: {len(iso_df)} bands")
    print(f"  H3 cells: {len(iso_df_h3)} cells")
    print(f"  H3 with population: {len(iso_df_h3_pop)} cells")
    
    # Step 5: Output GeoJSON files for Leaflet
    print(f"\nStep 5: Saving GeoJSON outputs...")
    
    output_base = output_path or (RESULTS_PATH / f"coverage_{query[:20].replace(' ', '_')}")
    
    # Facilities GeoJSON
    facilities_path = Path(f"{output_base}_facilities.geojson")
    facilities_gdf.to_file(facilities_path, driver="GeoJSON")
    print(f"  Facilities: {facilities_path}")
    
    # Isochrones GeoJSON
    iso_path = Path(f"{output_base}_isochrones.geojson")
    iso_df.to_file(iso_path, driver="GeoJSON")
    print(f"  Isochrones: {iso_path}")
    
    # H3 population coverage GeoJSON
    h3_pop_path = Path(f"{output_base}_h3_population.geojson")
    iso_df_h3_pop.to_file(h3_pop_path, driver="GeoJSON")
    print(f"  H3 Population: {h3_pop_path}")
    
    print(f"\n{'='*60}")
    print("Pipeline complete!")
    print(f"{'='*60}\n")
    
    return {
        "query": query,
        "facilities_count": len(facilities_gdf),
        "h3_cells": len(iso_df_h3_pop),
        "files": {
            "facilities": str(facilities_path),
            "isochrones": str(iso_path),
            "h3_population": str(h3_pop_path),
        }
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        query = "AIDS treatment centers"
        print(f"No query provided, using default: '{query}'")
    else:
        query = " ".join(sys.argv[1:])
    
    result = run_pipeline(query)
    print("\nResult:")
    print(json.dumps(result, indent=2))
