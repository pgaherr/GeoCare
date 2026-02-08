"""
FastAPI server for the facility ranking agent.

Run with:
    uvicorn api.server:app --reload --port 8000
"""

import json
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "geoprocessing"))

from ranking_agent import rank_facilities, rank_facilities_gdf

# Import geoprocessing (only when needed to avoid startup delays)
def run_coverage_pipeline(query: str, include_h3_pop: bool = True):
    """
    Run the full geoprocessing pipeline and return all GeoJSON layers.
    
    Returns dict with:
        - aoi: Ghana boundary (GeoDataFrame)
        - facilities: Ranked facilities with geometry (GeoDataFrame)
        - isochrones: Buffer polygons with accessibility bands (GeoDataFrame)
        - h3_accessibility: H3 cells with accessibility values (DataFrame)
        - h3_population: H3 cells with population and accessibility (GeoDataFrame)
        - config: Pipeline configuration for frontend
    """
    import geoprocessing
    import geopandas as gpd
    
    RESULTS_PATH = Path(__file__).parent.parent.parent / "geoprocessing" / "results"
    H3_RESOLUTION = 5
    REFERENCE_DISTANCE = 1000
    MAX_DISTANCE = 80000
    ELASTICITY = 0.5
    
    # Get AOI (Ghana boundary, cached)
    cache_path = RESULTS_PATH / "ghana_boundary.geojson"
    if cache_path.exists():
        aoi = gpd.read_file(cache_path)
    else:
        from shapely.geometry import box
        ghana_bbox = box(-3.5, 4.5, 1.5, 11.5)
        aoi = gpd.GeoDataFrame(geometry=[ghana_bbox], crs="EPSG:4326")
    
    # Get facilities via ranking agent
    facilities_gdf = rank_facilities_gdf(query)
    if facilities_gdf.empty:
        return None
    
    facilities_gdf = facilities_gdf[facilities_gdf["geometry"].notna()]
    if facilities_gdf.empty:
        return None
    
    # Get population data (cached)
    pop_h3 = None
    if include_h3_pop:
        pop_h3 = geoprocessing.get_pop_h3(aoi, str(RESULTS_PATH), h3_pop_resolution=H3_RESOLUTION)
    
    # Run coverage analysis - get all outputs
    result = geoprocessing.coverage(
        facilities_gdf,
        elasticity=ELASTICITY,
        reference_distance=REFERENCE_DISTANCE,
        max_distance=MAX_DISTANCE,
        pop_h3=pop_h3,
        h3_resolution=H3_RESOLUTION,
    )
    
    # Unpack based on what was returned
    if include_h3_pop:
        iso_df, iso_df_h3, iso_df_h3_pop = result
    else:
        iso_df, iso_df_h3 = result
        iso_df_h3_pop = None
    
    return {
        "aoi": aoi,
        "facilities": facilities_gdf,
        "isochrones": iso_df,  # Buffer polygons with accessibility bands
        "h3_accessibility": iso_df_h3,  # H3 cells with accessibility
        "h3_population": iso_df_h3_pop,  # H3 cells with population
        "config": {
            "h3_resolution": H3_RESOLUTION,
            "reference_distance": REFERENCE_DISTANCE,
            "max_distance": MAX_DISTANCE,
            "elasticity": ELASTICITY,
        }
    }

app = FastAPI(
    title="GeoCare Facility API",
    description="Search and rank healthcare facilities using AI",
    version="1.0.0",
)

# CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative dev port
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    query: str


class FacilityResult(BaseModel):
    name: str | None
    officialWebsite: str | None
    capabilities: list[str]
    score: int
    reason: str


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "GeoCare Facility API"}


@app.post("/search", response_model=list[FacilityResult])
async def search_facilities(request: SearchRequest):
    """
    Search for healthcare facilities matching the query.
    
    Returns a ranked list of facilities with relevance scores (1-5).
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    
    try:
        result_json = rank_facilities(request.query)
        results = json.loads(result_json)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.post("/search/geojson")
async def search_facilities_geojson(request: SearchRequest):
    """
    Search for facilities and return GeoJSON for map display.
    
    Returns GeoJSON FeatureCollection with facility locations and scores.
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    
    try:
        gdf = rank_facilities_gdf(request.query)
        # Filter to only rows with valid geometry
        gdf = gdf[gdf["geometry"].notna()]
        geojson = gdf.to_json()
        return Response(content=geojson, media_type="application/geo+json")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.post("/search/pipeline")
async def search_with_coverage(request: SearchRequest):
    """
    Full pipeline: search → ranking → coverage analysis.
    
    Returns JSON with GeoJSON for all layers (like general_map):
    - aoi: Ghana boundary outline
    - facilities: POIs with stars rating
    - isochrones: Buffer polygons with accessibility bands
    - h3_accessibility: H3 cells with accessibility values
    - h3_population: H3 cells with population (centroids)
    - config: Pipeline configuration
    
    This endpoint may take 10-30 seconds on first run (downloads population data).
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    
    try:
        result = run_coverage_pipeline(request.query)
        
        if result is None:
            return {
                "query": request.query,
                "facilities_count": 0,
                "error": "No facilities found",
                "layers": {},
                "config": {}
            }
        
        # Helper to ensure CRS is WGS84 for Leaflet
        def to_geojson_wgs84(gdf):
            if gdf.crs is None:
                gdf = gdf.set_crs("EPSG:4326")
            elif gdf.crs.to_epsg() != 4326:
                gdf = gdf.to_crs("EPSG:4326")
            return json.loads(gdf.to_json())
        
        # Build response with all layers as GeoJSON (all in WGS84)
        layers = {
            "aoi": to_geojson_wgs84(result["aoi"]),
            "facilities": to_geojson_wgs84(result["facilities"]),
            "isochrones": to_geojson_wgs84(result["isochrones"]),
        }
        
        # H3 accessibility (convert to GeoDataFrame if needed)
        if result["h3_accessibility"] is not None:
            import h3_utils
            h3_gdf = h3_utils.to_gdf(result["h3_accessibility"])
            layers["h3_accessibility"] = to_geojson_wgs84(h3_gdf)
        
        # H3 population
        if result["h3_population"] is not None:
            layers["h3_population"] = to_geojson_wgs84(result["h3_population"])
        
        return {
            "query": request.query,
            "facilities_count": len(result["facilities"]),
            "isochrone_bands": len(result["isochrones"]),
            "h3_cells": len(result["h3_accessibility"]) if result["h3_accessibility"] is not None else 0,
            "layers": layers,
            "config": result["config"],
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {str(e)}")


# Coverage GeoJSON files (pre-generated by run_pipeline.py)
COVERAGE_DIR = Path(__file__).parent.parent.parent / "geoprocessing" / "results"


@app.get("/coverage/{layer}")
async def get_coverage_layer(layer: str):
    """
    Serve pre-generated coverage GeoJSON files for Leaflet.
    
    Available layers:
    - facilities: Facility points with stars
    - isochrones: Accessibility coverage bands
    - h3_population: H3 hexagons with population and accessibility
    
    Example: /coverage/isochrones
    """
    # Map layer names to file patterns
    layer_patterns = {
        "facilities": "facilities.geojson",
        "isochrones": "isochrones.geojson",
        "h3_population": "h3_population.geojson",
    }
    
    if layer not in layer_patterns:
        raise HTTPException(
            status_code=400, 
            detail=f"Unknown layer. Available: {list(layer_patterns.keys())}"
        )
    
    # Find the most recent matching file
    pattern = f"*_{layer_patterns[layer]}"
    files = list(COVERAGE_DIR.glob(pattern))
    
    if not files:
        raise HTTPException(
            status_code=404,
            detail=f"No coverage data found. Run the pipeline first."
        )
    
    # Get most recent file
    latest = max(files, key=lambda f: f.stat().st_mtime)
    
    return Response(
        content=latest.read_text(),
        media_type="application/geo+json"
    )


@app.get("/coverage")
async def list_coverage_layers():
    """List available coverage layers."""
    layers = {}
    for layer in ["facilities", "isochrones", "h3_population"]:
        pattern = f"*_{layer}.geojson"
        files = list(COVERAGE_DIR.glob(pattern))
        if files:
            latest = max(files, key=lambda f: f.stat().st_mtime)
            layers[layer] = {
                "available": True,
                "file": latest.name,
                "size_kb": round(latest.stat().st_size / 1024, 1),
            }
        else:
            layers[layer] = {"available": False}
    return layers


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


