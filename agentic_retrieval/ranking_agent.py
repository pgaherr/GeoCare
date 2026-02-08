"""
Facility ranking agent: Genie → DB lookup → LLM rating.

Usage:
    from ranking_agent import rank_facilities

    results = rank_facilities("Where can I get treatment for AIDS?")
    for r in results:
        print(f"{r['score']}/5 - {r['name']}: {r['reason']}")
"""

import json
import sqlite3
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import wkt

from genie_client import query_genie
from clients.llm_client import create_openai_client

DB_PATH = Path(__file__).parent / "data" / "output" / "facilities_20260208_0233.db"

RATING_SYSTEM_PROMPT = """\
You are a healthcare facility evaluator. Given a user's healthcare need and \
a batch of facility profiles, rate how well EACH facility matches the need.

Return a JSON array with one object per facility, in the same order as provided:
[{"pk_unique_id": <id>, "score": <1-5>, "reason": "<one sentence>"}]

Scoring guide:
5 = Excellent match — facility clearly specializes in what the user needs
4 = Good match — facility has relevant capabilities
3 = Moderate match — some relevant services but not a clear fit
2 = Weak match — tangentially related
1 = Poor match — no meaningful connection to the user's need
"""


def _get_facility_confidence(pk_ids: list[int], db_path: Path = DB_PATH) -> dict[int, float]:
    """Get average preprocessing confidence per facility from facts_exploded."""
    conn = sqlite3.connect(db_path)
    placeholders = ",".join("?" * len(pk_ids))
    rows = conn.execute(
        f"SELECT facility_id, AVG(confidence) "
        f"FROM facts_exploded "
        f"WHERE facility_id IN ({placeholders}) AND confidence IS NOT NULL "
        f"GROUP BY facility_id",
        pk_ids,
    ).fetchall()
    conn.close()
    return {int(row[0]): row[1] for row in rows}


def _get_facility_profiles(pk_ids: list[int], db_path: Path = DB_PATH) -> list[dict]:
    """Look up facilities and their capability codes from the local DB."""
    conn = sqlite3.connect(db_path)

    placeholders = ",".join("?" * len(pk_ids))

    # Get facility base data (including geometry for geoprocessing)
    rows = conn.execute(
        f"SELECT pk_unique_id, name, description, specialties, procedure, capability, officialWebsite, geometry "
        f"FROM facilities_canonical WHERE pk_unique_id IN ({placeholders})",
        pk_ids,
    ).fetchall()

    facilities = {}
    for row in rows:
        pk_id = row[0]
        facilities[pk_id] = {
            "pk_unique_id": pk_id,
            "name": row[1],
            "description": row[2],
            "specialties": row[3],
            "procedure": row[4],
            "capability": row[5],
            "officialWebsite": row[6],
            "geometry": row[7],  # WKT geometry string
        }

    # Get mapped capability codes per facility
    codes_rows = conn.execute(
        f"SELECT facility_id, mapped_codes FROM facts_exploded "
        f"WHERE facility_id IN ({placeholders}) AND mapped_codes IS NOT NULL",
        pk_ids,
    ).fetchall()

    for fid, codes_json in codes_rows:
        if fid in facilities:
            try:
                codes = json.loads(codes_json)
                if codes:
                    facilities[fid].setdefault("normalized_codes", []).extend(codes)
            except (json.JSONDecodeError, TypeError):
                pass

    # Deduplicate codes
    for f in facilities.values():
        f["normalized_codes"] = sorted(set(f.get("normalized_codes", [])))

    conn.close()
    return list(facilities.values())


def _format_facility(facility: dict) -> str:
    """Format a single facility profile for the LLM prompt."""
    parts = [f"[pk_unique_id={facility['pk_unique_id']}] {facility['name']}"]

    if facility.get("description"):
        parts.append(f"  Description: {facility['description']}")
    if facility.get("specialties"):
        parts.append(f"  Specialties: {facility['specialties']}")
    if facility.get("procedure"):
        parts.append(f"  Procedures: {facility['procedure']}")
    if facility.get("capability"):
        parts.append(f"  Capabilities: {facility['capability']}")
    if facility.get("normalized_codes"):
        parts.append(f"  Capability codes: {', '.join(facility['normalized_codes'])}")

    return "\n".join(parts)


def _build_batch_prompt(user_query: str, facilities: list[dict]) -> str:
    """Build a single LLM prompt with all facilities."""
    facility_blocks = "\n\n".join(
        f"--- Facility {i+1} ---\n{_format_facility(f)}"
        for i, f in enumerate(facilities)
    )
    return f"User need: {user_query}\n\n{facility_blocks}"


DEFAULT_MAX_BATCH = 20
DEFAULT_UNRANKED_SCORE = 3


def _output_record(facility: dict, score: int, reason: str) -> dict:
    """Build a standardized output record for one facility."""
    codes = facility.get("normalized_codes", [])
    return {
        "name": facility.get("name"),
        "officialWebsite": facility.get("officialWebsite"),
        "capabilities": codes,
        "score": score,
        "reason": reason,
    }


def rank_facilities(
    user_query: str,
    db_path: Path = DB_PATH,
    max_batch: int = DEFAULT_MAX_BATCH,
) -> str:
    """
    Full pipeline: query Genie for matching facility IDs, look up in DB,
    LLM-rate top batch, return JSON string with all facilities.

    Facilities beyond max_batch get a default score of 2.
    """
    # Step 1: Ask Genie for matching facility PKs
    genie_prompt = (
        f"Return only the pk_unique_id column for facilities matching this query. "
        f"User query: {user_query}"
    )
    print(f"Querying Genie: {user_query}")
    genie_result = query_genie(genie_prompt)
    print(f"  Genie returned {len(genie_result['rows'])} facilities")
    print(f"  SQL: {genie_result['sql']}")

    if not genie_result["rows"]:
        print("  No facilities found.")
        return json.dumps([])

    # Extract pk_unique_id values from rows
    pk_ids = []
    for row in genie_result["rows"]:
        pk_val = row.get("pk_unique_id")
        if pk_val is not None:
            try:
                pk_ids.append(int(pk_val))
            except (ValueError, TypeError):
                pass

    if not pk_ids:
        print("  Could not extract pk_unique_id from Genie results.")
        return json.dumps([])

    print(f"  Extracted {len(pk_ids)} facility IDs")

    # Step 2: Look up ALL facilities in local DB
    all_facilities = _get_facility_profiles(pk_ids, db_path)
    print(f"  Found {len(all_facilities)} facilities in local DB")

    # Step 3: Pick top batch by preprocessing confidence for LLM rating
    if len(pk_ids) > max_batch:
        confidence_by_pk = _get_facility_confidence(pk_ids, db_path)
        pk_ids.sort(key=lambda pk: confidence_by_pk.get(pk, 0.0), reverse=True)
        print(f"  Sending top {max_batch} to LLM (remaining {len(pk_ids) - max_batch} get default score)")
        ranked_ids = set(pk_ids[:max_batch])
    else:
        ranked_ids = set(pk_ids)

    ranked_facilities = [f for f in all_facilities if f["pk_unique_id"] in ranked_ids]

    # Step 4: LLM-rate the top batch
    llm = create_openai_client()
    user_prompt = _build_batch_prompt(user_query, ranked_facilities)
    print(f"  Rating {len(ranked_facilities)} facilities in one LLM call...")

    score_by_pk: dict[int, tuple[int, str]] = {}
    try:
        response = llm(RATING_SYSTEM_PROMPT, user_prompt)
        ratings = json.loads(response)
        if not isinstance(ratings, list):
            ratings = [ratings]
        for rating in ratings:
            pk_id = int(rating.get("pk_unique_id", 0))
            score_by_pk[pk_id] = (rating.get("score", 0), rating.get("reason", ""))
    except (json.JSONDecodeError, Exception) as e:
        print(f"  Warning: LLM rating failed: {e}")
        for f in ranked_facilities:
            score_by_pk[f["pk_unique_id"]] = (0, "Rating failed")

    # Step 5: Assemble all results — rated facilities + unranked with default score
    results = []
    for f in all_facilities:
        pk_id = f["pk_unique_id"]
        if pk_id in score_by_pk:
            score, reason = score_by_pk[pk_id]
        else:
            score, reason = DEFAULT_UNRANKED_SCORE, "Not individually rated"
        results.append(_output_record(f, score, reason))

    results.sort(key=lambda x: x["score"], reverse=True)
    return json.dumps(results, indent=2)


def rank_facilities_gdf(
    user_query: str,
    db_path: Path = DB_PATH,
    max_batch: int = DEFAULT_MAX_BATCH,
) -> gpd.GeoDataFrame:
    """
    Full pipeline returning a GeoDataFrame for geoprocessing.
    
    Returns GeoDataFrame with columns:
      - name, officialWebsite, capabilities
      - stars (1-5 score, mapped from LLM rating)
      - geometry (Point from WKT)
    """
    # Step 1: Ask Genie for matching facility PKs
    genie_prompt = (
        f"Return only the pk_unique_id column for facilities matching this query. "
        f"User query: {user_query}"
    )
    print(f"Querying Genie: {user_query}")
    genie_result = query_genie(genie_prompt)
    print(f"  Genie returned {len(genie_result['rows'])} facilities")

    if not genie_result["rows"]:
        print("  No facilities found.")
        return gpd.GeoDataFrame(columns=["name", "stars", "geometry"], crs="EPSG:4326")

    # Extract pk_unique_id values
    pk_ids = []
    for row in genie_result["rows"]:
        pk_val = row.get("pk_unique_id")
        if pk_val is not None:
            try:
                pk_ids.append(int(pk_val))
            except (ValueError, TypeError):
                pass

    if not pk_ids:
        return gpd.GeoDataFrame(columns=["name", "stars", "geometry"], crs="EPSG:4326")

    # Step 2: Look up facilities in local DB
    all_facilities = _get_facility_profiles(pk_ids, db_path)

    # Step 3: Pick top batch by confidence for LLM rating
    if len(pk_ids) > max_batch:
        confidence_by_pk = _get_facility_confidence(pk_ids, db_path)
        pk_ids.sort(key=lambda pk: confidence_by_pk.get(pk, 0.0), reverse=True)
        ranked_ids = set(pk_ids[:max_batch])
    else:
        ranked_ids = set(pk_ids)

    ranked_facilities = [f for f in all_facilities if f["pk_unique_id"] in ranked_ids]

    # Step 4: LLM-rate the top batch
    llm = create_openai_client()
    user_prompt = _build_batch_prompt(user_query, ranked_facilities)
    print(f"  Rating {len(ranked_facilities)} facilities...")

    score_by_pk: dict[int, tuple[int, str]] = {}
    try:
        response = llm(RATING_SYSTEM_PROMPT, user_prompt)
        ratings = json.loads(response)
        if not isinstance(ratings, list):
            ratings = [ratings]
        for rating in ratings:
            pk_id = int(rating.get("pk_unique_id", 0))
            score_by_pk[pk_id] = (rating.get("score", 0), rating.get("reason", ""))
    except (json.JSONDecodeError, Exception) as e:
        print(f"  Warning: LLM rating failed: {e}")
        for f in ranked_facilities:
            score_by_pk[f["pk_unique_id"]] = (0, "Rating failed")

    # Step 5: Build GeoDataFrame
    records = []
    for f in all_facilities:
        pk_id = f["pk_unique_id"]
        if pk_id in score_by_pk:
            score, reason = score_by_pk[pk_id]
        else:
            score, reason = DEFAULT_UNRANKED_SCORE, "Not individually rated"
        
        # Parse geometry from WKT
        geom = None
        if f.get("geometry"):
            try:
                geom = wkt.loads(f["geometry"])
            except Exception:
                pass
        
        records.append({
            "pk_unique_id": pk_id,
            "name": f.get("name"),
            "officialWebsite": f.get("officialWebsite"),
            "capabilities": f.get("normalized_codes", []),
            "stars": score,  # Use 'stars' for geoprocessing compatibility
            "reason": reason,
            "geometry": geom,
        })

    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
    gdf = gdf.sort_values("stars", ascending=False).reset_index(drop=True)
    
    # Filter out rows without valid geometry
    valid_geom = gdf["geometry"].notna()
    if not valid_geom.all():
        print(f"  Warning: {(~valid_geom).sum()} facilities have no geometry")
    
    return gdf


if __name__ == "__main__":
    query = "Which places are best equipped to handle surgeries?"
    print(f"\nQuery: {query}\n")

    result_json = rank_facilities(query)

    print(f"\n{'='*60}")
    results = json.loads(result_json)
    print(f"Results ({len(results)} facilities):")
    print(f"{'='*60}")
    for r in results:
        print(f"  [{r['score']}/5] {r['name']}")
        print(f"         {r['reason']}")
    print(f"\nFull JSON:\n{result_json}")
