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
from pydantic import BaseModel, Field

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "geoprocessing"))

from ranking_agent import rank_facilities, rank_facilities_gdf

# Import geoprocessing (only when needed to avoid startup delays)
_RESULTS_PATH = Path(__file__).parent.parent.parent / "geoprocessing" / "results"
_H3_RESOLUTION = 5
_REFERENCE_DISTANCE = 1000
_MAX_DISTANCE = 80000
_ELASTICITY = 0.1

# Module-level caches — static data that never changes between requests
_aoi_cache = None
_pop_h3_geojson_cache = None
# Facilities from the last pipeline run — used by /coverage/recompute
_last_facilities_gdf = None


def _get_aoi():
    global _aoi_cache
    if _aoi_cache is not None:
        return _aoi_cache
    import geopandas as gpd
    cache_path = _RESULTS_PATH / "ghana_boundary.geojson"
    if cache_path.exists():
        _aoi_cache = gpd.read_file(cache_path)
    else:
        from shapely.geometry import box
        ghana_bbox = box(-3.5, 4.5, 1.5, 11.5)
        _aoi_cache = gpd.GeoDataFrame(geometry=[ghana_bbox], crs="EPSG:4326")
    return _aoi_cache


def _get_pop_h3_geojson():
    """Load population H3 hexagons (cached — static data)."""
    global _pop_h3_geojson_cache
    if _pop_h3_geojson_cache is not None:
        return _pop_h3_geojson_cache
    import geoprocessing
    import h3_utils
    aoi = _get_aoi()
    pop_h3 = geoprocessing.get_pop_h3(aoi, str(_RESULTS_PATH), h3_pop_resolution=_H3_RESOLUTION)
    pop_h3 = pop_h3[pop_h3["population"] > 1]
    pop_gdf = h3_utils.to_gdf(pop_h3)
    if pop_gdf.crs is None:
        pop_gdf = pop_gdf.set_crs("EPSG:4326")
    elif pop_gdf.crs.to_epsg() != 4326:
        pop_gdf = pop_gdf.to_crs("EPSG:4326")
    _pop_h3_geojson_cache = json.loads(pop_gdf.to_json())
    return _pop_h3_geojson_cache


def _to_geojson_wgs84(gdf):
    """Ensure CRS is WGS84 and convert GeoDataFrame to GeoJSON dict."""
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return json.loads(gdf.to_json())


def _run_coverage(
    facilities_gdf,
    max_distance: int = _MAX_DISTANCE,
    elasticity: float = _ELASTICITY,
):
    """Run coverage analysis on a facilities GeoDataFrame. Returns (iso_geojson, h3_geojson)."""
    import geoprocessing
    import h3_utils
    result = geoprocessing.coverage(
        facilities_gdf,
        elasticity=elasticity,
        reference_distance=_REFERENCE_DISTANCE,
        max_distance=max_distance,
        pop_h3=None,
        h3_resolution=_H3_RESOLUTION,
    )
    iso_df, iso_df_h3 = result
    iso_geojson = _to_geojson_wgs84(iso_df)
    h3_geojson = None
    if iso_df_h3 is not None:
        h3_geojson = _to_geojson_wgs84(h3_utils.to_gdf(iso_df_h3))
    return iso_geojson, h3_geojson


def run_coverage_pipeline(
    query: str,
    max_distance: int = _MAX_DISTANCE,
    elasticity: float = _ELASTICITY,
):
    """
    Run the full geoprocessing pipeline and return all GeoJSON layers.
    Caches facilities_gdf for subsequent /coverage/recompute calls.
    """
    global _last_facilities_gdf

    aoi = _get_aoi()

    # Get facilities via ranking agent
    facilities_gdf = rank_facilities_gdf(query)
    if facilities_gdf.empty:
        return None

    facilities_gdf = facilities_gdf[facilities_gdf["geometry"].notna()]
    if facilities_gdf.empty:
        return None

    # Cache for recompute endpoint
    _last_facilities_gdf = facilities_gdf.copy()

    # Run coverage analysis
    iso_geojson, h3_geojson = _run_coverage(
        facilities_gdf,
        max_distance=max_distance,
        elasticity=elasticity,
    )

    return {
        "aoi": aoi,
        "facilities": facilities_gdf,
        "isochrones_geojson": iso_geojson,
        "h3_accessibility_geojson": h3_geojson,
        "config": {
            "h3_resolution": _H3_RESOLUTION,
            "reference_distance": _REFERENCE_DISTANCE,
            "max_distance": max_distance,
            "elasticity": elasticity,
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
    max_distance: int = Field(default=_MAX_DISTANCE, ge=10000, le=100000)
    elasticity: float = Field(default=_ELASTICITY, ge=0.1, le=2.0)


class RecomputeRequest(BaseModel):
    min_stars: int = 1
    max_distance: int = Field(default=_MAX_DISTANCE, ge=10000, le=100000)
    elasticity: float = Field(default=_ELASTICITY, ge=0.1, le=2.0)


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
        result = run_coverage_pipeline(
            request.query,
            max_distance=request.max_distance,
            elasticity=request.elasticity,
        )

        if result is None:
            return {
                "query": request.query,
                "facilities_count": 0,
                "error": "No facilities found",
                "layers": {},
                "config": {}
            }

        layers = {
            "aoi": _to_geojson_wgs84(result["aoi"]),
            "facilities": _to_geojson_wgs84(result["facilities"]),
            "isochrones": result["isochrones_geojson"],
            "h3_accessibility": result["h3_accessibility_geojson"],
            "h3_population": _get_pop_h3_geojson(),
        }

        return {
            "query": request.query,
            "facilities_count": len(result["facilities"]),
            "layers": layers,
            "config": result["config"],
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {str(e)}")


@app.post("/coverage/recompute")
async def recompute_coverage(request: RecomputeRequest):
    """
    Recompute coverage layers for a star threshold using cached facilities.
    Much faster than the full pipeline (no Genie/LLM, just geoprocessing).
    """
    if _last_facilities_gdf is None:
        raise HTTPException(status_code=400, detail="No facilities cached. Run /search/pipeline first.")

    try:
        filtered = _last_facilities_gdf[
            _last_facilities_gdf["stars"] >= request.min_stars
        ]
        filtered = filtered[filtered["geometry"].notna()]

        if filtered.empty:
            return {"layers": {"isochrones": None, "h3_accessibility": None}}

        iso_geojson, h3_geojson = _run_coverage(
            filtered,
            max_distance=request.max_distance,
            elasticity=request.elasticity,
        )
        return {
            "layers": {
                "isochrones": iso_geojson,
                "h3_accessibility": h3_geojson,
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Recompute failed: {str(e)}")


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
