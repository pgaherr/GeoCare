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

# Add parent directory to path so we can import ranking_agent
sys.path.insert(0, str(Path(__file__).parent.parent))
from ranking_agent import rank_facilities, rank_facilities_gdf

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

