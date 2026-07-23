import React, { useState, useEffect, useRef, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MaskExtension } from '@deck.gl/extensions';
import Map from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { Play, Pause, SkipForward, SkipBack, Settings, Compass, Waves, Layers, Thermometer, Droplets, ArrowRight, ArrowLeft, Loader2, Activity, MapPin, X, ExternalLink, SlidersHorizontal, ChevronUp, ChevronDown } from 'lucide-react';
import Admin from './Admin';

import { API_URL } from './config';

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

// Centroid calculator for polygons/multipolygons
const getCentroid = (geometry) => {
  if (!geometry) return null;
  let coords = [];
  if (geometry.type === 'Polygon') {
    coords = geometry.coordinates[0];
  } else if (geometry.type === 'MultiPolygon') {
    coords = geometry.coordinates[0][0];
  } else {
    return null;
  }
  let sumLon = 0;
  let sumLat = 0;
  coords.forEach(coord => {
    sumLon += coord[0];
    sumLat += coord[1];
  });
  return {
    longitude: sumLon / coords.length,
    latitude: sumLat / coords.length
  };
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

const getZoomParameters = (zoom) => {
  const z = zoom || 5.8;
  if (z < 5.5) return { downsample: 10, maxPixels: 5 };
  if (z < 5.5) return { downsample: 6, maxPixels: 10 };
  if (z < 6.0) return { downsample: 5, maxPixels: 15 };
  if (z < 6.5) return { downsample: 5, maxPixels: 15 };
  if (z < 7.0) return { downsample: 3, maxPixels: 18 };
  if (z < 8) return { downsample: 3, maxPixels: 20 };
  if (z < 9.0) return { downsample: 3, maxPixels: 25 };
  if (z < 10.0) return { downsample: 2, maxPixels: 25 };
  return { downsample: 1, maxPixels: 35 };
};

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

  // Customization & Responsive States
  const [targetMaxPixels, setTargetMaxPixels] = useState(40);
  const [downsampleRate, setDownsampleRate] = useState(3);
  const [simplification, setSimplification] = useState(0.001);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isDepthOpen, setIsDepthOpen] = useState(false);

  // Grid Points & Time Series States
  const [showPoints, setShowPoints] = useState(false);
  const [pointsData, setPointsData] = useState([]);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [clickedPoint, setClickedPoint] = useState(null); // { lat, lng, i, j }
  const [timeSeriesData, setTimeSeriesData] = useState(null); // { times, values, variable, unit, lat, lng }
  const [timeSeriesVariable, setTimeSeriesVariable] = useState('temp');
  const [loadingTimeSeries, setLoadingTimeSeries] = useState(false);

  // Independent Caches for Contours and Currents
  const [contourCache, setContourCache] = useState({});
  const [currentsCache, setCurrentsCache] = useState({});
  const [maskData, setMaskData] = useState(null);

  const contourCacheRef = useRef({});
  const currentsCacheRef = useRef({});
  const fetchingContourKeysRef = useRef(new Set());
  const fetchingCurrentsKeysRef = useRef(new Set());

  // Load mask data on mount
  useEffect(() => {
    import('./sa_province_outline.json')
      .then((mod) => {
        // Expand mask layer bounds to cover all model boundary regions (e.g. down to -42 latitude and 10 longitude)
        // so that deck.gl doesn't clip layers outside the land mask's natural bounding box.
        const expandedMask = {
          ...mod.default,
          features: [
            ...mod.default.features,
            {
              type: 'Feature',
              properties: { dummy: true },
              geometry: {
                type: 'Point',
                coordinates: [10, -42]
              }
            },
            {
              type: 'Feature',
              properties: { dummy: true },
              geometry: {
                type: 'Point',
                coordinates: [35, -20]
              }
            }
          ]
        };
        setMaskData(expandedMask);
        console.log('SA province outline mask loaded successfully with expanded bounds');
      })
      .catch((err) => {
        console.error('Failed to load SA province outline mask:', err);
      });
  }, []);

  // Keep cache refs in sync
  useEffect(() => {
    contourCacheRef.current = contourCache;
  }, [contourCache]);

  useEffect(() => {
    currentsCacheRef.current = currentsCache;
  }, [currentsCache]);

  const currentTimeIndexRef = useRef(currentTimeIndex);
  useEffect(() => {
    currentTimeIndexRef.current = currentTimeIndex;
  }, [currentTimeIndex]);

  // Viewport State
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

  // Dynamic Zoom-driven Downsampling & Max Pixel Scaling
  const { autoDownsampleRate, autoMaxPixels, quantizedZoom } = useMemo(() => {
    const z = viewState?.zoom || 5.8;
    const params = getZoomParameters(z);

    let qz = 12.0;
    if (z < 5.5) qz = 5.0;
    else if (z < 6.0) qz = 5.5;
    else if (z < 6.5) qz = 6.0;
    else if (z < 7.0) qz = 6.5;
    else if (z < 7.5) qz = 7.0;
    else if (z < 8.0) qz = 7.5;
    else if (z < 9.0) qz = 8.0;
    else if (z < 10.0) qz = 9.0;
    else if (z < 11.0) qz = 10.0;
    else if (z < 12.0) qz = 11.0;

    return {
      autoDownsampleRate: params.downsample,
      autoMaxPixels: params.maxPixels,
      quantizedZoom: qz
    };
  }, [viewState?.zoom]);

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

  // Fetch grid points when group changes (fixed rate, independent of current vector downsampling)
  useEffect(() => {
    if (!selectedGroup) {
      setPointsData([]);
      return;
    }
    const filePath = selectedGroup.file_path;
    setLoadingPoints(true);
    fetch(`${API_URL}/api/points?file_path=${encodeURIComponent(filePath)}&downsample=2`)
      .then((res) => {
        if (!res.ok) throw new Error('API server returned error');
        return res.json();
      })
      .then((data) => {
        setPointsData(data || []);
      })
      .catch((err) => {
        console.error('Error fetching grid points:', err);
      })
      .finally(() => {
        setLoadingPoints(false);
      });
  }, [selectedGroup]);

  // Fetch time series data when clickedPoint, variable, or depth changes
  useEffect(() => {
    if (!clickedPoint || !selectedGroup) {
      setTimeSeriesData(null);
      return;
    }
    const filePath = selectedGroup.file_path;
    const dIdx = timeSeriesVariable === 'zeta' ? 0 : currentDepthIndex;

    setLoadingTimeSeries(true);
    fetch(`${API_URL}/api/timeseries?file_path=${encodeURIComponent(filePath)}&variable=${timeSeriesVariable}&depth=${dIdx}&i=${clickedPoint.i}&j=${clickedPoint.j}`)
      .then((res) => {
        if (!res.ok) throw new Error('API server returned error');
        return res.json();
      })
      .then((data) => {
        setTimeSeriesData(data);
      })
      .catch((err) => {
        console.error('Error fetching time series:', err);
      })
      .finally(() => {
        setLoadingTimeSeries(false);
      });
  }, [clickedPoint, timeSeriesVariable, currentDepthIndex, selectedGroup]);

  const handleProductClick = async (prodId, prodName) => {
    setLoadingMembers(true);
    setClickedProduct({ id: prodId, name: prodName });
    setSelectedMember(null);
    setSelectedGroup(null);
    setMetadata(null);

    // Zoom slightly into the clicked bounding box region
    const prod = products.find(p => p.id === prodId);
    if (prod && prod.region) {
      const centroid = getCentroid(prod.region);
      if (centroid) {
        setViewState(prev => ({
          ...prev,
          longitude: centroid.longitude,
          latitude: centroid.latitude,
          zoom: 5.5,
          transitionDuration: 1200
        }));
      }
    }

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
        // Clear caches on group change
        setContourCache({});
        setCurrentsCache({});
        fetchingFrameKeysRef.current.clear();
        fetch(`${API_URL}/api/clear_cache`, { method: 'POST' }).catch(() => { });
      } else {
        console.error("Failed to load metadata for file:", group.file_path);
      }
    } catch (e) {
      console.error("Error fetching metadata:", e);
    }
  };

  const handleClearAllCaches = async () => {
    setContourCache({});
    setCurrentsCache({});
    fetchingFrameKeysRef.current.clear();
    try {
      await fetch(`${API_URL}/api/clear_cache`, { method: 'POST' });
    } catch (e) {
      console.error("Failed to clear backend cache", e);
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

  const fetchingFrameKeysRef = useRef(new Set());

  const fetchFrameData = async (filePath, variable, depth, time, tolerance, needContours, needCurrents, signal) => {
    const contourKey = `${filePath}_${variable}_${depth}_${time}_tol${tolerance}`;
    const currentsKey = `${filePath}_${depth}_${time}`;
    const requestKey = `${contourKey}__${currentsKey}__c${needContours}_v${needCurrents}`;

    if (fetchingFrameKeysRef.current.has(requestKey)) return;
    fetchingFrameKeysRef.current.add(requestKey);

    try {
      const frameUrl = `${API_URL}/api/frame?variable=${variable}&time=${time}&depth=${depth}&tolerance=${tolerance}` +
        `&include_contours=${needContours}&include_currents=${needCurrents}` +
        (filePath ? `&file_path=${encodeURIComponent(filePath)}` : '');
      const res = await fetch(frameUrl, { signal });
      const data = await res.json();

      if (data.contours) {
        setContourCache((prev) => ({ ...prev, [contourKey]: data.contours }));
      }
      if (data.currents) {
        setCurrentsCache((prev) => ({ ...prev, [currentsKey]: data.currents }));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(`Failed to fetch frame ${requestKey}:`, err);
      }
    } finally {
      fetchingFrameKeysRef.current.delete(requestKey);
    }
  };

  // Single-connection NDJSON Stream Prefetching
  useEffect(() => {
    if (!metadata || !selectedGroup) return;

    let isCancelled = false;
    const controller = new AbortController();
    const filePath = selectedGroup.file_path || '';
    const dIdx = selectedVariable === 'zeta' ? 0 : currentDepthIndex;
    const numSteps = metadata.times.length;
    const startIdx = currentTimeIndexRef.current || 0;

    const streamPrefetch = async () => {
      // 1. Fetch active start frame immediately if missing
      const firstContourKey = `${filePath}_${selectedVariable}_${dIdx}_${startIdx}_tol${simplification}`;
      const firstCurrentsKey = `${filePath}_${dIdx}_${startIdx}`;
      const needFirstContours = showContours && !contourCacheRef.current[firstContourKey];
      const needFirstCurrents = showCurrents && !currentsCacheRef.current[firstCurrentsKey];

      if (needFirstContours || needFirstCurrents) {
        await fetchFrameData(filePath, selectedVariable, dIdx, startIdx, simplification, needFirstContours, needFirstCurrents, controller.signal);
      }

      if (isCancelled || controller.signal.aborted) return;

      // 2. Stream all remaining frames over ONE single HTTP connection
      const streamUrl = `${API_URL}/api/stream_frames?variable=${selectedVariable}&depth=${dIdx}&tolerance=${simplification}` +
        `&start_time=${startIdx}&count=${numSteps}` +
        `&include_contours=${showContours}&include_currents=${showCurrents}` +
        (filePath ? `&file_path=${encodeURIComponent(filePath)}` : '');

      try {
        const response = await fetch(streamUrl, { signal: controller.signal });
        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let partialLine = '';

        while (true) {
          if (isCancelled || controller.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = (partialLine + chunk).split('\n');
          partialLine = lines.pop(); // save trailing partial line

          const pendingContours = {};
          const pendingCurrents = {};

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              const tIdx = data.time;
              const cKey = `${filePath}_${selectedVariable}_${dIdx}_${tIdx}_tol${simplification}`;
              const vKey = `${filePath}_${dIdx}_${tIdx}`;

              if (data.contours) {
                pendingContours[cKey] = data.contours;
              }
              if (data.currents) {
                pendingCurrents[vKey] = data.currents;
              }
            } catch (e) {
              console.error("Error parsing stream line:", e);
            }
          }

          if (Object.keys(pendingContours).length > 0) {
            setContourCache((prev) => ({ ...prev, ...pendingContours }));
          }
          if (Object.keys(pendingCurrents).length > 0) {
            setCurrentsCache((prev) => ({ ...prev, ...pendingCurrents }));
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error("Stream prefetch error:", err);
        }
      }
    };

    streamPrefetch();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [selectedVariable, currentDepthIndex, simplification, showContours, showCurrents, metadata, selectedGroup]);

  // Playback Loop
  useEffect(() => {
    let timer = null;
    if (isPlaying && metadata) {
      timer = setInterval(() => {
        const dIdx = selectedVariable === 'zeta' ? 0 : currentDepthIndex;
        const filePath = selectedGroup?.file_path || '';

        setCurrentTimeIndex((prev) => {
          const contourKey = `${filePath}_${selectedVariable}_${dIdx}_${prev}_tol${simplification}`;
          const currentsKey = `${filePath}_${dIdx}_${prev}`;

          const isContourLoaded = !showContours || !!contourCacheRef.current[contourKey];
          const isCurrentsLoaded = !showCurrents || !!currentsCacheRef.current[currentsKey];

          if (!isContourLoaded || !isCurrentsLoaded) {
            // The current frame hasn't loaded yet. Stay here and wait.
            return prev;
          }

          // Advance to the next frame
          return (prev + 1) % metadata.times.length;
        });
      }, 1000 / playbackSpeed);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, playbackSpeed, metadata, selectedVariable, currentDepthIndex, simplification, showContours, showCurrents, selectedGroup]);

  // Active Keys
  const activeContourKey = useMemo(() => {
    const dIdx = selectedVariable === 'zeta' ? 0 : currentDepthIndex;
    const filePath = selectedGroup?.file_path || '';
    return `${filePath}_${selectedVariable}_${dIdx}_${currentTimeIndex}_tol${simplification}`;
  }, [selectedVariable, currentDepthIndex, currentTimeIndex, simplification, selectedGroup]);

  const activeCurrentsKey = useMemo(() => {
    const currentsDepth = selectedVariable === 'zeta' ? 0 : currentDepthIndex;
    const filePath = selectedGroup?.file_path || '';
    return `${filePath}_${currentsDepth}_${currentTimeIndex}`;
  }, [selectedVariable, currentDepthIndex, currentTimeIndex, selectedGroup]);

  // Calculate consecutive buffered frames from currentTimeIndex
  const bufferedRange = useMemo(() => {
    if (!metadata || !selectedGroup) return { count: 0, percentage: 0 };
    const numSteps = metadata.times.length;
    const dIdx = selectedVariable === 'zeta' ? 0 : currentDepthIndex;
    const filePath = selectedGroup?.file_path || '';

    let count = 0;
    for (let i = 0; i < numSteps; i++) {
      const idx = (currentTimeIndex + i) % numSteps;
      const cKey = `${filePath}_${selectedVariable}_${dIdx}_${idx}_tol${simplification}`;
      const vKey = `${filePath}_${dIdx}_${idx}`;
      const hasC = !showContours || !!contourCache[cKey];
      const hasV = !showCurrents || !!currentsCache[vKey];

      if (hasC && hasV) {
        count++;
      } else {
        break;
      }
    }
    return {
      count,
      percentage: Math.min(100, (count / Math.max(1, numSteps - 1)) * 100)
    };
  }, [metadata, selectedGroup, currentTimeIndex, selectedVariable, currentDepthIndex, simplification, showContours, showCurrents, contourCache, currentsCache]);

  const activeContours = selectedGroup && showContours ? contourCache[activeContourKey] : null;
  const rawActiveCurrents = selectedGroup && showCurrents ? currentsCache[activeCurrentsKey] : null;

  const activeCurrents = useMemo(() => {
    if (!rawActiveCurrents) return null;
    if (!pointsData || pointsData.length === 0) return rawActiveCurrents;
    if (rawActiveCurrents.length > 0 && Array.isArray(rawActiveCurrents[0]) && rawActiveCurrents[0].length === 2) {
      return rawActiveCurrents.map((uv, idx) => {
        const pt = pointsData[idx] || {};
        return {
          lng: pt.lng ?? pt[0],
          lat: pt.lat ?? pt[1],
          u: uv[0],
          v: uv[1],
          i: pt.i ?? pt[2],
          j: pt.j ?? pt[3]
        };
      });
    }
    return rawActiveCurrents;
  }, [rawActiveCurrents, pointsData]);

  const isLoading = selectedGroup ? ((showContours && !activeContours) || (showCurrents && !activeCurrents)) : false;

  // Double-buffering: hold last rendered data to avoid blinks while loading within the SAME variable group
  const [renderedData, setRenderedData] = useState(null);
  useEffect(() => {
    setRenderedData((prev) => {
      const isSameGroup = prev?.filePath === selectedGroup?.file_path;
      return {
        filePath: selectedGroup?.file_path,
        contours: showContours ? (activeContours || (isSameGroup ? prev?.contours : null)) : null,
        currents: showCurrents ? (activeCurrents || (isSameGroup ? prev?.currents : null)) : null,
      };
    });
  }, [activeContours, activeCurrents, showContours, showCurrents, selectedGroup?.file_path]);

  // 2D Grid Downsampling in JS (Zero network latency when zooming)
  const displayCurrents = useMemo(() => {
    if (!renderedData?.currents) return [];
    if (autoDownsampleRate <= 1) return renderedData.currents;
    const step = autoDownsampleRate;
    return renderedData.currents.filter((pt) =>
      (pt.i !== undefined && pt.j !== undefined)
        ? (pt.i % step === 0 && pt.j % step === 0)
        : true
    );
  }, [renderedData?.currents, autoDownsampleRate]);

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

  const activeValMin = (showContours && renderedData?.contours?.value_min !== undefined)
    ? renderedData.contours.value_min
    : valMin;
  const activeValMax = (showContours && renderedData?.contours?.value_max !== undefined)
    ? renderedData.contours.value_max
    : valMax;

  const legendValues = useMemo(() => {
    const decimals = selectedVariable === 'temp' ? 1 : 2;
    const range = activeValMax - activeValMin;
    return [
      activeValMax.toFixed(decimals),
      (activeValMin + range * 0.75).toFixed(decimals),
      (activeValMin + range * 0.50).toFixed(decimals),
      (activeValMin + range * 0.25).toFixed(decimals),
      activeValMin.toFixed(decimals),
    ];
  }, [activeValMin, activeValMax, selectedVariable]);

  const maxSpeed = useMemo(() => {
    if (!metadata) return 1.5;
    const dIdx = currentDepthIndex;
    const uRange = Array.isArray(metadata.ranges.u) ? metadata.ranges.u[dIdx] : metadata.ranges.u;
    const vRange = Array.isArray(metadata.ranges.v) ? metadata.ranges.v[dIdx] : metadata.ranges.v;

    const uMax = Math.max(Math.abs(uRange.min), Math.abs(uRange.max));
    const vMax = Math.max(Math.abs(vRange.min), Math.abs(vRange.max));
    return Math.sqrt(uMax * uMax + vMax * vMax);
  }, [metadata, currentDepthIndex]);

  const { currentMinSpeed, currentMaxSpeed } = useMemo(() => {
    if (!renderedData?.currents || renderedData.currents.length === 0) {
      return { currentMinSpeed: 0, currentMaxSpeed: maxSpeed || 0 };
    }
    let minS = Infinity;
    let maxS = -Infinity;
    for (let i = 0; i < renderedData.currents.length; i++) {
      const d = renderedData.currents[i];
      const s = Math.sqrt(d.u * d.u + d.v * d.v);
      if (s < minS) minS = s;
      if (s > maxS) maxS = s;
    }
    return {
      currentMinSpeed: isFinite(minS) ? minS : 0,
      currentMaxSpeed: isFinite(maxS) ? maxS : 0
    };
  }, [renderedData?.currents, maxSpeed]);

  // Construct Deck.gl Layers
  const layers = useMemo(() => {
    const layersList = [];

    // 0. Mask Layer (defining the land mask)
    if (maskData) {
      layersList.push(
        new GeoJsonLayer({
          id: 'land-mask',
          data: maskData,
          operation: 'mask',
          getFillColor: [0, 0, 0, 255]
        })
      );
    }

    // 1. Contours Layer
    if (showContours && renderedData?.contours && selectedMember) {
      layersList.push(
        new GeoJsonLayer({
          id: 'contour-layer',
          data: renderedData.contours,
          filled: true,
          stroked: true,
          lineWidthScale: 1,
          lineWidthMinPixels: 0.5,
          getFillColor: (f) => {
            const val = f.properties.value;
            const t = (val - activeValMin) / (activeValMax - activeValMin || 1);
            const rgb = interpolateColor(t, stops);
            return [...rgb, 150]; // Semi-transparent fill (alpha 150 / 255)
          },
          getLineColor: [0, 0, 0, 40], // Very subtle dark outline between contour bands
          getLineWidth: 0.5,
          extensions: maskData ? [new MaskExtension()] : [],
          maskId: 'land-mask',
          maskInverted: true,
          updateTriggers: {
            getFillColor: [activeValMin, activeValMax, stops]
          }
        })
      );
    }

    // 2. Currents Layers (Path-based Arrow Vectors)
    if (showCurrents && displayCurrents.length > 0 && selectedMember) {
      // Stepped zoom vector scaling: keeps vector path calculation static between zoom breakpoints for 60 FPS performance
      const latRad = ((viewState?.latitude || -34) * Math.PI) / 180;
      const degPerPixel = 360 / (256 * Math.pow(2, quantizedZoom) * Math.cos(latRad));
      const TARGET_MAX_PIXELS = autoMaxPixels;
      const refMaxSpeed = currentMaxSpeed > 0 ? currentMaxSpeed : (maxSpeed || 1.5);
      const dynamicVectorScale = (TARGET_MAX_PIXELS * degPerPixel) / refMaxSpeed;

      layersList.push(
        new PathLayer({
          id: 'currents-arrows',
          data: displayCurrents,
          pickable: true,
          widthMinPixels: 1.5,
          widthMaxPixels: 3.5,
          getPath: (d) => {
            let dx = d.u * dynamicVectorScale;
            let dy = d.v * dynamicVectorScale;
            let L = Math.sqrt(dx * dx + dy * dy);
            if (L === 0) return [[d.lng, d.lat], [d.lng, d.lat]];

            const maxAllowedL = TARGET_MAX_PIXELS * 1.5 * degPerPixel;
            if (L > maxAllowedL) {
              const scale = maxAllowedL / L;
              dx *= scale;
              dy *= scale;
              L = maxAllowedL;
            }

            const theta = Math.atan2(dy, dx);

            // Arrowhead barb length (up to 7 pixels in degrees)
            const barbLength = Math.min(L * 0.35, 7 * degPerPixel);

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
            getPath: [displayCurrents, autoMaxPixels, autoDownsampleRate, quantizedZoom, currentMaxSpeed, maxSpeed]
          }
        })
      );
    }

    // 2.5. Grid Points Layer
    if (selectedMember && showPoints && pointsData.length > 0) {
      layersList.push(
        new ScatterplotLayer({
          id: 'grid-points-layer',
          data: pointsData,
          pickable: true,
          opacity: 0.8,
          stroked: false,
          filled: true,
          radiusScale: 1,
          radiusMinPixels: 1.0,
          radiusMaxPixels: 10,
          lineWidthMinPixels: 1,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: (d) => 350,
          getFillColor: [255, 255, 255, 220],
          extensions: maskData ? [new MaskExtension()] : [],
          maskId: 'land-mask',
          maskInverted: true,
          onClick: (info) => {
            if (info.object) {
              const available = selectedGroup?.variables || [];
              const standardVars = ['temp', 'salt', 'zeta'];
              const activeStandard = standardVars.includes(selectedVariable) ? selectedVariable : null;
              const defaultVar = activeStandard || available.find(v => standardVars.includes(v)) || 'temp';

              setClickedPoint({
                lat: info.object.lat,
                lng: info.object.lng,
                i: info.object.i,
                j: info.object.j
              });
              setTimeSeriesVariable(defaultVar);
            }
          }
        })
      );
    }

    // 3. Product Bounding Boxes
    if (!selectedMember) {
      const productRegions = products
        .filter(p => p.region && (!clickedProduct || p.id === clickedProduct.id))
        .map(p => ({
          type: 'Feature',
          geometry: p.region,
          properties: {
            id: p.id,
            name: p.name,
            isClicked: clickedProduct && p.id === clickedProduct.id
          }
        }));

      layersList.push(
        new GeoJsonLayer({
          id: maskData ? 'products-boundary-layer-masked' : 'products-boundary-layer-unmasked',
          data: {
            type: 'FeatureCollection',
            features: productRegions
          },
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthScale: 1,
          lineWidthMinPixels: 2,
          getFillColor: (f) => f.properties.isClicked ? [14, 165, 233, 100] : [14, 165, 233, 40], // Darker when clicked
          getLineColor: (f) => f.properties.isClicked ? [14, 165, 233, 255] : [14, 165, 233, 220], // Darker border
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
  }, [renderedData, displayCurrents, showContours, showCurrents, showPoints, pointsData, selectedGroup, selectedVariable, activeValMin, activeValMax, stops, autoMaxPixels, autoDownsampleRate, quantizedZoom, maxSpeed, currentMaxSpeed, selectedMember, products, maskData, clickedProduct]);

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
        onClick={(info) => {
          if (showPoints && pointsData.length > 0 && info.coordinate) {
            const [clickLng, clickLat] = info.coordinate;
            let closestPt = null;
            let minDistance = Infinity;

            for (let i = 0; i < pointsData.length; i++) {
              const pt = pointsData[i];
              const dLng = pt.lng - clickLng;
              const dLat = pt.lat - clickLat;
              const dist = dLng * dLng + dLat * dLat;
              if (dist < minDistance) {
                minDistance = dist;
                closestPt = pt;
              }
            }

            if (closestPt) {
              const available = selectedGroup?.variables || [];
              const standardVars = ['temp', 'salt', 'zeta'];
              const activeStandard = standardVars.includes(selectedVariable) ? selectedVariable : null;
              const defaultVar = activeStandard || available.find(v => standardVars.includes(v)) || 'temp';

              setClickedPoint({
                lat: closestPt.lat,
                lng: closestPt.lng,
                i: closestPt.i,
                j: closestPt.j
              });
              setTimeSeriesVariable(defaultVar);
            }
          }
        }}
      >
        <Map
          reuseMaps
          mapLib={maplibregl}
          mapStyle={ESRI_MAP_STYLE}
          preventStyleDiffing={true}
        />
      </DeckGL>

      {/* 2. Top Header Title (Full-Width Header) */}
      <header className="absolute top-0 left-0 right-0 h-16 sm:h-20 bg-slate-950/90 border-b border-slate-800/80 backdrop-blur-md shadow-lg z-20 flex items-center justify-between px-3 sm:px-6 pointer-events-auto gap-2 sm:gap-4">
        {/* Left: Clickable Logos & Title */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 py-1">
            <a
              href="https://www.saeon.ac.za/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity"
              title="Visit NRF SAEON Website"
            >
              <img src={`${import.meta.env.BASE_URL}saeon-logo.png`} alt="SAEON Logo" className="h-6 sm:h-8 w-auto object-contain" />
            </a>
            <a
              href="https://somisana.ac.za/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity"
              title="Visit SOMISANA Website"
            >
              <img src={`${import.meta.env.BASE_URL}somisana-logo.png`} alt="SOMISANA Logo" className="h-6 sm:h-8 w-auto object-contain" />
            </a>
          </div>
          <div className="h-5 sm:h-6 w-[1px] bg-slate-800/80 hidden sm:block"></div>
          <div>
            <h1 className="font-bold text-xs sm:text-base text-slate-100 tracking-tight font-outfit truncate max-w-[120px] sm:max-w-none">
              Ocean Model Visualiser
            </h1>
          </div>
        </div>

        {/* Center: Active Model & Region status text */}
        <div className="hidden lg:flex flex-1 justify-center items-center px-4 text-center">
          <p className="text-xs text-slate-300 font-medium bg-slate-900/80 border border-slate-800/80 px-4 py-1.5 rounded-full shadow-inner truncate max-w-xl">
            {selectedMember
              ? `Active Model: ${selectedMember.name} (Region: ${clickedProduct?.name || 'Unknown'})`
              : clickedProduct
                ? `Region: ${clickedProduct.name} - Select a member model to begin`
                : "Select a region to explore"}
          </p>
        </div>

        {/* Right: Access Data link button */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <a
            href="https://catalog.somisana.ac.za/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 sm:px-3.5 sm:py-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/40 hover:border-sky-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center gap-1 sm:gap-1.5 group"
            title="Access SOMISANA Data Catalog"
          >
            <span>Access Data</span>
            <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </a>
        </div>
      </header>

      {/* 2.1. Top Banner Loading Bar */}
      {(isLoading || loadingMembers || loadingPoints || loadingTimeSeries) && (
        <div className="absolute top-16 sm:top-20 left-0 right-0 h-4 sm:h-5 bg-slate-950/95 border-b border-sky-500/30 backdrop-blur-md z-20 flex items-center px-3 sm:px-6 gap-2 sm:gap-3 shadow-lg transition-all">
          <span className="text-[8px] sm:text-[9px] font-mono font-bold text-sky-400 uppercase tracking-widest shrink-0">
            loading:
          </span>
          <div className="flex-1 h-1 bg-slate-900 rounded-full overflow-hidden relative border border-slate-800/80">
            <div className="absolute top-0 bottom-0 bg-gradient-to-r from-sky-500 via-emerald-400 to-sky-400 rounded-full animate-progress-bar shadow-[0_0_8px_rgba(56,189,248,0.6)]"></div>
          </div>
        </div>
      )}
      {selectedMember && metadata && showContours && (
        <section className="absolute bottom-[135px] sm:bottom-[54px] left-3 sm:left-6 w-16 sm:w-20 h-64 sm:h-76 bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-2.5 sm:p-3.5 rounded-2xl shadow-2xl z-10 flex flex-col items-center justify-between pointer-events-auto">
          {/* Label at the top */}
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider text-center truncate max-w-full pb-1 border-b border-slate-900 w-full">
            {selectedVariable === 'temp' ? 'Temp' : selectedVariable === 'salt' ? 'Salt' : 'SSH'}
          </div>

          {/* Ramp Container */}
          <div className="flex-1 w-full flex justify-center gap-2 sm:gap-2.5 my-2">
            {/* Color bar */}
            <div
              className="w-2 sm:w-2.5 h-full rounded-md shadow-inner"
              style={{
                background: `linear-gradient(to top, ${stops.map(s => `rgb(${s.color.slice(0, 3).join(',')})`).join(', ')})`
              }}
            ></div>

            {/* 5 Values */}
            <div className="flex flex-col justify-between text-[8px] sm:text-[9px] font-mono text-slate-400 h-full text-left py-0.5">
              {legendValues.map((val, i) => (
                <span
                  key={i}
                  className={
                    i === 0 || i === legendValues.length - 1
                      ? "text-slate-200 font-medium"
                      : i === 2
                        ? "text-slate-300"
                        : "text-slate-500"
                  }
                >
                  {val}
                </span>
              ))}
            </div>
          </div>

          {/* Unit at the bottom */}
          <div className="text-[9px] font-bold text-slate-500 text-center pt-1 border-t border-slate-900 w-full">
            {selectedVariable === 'temp' ? '°C' : selectedVariable === 'salt' ? 'g/kg' : 'm'}
          </div>
        </section>
      )}

      {/* 4.5. Current Vector Scale Legend */}
      {selectedMember && metadata && showCurrents && (
        <section className={`absolute bottom-[135px] sm:bottom-[54px] ${showContours ? 'left-22 sm:left-28' : 'left-3 sm:left-6'} bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-2.5 sm:p-3.5 rounded-2xl shadow-2xl z-10 flex flex-col gap-1.5 sm:gap-2 pointer-events-auto transition-all`}>
          {/* Legend Title */}
          <div className="flex items-center justify-between border-b border-slate-850/60 pb-1 gap-2 sm:gap-4">
            <span className="text-[9px] sm:text-[10px] font-bold text-slate-300 uppercase tracking-wider">Vector Scale</span>
            <span className="text-[8px] sm:text-[9px] font-mono font-bold text-sky-400 bg-sky-950/60 border border-sky-800/50 px-1 py-0.5 rounded-md">m/s</span>
          </div>

          {/* Reference Arrow */}
          {(() => {
            const legendArrowPixels = Math.max(5, Math.round(autoMaxPixels * Math.pow(2, (viewState?.zoom || 6) - quantizedZoom)));
            return (
              <div className="flex items-center justify-between gap-2 sm:gap-4 py-0.5 sm:py-1">
                <div className="flex items-center justify-center min-w-[30px] sm:min-w-[35px]">
                  <svg
                    style={{ width: `${Math.max(legendArrowPixels, 12)}px`, height: '14px' }}
                    viewBox={`0 0 ${Math.max(legendArrowPixels, 12)} 14`}
                    className="overflow-visible"
                  >
                    <line
                      x1="0"
                      y1="7"
                      x2={Math.max(0, legendArrowPixels - 5)}
                      y2="7"
                      stroke="#38bdf8"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <polygon
                      points={`${Math.max(0, legendArrowPixels - 5)},4 ${legendArrowPixels},7 ${Math.max(0, legendArrowPixels - 5)},10`}
                      fill="#38bdf8"
                    />
                  </svg>
                </div>
                <span className="text-[9px] sm:text-[10px] font-mono text-slate-200 font-medium whitespace-nowrap">
                  {currentMaxSpeed.toFixed(2)} m/s
                </span>
              </div>
            );
          })()}
        </section>
      )}

      {/* 3. Left Sidebar Control Panel Stack */}
      <div className={`absolute top-[72px] sm:top-[106px] left-3 sm:left-6 w-[calc(100vw-24px)] sm:w-96 z-20 flex flex-col gap-2 sm:gap-4 pointer-events-auto transition-all duration-300 ${isPanelOpen ? 'max-h-[calc(100vh-220px)] sm:max-h-[calc(100vh-186px)] overflow-y-auto pr-1' : 'max-h-12 overflow-hidden'}`}>
        
        {/* Mobile Collapse Toggle Bar (Visible on mobile) */}
        <button
          onClick={() => setIsPanelOpen(!isPanelOpen)}
          className="sm:hidden w-full bg-slate-950/90 border border-slate-800/80 backdrop-blur-lg px-4 py-2.5 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-200 shadow-xl shrink-0"
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-sky-400" />
            <span>Control Panel</span>
          </div>
          {isPanelOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {/* Model Visualization block */}
        <main className="w-full bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col shrink-0">

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
                    setViewState(INITIAL_VIEW_STATE);
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
                        className={`flex items-center justify-between px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium transition-all ${selectedGroup?.file_path === group.file_path
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
                  <div className={`grid ${availableContourVars.length === 3
                    ? 'grid-cols-3'
                    : availableContourVars.length === 2
                      ? 'grid-cols-2'
                      : 'grid-cols-1'
                    } gap-1 bg-slate-900/60 p-0.5 rounded-xl border border-slate-800/60`}>
                    {hasTemp && (
                      <button
                        onClick={() => setSelectedVariable('temp')}
                        className={`py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${selectedVariable === 'temp'
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
                        className={`py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${selectedVariable === 'salt'
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
                        className={`py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${selectedVariable === 'zeta'
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
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Map Layers</span>
              <div className={`grid ${(hasContoursOption ? 1 : 0) + (hasCurrents ? 1 : 0) + 1 >= 3
                ? 'grid-cols-3'
                : 'grid-cols-2'
                } gap-2`}>
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
                <label className="flex items-center justify-center gap-2 cursor-pointer text-xs font-semibold py-2 rounded-xl bg-slate-900/60 border border-slate-850 hover:border-slate-750 transition-colors text-slate-300">
                  <input
                    type="checkbox"
                    checked={showPoints}
                    onChange={(e) => setShowPoints(e.target.checked)}
                    className="rounded border-slate-800 bg-slate-900 text-slate-200 focus:ring-white focus:ring-offset-slate-950 w-3.5 h-3.5"
                  />
                  Grid Points
                </label>
              </div>
            </div>

          </section>
        )}
      </div>

      {/* 4b. Depths vertically on the right */}
      {selectedMember && metadata && (
        <section className="absolute right-3 sm:right-6 bottom-[135px] sm:bottom-[54px] bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-2 sm:p-3 rounded-2xl shadow-2xl z-10 flex flex-col items-center gap-1.5 sm:gap-2 pointer-events-auto transition-all">
          <button
            onClick={() => setIsDepthOpen(!isDepthOpen)}
            className="w-full flex items-center justify-between gap-1.5 text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-wider text-center pb-1 border-b border-slate-900 focus:outline-none"
          >
            <span>Depth ({metadata.depths[currentDepthIndex] === 0 ? '0m' : `${Math.abs(metadata.depths[currentDepthIndex])}m`})</span>
            <span className="sm:hidden">
              {isDepthOpen ? <ChevronDown className="w-3 h-3 text-sky-400" /> : <ChevronUp className="w-3 h-3 text-slate-400" />}
            </span>
          </button>

          <div className={`flex flex-col gap-1 sm:gap-1.5 mt-0.5 sm:mt-1 max-h-48 sm:max-h-none overflow-y-auto pr-0.5 transition-all duration-200 ${isDepthOpen ? 'flex' : 'hidden sm:flex'}`}>
            {metadata.depths.map((d, idx) => {
              const isZeta = selectedVariable === 'zeta';
              const isSelected = isZeta ? idx === 0 : currentDepthIndex === idx;
              return (
                <button
                  key={d}
                  disabled={isZeta}
                  onClick={() => {
                    setCurrentDepthIndex(idx);
                    setIsDepthOpen(false);
                  }}
                  className={`w-9 sm:w-12 py-1.5 sm:py-2 rounded-xl text-[10px] sm:text-[11px] font-bold border transition-all ${isSelected
                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/50'
                    : 'bg-slate-900/40 text-slate-400 border-slate-800'
                    } ${isZeta
                      ? 'opacity-40 cursor-not-allowed border-slate-800/20'
                      : 'hover:text-slate-200 hover:border-slate-700'
                    }`}
                  title={d === 0 ? 'Surface (0m)' : `${Math.abs(d)}m`}
                >
                  {d === 0 ? '0m' : `${Math.abs(d)}m`}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 4c. Time playback options across the bottom */}
      {selectedMember && metadata && (
        <section className="absolute bottom-2 sm:bottom-[54px] left-2 sm:left-1/2 right-2 sm:right-auto sm:-translate-x-1/2 bg-slate-950/90 border border-slate-800/80 backdrop-blur-lg px-3 py-2 sm:px-6 sm:py-3 rounded-2xl shadow-2xl z-10 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-6 pointer-events-auto w-auto sm:w-[960px] max-w-[calc(100vw-16px)] sm:max-w-[calc(100vw-32px)]">
          {/* Play/Pause Button Group */}
          <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-900/60 p-0.5 rounded-xl border border-slate-800/40 shrink-0">
            <button
              onClick={() => setCurrentTimeIndex((prev) => (prev - 1 + metadata.times.length) % metadata.times.length)}
              className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
              title="Previous Step"
            >
              <SkipBack className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`p-1.5 sm:p-2 rounded-xl transition-all ${isPlaying ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20' : 'text-slate-300 hover:bg-slate-800/50'
                }`}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            </button>
            <button
              onClick={() => setCurrentTimeIndex((prev) => (prev + 1) % metadata.times.length)}
              className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
              title="Next Step"
            >
              <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* Timeline Slider & Progress */}
          <div className="flex-1 flex flex-col gap-1 min-w-[140px] sm:min-w-[200px]">
            <div className="relative group flex items-center h-4">
              <div className="absolute left-0 right-0 h-1.5 bg-slate-900 rounded-lg overflow-hidden pointer-events-none border border-slate-800/80">
                <div
                  className="absolute top-0 bottom-0 bg-sky-500/30 border-r border-sky-400/80 rounded-r transition-all duration-300 shadow-[0_0_8px_rgba(56,189,248,0.5)]"
                  style={{
                    left: `${(currentTimeIndex / Math.max(1, metadata.times.length - 1)) * 100}%`,
                    width: `${(bufferedRange.count / Math.max(1, metadata.times.length - 1)) * 100}%`
                  }}
                ></div>
              </div>

              <input
                type="range"
                min="0"
                max={metadata.times.length - 1}
                value={currentTimeIndex}
                onChange={(e) => setCurrentTimeIndex(parseInt(e.target.value))}
                className="w-full h-1.5 bg-transparent rounded-lg appearance-none cursor-pointer accent-sky-400 z-10"
              />
            </div>
            <div className="flex items-center justify-between text-[8px] sm:text-[9px] text-slate-500 font-mono leading-none">
              <span>0h</span>
              <span className="flex items-center gap-1 truncate max-w-[110px] sm:max-w-none">
                <span className="hidden sm:inline">Timeline Progress</span>
                {bufferedRange.count > 0 && (
                  <span className="text-sky-400 font-bold">({bufferedRange.count}h)</span>
                )}
              </span>
              <span>{metadata.times.length - 1}h</span>
            </div>
          </div>

          {/* Active Timestamp details */}
          <div className="flex flex-col text-right shrink-0 border-l border-slate-900 pl-2 sm:pl-4 min-w-[85px] sm:min-w-[110px]">
            <span className="text-[10px] sm:text-xs font-bold text-slate-200">
              {formatTime(metadata.times[currentTimeIndex])}
            </span>
            <span className="text-[8px] sm:text-[9px] text-slate-500 font-mono mt-0.5">
              Step {currentTimeIndex + 1} / {metadata.times.length}
            </span>
          </div>

          {/* Playback speed selector */}
          <div className="hidden md:flex items-center gap-2 border-l border-slate-900 pl-4 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Speed</span>
            <div className="flex gap-0.5 bg-slate-900/60 p-0.5 rounded-lg border border-slate-850">
              {[1, 2, 5, 10].map((speed) => (
                <button
                  key={speed}
                  onClick={() => setPlaybackSpeed(speed)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all ${playbackSpeed === speed
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

      {/* 5. Live Zoom Level Indicator (Top Right) */}
      <div className="absolute top-[72px] sm:top-[106px] right-3 sm:right-6 bg-slate-950/85 border border-slate-800/80 backdrop-blur-md px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl sm:rounded-2xl shadow-xl z-20 pointer-events-auto flex items-center gap-1.5 sm:gap-2">
        <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider">Zoom</span>
        <span className="text-[10px] sm:text-xs font-mono font-bold text-sky-400 bg-sky-950/60 border border-sky-800/50 px-1.5 py-0.5 sm:px-2 rounded-md sm:rounded-lg">
          {viewState?.zoom ? viewState.zoom.toFixed(2) : '5.80'}
        </span>
      </div>



      {/* 6. Time Series Modal */}
      {clickedPoint && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]">
          <div
            className="w-full max-w-[640px] bg-slate-900/95 border border-slate-800/80 backdrop-blur-xl rounded-3xl p-6 shadow-2xl space-y-4 text-slate-100 relative pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-sky-400 animate-pulse" /> Time Series Analysis
                </h3>
                <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-emerald-400" />
                  Lat: <span className="font-mono text-slate-300">{clickedPoint.lat.toFixed(4)}</span>,
                  Lng: <span className="font-mono text-slate-300">{clickedPoint.lng.toFixed(4)}</span>
                </p>
              </div>
              <button
                onClick={() => setClickedPoint(null)}
                className="p-1.5 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 text-slate-400 hover:text-slate-200 rounded-xl transition-all"
                title="Close Panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Variable Select / Depth indicator */}
            <div className="flex items-center justify-between gap-4 border-b border-slate-850 pb-3">
              {/* Select tabs */}
              <div className="flex gap-1.5 p-0.5 bg-slate-950/60 rounded-xl border border-slate-850/50">
                {(selectedGroup?.variables || [])
                  .filter(v => ['temp', 'salt', 'zeta'].includes(v))
                  .map(v => {
                    const label = v === 'temp' ? 'Temp' : v === 'salt' ? 'Salinity' : 'SSH';
                    const activeColor = v === 'temp' ? 'text-sky-400' : v === 'salt' ? 'text-emerald-400' : 'text-amber-400';
                    return (
                      <button
                        key={v}
                        onClick={() => setTimeSeriesVariable(v)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${timeSeriesVariable === v
                          ? `bg-slate-900 ${activeColor} border border-slate-800`
                          : 'text-slate-500 hover:text-slate-300 border border-transparent'
                          }`}
                      >
                        {label}
                      </button>
                    );
                  })}
              </div>

              {/* Depth indicator if not zeta */}
              {timeSeriesVariable !== 'zeta' && metadata && (
                <div className="text-[10px] text-slate-400 bg-slate-900/60 border border-slate-850/40 px-3 py-1.5 rounded-xl">
                  Depth: <span className="font-bold text-sky-400">
                    {metadata.depths[currentDepthIndex] === 0 ? '0m' : `${Math.abs(metadata.depths[currentDepthIndex])}m`}
                  </span>
                </div>
              )}
            </div>

            {/* Graph component */}
            <TimeSeriesGraph data={timeSeriesData} loading={loadingTimeSeries} />
          </div>
        </div>
      )}
    </div>
  );
}

function TimeSeriesGraph({ data, loading }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (loading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
        <span className="text-xs">Fetching time series data...</span>
      </div>
    );
  }

  if (!data || !data.values || data.values.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
        No time series data available for this location.
      </div>
    );
  }

  // Filter out any null/undefined values for calculating min/max
  const validValues = data.values.filter(v => v !== null && v !== undefined);
  if (validValues.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
        All time series values are NaN at this coordinate.
      </div>
    );
  }

  const vMin = Math.min(...validValues);
  const vMax = Math.max(...validValues);
  const vRange = vMax - vMin === 0 ? 1 : vMax - vMin;

  // Add 10% padding to graph top/bottom
  const yMin = vMin - vRange * 0.1;
  const yMax = vMax + vRange * 0.1;
  const yRange = yMax - yMin;

  // SVG dimensions
  const width = 600;
  const height = 260;
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Map coordinates to SVG pixels
  const getX = (index) => paddingLeft + (index / (data.values.length - 1)) * chartWidth;
  const getY = (val) => {
    if (val === null || val === undefined) return null;
    return paddingTop + chartHeight - ((val - yMin) / yRange) * chartHeight;
  };

  // Generate path coordinates
  let pathD = "";
  const points = [];
  data.values.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    if (y !== null) {
      points.push({ x, y, val, time: data.times[idx], index: idx });
      if (pathD === "") {
        pathD = `M ${x} ${y}`;
      } else {
        pathD += ` L ${x} ${y}`;
      }
    }
  });

  // Parse ISO times to user friendly dates
  const formatTime = (timeStr) => {
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return timeStr;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return timeStr;
    }
  };

  const formatXAxisTime = (timeStr) => {
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return timeStr;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return timeStr;
    }
  };

  // Y axis ticks (5 ticks)
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const val = yMin + (i / 4) * yRange;
    yTicks.push({
      val: val,
      y: getY(val),
      label: val.toFixed(2)
    });
  }

  // X axis ticks (4 ticks)
  const xTicks = [];
  const numTimes = data.times.length;
  if (numTimes > 1) {
    const indices = [0, Math.floor(numTimes / 3), Math.floor((2 * numTimes) / 3), numTimes - 1];
    indices.forEach(idx => {
      if (idx < numTimes && data.times[idx]) {
        xTicks.push({
          x: getX(idx),
          label: formatXAxisTime(data.times[idx])
        });
      }
    });
  }

  // Handle mouse move to display vertical tracker/tooltip
  const handleMouseMove = (e) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - svgRect.left;

    // Find closest point by x coordinate
    let closest = null;
    let minDiff = Infinity;
    points.forEach(p => {
      const diff = Math.abs(p.x - mouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    });

    if (minDiff < 30) {
      setHoveredPoint(closest);
    } else {
      setHoveredPoint(null);
    }
  };

  return (
    <div className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible select-none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
      >
        <defs>
          <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Gridlines */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={tick.y}
              x2={width - paddingRight}
              y2={tick.y}
              stroke="#64748b"
              strokeWidth="1"
              strokeDasharray="3,3"
              className="opacity-20"
            />
            <text
              x={paddingLeft - 8}
              y={tick.y + 4}
              fill="#cbd5e1"
              fontSize="9"
              textAnchor="end"
              className="font-mono font-medium"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* X axis labels */}
        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={height - paddingBottom + 16}
            fill="#cbd5e1"
            fontSize="9"
            textAnchor="middle"
            className="font-medium"
          >
            {tick.label}
          </text>
        ))}

        {/* Shaded Area under path */}
        {points.length > 1 && (
          <path
            d={`${pathD} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`}
            fill="url(#chart-glow)"
          />
        )}

        {/* SVG Line path */}
        <path
          d={pathD}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="drop-shadow-[0_2px_8px_rgba(14,165,233,0.3)]"
        />

        {/* Interactive hover elements */}
        {hoveredPoint && (
          <g>
            {/* Vertical Tracker Line */}
            <line
              x1={hoveredPoint.x}
              y1={paddingTop}
              x2={hoveredPoint.x}
              y2={paddingTop + chartHeight}
              stroke="#0ea5e9"
              strokeWidth="1.5"
              strokeDasharray="2,2"
              className="opacity-50"
            />
            {/* Hover Circle Marker */}
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="5"
              fill="#0ea5e9"
              stroke="#ffffff"
              strokeWidth="1.5"
              className="drop-shadow-[0_0_6px_rgba(14,165,233,0.8)]"
            />
          </g>
        )}
      </svg>

      {/* Floating HTML Tooltip inside the card */}
      {hoveredPoint && (
        <div
          className="absolute z-20 pointer-events-none bg-slate-950/95 border border-slate-700/80 backdrop-blur rounded-xl p-2.5 shadow-2xl text-xs flex flex-col gap-1 text-slate-100 transition-all duration-75"
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100 - 65}%`,
            transform: 'translateX(-50%)'
          }}
        >
          <div className="text-[9px] font-bold text-slate-500 uppercase">{formatTime(hoveredPoint.time)}</div>
          <div className="font-semibold text-sky-400">
            {hoveredPoint.val.toFixed(3)} <span className="text-[10px] text-slate-400">{data.unit}</span>
          </div>
        </div>
      )}
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

  const isAdmin = path.includes('admin');

  if (isAdmin) {
    return <Admin onBack={() => navigate(window.location.pathname.includes('/ocean_model_visualiser/') ? '/ocean_model_visualiser/' : '/')} />;
  }

  return <Visualizer onNavigateAdmin={() => navigate(window.location.pathname.includes('/ocean_model_visualiser/') ? '/ocean_model_visualiser/admin' : '/admin')} />;
}
