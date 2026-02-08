import L from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet/dist/leaflet.css";

import {
  CheckCircle,
  ChevronLeft,
  Database,
  Filter,
  Layers,
  MapPin,
  Menu,
  Pin,
  Search,
  Settings,
  User,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FeatureGroup,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap
} from "react-leaflet";
import { EditControl } from "react-leaflet-draw";

// --- Leaflet Icon Fix ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// --- HELPER COMPONENTS ---

// 1. Star Rating Filter
const ConfidenceFilter = ({ value, onChange }) => {
  return (
    <div className="bg-white/90 backdrop-blur-md border border-slate-200 shadow-xl rounded-[20px] px-6 py-3 flex items-center gap-4 animate-in slide-in-from-bottom-10 duration-500">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 hidden sm:block">
        Confidence Threshold
      </span>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => onChange(star)}
            className={`transition-all duration-200 hover:scale-125 ${star <= value
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
        {value === 1 ? "All" : `${value}+ Stars`}
      </div>
    </div>
  );
};

// 2. Map Controller
function RecenterMap({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lon) {
      map.flyTo([lat, lon], 13, { duration: 1.5 });
    }
  }, [lat, lon, map]);
  return null;
}

// 3. Controlador de Dibujo Personalizado
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
      onDrawReady();

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

// --- MAIN APP ---

export default function UrbanLayoutApp() {
  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [showLayers, setShowLayers] = useState(false);

  // Data State
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [minConfidence, setMinConfidence] = useState(1);
  const [mapPosition, setMapPosition] = useState([7.983173013737491, -1.0916666895576415]); // Ghana

  // DRAWING STATE & DATA
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [aoi, setAoi] = useState(null);
  const featureGroupRef = useRef(null);

  // Mock Filter States
  const [timeRange, setTimeRange] = useState(50);
  const [popularity, setPopularity] = useState(true);

  // Search Logic
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query) return;

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=15`
      );
      const data = await res.json();
      const enrichedData = data.map(item => ({
        ...item,
        confidenceScore: Math.floor(Math.random() * 5) + 1
      }));
      setResults(enrichedData);
      setSidebarOpen(true);
    } catch (error) {
      console.error("Search error:", error);
    }
  };

  const filteredResults = useMemo(() => {
    return results.filter(r => r.confidenceScore >= minConfidence);
  }, [results, minConfidence]);


  // --- LOGICA DE GEODATAFRAME ---

  const handleAreaSelectionClick = () => {
    setIsDrawingMode(true);
    setSidebarOpen(false);
    setRightPanelOpen(false);
  };

  const handleDrawCreated = (layer) => {
    const geoJson = layer.toGeoJSON();

    // Creamos el objeto limpio para la variable
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

    setAoi(data);   // Guardamos en la variable AOI
    setIsDrawingMode(false);
  };

  const _onEdited = (e) => {
    console.log("Polygon edited", e);
  };

  const _onDeleted = (e) => {
    setAoi(null);
  };

  // Función para resetear el AOI desde el botón de la UI
  const clearAoi = () => {
    setAoi(null);
    // Opcional: Si quieres borrar también el dibujo visual del mapa
    if (featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900 font-sans text-slate-900">

      {/* 4. MAIN CONTENT AREA (The Map) */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={mapPosition}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; OSM'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <RecenterMap lat={mapPosition[0]} lon={mapPosition[1]} />

          <MapDrawHandler
            isDrawing={isDrawingMode}
            onDrawReady={() => console.log("Draw mode enabled")}
            onDrawCreated={handleDrawCreated}
          />

          {filteredResults.map((place) => (
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

          <FeatureGroup ref={featureGroupRef}>
            <EditControl
              position="topright"
              onEdited={_onEdited}
              onCreated={(e) => handleDrawCreated(e.layer)}
              onDeleted={_onDeleted}
              draw={{
                rectangle: true,
                polygon: true,
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false,
              }}
            />
          </FeatureGroup>
        </MapContainer>
      </div>


      {/* 2. TOP NAVIGATION BAR */}
      <div className="absolute top-0 left-0 w-full z-50 pointer-events-none p-4 flex justify-between items-start">
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="bg-white p-3 rounded-[20px] shadow-lg border border-slate-200 hover:bg-slate-50 transition-transform hover:scale-105 active:scale-95"
          >
            {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 tracking-tight ml-2">GeoCare</span>
          </div>
        </div>

        {/* Center: Search Command Bar - ACTUALIZADO */}
        <div className="pointer-events-auto flex flex-col items-center w-full max-w-xl mx-4">
          <div className="relative w-full shadow-2xl rounded-2xl bg-white/95 backdrop-blur border border-slate-200 transition-all duration-300">

            {aoi ? (
              /* --- MODO: ÁREA SELECCIONADA (Chip/Botón) --- */
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

                {/* Botón de búsqueda secundaria opcional dentro del área */}
                <button className="mr-2 p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-full transition-colors">
                  <Search className="w-5 h-5" />
                </button>
              </div>
            ) : (
              /* --- MODO: BÚSQUEDA NORMAL --- */
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
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur rounded-full text-xs font-semibold text-slate-600 shadow-sm border border-slate-200 hover:bg-slate-50">
              <Filter className="w-3 h-3" /> Filters
            </button>
            <button
              onClick={handleAreaSelectionClick}
              className={`flex items-center gap-1.5 px-3 py-1.5 backdrop-blur rounded-full text-xs font-semibold shadow-sm border transition-all ${isDrawingMode
                ? "bg-blue-600 text-white border-blue-600 ring-2 ring-blue-300"
                : "bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
            >
              {isDrawingMode ? <CheckCircle className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
              {isDrawingMode ? "Drawing Active..." : "Area Selection"}
            </button>
          </div>
        </div>

        <div className="pointer-events-auto">
          <button className="bg-white p-3 rounded-[20px] shadow-lg border border-slate-200 hover:bg-slate-50 transition-transform hover:scale-105 active:scale-95">
            <User className="w-5 h-5 text-slate-700" />
          </button>
        </div>
      </div>

      {isDrawingMode && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white px-6 py-2 rounded-full shadow-xl animate-bounce">
          <p className="text-sm font-bold">Modo Dibujo Activo: Haz clic en el mapa para trazar el polígono</p>
        </div>
      )}

      {/* 3. LEFT SIDEBAR */}
      <div
        className={`absolute top-0 left-0 h-full w-80 bg-white/95 backdrop-blur-md shadow-2xl z-40 transform transition-transform duration-300 pt-24 border-r border-slate-200 flex flex-col ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
      >
        <div className="px-5 pb-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="font-bold text-lg text-slate-800">Results</h2>
          <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
            {filteredResults.length} found
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">

          {results.length === 0 && (
            <div className="text-center p-8 text-slate-400 text-sm">
              Search for a location...
            </div>
          )}

          {filteredResults.map((place) => (
            <div key={place.place_id} className="p-3 rounded-xl hover:bg-blue-50 cursor-pointer group transition-colors border border-transparent hover:border-blue-100" onClick={() => setMapPosition([parseFloat(place.lat), parseFloat(place.lon)])}>
              <h3 className="font-semibold text-slate-800 text-sm group-hover:text-blue-600 mb-1">{place.display_name.split(',')[0]}</h3>
            </div>
          ))}
        </div>
      </div>

      {/* 5. RIGHT-SIDE OVERLAY */}
      <div className={`absolute top-40 right-4 w-64 bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200 z-40 p-5 transition-all duration-300 origin-top-right ${rightPanelOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
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
      </div>

      {/* 6. BOTTOM CONFIDENCE */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md flex justify-center px-4">
        <ConfidenceFilter value={minConfidence} onChange={setMinConfidence} />
      </div>

      {/* 7. LAYERS CONTROL */}
      <div className={`absolute bottom-8 right-4 z-50 flex flex-col transition-all duration-300 ${showLayers ? 'gap-12' : 'gap-3'}`}>
        {!rightPanelOpen && (
          <button onClick={() => setRightPanelOpen(true)} className="bg-white p-3 rounded-full shadow-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600">
            <Settings className="w-5 h-5" />
          </button>
        )}
        <div className="relative">
          {showLayers && (
            <div className="absolute bottom-full right-0 mb-3 w-40 bg-white rounded-xl shadow-xl border border-slate-200 p-2 animate-in fade-in slide-in-from-bottom-2">
              <div className="text-xs p-2 text-slate-500">Map Styles</div>
            </div>
          )}
          <button onClick={() => setShowLayers(!showLayers)} className="bg-slate-800 p-3 rounded-full shadow-xl text-white hover:bg-slate-700 transition-transform hover:scale-105">
            <Layers className="w-5 h-5" />
          </button>
        </div>
      </div>

    </div>
  );
}