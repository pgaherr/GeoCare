#!/usr/bin/env python3
import os
import sys
import geopandas as gpd
import osmnx as ox
import osm
import graph_processing


def main():
    if len(sys.argv) != 4:
        print(
            "Usage: python build_street_graph.py <results_path> <min_edge_length> <aoi_path>"
        )
        sys.exit(1)

    results_path = sys.argv[1]
    min_edge_length = float(sys.argv[2])
    aoi_path = sys.argv[3]

    # Load AOI
    aoi = gpd.read_file(aoi_path)

    # Paths for outputs
    osm_xml_file = os.path.normpath(os.path.join(results_path, "streets.osm"))
    streets_graph_path = os.path.normpath(os.path.join(results_path, "streets.graphml"))
    streets_path_edges = os.path.normpath(
        os.path.join(results_path, "streets_edges.gpkg")
    )
    streets_path_nodes = os.path.normpath(
        os.path.join(results_path, "streets_nodes.gpkg")
    )

    # Step 1: Download and crop OSM
    network_filter = osm.osmium_network_filter("all")
    osm.geofabrik_to_osm(
        osm_xml_file,
        input_file=results_path,
        aoi=aoi,
        osmium_filter_args=network_filter,
        overwrite=False,
    )

    # Step 2: Load and project graph
    G = ox.graph_from_xml(osm_xml_file)
    G = ox.project_graph(G, to_crs=aoi.estimate_utm_crs())

    # Step 3: Simplify graph
    G = graph_processing.simplify_graph(
        G,
        min_edge_length=min_edge_length,
        min_edge_separation=min_edge_length * 2,
        undirected=True,
    )

    # Step 4: Save graph
    ox.save_graphml(G, streets_graph_path)

    # Step 5: Convert to GeoDataFrames
    street_nodes, street_edges = ox.graph_to_gdfs(G)

    # Save edges
    street_edges = street_edges.to_crs(aoi.crs)
    street_edges.reset_index().to_file(streets_path_edges, layer="edges", driver="GPKG")

    # Save nodes
    street_nodes = street_nodes.to_crs(aoi.crs)
    street_nodes.reset_index().to_file(streets_path_nodes, layer="nodes", driver="GPKG")

    print(f"Street graph saved to {streets_graph_path}")


if __name__ == "__main__":
    main()
