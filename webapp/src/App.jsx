import React, { useState, useEffect, useMemo } from "react";
import { 
  MapContainer, 
  TileLayer, 
  Marker, 
  Popup, 
  useMap, 
  FeatureGroup,
  GeoJSON,
  CircleMarker
} from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import L from "leaflet";
import { 
  Search, 
  Menu, 
  X, 
  Layers, 
  MapPin,
  Settings,
  HelpCircle,
  ChevronLeft,
  Clock,
  Activity,
  Database,
  Pencil,
  Star,
  Users,
} from "lucide-react";
import { union } from '@turf/union';
import { difference } from '@turf/difference';
import { featureCollection } from '@turf/helpers';
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

// --- Leaflet Icon Fix ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const DEFAULT_MAX_DISTANCE = 80000;
const DEFAULT_ELASTICITY = 0.1;

// --- HELPER COMPONENTS ---

// 1. WELCOME MODAL (Your GeoCare Version)
const WelcomeModal = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8 relative overflow-hidden">
        
        {/* Decorative background */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100 rounded-bl-full -mr-8 -mt-8 opacity-50 pointer-events-none"></div>

        <div className="relative z-10">
          <div className="w-12 h-12 flex items-center justify-center mb-6">
            <img src="/favicon.png" alt="GeoCare Logo" className="h-8 w-auto" />
          </div>
          
          <h2 className="text-3xl font-bold text-slate-900 mb-3">
            Welcome to GeoCare
          </h2>
          
          <p className="text-slate-600 text-lg mb-6 leading-relaxed">
            Explore and ask about healthcare facilities with our interactive AI mapping tool.
          </p>

          <div className="space-y-4 mb-8">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                <Search className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <h4 className="font-semibold text-slate-800">Search bar</h4>
                <p className="text-sm text-slate-500">Ask question related to healthcare facilities and nearby locations.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                <Pencil className="w-4 h-4 text-purple-500" />
              </div>
              <div>
                <h4 className="font-semibold text-slate-800">Select Areas</h4>
                <p className="text-sm text-slate-500">Draw and select specific zones on the map.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                <Star className="w-4 h-4 text-green-500" />
              </div>
              <div>
                <h4 className="font-semibold text-slate-800">Filter Results</h4>
                <p className="text-sm text-slate-500">Use the confidence rating system at the bottom to filter.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                <MapPin className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <h4 className="font-semibold text-slate-800">Select Points</h4>
                <p className="text-sm text-slate-500">Click on the map to select exact point locations.</p>
              </div>
            </div>

            
          </div>

          <button
            onClick={onClose}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98]"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
};

// 2. Star Rating Filter (Bottom Center)
const ConfidenceFilter = ({ value, onChange }) => {
  return (
    <div className="bg-white/60 backdrop-blur-md border border-slate-200 shadow-xl rounded-[20px] px-6 py-3 flex items-center gap-4 animate-in slide-in-from-bottom-10 duration-500">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 hidden sm:block">
        Confidence Threshold
      </span>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => onChange(star)}
            className={`transition-all duration-200 hover:scale-125 ${
              star <= value 
                ? "text-blue-600 fill-blue-600" 
                : "text-slate-300 fill-slate-100"
            }`}
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="24" 
              height="24" 
              viewBox="0 0 24 24" 
              fill="inherit" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="w-6 h-6"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        ))}
      </div>
      <div className="text-sm font-medium text-slate-700 min-w-[3rem] text-right">
        {value === 1 ? "All" : `${value} Stars`}
      </div>
    </div>
  );
};

// 3. Map Controller
function RecenterMap({ lat, lon, zoom = 7 }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lon) {
      map.flyTo([lat, lon], zoom, { duration: 1.5 });
    }
  }, [lat, lon, zoom, map]);
  return null;
}

// --- MAIN APP ---

export default function UrbanLayoutApp() {
  // Welcome Modal State
  const [showWelcome, setShowWelcome] = useState(true);

  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [showLayers, setShowLayers] = useState(false);
  const [mapLayer, setMapLayer] = useState('standard');
  
  // Data State
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [minConfidence, setMinConfidence] = useState(1); // 1 = Show All
  const [mapPosition, setMapPosition] = useState([7.983173013737491, -1.0916666895576415]); // Ghana

  // Coverage parameters (used to recompute isochrone/H3 accessibility layers)
  const [maxDistance, setMaxDistance] = useState(DEFAULT_MAX_DISTANCE);
  const [elasticity, setElasticity] = useState(DEFAULT_ELASTICITY);
  const [baseCoverageParams, setBaseCoverageParams] = useState({
    maxDistance: DEFAULT_MAX_DISTANCE,
    elasticity: DEFAULT_ELASTICITY,
  });

  // Loading State
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Coverage Layers (from pipeline)
  const [facilitiesLayer, setFacilitiesLayer] = useState(null);
  const [isochronesLayer, setIsochronesLayer] = useState(null);
  const [h3AccessibilityLayer, setH3AccessibilityLayer] = useState(null);
  const [h3PopulationLayer, setH3PopulationLayer] = useState(null);
  const [aoiLayer, setAoiLayer] = useState(null);  // Ghana boundary for "desert" visualization

  // Original layers from initial pipeline (for restoring when star filter returns to 1)
  const [origIsochronesLayer, setOrigIsochronesLayer] = useState(null);
  const [origH3AccessibilityLayer, setOrigH3AccessibilityLayer] = useState(null);

  // Coverage display mode: 'buffers' | 'h3'
  const [coverageMode, setCoverageMode] = useState('buffers');

  // Population overlay toggle (independent of coverage mode)
  const [showPopulation, setShowPopulation] = useState(false);
  // Population rendering mode: 'hex' (existing choropleth) | 'balls' (general_map-like circles)
  const [populationView, setPopulationView] = useState('hex');

  // Recompute loading state
  const [isRecomputing, setIsRecomputing] = useState(false);

  // Compute "desert" layer: Ghana boundary minus coverage areas
  const desertLayer = useMemo(() => {
    if (!aoiLayer) return null;

    const coverageData = coverageMode === 'buffers'
      ? isochronesLayer
      : h3AccessibilityLayer;

    if (!coverageData?.features?.length) {
      return aoiLayer; // No coverage — entire AOI is desert
    }

    // Union all coverage features into one polygon
    let coverageUnion = null;
    for (const feature of coverageData.features) {
      if (!feature.geometry) continue;
      if (coverageUnion === null) {
        coverageUnion = feature;
      } else {
        try {
          coverageUnion = union(featureCollection([coverageUnion, feature]));
        } catch (e) {
          console.warn('Union failed for feature, skipping:', e);
        }
      }
    }

    if (!coverageUnion) return aoiLayer;

    // Subtract coverage from each AOI feature
    const desertFeatures = [];
    for (const aoiFeature of aoiLayer.features) {
      try {
        const desert = difference(featureCollection([aoiFeature, coverageUnion]));
        if (desert) desertFeatures.push(desert);
      } catch (e) {
        console.warn('Difference failed:', e);
      }
    }

    return desertFeatures.length > 0
      ? { type: 'FeatureCollection', features: desertFeatures }
      : null;
  }, [aoiLayer, isochronesLayer, h3AccessibilityLayer, coverageMode]);
  
  // Desert style - brown fill for healthcare "deserts" (uncovered areas)
  const getAoiStyle = () => ({
    // Softer "sand" tone so the desert context is visible but not overwhelming.
    fillColor: '#B38A57',
    fillOpacity: 0.26,
    weight: 1,
    color: '#8E6B43',
    opacity: 0.35,
    lineJoin: 'round',
    lineCap: 'round',
  });

  // Isochrone style function - color by accessibility
  const getIsochroneStyle = (feature) => {
    const accessibility = parseFloat(feature.properties.accessibility) || 0;
    // Color scale: red (low) → yellow → green (high)
    const hue = accessibility * 120; // 0=red, 60=yellow, 120=green
    return {
      fillColor: `hsl(${hue}, 80%, 45%)`,
      fillOpacity: 0.6,  // Increased from 0.4
      weight: 2,         // Thicker border
      color: `hsl(${hue}, 80%, 30%)`,
      opacity: 1.0,
    };
  };

  // Population style function - choropleth by population density
  const getPopulationStyle = (feature) => {
    const pop = feature.properties?.population || 0;
    // Log scale: most cells 0-5000, some up to 50k+
    const t = Math.min(Math.log10(Math.max(pop, 1)) / 4.5, 1); // log10(~30000)≈4.5
    // Light purple → dark purple
    const lightness = 85 - t * 50; // 85% (light) → 35% (dark)
    return {
      fillColor: `hsl(270, 60%, ${lightness}%)`,
      fillOpacity: 0.45,
      weight: 1,
      color: `hsl(270, 60%, ${Math.max(lightness - 15, 20)}%)`,
      opacity: 0.4,
    };
  };

  // Build population "balls" using the same scaling pattern as general_map:
  // radius = max_radius * clip(population, 0, p90) / p90
  const populationBallMarkers = useMemo(() => {
    const features = h3PopulationLayer?.features;
    if (!features?.length) return [];

    const getFeatureCenter = (geometry) => {
      if (!geometry) return null;
      if (geometry.type === 'Point') {
        const [lon, lat] = geometry.coordinates || [];
        return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
      }

      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;

      const visit = (coords) => {
        if (!Array.isArray(coords)) return;
        if (coords.length === 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
          const [lon, lat] = coords;
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
          minLon = Math.min(minLon, lon);
          maxLon = Math.max(maxLon, lon);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          return;
        }
        for (const child of coords) visit(child);
      };

      visit(geometry.coordinates);
      if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) {
        return null;
      }
      return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
    };

    const quantile = (values, q) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const pos = (sorted.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      const upper = sorted[base + 1];
      return upper !== undefined
        ? sorted[base] + rest * (upper - sorted[base])
        : sorted[base];
    };

    const populations = features
      .map((feature) => Number(feature.properties?.population) || 0)
      .filter((value) => value > 0);
    const p90 = quantile(populations, 0.9);
    const maxRadius = 12; // matches general_map default max_radius

    return features
      .map((feature, idx) => {
        const center = getFeatureCenter(feature.geometry);
        if (!center) return null;

        const pop = Number(feature.properties?.population) || 0;
        const clipped = p90 > 0 ? Math.min(Math.max(pop, 0), p90) : pop;
        const radius = p90 > 0 ? (maxRadius * clipped) / p90 : maxRadius;
        return {
          id: feature.properties?.h3_cell || `cell-${idx}`,
          center,
          pop,
          radius: Math.max(radius, 1.5),
          fillColor: '#111111',
        };
      })
      .filter(Boolean);
  }, [h3PopulationLayer]);

  // Search Logic - calls FastAPI pipeline (ranking + coverage)
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    setFacilitiesLayer(null);
    setIsochronesLayer(null);

    try {
      const res = await fetch("http://localhost:8000/search/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          max_distance: maxDistance,
          elasticity,
        }),
      });
      
      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`);
      }
      
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Set GeoJSON layers for map
      if (data.layers?.aoi) setAoiLayer(data.layers.aoi);
      if (data.layers?.facilities) setFacilitiesLayer(data.layers.facilities);
      if (data.layers?.isochrones) {
        setIsochronesLayer(data.layers.isochrones);
        setOrigIsochronesLayer(data.layers.isochrones);
      }
      if (data.layers?.h3_accessibility) {
        setH3AccessibilityLayer(data.layers.h3_accessibility);
        setOrigH3AccessibilityLayer(data.layers.h3_accessibility);
      }
      if (data.layers?.h3_population) setH3PopulationLayer(data.layers.h3_population);

      const cfgMaxDistance = Number(data.config?.max_distance ?? maxDistance);
      const cfgElasticity = Number(data.config?.elasticity ?? elasticity);
      setBaseCoverageParams({
        maxDistance: cfgMaxDistance,
        elasticity: cfgElasticity,
      });
      setMaxDistance(cfgMaxDistance);
      setElasticity(cfgElasticity);

      // Reset star filter to "All" on new search
      setMinConfidence(1);
      
      // Map facilities to sidebar format
      const facilities = data.layers?.facilities?.features || [];
      const enrichedData = facilities.map((f, index) => ({
        place_id: `facility_${f.properties.pk_unique_id || index}`,
        name: f.properties.name,
        display_name: f.properties.name + (f.properties.reason ? ` — ${f.properties.reason}` : ""),
        officialWebsite: f.properties.officialWebsite,
        capabilities: f.properties.capabilities || [],
        confidenceScore: f.properties.stars,
        lat: f.geometry?.coordinates?.[1],
        lon: f.geometry?.coordinates?.[0],
      }));

      setResults(enrichedData);
      setSidebarOpen(true);
      
      // Center map on Ghana if we got results
      if (enrichedData.length > 0) {
        setMapPosition([7.9, -1.0]); // Center of Ghana
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchError(error.message);
    } finally {
      setIsSearching(false);
    }
  };

  // Recompute coverage when the star filter or coverage parameters change
  useEffect(() => {
    if (!facilitiesLayer) return;

    const isAtBaseParams =
      maxDistance === baseCoverageParams.maxDistance &&
      Math.abs(elasticity - baseCoverageParams.elasticity) < 1e-9;

    // If we're back to the base query config and no star filtering, restore original layers.
    if (minConfidence === 1 && isAtBaseParams) {
      if (origIsochronesLayer) setIsochronesLayer(origIsochronesLayer);
      if (origH3AccessibilityLayer) setH3AccessibilityLayer(origH3AccessibilityLayer);
      setIsRecomputing(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setIsRecomputing(true);

      fetch("http://localhost:8000/coverage/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_stars: minConfidence,
          max_distance: maxDistance,
          elasticity,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          if (data.layers?.isochrones) setIsochronesLayer(data.layers.isochrones);
          else setIsochronesLayer(null);
          if (data.layers?.h3_accessibility) setH3AccessibilityLayer(data.layers.h3_accessibility);
          else setH3AccessibilityLayer(null);
        })
        .catch((err) => console.error("Recompute failed:", err))
        .finally(() => { if (!cancelled) setIsRecomputing(false); });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    minConfidence,
    maxDistance,
    elasticity,
    facilitiesLayer,
    origIsochronesLayer,
    origH3AccessibilityLayer,
    baseCoverageParams.maxDistance,
    baseCoverageParams.elasticity,
  ]);

  // Filter Results based on Confidence Selector
  const filteredResults = useMemo(() => {
    return results.filter(r => r.confidenceScore >= minConfidence);
  }, [results, minConfidence]);

  // Population coverage stats by accessibility step (0.0 .. 1.0)
  const coveragePopulationStats = useMemo(() => {
    const popFeatures = h3PopulationLayer?.features || [];
    if (!popFeatures.length) {
      return {
        hasData: false,
        totalPopulation: 0,
        coveredPopulation: 0,
        weightedAccessibility: 0,
        rows: [],
      };
    }

    const getCellKey = (feature) => {
      const key = feature?.properties?.h3_cell ?? feature?.id;
      if (key === undefined || key === null) return null;
      return String(key);
    };

    const accessibilityByCell = new Map();
    for (const feature of h3AccessibilityLayer?.features || []) {
      const cell = getCellKey(feature);
      if (!cell) continue;
      const accessibility = Number(feature.properties?.accessibility);
      if (!Number.isFinite(accessibility)) continue;
      const clamped = Math.max(0, Math.min(1, accessibility));
      accessibilityByCell.set(cell, clamped);
    }

    const stepsAsc = Array.from({ length: 11 }, (_, idx) => (idx / 10).toFixed(1));
    const stepPopulation = new Map(stepsAsc.map((step) => [step, 0]));

    // Tolerance for high-accessibility buckets: helps avoid undercounting
    // near-threshold cells caused by discretization and H3 boundary effects.
    const getToleratedAccessibilityForStep = (value) => {
      if (!Number.isFinite(value)) return 0;
      const clamped = Math.max(0, Math.min(1, value));
      if (clamped >= 0.55) {
        return Math.min(1, clamped + 0.08);
      }
      return clamped;
    };

    let totalPopulation = 0;
    let coveredPopulation = 0;
    let weightedAccessibilitySum = 0;

    for (const feature of popFeatures) {
      const population = Number(feature.properties?.population) || 0;
      if (!Number.isFinite(population) || population <= 0) continue;

      totalPopulation += population;

      const cell = getCellKey(feature);
      const accessibility = cell && accessibilityByCell.has(cell)
        ? accessibilityByCell.get(cell)
        : 0;

      if (accessibility > 0) {
        coveredPopulation += population;
      }
      weightedAccessibilitySum += population * accessibility;

      const toleratedForStep = getToleratedAccessibilityForStep(accessibility);
      const step = (Math.round(toleratedForStep * 10) / 10).toFixed(1);
      stepPopulation.set(step, (stepPopulation.get(step) || 0) + population);
    }

    const weightedAccessibility = totalPopulation > 0
      ? weightedAccessibilitySum / totalPopulation
      : 0;

    const rows = [...stepsAsc].reverse().map((step) => {
      const population = stepPopulation.get(step) || 0;
      const percentage = totalPopulation > 0
        ? (population / totalPopulation) * 100
        : 0;
      return { step, population, percentage };
    });

    return {
      hasData: true,
      totalPopulation,
      coveredPopulation,
      weightedAccessibility,
      rows,
    };
  }, [h3PopulationLayer, h3AccessibilityLayer]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900 font-sans text-slate-900">
      
      {/* Welcome Modal */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      
      {/* =========================================
          4. MAIN CONTENT AREA (The Map)
          Z-Index: 0 (Base Layer)
      ========================================= */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={mapPosition}
          zoom={1}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          {/* Tile Layer */}
          <TileLayer
            attribution={mapLayer === 'satellite' ? '&copy; OpenTopoMap' : mapLayer === 'dark' ? '&copy; CartoDB' : '&copy; OSM'}
            url={mapLayer === 'standard' ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' : mapLayer === 'light' ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' : mapLayer === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'}
          />
          
          <RecenterMap lat={mapPosition[0]} lon={mapPosition[1]} />

          {/* Desert Layer - Brown fill only for areas NOT covered by isochrones */}
          {desertLayer && (
            <GeoJSON
              key={`desert-${coverageMode}-${minConfidence}-${Date.now()}`}
              data={desertLayer}
              style={getAoiStyle}
            />
          )}

          {/* Ghana border outline (always visible when data loaded) */}
          {aoiLayer && (
            <GeoJSON
              key={`aoi-border-${Date.now()}`}
              data={aoiLayer}
              style={() => ({
                fillColor: 'transparent',
                fillOpacity: 0,
                weight: 1.5,
                color: '#6B4E2E',
                opacity: 0.75,
                lineJoin: 'round',
                lineCap: 'round',
              })}
            />
          )}

          {/* Coverage Layer - Buffers or H3 Hexagons */}
          {coverageMode === 'buffers' && isochronesLayer && (
            <GeoJSON
              key={`isochrones-${minConfidence}-${Date.now()}`}
              data={isochronesLayer}
              style={getIsochroneStyle}
            />
          )}
          {coverageMode === 'h3' && h3AccessibilityLayer && (
            <GeoJSON
              key={`h3-${minConfidence}-${Date.now()}`}
              data={h3AccessibilityLayer}
              style={getIsochroneStyle}
            />
          )}
          {/* Population Overlay (hex mode) */}
          {showPopulation && populationView === 'hex' && h3PopulationLayer && (
            <GeoJSON
              key={`population-${Date.now()}`}
              data={h3PopulationLayer}
              style={getPopulationStyle}
            />
          )}
          {/* Population Overlay (ball mode) */}
          {showPopulation && populationView === 'balls' && populationBallMarkers.map((marker) => (
            <CircleMarker
              key={`population-ball-${marker.id}`}
              center={marker.center}
              radius={marker.radius}
              pathOptions={{
                fillColor: marker.fillColor,
                fillOpacity: 0.8,
                color: 'transparent',
                weight: 0,
                opacity: 1.0,
              }}
            >
              <Popup>
                <div className="p-1 text-sm">
                  <strong>Population</strong>: {Math.round(marker.pop).toLocaleString()}
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* Facility Markers from GeoJSON */}
          {facilitiesLayer && facilitiesLayer.features?.map((feature, idx) => {
            const coords = feature.geometry?.coordinates;
            if (!coords) return null;
            const stars = feature.properties?.stars || 0;
            // Color by star rating: 5=green, 3=yellow, 1=red
            const hue = (stars / 5) * 120;
            return (
              <CircleMarker
                key={`facility-${feature.properties?.pk_unique_id || idx}`}
                center={[coords[1], coords[0]]}
                radius={8 + stars}
                pathOptions={{
                  fillColor: `hsl(${hue}, 70%, 50%)`,
                  fillOpacity: 0.9,
                  weight: 2,
                  color: 'white',
                }}
              >
                <Popup>
                  <div className="p-2">
                    <strong className="block mb-1 text-lg">{feature.properties?.name}</strong>
                    <div className="flex items-center gap-1 mb-2">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-4 h-4 ${i < stars ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                      ))}
                      <span className="ml-1 text-sm text-gray-600">({stars}/5)</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{feature.properties?.reason}</p>
                    {feature.properties?.officialWebsite && (
                      <a 
                        href={`https://${feature.properties.officialWebsite}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                      >
                        {feature.properties.officialWebsite}
                      </a>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

          {/* Legacy Markers for Filtered Results (fallback) */}
          {filteredResults.filter(p => p.lat && p.lon).map((place) => (
            <Marker 
              key={place.place_id} 
              position={[parseFloat(place.lat), parseFloat(place.lon)]}
            >
              <Popup>
                <div className="p-1">
                   <strong className="block mb-1">{place.display_name.split(',')[0]}</strong>
                   <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                     {place.confidenceScore} Star Confidence
                   </span>
                </div>
              </Popup>
            </Marker>
          ))}

          
        </MapContainer>
      </div>


      {/* =========================================
          2. TOP NAVIGATION BAR (Global Controls)
          Z-Index: 50
      ========================================= */}
      <div className="absolute top-0 left-0 w-full z-50 pointer-events-none p-4 flex justify-between items-start">
        
        {/* Left: Branding & Sidebar Toggle */}
        <div className="pointer-events-auto flex items-center gap-3">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="bg-white p-3 rounded-[20px] shadow-lg border border-slate-200 hover:bg-slate-50 transition-transform hover:scale-105 active:scale-95"
          >
            {sidebarOpen ? <ChevronLeft className="w-5 h-5"/> : <Menu className="w-5 h-5"/>}
          </button>

          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="Logo" className="h-6 w-auto" />
            <span className="font-bold text-slate-800 tracking-tight">GeoCare</span>
          </div>
        </div>

        {/* Center: Search Command Bar */}
        <div className="pointer-events-auto flex flex-col items-center w-full max-w-xl mx-4">
           <div className="relative w-full shadow-2xl rounded-2xl">
             <form onSubmit={handleSearch} className="relative">
               <input 
                 type="text" 
                 placeholder="Search for healthcare nearby locations..." 
                 className="w-full pl-5 pr-12 py-3.5 bg-white/70 backdrop-blur rounded-2xl border-0 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-800 placeholder:text-slate-400"
                 value={query}
                 onChange={(e) => setQuery(e.target.value)}
               />
               <button type="submit" className="absolute right-2 top-2 p-1.5 bg-blue-600 rounded-xl text-white hover:bg-blue-700 transition-colors">
                 <Search className="w-5 h-5" />
               </button>
             </form>
           </div>
           
           {/* Quick Options Under Search */}
           <div className="flex gap-2 mt-3 animate-in fade-in slide-in-from-top-2">
             {/* Coverage Mode Toggle (Buffers ↔ H3) */}
             <button
               onClick={() => setCoverageMode(coverageMode === 'buffers' ? 'h3' : 'buffers')}
               className={`flex items-center gap-1.5 px-3 py-1.5 backdrop-blur rounded-full text-xs font-semibold shadow-sm border transition-colors ${
                 coverageMode === 'h3'
                   ? 'bg-blue-500 text-white border-blue-600'
                   : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50'
               }`}
             >
               <Layers className="w-3 h-3" />
               {coverageMode === 'buffers' ? 'Buffers' : 'H3 Hexagons'}
             </button>
             <button
               onClick={() => setShowPopulation((prev) => !prev)}
               className={`flex items-center gap-1.5 px-3 py-1.5 backdrop-blur rounded-full text-xs font-semibold shadow-sm border transition-colors ${
                 showPopulation
                   ? 'bg-purple-500 text-white border-purple-600'
                   : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50'
               }`}
               title="Toggle population overlay"
             >
               <Users className="w-3 h-3" />
               Population
             </button>
             <button
               onClick={() => setPopulationView((prev) => (prev === 'hex' ? 'balls' : 'hex'))}
               className={`flex items-center gap-1.5 px-3 py-1.5 backdrop-blur rounded-full text-xs font-semibold shadow-sm border transition-colors ${
                 populationView === 'balls'
                   ? 'bg-indigo-500 text-white border-indigo-600'
                   : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50'
               }`}
               title="Switch population view mode"
             >
               {populationView === 'hex' ? 'Pop: Hex' : 'Pop: Balls'}
             </button>
           </div>
        </div>

        {/* Right: Help Button */}
        <div className="pointer-events-auto">
          <button onClick={() => setShowWelcome(true)} className="bg-white p-3 rounded-[20px] shadow-lg border border-slate-200 hover:bg-slate-50 transition-transform hover:scale-105 active:scale-95" title="Help">
             <HelpCircle className="w-5 h-5 text-slate-700" />
          </button>
        </div>
      </div>


      {/* =========================================
          3. LEFT SIDEBAR (Results Panel)
          Z-Index: 40
      ========================================= */}
      <div 
        className={`absolute top-0 left-0 h-full w-80 bg-white/60 backdrop-blur-md shadow-2xl z-40 transform transition-transform duration-300 pt-24 border-r border-slate-200 flex flex-col ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 pb-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="font-bold text-lg text-slate-800">Results</h2>
          <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
            {filteredResults.length} found
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
           {/* Loading State */}
           {isSearching && (
             <div className="text-center p-8 text-slate-500 text-sm">
               <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
               Searching facilities...
             </div>
           )}

           {/* Error State */}
           {searchError && !isSearching && (
             <div className="text-center p-4 text-red-500 text-sm bg-red-50 rounded-xl mx-2">
               {searchError}
             </div>
           )}

           {/* Empty State */}
           {results.length === 0 && !isSearching && !searchError && (
             <div className="text-center p-8 text-slate-400 text-sm">
               Ask a healthcare question to find facilities.
             </div>
           )}

           {/* Results List */}
           {!isSearching && filteredResults.map((place) => (
             <div 
               key={place.place_id}
               className="p-3 rounded-xl hover:bg-blue-50 cursor-pointer group transition-colors border border-transparent hover:border-blue-100"
             >
               <h3 className="font-semibold text-slate-800 text-sm group-hover:text-blue-600 mb-1">
                 {place.name || "Unknown Facility"}
               </h3>
               <p className="text-xs text-slate-500 line-clamp-2 mb-2">
                 {place.display_name}
               </p>
               
               {/* Website Link */}
               {place.officialWebsite && (
                 <a 
                   href={place.officialWebsite} 
                   target="_blank" 
                   rel="noopener noreferrer"
                   onClick={(e) => e.stopPropagation()}
                   className="text-xs text-blue-600 hover:underline block mb-2"
                 >
                   Visit Website →
                 </a>
               )}
               
               {/* Confidence Score Stars */}
               <div className="flex items-center gap-2">
                 <div className="flex text-yellow-400">
                   {[...Array(place.confidenceScore || 0)].map((_, i) => (
                     <svg key={i} className="w-3 h-3 fill-current" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                   ))}
                 </div>
                 <span className="text-[10px] text-slate-400 font-medium">Relevance</span>
               </div>
             </div>
           ))}
        </div>
      </div>


      {/* =========================================
          5. RIGHT-SIDE OVERLAY (Map Filters)
          Z-Index: 40
      ========================================= */}
      <div className={`absolute top-24 right-4 w-64 max-h-[calc(100vh-12rem)] overflow-y-auto bg-white/60 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200 z-40 p-5 transition-all duration-300 origin-top-right ${rightPanelOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
         <div className="flex justify-between items-center mb-4">
           <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
             <Settings className="w-4 h-4" /> Map Panel
           </h3>
           <button onClick={() => setRightPanelOpen(false)} className="text-slate-400 hover:text-slate-600">
             <X className="w-4 h-4" />
           </button>
         </div>

         {/* Coverage: Max Distance */}
         <div className="mb-6">
           <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-3">
             <Clock className="w-3 h-3" /> Max Distance
           </label>
           <div className="text-sm text-slate-700 font-medium mb-2">
             {(maxDistance / 1000).toFixed(0)} km
           </div>
           <input
             type="range"
             min="10000"
             max="100000"
             step="1000"
             value={maxDistance}
             onChange={(e) => setMaxDistance(Number(e.target.value))}
             className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
           />
           <div className="flex justify-between text-[10px] text-slate-400 mt-1">
             <span>10 km</span>
             <span>100 km</span>
           </div>
         </div>

         {/* Coverage: Elasticity */}
         <div className="mb-6">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-3">
             <Activity className="w-3 h-3" /> Elasticity
           </label>
           <div className="text-sm text-slate-700 font-medium mb-2">
             {elasticity.toFixed(1)} (sensibility to distance)
           </div>
           <input
             type="range"
             min="0.1"
             max="2"
             step="0.1"
             value={elasticity}
             onChange={(e) => setElasticity(Number(e.target.value))}
             className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
           />
           <div className="flex justify-between text-[10px] text-slate-400 mt-1">
             <span>0.1 not sensible</span>
             <span>2.0 very sensible</span>
           </div>
         </div>

         {/* Population Coverage Stats (always visible) */}
         <div className="space-y-3 border-t border-slate-200 pt-3">
           <p className="text-xs text-slate-500">
             Population by coverage step (accessibility 0.0 to 1.0), computed from H3 population and current coverage.
           </p>

           {!coveragePopulationStats.hasData && (
             <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
               Run a search to view coverage statistics.
             </div>
           )}

           {coveragePopulationStats.hasData && (
             <>
               <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
                 <div className="flex justify-between text-xs text-slate-600">
                   <span>Total Population</span>
                   <span className="font-semibold text-slate-700">{Math.round(coveragePopulationStats.totalPopulation).toLocaleString()}</span>
                 </div>
                 <div className="flex justify-between text-xs text-slate-600">
                   <span>Covered (&gt; 0.0)</span>
                   <span className="font-semibold text-slate-700">
                     {coveragePopulationStats.totalPopulation > 0
                       ? ((coveragePopulationStats.coveredPopulation / coveragePopulationStats.totalPopulation) * 100).toFixed(1)
                       : '0.0'}%
                   </span>
                 </div>
                 <div className="flex justify-between text-xs text-slate-600">
                   <span>Weighted Accessibility</span>
                   <span className="font-semibold text-slate-700">{coveragePopulationStats.weightedAccessibility.toFixed(2)}</span>
                 </div>
               </div>

               <div className="pr-1 space-y-1">
                 {coveragePopulationStats.rows.map((row) => {
                   const hue = Number(row.step) * 120;
                   return (
                     <div key={`coverage-step-${row.step}`}>
                       <div className="flex justify-between text-xs text-slate-700">
                         <span>Step {row.step}</span>
                         <span>{row.percentage.toFixed(1)}%</span>
                       </div>
                       <div className="h-1.5 bg-slate-200 rounded mt-1 overflow-hidden">
                         <div
                           className="h-full"
                           style={{
                             width: `${Math.max(0, Math.min(100, row.percentage))}%`,
                             backgroundColor: `hsl(${hue}, 75%, 45%)`,
                           }}
                         />
                       </div>
                     </div>
                   );
                 })}
               </div>
             </>
           )}
         </div>
      </div>


      {/* =========================================
          6. BOTTOM CONFIDENCE SELECTOR
          Z-Index: 50
      ========================================= */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md flex justify-center items-center gap-3 px-4">
        <ConfidenceFilter value={minConfidence} onChange={setMinConfidence} />
        {isRecomputing && (
          <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" title="Recomputing coverage..." />
        )}
      </div>


      {/* =========================================
          7. LAYERS CONTROL (Bottom Right)
          Z-Index: 50
      ========================================= */}
      <div className={`absolute bottom-8 right-4 z-50 flex flex-col transition-all duration-300 ${showLayers ? 'gap-44' : 'gap-3'}`}>
         {/* Toggle for the Right Panel (if closed) */}
         {!rightPanelOpen && (
           <button 
             onClick={() => setRightPanelOpen(true)}
             className="bg-white p-3 rounded-full shadow-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600"
             title="Open Filters"
           >
             <Settings className="w-5 h-5" />
           </button>
         )}

         {/* Actual Layers Button */}
         <div className="relative">
            {showLayers && (
              <div className="absolute bottom-full right-0 mb-3 w-40 bg-white rounded-xl shadow-xl border border-slate-200 p-2 animate-in fade-in slide-in-from-bottom-2">
                <button onClick={() => { setMapLayer('standard'); setShowLayers(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 rounded-lg font-medium ${mapLayer === 'standard' ? 'text-blue-600 bg-blue-50' : 'text-slate-600'}`}>
                   Standard
                </button>
                <button onClick={() => { setMapLayer('light'); setShowLayers(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 rounded-lg font-medium ${mapLayer === 'light' ? 'text-blue-600 bg-blue-50' : 'text-slate-600'}`}>
                   Light
                </button>
                <button onClick={() => { setMapLayer('dark'); setShowLayers(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 rounded-lg font-medium ${mapLayer === 'dark' ? 'text-blue-600 bg-blue-50' : 'text-slate-600'}`}>
                   Dark
                </button>
                <button onClick={() => { setMapLayer('satellite'); setShowLayers(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 rounded-lg font-medium ${mapLayer === 'satellite' ? 'text-blue-600 bg-blue-50' : 'text-slate-600'}`}>
                   Satellite
                </button>
              </div>
            )}
            <button 
              onClick={() => setShowLayers(!showLayers)}
              className="bg-slate-800 p-3 rounded-full shadow-xl text-white hover:bg-slate-700 transition-transform hover:scale-105"
            >
              <Layers className="w-5 h-5" />
            </button>
         </div>
      </div>

    </div>
  );
}
