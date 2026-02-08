import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  MapContainer, 
  TileLayer, 
  Marker, 
  Popup, 
  useMap, 
  FeatureGroup,
  GeoJSON,
  CircleMarker,
  useMapEvents 
} from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import L from "leaflet";
import { 
  Search, 
  Menu, 
  X, 
  Layers, 
  Filter, 
  MapPin,
  Settings,
  ChevronLeft,
  Clock,
  Activity,
  Database,
  Info,
  CheckCircle,
  Pin,
  Pencil,
  Star,
  HelpCircle,
  ExternalLink,
  Navigation,
  Trash2,
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

// --- HELPER COMPONENTS ---

// 1. WELCOME MODAL
const WelcomeModal = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100 rounded-bl-full -mr-8 -mt-8 opacity-50 pointer-events-none"></div>
        <div className="relative z-10">
          <div className="w-12 h-12 flex items-center justify-center mb-6">
            <img src="/favicon.png" alt="GeoCare Logo" className="h-8 w-auto" />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-3">Welcome to GeoCare</h2>
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

// 2. Star Rating Filter
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
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="inherit" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
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
function RecenterMap({ lat, lon, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lon) {
      map.flyTo([lat, lon], zoom || map.getZoom(), { duration: 1.5 });
    }
  }, [lat, lon, zoom, map]);
  return null;
}

// 4. Custom Draw Handler
const MapDrawHandler = ({ isDrawing, onDrawReady, onDrawCreated }) => {
  const map = useMap();
  const drawHandlerRef = useRef(null);

  useEffect(() => {
    if (isDrawing) {
      drawHandlerRef.current = new L.Draw.Polygon(map, {
        allowIntersection: true,
        showArea: true,
        showLength: true,
        guidelineDistance: 15,
        shapeOptions: {
          color: '#2563eb',
          weight: 4,
          opacity: 0.7,
          fillOpacity: 0.2
        },
        touchIcon: null,
      });

      drawHandlerRef.current.enable();
      if(onDrawReady) onDrawReady();

      const handleCreated = (e) => {
        const layer = e.layer;
        onDrawCreated(layer);
        map.addLayer(layer);
        drawHandlerRef.current.disable();
      };

      map.on(L.Draw.Event.CREATED, handleCreated);

      return () => {
        if (drawHandlerRef.current) drawHandlerRef.current.disable();
        map.off(L.Draw.Event.CREATED, handleCreated);
      };
    }
  }, [isDrawing, map, onDrawCreated, onDrawReady]);

  return null;
};

// Red marker icon for point capture
const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// 5. Point Capture Handler
const PointCaptureHandler = ({ isActive, onPointCaptured }) => {
  useMapEvents({
    click(e) {
      if (isActive) {
        onPointCaptured(e.latlng);
      }
    }
  });
  return null;
};

// --- MAIN APP ---

export default function App() {
  // UI State
  const [showWelcome, setShowWelcome] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [showLayers, setShowLayers] = useState(false);
  const [mapLayer, setMapLayer] = useState('satellite');
  
  // Expandable sidebar cards
  const [expandedId, setExpandedId] = useState(null);

  // Data State
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [minConfidence, setMinConfidence] = useState(1);
  const [mapPosition, setMapPosition] = useState([7.983173013737491, -1.0916666895576415]); // Ghana Default

  // Drawing State
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [aoi, setAoi] = useState(null);
  const featureGroupRef = useRef(null);
  const drawnLayersRef = useRef([]);

  // Mock Settings
  const [timeRange, setTimeRange] = useState(50);
  const [popularity, setPopularity] = useState(true);

  // Point capture state
  const [isPointMode, setIsPointMode] = useState(false);
  const [poiList, setPoiList] = useState([]);

  // Loading State
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Coverage Layers from pipeline
  const [facilitiesLayer, setFacilitiesLayer] = useState(null);
  const [isochronesLayer, setIsochronesLayer] = useState(null);
  const [h3AccessibilityLayer, setH3AccessibilityLayer] = useState(null);
  const [h3PopulationLayer, setH3PopulationLayer] = useState(null);
  const [aoiLayer, setAoiLayer] = useState(null);

  // Original layers for restoring when star filter returns to 1
  const [origIsochronesLayer, setOrigIsochronesLayer] = useState(null);
  const [origH3AccessibilityLayer, setOrigH3AccessibilityLayer] = useState(null);

  // Coverage display mode: 'buffers' | 'h3'
  const [coverageMode, setCoverageMode] = useState('buffers');

  // Population overlay toggle
  const [showPopulation, setShowPopulation] = useState(false);

  // Recompute loading state
  const [isRecomputing, setIsRecomputing] = useState(false);

  // Helper function to format capability strings
  const formatCapability = (text) => {
    return text.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Compute "desert" layer: Ghana boundary minus coverage areas
  const desertLayer = useMemo(() => {
    if (!aoiLayer) return null;

    const coverageData = coverageMode === 'buffers'
      ? isochronesLayer
      : h3AccessibilityLayer;

    if (!coverageData?.features?.length) {
      return aoiLayer;
    }

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
  
  // Desert style
  const getAoiStyle = () => ({
    fillColor: '#8B4513',
    fillOpacity: 0.55,
    weight: 0,
    color: 'transparent',
    opacity: 0,
  });

  // Isochrone style function
  const getIsochroneStyle = (feature) => {
    const accessibility = parseFloat(feature.properties.accessibility) || 0;
    const hue = accessibility * 120;
    return {
      fillColor: `hsl(${hue}, 80%, 45%)`,
      fillOpacity: 0.6,
      weight: 2,
      color: `hsl(${hue}, 80%, 30%)`,
      opacity: 1.0,
    };
  };

  // Population style function
  const getPopulationStyle = (feature) => {
    const pop = feature.properties?.population || 0;
    const t = Math.min(Math.log10(Math.max(pop, 1)) / 4.5, 1);
    const lightness = 85 - t * 50;
    return {
      fillColor: `hsl(270, 60%, ${lightness}%)`,
      fillOpacity: 0.45,
      weight: 1,
      color: `hsl(270, 60%, ${Math.max(lightness - 15, 20)}%)`,
      opacity: 0.4,
    };
  };

  // --- Handlers ---

  // Search Logic - calls FastAPI pipeline
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
        body: JSON.stringify({ query: query.trim() }),
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

      // Reset star filter to "All" on new search
      setMinConfidence(1);
      
      // Map facilities to sidebar format
      const facilities = data.layers?.facilities?.features || [];
      const enrichedData = facilities.map((f, index) => ({
        place_id: `facility_${f.properties.pk_unique_id || index}`,
        name: f.properties.name,
        display_name: f.properties.name + (f.properties.reason ? ` — ${f.properties.reason}` : ""),
        reason: f.properties.reason || "",
        officialWebsite: f.properties.officialWebsite,
        capabilities: f.properties.capabilities || [],
        score: f.properties.stars,
        lat: f.geometry?.coordinates?.[1],
        lon: f.geometry?.coordinates?.[0],
      }));

      setResults(enrichedData);
      setSidebarOpen(true);
      setExpandedId(null);
      
      // Center map on Ghana if we got results
      if (enrichedData.length > 0) {
        setMapPosition([7.9, -1.0]);
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchError(error.message);
    } finally {
      setIsSearching(false);
    }
  };
 
  // Point selection handlers
  const handlePointSelectionClick = () => {
    setIsPointMode(!isPointMode);
    setIsDrawingMode(false);
    setSidebarOpen(false);
  };

  const handlePointCaptured = (latlng) => {
    const newIndex = poiList.length + 1; 
    const newPoint = {
      id: `poi_${newIndex}`, 
      index: newIndex,
      lat: latlng.lat,
      lng: latlng.lng
    };
    setPoiList(prev => [...prev, newPoint]);
  };

  const clearPois = () => {
    setPoiList([]);        
    setIsPointMode(false); 
  };

  // Area drawing handlers
  const handleAreaSelectionClick = () => {
    setIsDrawingMode(true);
    setSidebarOpen(false);
    setRightPanelOpen(false);
  };

  const handleDrawCreated = (layer) => {
    const geoJson = layer.toGeoJSON();
    const data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            id: Date.now(),
            area_type: "aoi_selection"
          },
          geometry: geoJson.geometry
        }
      ]
    };
    setAoi(data);
    drawnLayersRef.current.push(layer);
    setIsDrawingMode(false);
  };

  const clearAoi = () => {
    setAoi(null);
    if (featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
    }
    drawnLayersRef.current.forEach(layer => {
      if (layer && layer._map) {
        layer._map.removeLayer(layer);
      }
    });
    drawnLayersRef.current = [];
  };

  // Recompute coverage when star filter changes
  useEffect(() => {
    if (minConfidence === 1) {
      if (origIsochronesLayer) setIsochronesLayer(origIsochronesLayer);
      if (origH3AccessibilityLayer) setH3AccessibilityLayer(origH3AccessibilityLayer);
      return;
    }
    if (!facilitiesLayer) return;

    let cancelled = false;
    setIsRecomputing(true);

    fetch("http://localhost:8000/coverage/recompute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ min_stars: minConfidence }),
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

    return () => { cancelled = true; };
  }, [minConfidence]);

  // Filter Results based on Confidence Selector
  const filteredResults = useMemo(() => {
    return results.filter(r => r.score >= minConfidence);
  }, [results, minConfidence]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900 font-sans text-slate-900">
      
      {/* 1. Welcome Modal */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      
      {/* 2. Map Area */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={mapPosition}
          zoom={8}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            attribution={
              mapLayer === 'satellite' ? '&copy; OpenTopoMap' : 
              mapLayer === 'dark' ? '&copy; CartoDB' : 
              '&copy; OSM'
            }
            url={
              mapLayer === 'standard' ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' : 
              mapLayer === 'light' ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' : 
              mapLayer === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 
              'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
            }
          />
          
          <RecenterMap lat={mapPosition[0]} lon={mapPosition[1]} />
          
          {/* Custom Drawing Logic */}
          <MapDrawHandler 
            isDrawing={isDrawingMode}
            onDrawReady={() => console.log("Ready to draw")}
            onDrawCreated={handleDrawCreated}
          />

          {/* Desert Layer - Brown fill for uncovered areas */}
          {desertLayer && (
            <GeoJSON
              key={`desert-${coverageMode}-${minConfidence}-${Date.now()}`}
              data={desertLayer}
              style={getAoiStyle}
            />
          )}

          {/* Ghana border outline */}
          {aoiLayer && (
            <GeoJSON
              key={`aoi-border-${Date.now()}`}
              data={aoiLayer}
              style={() => ({
                fillColor: 'transparent',
                fillOpacity: 0,
                weight: 2,
                color: '#5C3317',
                opacity: 1.0,
                dashArray: '5,5',
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

          {/* Population Overlay */}
          {showPopulation && h3PopulationLayer && (
            <GeoJSON
              key={`population-${Date.now()}`}
              data={h3PopulationLayer}
              style={getPopulationStyle}
            />
          )}

          {/* Facility Markers from GeoJSON */}
          {facilitiesLayer && facilitiesLayer.features?.map((feature, idx) => {
            const coords = feature.geometry?.coordinates;
            if (!coords) return null;
            const stars = feature.properties?.stars || 0;
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
                   <strong className="block mb-1">{place.name || place.display_name?.split(',')[0]}</strong>
                   <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                     {place.score} Star Confidence
                   </span>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Standard Edit Control */}
          <FeatureGroup ref={featureGroupRef}>
            <EditControl
              position="topright"
              onCreated={(e) => handleDrawCreated(e.layer)}
              edit={{ edit: false, remove: false }}
              draw={{
                rectangle: false,
                polygon: false,
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false,
              }}
            />
          </FeatureGroup>

          {/* Point Capture */}
          <PointCaptureHandler 
            isActive={isPointMode} 
            onPointCaptured={handlePointCaptured} 
          />

          {poiList.map((poi) => (
             <Marker 
               key={poi.id} 
               position={[poi.lat, poi.lng]} 
               icon={redIcon}
             >
                <Popup>
                  <div className="text-center">
                    <strong className="text-red-600">poi_{poi.index}</strong>
                    <br/>
                    <span className="text-xs text-slate-500">{poi.lat.toFixed(4)}, {poi.lng.toFixed(4)}</span>
                  </div>
                </Popup>
             </Marker>
          ))}
        </MapContainer>
      </div>

      {/* 3. Top Navigation */}
      <div className="absolute top-0 left-0 w-full z-50 pointer-events-none p-4 flex justify-between items-start">
        
        {/* Left: Menu & Logo */}
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

        {/* Center: Search Bar (Dynamic) */}
        <div className="pointer-events-auto flex flex-col items-center w-full max-w-xl mx-4">
           <div className="relative w-full shadow-2xl rounded-2xl bg-white/70 backdrop-blur border border-slate-200 transition-all duration-300">
             
             {aoi ? (
                /* MODE: AREA SELECTED */
                <div className="flex items-center justify-between w-full p-2 h-[58px]">
                  <div className="flex items-center gap-2 bg-blue-100 text-blue-700 pl-3 pr-2 py-1.5 rounded-xl font-medium text-sm animate-in fade-in zoom-in duration-300 shadow-sm border border-blue-200">
                    <Pin className="w-4 h-4 fill-current" />
                    <span>Area Selected</span>
                    <div className="w-px h-4 bg-blue-300 mx-1"></div>
                    <button 
                      onClick={clearAoi}
                      className="hover:bg-blue-200 p-0.5 rounded-full transition-colors text-blue-600 hover:text-blue-800"
                      title="Remove Area"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <button className="mr-2 p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-full transition-colors">
                    <Search className="w-5 h-5" />
                  </button>
                </div>
             ) : (
                /* MODE: SEARCH */
                <form onSubmit={handleSearch} className="relative w-full">
                  <input 
                    type="text" 
                    placeholder="Search for healthcare nearby locations..." 
                    className="w-full pl-5 pr-12 py-3.5 bg-transparent outline-none text-slate-800 placeholder:text-slate-400 rounded-2xl"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button type="submit" className="absolute right-2 top-2 p-1.5 bg-blue-600 rounded-xl text-white hover:bg-blue-700 transition-colors shadow-sm">
                    <Search className="w-5 h-5" />
                  </button>
                </form>
             )}
           </div>
           
           <div className="flex gap-2 mt-3 animate-in fade-in slide-in-from-top-2">
             {/* Point Selection Button */}
             <button 
               onClick={handlePointSelectionClick}
               className={`flex items-center gap-1.5 px-3 py-1.5 backdrop-blur rounded-full text-xs font-semibold shadow-sm border transition-all ${
                 isPointMode
                   ? "bg-red-600 text-white border-red-600 ring-2 ring-red-300" 
                   : "bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50"
               }`}
             >
               {isPointMode ? <CheckCircle className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
               Points {poiList.length > 0 && `(${poiList.length})`}
             </button>

             {/* Clear Points Button */}
             {poiList.length > 0 && (
                <button onClick={clearPois} className="flex items-center gap-1.5 px-2 py-1.5 bg-red-50 backdrop-blur rounded-full text-xs font-semibold text-red-600 shadow-sm border border-red-100 hover:bg-red-100">
                  <Trash2 className="w-3 h-3" />
                </button>
             )}

             {/* Area Selection Button */}
             <button 
               onClick={handleAreaSelectionClick}
               className={`flex items-center gap-1.5 px-3 py-1.5 backdrop-blur rounded-full text-xs font-semibold shadow-sm border transition-all ${
                 isDrawingMode 
                   ? "bg-blue-600 text-white border-blue-600 ring-2 ring-blue-300" 
                   : "bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50"
               }`}
             >
               {isDrawingMode ? <CheckCircle className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
               {isDrawingMode ? "Drawing Active..." : "Area Selection"}
             </button>

             {/* Coverage Mode Toggle (Buffers / H3) */}
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

             {/* Population Toggle */}
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
           </div>
        </div>

        {/* Right: Help Button */}
        <div className="pointer-events-auto flex gap-2">
          <button onClick={() => setShowWelcome(true)} className="bg-white p-3 rounded-[20px] shadow-lg border border-slate-200 hover:bg-slate-50 transition-transform hover:scale-105 active:scale-95">
             <HelpCircle className="w-5 h-5 text-slate-700" />
          </button>
        </div>
      </div>

      {/* 4. Sidebar Results - Expandable Cards with Loading States */}
      <div 
        className={`absolute top-0 left-0 h-full w-80 bg-white/90 backdrop-blur-md shadow-2xl z-40 transform transition-transform duration-300 pt-24 border-r border-slate-200 flex flex-col ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 pb-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="font-bold text-lg text-slate-800">Results</h2>
          <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
            {filteredResults.length} found
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
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

           {/* Results List - Expandable Cards */}
           {!isSearching && filteredResults.map((place) => {
             const isExpanded = expandedId === place.place_id;

             return (
               <div 
                 key={place.place_id}
                 className={`rounded-2xl transition-all duration-300 border cursor-pointer overflow-hidden ${
                   isExpanded 
                     ? "bg-white border-blue-200 shadow-md ring-1 ring-blue-100" 
                     : "bg-white/50 border-transparent hover:bg-white hover:shadow-sm"
                 }`}
                 onClick={() => {
                   if (place.lat && place.lon) {
                     setMapPosition([parseFloat(place.lat), parseFloat(place.lon)]);
                   }
                   setExpandedId(isExpanded ? null : place.place_id);
                 }}
               >
                 {/* Card Header */}
                 <div className="p-4">
                   <div className="flex justify-between items-start gap-2">
                     <h3 className={`font-bold text-sm leading-tight ${isExpanded ? 'text-blue-700' : 'text-slate-800'}`}>
                       {place.name || place.display_name?.split(',')[0]}
                     </h3>
                     <div className="flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-600 shrink-0">
                       <span className="text-yellow-500">★</span> {place.score}
                     </div>
                   </div>
                   
                   {!isExpanded && (
                     <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                       {place.reason}
                     </p>
                   )}
                 </div>

                 {/* Expandable Details */}
                 {isExpanded && (
                   <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-300">
                     
                     {place.reason && (
                       <div className="mb-3 p-2 bg-slate-50 rounded-lg text-xs text-slate-600 italic border border-slate-100">
                         "{place.reason}"
                       </div>
                     )}

                     {place.capabilities?.length > 0 && (
                       <div className="mb-3">
                         <h4 className="text-[10px] uppercase font-bold text-slate-400 mb-1.5 tracking-wider">Capabilities</h4>
                         <div className="flex flex-wrap gap-1.5">
                           {place.capabilities.map((cap, i) => (
                             <span key={i} className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
                               {formatCapability(cap)}
                             </span>
                           ))}
                         </div>
                       </div>
                     )}

                     <div className="flex gap-2 mt-2 pt-2 border-t border-slate-100">
                        {place.officialWebsite && (
                          <a 
                            href={place.officialWebsite.startsWith('http') ? place.officialWebsite : `https://${place.officialWebsite}`} 
                            target="_blank" 
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()} 
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Visit Website
                          </a>
                        )}
                        <button className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-1">
                          <Navigation className="w-3 h-3" />
                          Directions
                        </button>
                     </div>
                   </div>
                 )}
               </div>
             );
           })}
        </div>
      </div>

      {/* 5. Right Sidebar (Filters) */}
      <div className={`absolute top-40 right-4 w-64 bg-white/60 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200 z-40 p-5 transition-all duration-300 origin-top-right ${rightPanelOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
         <div className="flex justify-between items-center mb-4">
           <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
             <Settings className="w-4 h-4" /> Map Controls
           </h3>
           <button onClick={() => setRightPanelOpen(false)} className="text-slate-400 hover:text-slate-600">
             <X className="w-4 h-4" />
           </button>
         </div>

         <div className="mb-6 space-y-3">
           <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
             <Database className="w-3 h-3" /> Data Layers
           </label>
           <div className="flex flex-col gap-2">
             <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
               <input type="checkbox" className="rounded text-blue-600 focus:ring-blue-500" defaultChecked />
               Political Borders
             </label>
             <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
               <input type="checkbox" className="rounded text-blue-600 focus:ring-blue-500" />
               Traffic Density
             </label>
           </div>
         </div>

         <div className="mb-6">
           <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-3">
             <Clock className="w-3 h-3" /> Time Range
           </label>
           <input 
             type="range" 
             min="0" max="100" 
             value={timeRange}
             onChange={(e) => setTimeRange(e.target.value)}
             className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
           />
           <div className="flex justify-between text-[10px] text-slate-400 mt-1">
             <span>Past</span>
             <span>Now</span>
             <span>Future</span>
           </div>
         </div>
      </div>

      {/* 6. Bottom Confidence Filter */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md flex justify-center items-center gap-3 px-4">
        <ConfidenceFilter value={minConfidence} onChange={setMinConfidence} />
        {isRecomputing && (
          <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" title="Recomputing coverage..." />
        )}
      </div>

      {/* 7. Layer Controls */}
      <div className={`absolute bottom-8 right-4 z-50 flex flex-col transition-all duration-300 ${showLayers ? 'gap-44' : 'gap-3'}`}>
         {!rightPanelOpen && (
           <button 
             onClick={() => setRightPanelOpen(true)}
             className="bg-white p-3 rounded-full shadow-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600"
             title="Open Filters"
           >
             <Settings className="w-5 h-5" />
           </button>
         )}

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
