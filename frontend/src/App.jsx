import React, { useState, useEffect, useRef, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, PathLayer } from '@deck.gl/layers';
import { MaskExtension } from '@deck.gl/extensions';
import Map from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { Play, Pause, SkipForward, SkipBack, Settings, Compass, Waves, Layers, Thermometer, Droplets, ArrowRight, ArrowLeft, Loader2, Activity, MapPin } from 'lucide-react';
import Admin from './Admin';

// API Base URL
const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8001`;

const ESRI_MAP_STYLE = {
  "version": 8,
  "sources": {
    "esri-world-street-map": {
      "type": "raster",
      "tiles": [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
      ],
      "tileSize": 256,
      "attribution": "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012"
    }
  },
  "layers": [
    {
      "id": "esri-world-street-map-layer",
      "type": "raster",
      "source": "esri-world-street-map",
      "minzoom": 0,
      "maxzoom": 22
    }
  ]
};

// Initial viewport center of South Africa coast
const INITIAL_VIEW_STATE = {
  longitude: 25.0,
  latitude: -31.0,
  zoom: 4.8,
  pitch: 0,
  bearing: 0,
  maxZoom: 16,
  minZoom: 3
};

// Color Map Stops
const TEMP_STOPS = [
  { t: 0.0, color: [20, 30, 180] },    // Deep Indigo (Cold)
  { t: 0.25, color: [0, 180, 220] },   // Bright Cyan
  { t: 0.5, color: [253, 224, 71] },   // Bright Yellow (Neutral)
  { t: 0.75, color: [244, 100, 30] },  // Rich Orange
  { t: 1.0, color: [220, 20, 60] }     // Fire Crimson (Warm)
];

const SALT_STOPS = [
  { t: 0.0, color: [90, 0, 150] },     // Deep Violet (Low Salinity)
  { t: 0.35, color: [13, 71, 161] },   // Royal Blue
  { t: 0.7, color: [0, 200, 180] },    // Electric Teal
  { t: 1.0, color: [255, 215, 0] }     // Gold (High Salinity)
];

const ZETA_STOPS = [
  { t: 0.0, color: [220, 20, 180] },   // Low SSH (Hot Pink/Magenta)
  { t: 0.5, color: [30, 41, 59] },     // Zero SSH (Deep Slate)
  { t: 1.0, color: [0, 255, 127] }     // High SSH (Spring Green)
];

const SPEED_STOPS = [
  { t: 0.0, color: [30, 41, 59, 100] }, // Slow (Slate)
  { t: 0.2, color: [0, 191, 255] },    // Moderate (Deep Sky Blue)
  { t: 0.5, color: [0, 250, 154] },    // Good Flow (Medium Spring Green)
  { t: 0.8, color: [255, 215, 0] },    // Strong (Gold)
  { t: 1.0, color: [255, 0, 0] }       // Severe (Pure Red)
];

// Helper to interpolate between color stops
function interpolateColor(t, stops) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (t >= s1.t && t <= s2.t) {
      const factor = (t - s1.t) / (s2.t - s1.t);
      const r = Math.round(s1.color[0] + factor * (s2.color[0] - s1.color[0]));
      const g = Math.round(s1.color[1] + factor * (s2.color[1] - s1.color[1]));
      const b = Math.round(s1.color[2] + factor * (s2.color[2] - s1.color[2]));
      return [r, g, b];
    }
  }
  return stops[stops.length - 1].color;
}

function Visualizer({ onNavigateAdmin }) {
  // Products & region selection states
  const [products, setProducts] = useState([]);
  const [clickedProduct, setClickedProduct] = useState(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [productMembers, setProductMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  
  // App States
  const [metadata, setMetadata] = useState(null);
  const [currentTimeIndex, setCurrentTimeIndex] = useState(0);
  const [currentDepthIndex, setCurrentDepthIndex] = useState(0);
  const [selectedVariable, setSelectedVariable] = useState('temp'); // temp, salt, zeta
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2); // steps per second
  const [showCurrents, setShowCurrents] = useState(true);
  const [showContours, setShowContours] = useState(true);
  
  // Customization States
  const [vectorScale, setVectorScale] = useState(0.02);
  const [downsampleRate, setDownsampleRate] = useState(3);
  const [simplification, setSimplification] = useState(0.001);
  const [showSettings, setShowSettings] = useState(false);

  // Cache System
  const [cache, setCache] = useState({});
  const [maskData, setMaskData] = useState(null);

  // Load mask data on mount
  useEffect(() => {
    import('./sa_province_outline.json')
      .then((mod) => {
        setMaskData(mod.default);
        console.log('SA province outline mask loaded successfully');
      })
      .catch((err) => {
        console.error('Failed to load SA province outline mask:', err);
      });
  }, []);
  const cacheRef = useRef({});
  const fetchingKeysRef = useRef(new Set());

  // Viewport State
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

  // Keep cacheRef in sync
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  // Fetch Products on mount
  useEffect(() => {
    fetch(`${API_URL}/api/products`)
      .then((res) => {
        if (!res.ok) throw new Error('API server returned error');
        return res.json();
      })
      .then((data) => {
        setProducts(data);
        console.log('Products loaded:', data);
      })
      .catch((err) => {
        console.error('Failed to load products.', err);
      });
  }, []);

  const handleProductClick = async (prodId, prodName) => {
    setLoadingMembers(true);
    setClickedProduct({ id: prodId, name: prodName });
    setSelectedMember(null);
    setSelectedGroup(null);
    setMetadata(null);
    try {
      const res = await fetch(`${API_URL}/api/products/${prodId}/members`);
      if (res.ok) {
        const data = await res.json();
        setProductMembers(data);
      }
    } catch (e) {
      console.error("Error fetching product members:", e);
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleSelectVariableGroup = async (group, member) => {
    setSelectedGroup(group);
    
    // Pick active variable from options
    const available = group.variables || [];
    if (available.length > 0 && !available.includes(selectedVariable)) {
      if (available.includes('temp')) {
        setSelectedVariable('temp');
      } else if (available.includes('salt')) {
        setSelectedVariable('salt');
      } else if (available.includes('zeta')) {
        setSelectedVariable('zeta');
      } else {
        setSelectedVariable(available[0]);
      }
    }

    // Automatically enable/disable contours or currents toggles based on variable availability
    const hasGroupContours = available.some(v => ['temp', 'salt', 'zeta'].includes(v));
    const hasGroupCurrents = available.includes('currents');
    
    if (hasGroupContours && !hasGroupCurrents) {
      setShowContours(true);
      setShowCurrents(false);
    } else if (!hasGroupContours && hasGroupCurrents) {
      setShowContours(false);
      setShowCurrents(true);
    } else if (hasGroupContours && hasGroupCurrents) {
      setShowContours(true);
      setShowCurrents(true);
    }

    try {
      const res = await fetch(`${API_URL}/api/metadata?file_path=${encodeURIComponent(group.file_path)}`);
      if (res.ok) {
        const data = await res.json();
        setMetadata(data);
        setCurrentTimeIndex(0);
        setCurrentDepthIndex(0);
        
        // Fly map viewport to center of bounds if present
        if (data.bounds) {
          const centerLon = (data.bounds.lon_min + data.bounds.lon_max) / 2;
          const centerLat = (data.bounds.lat_min + data.bounds.lat_max) / 2;
          setViewState(prev => ({
            ...prev,
            longitude: centerLon,
            latitude: centerLat,
            zoom: 5.8,
            transitionDuration: 1000
          }));
        }
      } else {
        console.error("Failed to load metadata for file:", group.file_path);
      }
    } catch (e) {
      console.error("Error fetching metadata:", e);
    }
  };

  const handleSelectMember = async (member) => {
    if (!member.variable_groups || member.variable_groups.length === 0) {
      alert("This member has no source files/variable groups.");
      return;
    }
    setSelectedMember(member);
    const firstGroup = member.variable_groups[0];
    handleSelectVariableGroup(firstGroup, member);
  };

  // Fetch helper
  const fetchStepData = async (filePath, variable, depth, time, downsample, tolerance) => {
    const key = `${filePath}_${variable}_${depth}_${time}_ds${downsample}_tol${tolerance}`;
    try {
      const contourUrl = `${API_URL}/api/contours?variable=${variable}&time=${time}&depth=${depth}&tolerance=${tolerance}` +
        (filePath ? `&file_path=${encodeURIComponent(filePath)}` : '');
      
      const currentsDepth = variable === 'zeta' ? 0 : depth;
      const currentsUrl = `${API_URL}/api/currents?time=${time}&depth=${currentsDepth}&downsample=${downsample}` +
        (filePath ? `&file_path=${encodeURIComponent(filePath)}` : '');

      // Run both API requests in parallel
      const [contourRes, currentsRes] = await Promise.all([
        fetch(contourUrl),
        fetch(currentsUrl)
      ]);

      // Parse JSON payloads in parallel
      const [contours, currents] = await Promise.all([
        contourRes.json(),
        currentsRes.json()
      ]);

      setCache((prev) => ({
        ...prev,
        [key]: { contours, currents }
      }));
    } catch (err) {
      console.error(`Failed to fetch key ${key}:`, err);
    }
  };

  // Pre-fetching and sliding-window cache logic
  useEffect(() => {
    if (!metadata) return;

    const numSteps = metadata.times.length;
    const filePath = selectedGroup?.file_path || '';

    const ensureData = (timeIdx) => {
      // Use currents depth 0 if zeta, else current depth
      const dIdx = selectedVariable === 'zeta' ? 0 : currentDepthIndex;
      const key = `${filePath}_${selectedVariable}_${dIdx}_${timeIdx}_ds${downsampleRate}_tol${simplification}`;
      
      if (!cacheRef.current[key] && !fetchingKeysRef.current.has(key)) {
        fetchingKeysRef.current.add(key);
        fetchStepData(filePath, selectedVariable, dIdx, timeIdx, downsampleRate, simplification)
          .then(() => fetchingKeysRef.current.delete(key))
          .catch(() => fetchingKeysRef.current.delete(key));
      }
    };

    // 1. Load current step and immediate next step (+1) instantly
    ensureData(currentTimeIndex);
    if (numSteps > 1) {
      ensureData((currentTimeIndex + 1) % numSteps);
    }

    // 2. Debounce prefetching of remaining buffer steps (+2 to +12)
    // to prevent browser network socket choking during rapid scrubbing/playback
    const prefetchTimer = setTimeout(() => {
      for (let i = 2; i <= 12; i++) {
        const nextIndex = (currentTimeIndex + i) % numSteps;
        ensureData(nextIndex);
      }
    }, 150);

    return () => clearTimeout(prefetchTimer);
  }, [selectedVariable, currentDepthIndex, currentTimeIndex, downsampleRate, simplification, metadata, selectedGroup]);

  // Playback Loop
  useEffect(() => {
    let timer = null;
    if (isPlaying && metadata) {
      timer = setInterval(() => {
        setCurrentTimeIndex((prev) => (prev + 1) % metadata.times.length);
      }, 1000 / playbackSpeed);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, playbackSpeed, metadata]);

  // Active Key
  const activeKey = useMemo(() => {
    const dIdx = selectedVariable === 'zeta' ? 0 : currentDepthIndex;
    const filePath = selectedGroup?.file_path || '';
    return `${filePath}_${selectedVariable}_${dIdx}_${currentTimeIndex}_ds${downsampleRate}_tol${simplification}`;
  }, [selectedVariable, currentDepthIndex, currentTimeIndex, downsampleRate, simplification, selectedGroup]);

  const activeData = selectedGroup ? cache[activeKey] : null;
  const isLoading = selectedGroup ? !activeData : false;

  // Double-buffering: hold last rendered data to avoid blinks while loading
  const [renderedData, setRenderedData] = useState(null);
  useEffect(() => {
    if (activeData) {
      setRenderedData(activeData);
    }
  }, [activeData]);

  // Compute color range and stops for current variable
  const { valMin, valMax, stops } = useMemo(() => {
    if (!metadata) return { valMin: 0, valMax: 1, stops: TEMP_STOPS };
    const rangeObj = metadata.ranges[selectedVariable];
    const range = (selectedVariable !== 'zeta' && Array.isArray(rangeObj))
      ? rangeObj[currentDepthIndex]
      : rangeObj;
      
    let activeStops = TEMP_STOPS;
    if (selectedVariable === 'salt') activeStops = SALT_STOPS;
    if (selectedVariable === 'zeta') activeStops = ZETA_STOPS;
    return {
      valMin: range.min,
      valMax: range.max,
      stops: activeStops
    };
  }, [selectedVariable, currentDepthIndex, metadata]);

  const maxSpeed = useMemo(() => {
    if (!metadata) return 1.5;
    const dIdx = currentDepthIndex;
    const uRange = Array.isArray(metadata.ranges.u) ? metadata.ranges.u[dIdx] : metadata.ranges.u;
    const vRange = Array.isArray(metadata.ranges.v) ? metadata.ranges.v[dIdx] : metadata.ranges.v;
    
    const uMax = Math.max(Math.abs(uRange.min), Math.abs(uRange.max));
    const vMax = Math.max(Math.abs(vRange.min), Math.abs(vRange.max));
    return Math.sqrt(uMax * uMax + vMax * vMax);
  }, [metadata, currentDepthIndex]);

  // Construct Deck.gl Layers
  const layers = useMemo(() => {
    const layersList = [];

    // 0. Mask Layer (defining the land mask)
    if (maskData) {
      layersList.push(
        new GeoJsonLayer({
          id: 'land-mask',
          data: maskData,
          operation: 'mask'
        })
      );
    }

    // 1. Filled Contour Layer
    if (showContours && renderedData?.contours && selectedMember) {
      layersList.push(
        new GeoJsonLayer({
          id: 'contours-layer',
          data: renderedData.contours,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthScale: 1,
          lineWidthMinPixels: 0.5,
          getFillColor: (f) => {
            const val = f.properties.value;
            const t = (val - valMin) / (valMax - valMin || 1);
            const rgb = interpolateColor(t, stops);
            return [...rgb, 150]; // Semi-transparent fill (alpha 150 / 255)
          },
          getLineColor: [0, 0, 0, 40], // Very subtle dark outline between contour bands
          getLineWidth: 0.5,
          extensions: maskData ? [new MaskExtension()] : [],
          maskId: 'land-mask',
          maskInverted: true,
          updateTriggers: {
            getFillColor: [valMin, valMax, stops]
          }
        })
      );
    }

    // 2. Currents Layers (Path-based Arrow Vectors)
    if (showCurrents && renderedData?.currents && selectedMember) {
      layersList.push(
        new PathLayer({
          id: 'currents-arrows',
          data: renderedData.currents,
          pickable: true,
          widthMinPixels: 1.5,
          widthMaxPixels: 3.5,
          getPath: (d) => {
            const dx = d.u * vectorScale;
            const dy = d.v * vectorScale;
            const L = Math.sqrt(dx * dx + dy * dy);
            if (L === 0) return [[d.lng, d.lat], [d.lng, d.lat]];
            const theta = Math.atan2(dy, dx);
            
            // 8 pixels in degrees at current zoom level to keep head proportion clean
            const pixelSize = 360 / (256 * Math.pow(2, viewState.zoom));
            const barbLength = Math.min(L * 0.35, 8 * pixelSize);
            
            return [
              [d.lng, d.lat],
              [d.lng + dx, d.lat + dy],
              [d.lng + dx + barbLength * Math.cos(theta + 2.6), d.lat + dy + barbLength * Math.sin(theta + 2.6)],
              [d.lng + dx, d.lat + dy],
              [d.lng + dx + barbLength * Math.cos(theta - 2.6), d.lat + dy + barbLength * Math.sin(theta - 2.6)]
            ];
          },
          getColor: [0, 0, 0],
          getWidth: 2.2,
          extensions: maskData ? [new MaskExtension()] : [],
          maskId: 'land-mask',
          maskInverted: true,
          updateTriggers: {
            getPath: [vectorScale, viewState.zoom]
          }
        })
      );
    }

    // 3. Product Bounding Boxes
    if (!selectedMember) {
      const productRegions = products
        .filter(p => p.region)
        .map(p => ({
          type: 'Feature',
          geometry: p.region,
          properties: {
            id: p.id,
            name: p.name
          }
        }));

      layersList.push(
        new GeoJsonLayer({
          id: 'products-boundary-layer',
          data: {
            type: 'FeatureCollection',
            features: productRegions
          },
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthScale: 1,
          lineWidthMinPixels: 2,
          getFillColor: [14, 165, 233, 40], // sky-500 light fill
          getLineColor: [14, 165, 233, 220], // sky-500 border
          getLineWidth: 2,
          extensions: maskData ? [new MaskExtension()] : [],
          maskId: 'land-mask',
          maskInverted: true,
          onClick: (info) => {
            if (info.object) {
              const prodId = info.object.properties.id;
              const prodName = info.object.properties.name;
              handleProductClick(prodId, prodName);
            }
          }
        })
      );
    }

    return layersList;
  }, [renderedData, showContours, showCurrents, valMin, valMax, stops, vectorScale, maxSpeed, selectedMember, products, maskData]);

  // Handle Tooltips
  const getTooltip = ({ object }) => {
    if (!object) return null;
    
    // Product region hover
    if (object.properties && object.properties.name && object.properties.value === undefined) {
      return {
        html: `
          <div class="p-2.5 bg-slate-950/95 border border-slate-700/80 backdrop-blur text-slate-100 rounded-xl shadow-xl text-xs space-y-1">
            <div class="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">Product Region</div>
            <div class="text-xs font-bold text-sky-400">${object.properties.name}</div>
            <div class="text-slate-500 text-[10px]">Click to view member outputs</div>
          </div>
        `,
        style: { background: 'transparent', padding: 0 }
      };
    }

    if (object.properties && object.properties.value !== undefined) {
      const val = object.properties.value;
      const valMinVal = object.properties.value_min;
      const valMaxVal = object.properties.value_max;
      const unit = selectedVariable === 'temp' ? '°C' : selectedVariable === 'salt' ? 'g/kg' : 'm';
      const name = selectedVariable === 'temp' ? 'Temperature' : selectedVariable === 'salt' ? 'Salinity' : 'Sea Surface Height';
      
      const valDisplay = (valMinVal !== undefined && valMaxVal !== undefined)
        ? `${valMinVal.toFixed(2)} - ${valMaxVal.toFixed(2)} ${unit}`
        : `${val.toFixed(2)} ${unit}`;
        
      return {
        html: `
          <div class="p-2.5 bg-slate-950/95 border border-slate-700/80 backdrop-blur text-slate-100 rounded-xl shadow-xl text-xs space-y-1">
            <div class="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">${name}</div>
            <div class="text-xs font-bold text-sky-400">${valDisplay}</div>
          </div>
        `,
        style: { background: 'transparent', padding: 0 }
      };
    }
    if (object.u !== undefined) {
      const speed = Math.sqrt(object.u * object.u + object.v * object.v);
      const angle = (Math.atan2(object.v, object.u) * 180 / Math.PI + 360) % 360;
      return {
        html: `
          <div class="p-2.5 bg-slate-950/95 border border-slate-700/80 backdrop-blur text-slate-100 rounded-xl shadow-xl text-xs space-y-1">
            <div class="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">Flow Vector</div>
            <div class="text-sm font-bold text-emerald-400">${speed.toFixed(2)} m/s</div>
            <div class="text-slate-300">Bearing: ${angle.toFixed(0)}°</div>
            <div class="text-slate-500 text-[10px]">U: ${object.u.toFixed(2)} | V: ${object.v.toFixed(2)}</div>
          </div>
        `,
        style: { background: 'transparent', padding: 0 }
      };
    }
    return null;
  };

  // Format Time Label
  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const availableVars = selectedGroup?.variables || ['temp', 'salt', 'zeta', 'currents'];
  const hasTemp = availableVars.includes('temp');
  const hasSalt = availableVars.includes('salt');
  const hasZeta = availableVars.includes('zeta');
  const hasCurrents = availableVars.includes('currents');
  const availableContourVars = ['temp', 'salt', 'zeta'].filter(v => availableVars.includes(v));
  const hasContoursOption = hasTemp || hasSalt || hasZeta;

  return (
    <div className="relative w-full h-full">
      {/* 1. Base Map and Visualizer */}
      <DeckGL
        viewState={viewState}
        onViewStateChange={(e) => setViewState(e.viewState)}
        controller={true}
        layers={layers}
        getTooltip={getTooltip}
      >
        <Map
          reuseMaps
          mapLib={maplibregl}
          mapStyle={ESRI_MAP_STYLE}
          preventStyleDiffing={true}
        />
      </DeckGL>

      {/* 2. Top Header Title (Full-Width Header) */}
      <header className="absolute top-0 left-0 right-0 h-16 bg-slate-950/90 border-b border-slate-800/80 backdrop-blur-md shadow-lg z-20 flex items-center justify-between px-6 pointer-events-auto">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-sky-500 to-indigo-600 rounded-xl text-white shadow-lg shadow-sky-500/20">
            <Waves className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base text-slate-100 tracking-tight font-outfit">
              Ocean Model Visualiser
            </h1>
            <p className="text-[10px] text-slate-400">
              {selectedMember 
                ? `Active Model: ${selectedMember.name} (Region: ${clickedProduct?.name || 'Unknown'})` 
                : clickedProduct 
                  ? `Region: ${clickedProduct.name} - Select a member model to begin` 
                  : "Select a region to explore"}
            </p>
          </div>
        </div>
        <button
          onClick={onNavigateAdmin}
          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 text-xs font-bold uppercase tracking-wider rounded-lg text-slate-400 hover:text-slate-100 transition-colors border border-slate-800 hover:border-slate-700"
        >
          Admin Portal
        </button>
      </header>      {/* 4. Color Scale Legends (Bottom Left) - Now vertical */}
      {selectedMember && metadata && showContours && (
        <section className="absolute bottom-[54px] left-6 w-20 h-72 bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-4 rounded-2xl shadow-2xl z-10 flex flex-col items-center justify-between pointer-events-auto">
          {/* Label at the top */}
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider text-center truncate max-w-full pb-1 border-b border-slate-900 w-full">
            {selectedVariable === 'temp' ? 'Temp' : selectedVariable === 'salt' ? 'Salt' : 'SSH'}
          </div>
          
          {/* Ramp Container */}
          <div className="flex-1 w-full flex justify-center gap-3 my-3">
            {/* Color bar */}
            <div
              className="w-2.5 h-full rounded-md shadow-inner"
              style={{
                background: `linear-gradient(to top, ${stops.map(s => `rgb(${s.color.slice(0, 3).join(',')})`).join(', ')})`
              }}
            ></div>
            
            {/* Values */}
            <div className="flex flex-col justify-between text-[9px] font-mono text-slate-400 h-full text-left py-0.5">
              <span>{valMax.toFixed(1)}</span>
              <span className="text-slate-500">{((valMin + valMax) / 2).toFixed(1)}</span>
              <span>{valMin.toFixed(1)}</span>
            </div>
          </div>

          {/* Unit at the bottom */}
          <div className="text-[9px] font-bold text-slate-500 text-center">
            {selectedVariable === 'temp' ? '°C' : selectedVariable === 'salt' ? 'g/kg' : 'm'}
          </div>
        </section>
      )}

      {/* 3. Left Sidebar Control Panel Stack */}
      <div className="absolute top-[80px] left-6 w-96 z-10 flex flex-col gap-4 pointer-events-auto max-h-[calc(100vh-160px)] overflow-y-auto pr-1">
        
        {/* Model Visualization block */}
        <main className="w-full bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col shrink-0">
          {/* Loading progress bar */}
          {isLoading && (
            <div className="h-[2px] bg-slate-800 w-full overflow-hidden relative">
              <div className="absolute h-[2px] bg-sky-500 animate-[shimmer_1.5s_infinite] w-1/3"></div>
            </div>
          )}
          {!isLoading && <div className="h-[2px] bg-sky-500/30 w-full"></div>}

          <div className="border-b border-slate-900/60 px-5 py-4 flex items-center justify-between bg-slate-950/40">
            <div className="flex items-center gap-2">
              {selectedMember ? (
                <>
                  <Activity className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Model Visualization</span>
                </>
              ) : clickedProduct ? (
                <>
                  <MapPin className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Product Models</span>
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Available Regions</span>
                </>
              )}
            </div>
            {(selectedMember || clickedProduct) && (
              <button
                onClick={() => {
                  if (selectedMember) {
                    setSelectedMember(null);
                    setSelectedGroup(null);
                    setMetadata(null);
                  } else {
                    setClickedProduct(null);
                    setProductMembers([]);
                  }
                }}
                className="flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300 transition-colors uppercase"
              >
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            )}
          </div>

          {selectedMember ? (
            <div className="p-5 space-y-4">
              {/* Variable Group Radios */}
              {selectedMember.variable_groups && selectedMember.variable_groups.length > 1 && (
                <div className="space-y-1.5 border-b border-slate-900/60 pb-3">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Dataset / Variable Group</label>
                  <div className="space-y-1 bg-slate-900/40 p-1.5 rounded-xl border border-slate-800/40 max-h-32 overflow-y-auto">
                    {selectedMember.variable_groups.map((group, idx) => (
                      <label
                        key={idx}
                        className={`flex items-center justify-between px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium transition-all ${
                          selectedGroup?.file_path === group.file_path
                            ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                            : 'text-slate-400 hover:text-slate-200 border border-transparent hover:bg-slate-900/60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="activeGroup"
                            checked={selectedGroup?.file_path === group.file_path}
                            onChange={() => handleSelectVariableGroup(group, selectedMember)}
                            className="rounded-full border-slate-800 bg-slate-950 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 w-3 h-3"
                          />
                          <span className="truncate max-w-[200px]">{group.name || `Dataset ${idx + 1}`}</span>
                        </div>
                        <span className="text-[9px] font-mono text-slate-500 uppercase">
                          {(group.variables || []).join(', ')}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {selectedMember.variable_groups && selectedMember.variable_groups.length === 1 && (
                <div className="text-[10px] text-slate-500 uppercase font-semibold pb-1 border-b border-slate-900/60">
                  Active Dataset: <span className="text-slate-300 normal-case font-normal">{selectedGroup?.name || 'Default'}</span>
                </div>
              )}

              {/* Variable Toggles */}
              {availableContourVars.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Variable</label>
                  <div className={`grid ${
                    availableContourVars.length === 3
                      ? 'grid-cols-3'
                      : availableContourVars.length === 2
                        ? 'grid-cols-2'
                        : 'grid-cols-1'
                  } gap-1 bg-slate-900/60 p-0.5 rounded-xl border border-slate-800/60`}>
                    {hasTemp && (
                      <button
                        onClick={() => setSelectedVariable('temp')}
                        className={`py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          selectedVariable === 'temp'
                            ? 'bg-slate-800 text-sky-400 shadow shadow-sky-500/10'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Thermometer className="w-3.5 h-3.5" /> Temp
                      </button>
                    )}
                    {hasSalt && (
                      <button
                        onClick={() => setSelectedVariable('salt')}
                        className={`py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          selectedVariable === 'salt'
                            ? 'bg-slate-800 text-teal-400 shadow shadow-teal-500/10'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Droplets className="w-3.5 h-3.5" /> Salt
                      </button>
                    )}
                    {hasZeta && (
                      <button
                        onClick={() => {
                          setSelectedVariable('zeta');
                          setCurrentDepthIndex(0);
                        }}
                        className={`py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          selectedVariable === 'zeta'
                            ? 'bg-slate-800 text-emerald-400 shadow shadow-emerald-500/10'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Waves className="w-3.5 h-3.5" /> SSH
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : clickedProduct ? (
            <div className="p-5 space-y-4">
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-slate-300">Model Outputs (Members)</h3>
                <p className="text-[10px] text-slate-500">Select one of the member models below to load and visualize its data layers on the map.</p>
              </div>
              {loadingMembers ? (
                <div className="py-8 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
                  <span className="text-xs text-slate-500">Loading models...</span>
                </div>
              ) : productMembers.length === 0 ? (
                <div className="py-8 text-center space-y-2 border border-dashed border-slate-800 rounded-xl">
                  <p className="text-xs text-slate-500">No member models added yet.</p>
                  <button
                    onClick={onNavigateAdmin}
                    className="text-[10px] font-bold text-sky-400 hover:text-sky-300"
                  >
                    Manage Models in Admin
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {productMembers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleSelectMember(m)}
                      className="w-full text-left p-3.5 bg-slate-900/60 hover:bg-slate-850 border border-slate-850 hover:border-slate-750 rounded-xl transition-all flex items-center justify-between group"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-200 group-hover:text-sky-400 transition-colors">{m.name}</div>
                        <div className="text-[9px] text-slate-500 mt-1 flex items-center gap-2">
                          <span>{m.variable_groups?.length || 0} datasets</span>
                          <span className="text-slate-700">•</span>
                          <span className="truncate max-w-[150px]">
                            {m.variable_groups?.[0]?.variables?.join(', ') || ''}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500">Select a highlighted bounding box on the map or choose a region below to inspect active model outputs.</p>
              </div>
              {products.length === 0 ? (
                <div className="py-8 text-center space-y-2 border border-dashed border-slate-800 rounded-xl">
                  <p className="text-xs text-slate-500">No regions or products configured.</p>
                  <button
                    onClick={onNavigateAdmin}
                    className="text-[10px] font-bold text-sky-400 hover:text-sky-300"
                  >
                    Add Products in Admin
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {products.map((p) => {
                    const hasRegion = !!p.region;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleProductClick(p.id, p.name)}
                        className="w-full text-left p-3.5 bg-slate-900/60 hover:bg-slate-850 border border-slate-850 hover:border-slate-750 rounded-xl transition-all flex items-center justify-between group"
                      >
                        <div>
                          <div className="text-xs font-bold text-slate-200 group-hover:text-sky-400 transition-colors">{p.name}</div>
                          <div className="text-[9px] text-slate-500 mt-1 flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${hasRegion ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-amber-500'}`}></span>
                            <span>{hasRegion ? 'Bounding Shape Derived' : 'No Shape Derived'}</span>
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>

        {/* 4a. Layer options & configure engine (Stacked under main panel) */}
        {selectedMember && metadata && (
          <section className="w-full bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-4 rounded-2xl shadow-2xl space-y-4 shrink-0">
            {/* Visibility Controls */}
            {(hasContoursOption || hasCurrents) && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Map Layers</span>
                <div className={`grid ${hasContoursOption && hasCurrents ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  {hasContoursOption && (
                    <label className="flex items-center justify-center gap-2 cursor-pointer text-xs font-semibold py-2 rounded-xl bg-slate-900/60 border border-slate-850 hover:border-slate-750 transition-colors text-slate-300">
                      <input
                        type="checkbox"
                        checked={showContours}
                        onChange={(e) => setShowContours(e.target.checked)}
                        className="rounded border-slate-800 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 w-3.5 h-3.5"
                      />
                      Contours
                    </label>
                  )}
                  {hasCurrents && (
                    <label className="flex items-center justify-center gap-2 cursor-pointer text-xs font-semibold py-2 rounded-xl bg-slate-900/60 border border-slate-850 hover:border-slate-750 transition-colors text-slate-300">
                      <input
                        type="checkbox"
                        checked={showCurrents}
                        onChange={(e) => setShowCurrents(e.target.checked)}
                        className="rounded border-slate-800 bg-slate-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-950 w-3.5 h-3.5"
                      />
                      Currents
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* Toggle Settings Button */}
            <div className="border-t border-slate-900 pt-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                  showSettings ? 'text-sky-400' : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Settings className={`w-3.5 h-3.5 ${showSettings ? 'animate-[spin_8s_linear_infinite]' : ''}`} /> Configure Engine
              </button>
            </div>

            {/* Expandable Settings */}
            {showSettings && (
              <div className="border-t border-slate-900 pt-3 space-y-3 animate-[fadeIn_0.2s_ease-out]">
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 uppercase">
                    <span>Current Vector Scale</span>
                    <span className="font-mono text-sky-400">{vectorScale.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.005"
                    max="0.08"
                    step="0.005"
                    value={vectorScale}
                    onChange={(e) => setVectorScale(parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 uppercase">
                    <span>Currents Downsampling</span>
                    <span className="font-mono text-emerald-400">1 / {downsampleRate}</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="5"
                    step="1"
                    value={downsampleRate}
                    onChange={(e) => setDownsampleRate(parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 uppercase">
                    <span>Contour Simplification</span>
                    <span className="font-mono text-amber-400">{simplification} deg</span>
                  </div>
                  <input
                    type="range"
                    min="0.0005"
                    max="0.005"
                    step="0.0005"
                    value={simplification}
                    onChange={(e) => setSimplification(parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* 4b. Depths vertically on the right */}
      {selectedMember && metadata && (
        <section className="absolute right-6 bottom-[54px] bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-3 rounded-2xl shadow-2xl z-10 flex flex-col items-center gap-2 pointer-events-auto">
          <div 
            className="text-[9px] font-bold text-slate-500 uppercase tracking-wider text-center pb-1 border-b border-slate-900 w-full"
          >
            Depth
          </div>
          <div className="flex flex-col gap-1.5 mt-1">
            {metadata.depths.map((d, idx) => {
              const isZeta = selectedVariable === 'zeta';
              const isSelected = isZeta ? idx === 0 : currentDepthIndex === idx;
              return (
                <button
                  key={d}
                  disabled={isZeta}
                  onClick={() => setCurrentDepthIndex(idx)}
                  className={`w-12 py-2 rounded-xl text-[11px] font-bold border transition-all ${
                    isSelected
                      ? 'bg-sky-500/10 text-sky-400 border-sky-500/50'
                      : 'bg-slate-900/40 text-slate-400 border-slate-800'
                  } ${
                    isZeta
                      ? 'opacity-40 cursor-not-allowed border-slate-800/20'
                      : 'hover:text-slate-200 hover:border-slate-700'
                  }`}
                  title={d === 0 ? 'Surface' : `${Math.abs(d)}m`}
                >
                  {d === 0 ? 'Surf' : `${Math.abs(d)}m`}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 4c. Time playback options across the bottom */}
      {selectedMember && metadata && (
        <section className="absolute bottom-[54px] left-1/2 -translate-x-1/2 bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg px-6 py-3 rounded-2xl shadow-2xl z-10 flex items-center gap-6 pointer-events-auto w-[960px] max-w-[calc(100vw-32px)]">
          {/* Play/Pause Button Group */}
          <div className="flex items-center gap-1 bg-slate-900/60 p-0.5 rounded-xl border border-slate-800/40 shrink-0">
            <button
              onClick={() => setCurrentTimeIndex((prev) => (prev - 1 + metadata.times.length) % metadata.times.length)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
              title="Previous Step"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`p-2 rounded-xl transition-all ${
                isPlaying ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20' : 'text-slate-300 hover:bg-slate-800/50'
              }`}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setCurrentTimeIndex((prev) => (prev + 1) % metadata.times.length)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
              title="Next Step"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          {/* Timeline Slider & Progress */}
          <div className="flex-1 flex flex-col gap-1">
            <div className="relative group flex items-center">
              <input
                type="range"
                min="0"
                max={metadata.times.length - 1}
                value={currentTimeIndex}
                onChange={(e) => setCurrentTimeIndex(parseInt(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
              />
            </div>
            <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono leading-none">
              <span>0h</span>
              <span>Timeline Progress</span>
              <span>{metadata.times.length - 1}h</span>
            </div>
          </div>

          {/* Active Timestamp details */}
          <div className="flex flex-col text-right shrink-0 border-l border-slate-900 pl-4 min-w-[110px]">
            <span className="text-xs font-bold text-slate-200">
              {formatTime(metadata.times[currentTimeIndex])}
            </span>
            <span className="text-[9px] text-slate-500 font-mono mt-0.5">
              Step {currentTimeIndex + 1} / {metadata.times.length}
            </span>
          </div>

          {/* Playback speed selector */}
          <div className="flex items-center gap-2 border-l border-slate-900 pl-4 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Speed</span>
            <div className="flex gap-0.5 bg-slate-900/60 p-0.5 rounded-lg border border-slate-850">
              {[1, 2, 5, 10, 20].map((speed) => (
                <button
                  key={speed}
                  onClick={() => setPlaybackSpeed(speed)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all ${
                    playbackSpeed === speed
                      ? 'bg-slate-800 text-sky-400 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {speed}fps
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 5. Compass Rose / North arrow (Top Right) */}
      <div className="absolute top-4 right-4 p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800/80 backdrop-blur-md shadow-xl z-10 flex items-center justify-center pointer-events-auto">
        <Compass className="w-5 h-5 text-slate-400 animate-[spin_60s_linear_infinite]" />
      </div>
    </div>
  );
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  
  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (newPath) => {
    window.history.pushState({}, "", newPath);
    setPath(newPath);
  };

  if (path === '/admin') {
    return <Admin onBack={() => navigate('/')} />;
  }
  
  return <Visualizer onNavigateAdmin={() => navigate('/admin')} />;
}
