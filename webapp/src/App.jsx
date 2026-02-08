import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  MapContainer, 
  TileLayer, 
  Marker, 
  Popup, 
  useMap, 
  FeatureGroup,
  ZoomControl,
  AttributionControl 
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
  User,
  ChevronLeft,
  Clock,
  Activity,
  Database,
  Info,
  CheckCircle,
  Pin,
  Pencil,
  Star,
  HelpCircle
} from "lucide-react";
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

// 1. WELCOME MODAL (GeoCare Version)
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
function RecenterMap({ lat, lon }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lon) {
      map.flyTo([lat, lon], 13, { duration: 1.5 });
    }
  }, [lat, lon, map]);
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

// --- MAIN APP ---

export default function App() {
  // UI State
  const [showWelcome, setShowWelcome] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [showLayers, setShowLayers] = useState(false);
  const [mapLayer, setMapLayer] = useState('standard');

  // Data State
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [minConfidence, setMinConfidence] = useState(1);
  const [mapPosition, setMapPosition] = useState([7.983173013737491, -1.0916666895576415]); // Ghana Default

  // Drawing State
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [aoi, setAoi] = useState(null);
  const featureGroupRef = useRef(null);

  // Mock Settings
  const [timeRange, setTimeRange] = useState(50);
  const [popularity, setPopularity] = useState(true);

  // --- Handlers ---

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
    setIsDrawingMode(false);
  };

  const clearAoi = () => {
    setAoi(null);
    if (featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
    }
    // Refresh map to remove layers added by MapDrawHandler if needed, 
    // though featureGroupRef handles standard EditControl layers.
    // For custom layers added via map.addLayer, we might need a reload or state management,
    // but typically a re-render or clearing the group works if attached.
    // Simpler: reload page or use state to control visibility. 
    // Ideally MapDrawHandler adds to a group we can clear.
    window.location.reload(); // Quick fix to clear map drawings for prototype
  };

  const filteredResults = useMemo(() => {
    return results.filter(r => r.confidenceScore >= minConfidence);
  }, [results, minConfidence]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900 font-sans text-slate-900">
      
      {/* 1. Welcome Modal */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      
      {/* 2. Map Area */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={mapPosition}
          zoom={13}
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
          
          <ZoomControl position="bottomright" />
          <AttributionControl position="bottomright" prefix={false} />

          {/* Custom Drawing Logic */}
          <MapDrawHandler 
            isDrawing={isDrawingMode}
            onDrawReady={() => console.log("Ready to draw")}
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

          {/* Standard Edit Control (Hidden but available for management) */}
          <FeatureGroup ref={featureGroupRef}>
            <EditControl
              position="topright"
              onCreated={(e) => handleDrawCreated(e.layer)}
              draw={{
                rectangle: false,
                polygon: false, // We use custom handler button
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false,
              }}
            />
          </FeatureGroup>
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
           <div className="relative w-full shadow-2xl rounded-2xl bg-white/95 backdrop-blur border border-slate-200 transition-all duration-300">
             
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
             <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur rounded-full text-xs font-semibold text-slate-600 shadow-sm border border-slate-200 hover:bg-slate-50">
               <Filter className="w-3 h-3" /> Filters
             </button>
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
           </div>
        </div>

        {/* Right: User/Help */}
        <div className="pointer-events-auto flex gap-2">
          <button onClick={() => setShowWelcome(true)} className="bg-white p-3 rounded-[20px] shadow-lg border border-slate-200 hover:bg-slate-50 transition-transform hover:scale-105 active:scale-95">
             <HelpCircle className="w-5 h-5 text-slate-700" />
          </button>
          <button className="bg-white p-3 rounded-[20px] shadow-lg border border-slate-200 hover:bg-slate-50 transition-transform hover:scale-105 active:scale-95">
             <User className="w-5 h-5 text-slate-700" />
          </button>
        </div>
      </div>

      {/* 4. Sidebar Results */}
      <div 
        className={`absolute top-0 left-0 h-full w-80 bg-white/95 backdrop-blur-md shadow-2xl z-40 transform transition-transform duration-300 pt-24 border-r border-slate-200 flex flex-col ${
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
           {results.length === 0 && (
             <div className="text-center p-8 text-slate-400 text-sm">
               Search for a location...
             </div>
           )}

           {filteredResults.map((place) => (
             <div 
               key={place.place_id}
               onClick={() => setMapPosition([parseFloat(place.lat), parseFloat(place.lon)])}
               className="p-3 rounded-xl hover:bg-blue-50 cursor-pointer group transition-colors border border-transparent hover:border-blue-100"
             >
               <h3 className="font-semibold text-slate-800 text-sm group-hover:text-blue-600 mb-1">
                 {place.name || place.display_name.split(',')[0]}
               </h3>
               <p className="text-xs text-slate-500 line-clamp-2 mb-2">
                 {place.display_name}
               </p>
               
               <div className="flex items-center gap-2">
                 <div className="flex text-yellow-400">
                   {[...Array(place.confidenceScore)].map((_, i) => (
                     <svg key={i} className="w-3 h-3 fill-current" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                   ))}
                 </div>
                 <span className="text-[10px] text-slate-400 font-medium">Confidence</span>
               </div>
             </div>
           ))}
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
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md flex justify-center px-4">
        <ConfidenceFilter value={minConfidence} onChange={setMinConfidence} />
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