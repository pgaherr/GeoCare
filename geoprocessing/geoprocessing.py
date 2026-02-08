"""
Accessibility and coverage quality utilities.

This module defines composable quality functions for:
- service quality (e.g. star ratings)
- distance decay with elasticity
- combined accessibility quality
- adaptive quality grids
- isochrone-based spatial accessibility
- optional aggregation to H3 and population-weighted coverage
"""

from typing import Callable, Tuple, Optional

import numpy as np
import pandas as pd
import geopandas as gpd
import os 
import shapely

import quality_utils
import isochrones
import h3_utils
import population

# Number of discrete accessibility grades (0–1)
n_accessibility_grades: int = 10


def get_service_quality_func() -> Callable[[float], float]:
    """
    Return a service quality function based on star ratings.

    Returns
    -------
    Callable[[float], float]
        Function mapping stars (0–5) → quality (0–1)
    """

    def get_service_quality(stars: float) -> float:
        return stars / 5.0

    return get_service_quality


def get_distance_quality_func(
    elasticity: float, reference_distance: float, max_distance: float
) -> Callable[[np.ndarray | float], np.ndarray]:
    """
    Return a distance-decay quality function with elasticity.

    The function is normalized so that:
    - quality = 1 at reference_distance
    - quality = 0 at max_distance

    Parameters
    ----------
    elasticity : float
        Distance decay elasticity (economic-style).
    reference_distance : float
        Distance where quality equals 1.
    max_distance : float
        Distance where quality reaches 0.

    Returns
    -------
    Callable
        Function mapping distance(s) → quality in [0,1]
    """

    def get_distance_quality(
        distance: np.ndarray | float,
    ) -> np.ndarray:
        """
        Distance-based quality with elasticity.

        Works with scalars or NumPy arrays.
        """
        distance = np.asarray(distance)

        raw = (distance / reference_distance) ** (-elasticity)
        k = (max_distance / reference_distance) ** (-elasticity)

        # Shift so quality(max_distance) = 0
        shifted = raw - k

        # Rescale so quality(reference_distance) = 1
        scale = 1.0 / (1.0 - k)
        q = shifted * scale

        # Clamp to [0,1]
        return np.clip(q, 0.0, 1.0)

    return get_distance_quality


def get_quality_func(
    service_quality_func: Callable[[float], float],
    distance_quality_func: Callable[[np.ndarray | float], np.ndarray],
) -> Callable[[float, np.ndarray | float], np.ndarray]:
    """
    Combine service quality and distance quality into a single metric.

    Returns
    -------
    Callable
        Function mapping (stars, distance) → combined quality
    """

    def get_quality(stars: float, distance: np.ndarray | float) -> np.ndarray:
        return service_quality_func(stars) * distance_quality_func(distance)

    return get_quality


def get_grids(
    quality_func: Callable[[float, float], float],
    reference_distance: float,
    max_distance: float,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Build adaptive service-quality and distance grids.

    Returns
    -------
    Tuple[np.ndarray, np.ndarray]
        (service_quality_grid, distance_grid)
    """
    service_quality_grid, distance_grid = quality_utils.build_adaptive_grids(
        quality_func,
        variables=[
            [1, 2, 3, 4, 5],  # stars
            [reference_distance, max_distance],
        ],
        delta=0.1,
    )
    return service_quality_grid, distance_grid


def get_quality_matrix(
    data: pd.DataFrame,
    quality_func: Callable[[float, float], float],
    distance_grid: np.ndarray,
) -> pd.DataFrame:
    """
    Build a discretized quality matrix over service quality and distance.

    Parameters
    ----------
    data : pd.DataFrame
        Must contain columns: 'stars', 'service_quality'
    quality_func : Callable
        Combined quality function
    distance_grid : np.ndarray
        Distance grid

    Returns
    -------
    pd.DataFrame
        Pivoted quality matrix
    """
    quality_matrix = (
        data.apply(
            lambda row: [
                {
                    "distance_grid": d,
                    "service_quality": row["service_quality"],
                    "quality_grid": quality_func(row["stars"], d),
                }
                for d in distance_grid
            ],
            axis=1,
        )
        .explode()
        .apply(pd.Series)
        .drop_duplicates(["service_quality", "distance_grid", "quality_grid"])
        .reset_index(drop=True)
    )

    quality_grid = np.linspace(0, 1, n_accessibility_grades + 1)
    idx = np.searchsorted(quality_grid, quality_matrix["quality_grid"], side="left")
    idx = np.clip(idx, 0, len(quality_grid) - 1)

    quality_matrix["quality_grid"] = quality_grid[idx]
    quality_matrix["quality_grid"] = quality_matrix["quality_grid"].round(3)

    quality_matrix = (
        quality_matrix.drop_duplicates(
            ["service_quality", "distance_grid", "quality_grid"]
        )
        .pivot(index="service_quality", columns="distance_grid", values="quality_grid")
        .reset_index()
    )

    return quality_matrix

def get_pop_h3(aoi,results_path,h3_pop_resolution = 8):
    pop_h3_path = results_path+f"/population_h3_res_{h3_pop_resolution}.csv"
    if os.path.isfile(pop_h3_path):
        pop_h3_df = pd.read_csv(pop_h3_path)
    else:
        population_file = population.download_worldpop_population(
            aoi,
            2025,
            folder=results_path,
            resolution="1km",
        )
        pop_h3_df = h3_utils.from_raster(population_file,aoi=aoi,resolution=h3_pop_resolution,method="distribute")
        pop_h3_df = pop_h3_df.rename(columns={'value':'population'})
        pop_h3_df.reset_index().to_csv(pop_h3_path)

    pop_h3_df = pd.read_csv(pop_h3_path).set_index("h3_cell")
    return pop_h3_df 


def coverage(
    data,
    elasticity: float, 
    reference_distance: float, 
    max_distance: float,
    pop_h3 = None,
    h3_resolution = None
):
    service_quality_func = get_service_quality_func()
    distance_quality_func = get_distance_quality_func(elasticity,reference_distance,max_distance)
    quality_func = get_quality_func(service_quality_func,distance_quality_func)
    
    data = data.copy()
    data["service_quality"] = data["stars"].map(service_quality_func).round(3)
    _, distance_grid = get_grids(quality_func, reference_distance, max_distance)
    quality_matrix = get_quality_matrix(data, quality_func, distance_grid)

    iso_df = isochrones.buffers(
        data, quality_matrix, service_quality_col="service_quality"
    )
    iso_df['accessibility'] = iso_df['accessibility'].astype(float)

    iso_df_h3 = None
    iso_df_h3_pop = None

    do_h3 = True 
    if h3_resolution is None:
        do_h3 = False 

    do_population = True 
    if pop_h3 is None:
        do_population = False 

    if do_h3:
        iso_df_h3 = h3_utils.from_gdf(
            iso_df,
            contain="overlap",
            method="max",
            columns=["accessibility"],
            resolution=h3_resolution,
        )

    if do_population and pop_h3 is not None:
        iso_df_h3_pop = pop_h3.merge(
            iso_df_h3, left_index=True, right_index=True, how="left"
        )
        iso_df_h3_pop["accessibility"] = iso_df_h3_pop["accessibility"].fillna(0)
        iso_df_h3_pop = iso_df_h3_pop[iso_df_h3_pop['population'] > 1]
        iso_df_h3_pop = h3_utils.to_gdf(iso_df_h3_pop)
        iso_df_h3_pop.geometry = iso_df_h3_pop.geometry.centroid

    if do_h3 and do_population:
        return iso_df, iso_df_h3, iso_df_h3_pop
    if do_h3:
        return iso_df, iso_df_h3
    if do_population:
        return iso_df, iso_df_h3_pop

    return iso_df


def poi_distance_quality(
    data,
    poi,  
    elasticity: float, 
    reference_distance: float, 
    max_distance: float
):
    utm_crs = poi.estimate_utm_crs()
    poi = poi.to_crs(utm_crs)
    data = data.to_crs(utm_crs)
    data = data[data.geometry.intersects(shapely.buffer(poi.union_all(),max_distance))]
    data["distance_to_poi"] = data.geometry.map(
        lambda geom: poi.distance(geom).min()
    )
    distance_quality_func = get_distance_quality_func(
        elasticity,
        reference_distance,
        max_distance,
    )
    data["distance_quality"] = data["distance_to_poi"].map(distance_quality_func)
    return data.to_crs(4326) 
