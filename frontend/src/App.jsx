import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import Map from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import Admin from './Admin';
import { API_URL } from './config';
import saProvinceOutline from './sa_province_outline.json';

import {
  TEMP_STOPS,
  SALT_STOPS,
  ZETA_STOPS,
  VIRIDIS_STOPS,
  getZoomParameters,
  normalizeVar
} from './utils/colorScales';

import { buildDeckLayers } from './layers/layerRegistry';
import { useFrameStream } from './hooks/useFrameStream';
import { getContourCacheKey, getCurrentsCacheKey } from './utils/cacheKeys';

import Header from './components/layout/Header';
import ErrorBoundary from './components/layout/ErrorBoundary';
import ControlPanel from './components/panels/ControlPanel';
import Legends from './components/controls/Legends';
import DepthSelector from './components/controls/DepthSelector';
import PlaybackControls from './components/controls/PlaybackControls';
import TimeSeriesPanel from './components/panels/TimeSeriesPanel';

const ESRI_MAP_STYLE = {
  version: 8,
  sources: {
    'esri-world-street-map': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012'
    }
  },
  layers: [
    {
      id: 'esri-world-street-map-layer',
      type: 'raster',
      source: 'esri-world-street-map',
      minzoom: 0,
      maxzoom: 22
    }
  ]
};

const INITIAL_VIEW_STATE = {
  longitude: 25.0,
  latitude: -31.0,
  zoom: 4.8,
  pitch: 0,
  bearing: 0,
  maxZoom: 16,
  minZoom: 3
};

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
  coords.forEach((coord) => {
    sumLon += coord[0];
    sumLat += coord[1];
  });
  return {
    longitude: sumLon / coords.length,
    latitude: sumLat / coords.length
  };
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
  const [selectedVariable, setSelectedVariable] = useState('temp');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const [showCurrents, setShowCurrents] = useState(true);
  const [showContours, setShowContours] = useState(true);

  const [simplification] = useState(0.001);

  // Grid Points & Time Series States
  const [showPoints, setShowPoints] = useState(false);
  const [pointsData, setPointsData] = useState([]);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [clickedPoint, setClickedPoint] = useState(null);
  const [timeSeriesData, setTimeSeriesData] = useState(null);
  const [timeSeriesVariable, setTimeSeriesVariable] = useState('temp');
  const [loadingTimeSeries, setLoadingTimeSeries] = useState(false);

  // Viewport State
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

  // Land Mask
  const [maskData] = useState(saProvinceOutline);

  // Fetch initial products
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/api/products`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('API server returned error');
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setProducts(data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('Error fetching products:', err);
      });
    return () => controller.abort();
  }, []);

  // Normalized Variable Definitions for full dynamic variable support
  const normalizedVars = useMemo(() => {
    const raw = selectedGroup?.variables || ['temp', 'salt', 'zeta', 'currents'];
    return raw.map(normalizeVar).filter(Boolean);
  }, [selectedGroup]);

  const availableContourVars = useMemo(() => {
    return normalizedVars.filter((v) => v.type === 'scalar_contour');
  }, [normalizedVars]);

  const hasContoursOption = availableContourVars.length > 0;

  const hasCurrents = useMemo(() => {
    return normalizedVars.some((v) => v.type === 'vector_pair');
  }, [normalizedVars]);

  const currentVarDef = useMemo(() => {
    return (
      normalizedVars.find(
        (v) => v.id === selectedVariable || v.nc_var === selectedVariable
      ) ||
      (metadata?.variables &&
        metadata.variables
          .map(normalizeVar)
          .find((v) => v.id === selectedVariable || v.nc_var === selectedVariable)) ||
      normalizeVar(selectedVariable)
    );
  }, [normalizedVars, metadata, selectedVariable]);

  const isSurfaceOnly = !!(currentVarDef?.is_surface_only || selectedVariable === 'zeta');

  // Dynamic zoom & projection parameters
  const { autoDownsampleRate, autoMaxPixels, quantizedZoom, quantizedLatitude } = useMemo(() => {
    const z = viewState?.zoom || 5.8;
    const lat = viewState?.latitude || -34.0;
    const params = getZoomParameters(z);

    let qz = 12.0;
    if (z < 5.5)  qz = 5.0;
    else if (z < 6.0)  qz = 5.5;
    else if (z < 6.5)  qz = 6.0;
    else if (z < 7.0)  qz = 6.5;
    else if (z < 7.5)  qz = 7.0;
    else if (z < 8.0)  qz = 7.5;
    else if (z < 9.0)  qz = 8.0;
    else if (z < 10.0) qz = 9.0;
    else if (z < 11.0) qz = 10.0;
    else if (z < 12.0) qz = 11.0;

    return {
      autoDownsampleRate: params.downsample,
      autoMaxPixels: params.maxPixels,
      quantizedZoom: qz,
      quantizedLatitude: Math.round(lat * 2) / 2
    };
  }, [viewState?.zoom, viewState?.latitude]);

  // Stream hook for NDJSON progressive frame delivery
  const {
    renderedData: streamedData,
    contourCache,
    currentsCache,
    contourCacheRef,
    currentsCacheRef,
    setContourCache,
    setCurrentsCache
  } = useFrameStream({
    metadata,
    selectedGroup,
    selectedVariable,
    currentDepthIndex,
    currentTimeIndex,
    simplification,
    showContours,
    showCurrents,
    currentVarDef
  });

  // Backend sends currents as compact [u, v] arrays aligned with the grid points
  // list; merge them with point coordinates so layers get {lng, lat, u, v, i, j}.
  const activeCurrents = useMemo(() => {
    const raw = streamedData?.currents;
    if (!raw) return null;
    if (raw.length > 0 && Array.isArray(raw[0]) && raw[0].length === 2) {
      if (!pointsData || pointsData.length === 0) return null;
      return raw.map((uv, idx) => {
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
    return raw;
  }, [streamedData?.currents, pointsData]);

  const activeContours = streamedData?.contours || null;

  // Double-buffering: keep the last rendered frame while the next one loads
  // (within the same variable group) to avoid blinking without an extra render pass.
  const lastRenderedRef = useRef({ filePath: null, contours: null, currents: null });
  const renderedData = useMemo(() => {
    const isSameGroup = lastRenderedRef.current.filePath === selectedGroup?.file_path;
    const contours = showContours ? (activeContours || (isSameGroup ? lastRenderedRef.current.contours : null)) : null;
    const currents = showCurrents ? (activeCurrents || (isSameGroup ? lastRenderedRef.current.currents : null)) : null;

    if (contours || currents || !isSameGroup) {
      lastRenderedRef.current = {
        filePath: selectedGroup?.file_path,
        contours: contours || (isSameGroup ? lastRenderedRef.current.contours : null),
        currents: currents || (isSameGroup ? lastRenderedRef.current.currents : null)
      };
    }

    return {
      filePath: selectedGroup?.file_path,
      contours,
      currents
    };
  }, [activeContours, activeCurrents, showContours, showCurrents, selectedGroup?.file_path]);

  // Fetch grid points probe when group changes
  useEffect(() => {
    if (!selectedGroup) {
      setPointsData([]);
      return;
    }
    const controller = new AbortController();
    const filePath = selectedGroup.file_path;
    setLoadingPoints(true);
    fetch(`${API_URL}/api/points?file_path=${encodeURIComponent(filePath)}&downsample=2`, {
      signal: controller.signal
    })
      .then((res) => {
        if (!res.ok) throw new Error('API server returned error');
        return res.json();
      })
      .then((data) => {
        setPointsData(data || []);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('Error fetching grid points:', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPoints(false);
      });

    return () => controller.abort();
  }, [selectedGroup]);

  // Fetch time series data when clickedPoint, variable, or depth changes
  useEffect(() => {
    if (!clickedPoint || !selectedGroup) {
      setTimeSeriesData(null);
      return;
    }
    const controller = new AbortController();
    const filePath = selectedGroup.file_path;
    const tsVarDef = normalizedVars.find((v) => v.id === timeSeriesVariable);
    const isTsSurf = tsVarDef?.is_surface_only || timeSeriesVariable === 'zeta';
    const dIdx = isTsSurf ? 0 : currentDepthIndex;
    const targetVar = tsVarDef?.nc_var || timeSeriesVariable;

    setLoadingTimeSeries(true);
    fetch(
      `${API_URL}/api/timeseries?file_path=${encodeURIComponent(filePath)}&variable=${encodeURIComponent(targetVar)}&depth=${dIdx}&i=${clickedPoint.i}&j=${clickedPoint.j}`,
      { signal: controller.signal }
    )
      .then((res) => {
        if (!res.ok) throw new Error('API server returned error');
        return res.json();
      })
      .then((data) => {
        setTimeSeriesData(data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('Error fetching time series:', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTimeSeries(false);
      });

    return () => controller.abort();
  }, [clickedPoint, timeSeriesVariable, currentDepthIndex, selectedGroup, normalizedVars]);

  const productFetchControllerRef = useRef(null);
  const metadataFetchControllerRef = useRef(null);

  const handleProductClick = useCallback(async (prodId, prodName) => {
    if (productFetchControllerRef.current) {
      productFetchControllerRef.current.abort();
    }
    const controller = new AbortController();
    productFetchControllerRef.current = controller;

    setLoadingMembers(true);
    setClickedProduct({ id: prodId, name: prodName });
    setSelectedMember(null);
    setSelectedGroup(null);
    setMetadata(null);

    const prod = products.find((p) => p.id === prodId);
    if (prod && prod.region) {
      const centroid = getCentroid(prod.region);
      if (centroid) {
        setViewState((prev) => ({
          ...prev,
          longitude: centroid.longitude,
          latitude: centroid.latitude,
          zoom: 5.5,
          transitionDuration: 1200
        }));
      }
    }

    try {
      const res = await fetch(`${API_URL}/api/products/${prodId}/members`, {
        signal: controller.signal
      });
      if (res.ok) {
        const data = await res.json();
        setProductMembers(data);
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Error fetching product members:', e);
    } finally {
      if (!controller.signal.aborted) setLoadingMembers(false);
    }
  }, [products]);

  const handleSelectVariableGroup = async (group, _member) => {
    if (metadataFetchControllerRef.current) {
      metadataFetchControllerRef.current.abort();
    }
    const controller = new AbortController();
    metadataFetchControllerRef.current = controller;

    setSelectedGroup(group);

    const groupNormVars = (group.variables || []).map(normalizeVar).filter(Boolean);
    const contourVars = groupNormVars.filter((v) => v.type === 'scalar_contour');
    const hasVectorPair = groupNormVars.some((v) => v.type === 'vector_pair');

    if (contourVars.length > 0) {
      const exists = contourVars.some((v) => v.id === selectedVariable);
      if (!exists) {
        const preferred =
          contourVars.find((v) => v.id === 'temp') ||
          contourVars.find((v) => v.id === 'salt') ||
          contourVars.find((v) => v.id === 'zeta') ||
          contourVars[0];
        setSelectedVariable(preferred.id);
      }
    }

    if (contourVars.length > 0 && !hasVectorPair) {
      setShowContours(true);
      setShowCurrents(false);
    } else if (contourVars.length === 0 && hasVectorPair) {
      setShowContours(false);
      setShowCurrents(true);
    } else if (contourVars.length > 0 && hasVectorPair) {
      setShowContours(true);
      setShowCurrents(true);
    }

    try {
      const res = await fetch(
        `${API_URL}/api/metadata?file_path=${encodeURIComponent(group.file_path)}`,
        { signal: controller.signal }
      );
      if (res.ok) {
        const data = await res.json();
        if (controller.signal.aborted) return;
        setMetadata(data);
        setCurrentTimeIndex(0);
        setCurrentDepthIndex(0);

        if (
          data.bounds &&
          isFinite(data.bounds.lon_min) &&
          isFinite(data.bounds.lon_max) &&
          isFinite(data.bounds.lat_min) &&
          isFinite(data.bounds.lat_max)
        ) {
          const centerLon = (data.bounds.lon_min + data.bounds.lon_max) / 2;
          const centerLat = (data.bounds.lat_min + data.bounds.lat_max) / 2;
          if (isFinite(centerLon) && isFinite(centerLat)) {
            setViewState((prev) => ({
              ...prev,
              longitude: centerLon,
              latitude: centerLat,
              zoom: 5.8,
              transitionDuration: 1000
            }));
          }
        }
        setContourCache({});
        setCurrentsCache({});
        if (contourCacheRef) contourCacheRef.current = {};
        if (currentsCacheRef) currentsCacheRef.current = {};
      } else {
        if (!controller.signal.aborted) {
          console.error('Failed to load metadata for file:', group.file_path);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Error fetching metadata:', e);
    }
  };

  const handleSelectMember = async (member) => {
    if (!member.variable_groups || member.variable_groups.length === 0) {
      alert('This member has no source files/variable groups.');
      return;
    }
    setSelectedMember(member);
    const firstGroup = member.variable_groups[0];
    handleSelectVariableGroup(firstGroup, member);
  };

  // Playback Loop
  useEffect(() => {
    let timer = null;
    if (isPlaying && metadata?.times?.length > 0) {
      timer = setInterval(() => {
        const dIdx = isSurfaceOnly ? 0 : currentDepthIndex;
        const filePath = selectedGroup?.file_path || '';

        setCurrentTimeIndex((prev) => {
          const currContourKey = getContourCacheKey(filePath, selectedVariable, dIdx, prev, simplification);
          const currCurrentsKey = getCurrentsCacheKey(filePath, dIdx, prev);

          const isCurrContourLoaded = !showContours || !!contourCacheRef?.current?.[currContourKey];
          const isCurrCurrentsLoaded = !showCurrents || !!currentsCacheRef?.current?.[currCurrentsKey];

          if (!isCurrContourLoaded || !isCurrCurrentsLoaded) {
            return prev;
          }

          const next = (prev + 1) % metadata.times.length;
          const nextContourKey = getContourCacheKey(filePath, selectedVariable, dIdx, next, simplification);
          const nextCurrentsKey = getCurrentsCacheKey(filePath, dIdx, next);

          const isNextContourLoaded = !showContours || !!contourCacheRef?.current?.[nextContourKey];
          const isNextCurrentsLoaded = !showCurrents || !!currentsCacheRef?.current?.[nextCurrentsKey];

          if (!isNextContourLoaded || !isNextCurrentsLoaded) {
            return prev;
          }

          return next;
        });
      }, 1000 / playbackSpeed);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [
    isPlaying,
    playbackSpeed,
    metadata,
    selectedVariable,
    currentDepthIndex,
    simplification,
    showContours,
    showCurrents,
    selectedGroup,
    isSurfaceOnly,
    contourCacheRef,
    currentsCacheRef
  ]);

  // Calculate consecutive buffered frames from currentTimeIndex
  const bufferedRange = useMemo(() => {
    if (!metadata || !selectedGroup) return { count: 0, percentage: 0 };
    const numSteps = metadata.times?.length || 0;
    const dIdx = isSurfaceOnly ? 0 : currentDepthIndex;
    const filePath = selectedGroup?.file_path || '';

    let count = 0;
    for (let i = 0; i < numSteps; i++) {
      const idx = (currentTimeIndex + i) % numSteps;
      const cKey = getContourCacheKey(filePath, selectedVariable, dIdx, idx, simplification);
      const vKey = getCurrentsCacheKey(filePath, dIdx, idx);
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
  }, [
    metadata,
    selectedGroup,
    currentTimeIndex,
    selectedVariable,
    currentDepthIndex,
    simplification,
    showContours,
    showCurrents,
    contourCache,
    currentsCache,
    isSurfaceOnly
  ]);

  // Downsample currents in JS
  const displayCurrents = useMemo(() => {
    if (!renderedData?.currents) return [];
    if (autoDownsampleRate <= 1) return renderedData.currents;
    const step = autoDownsampleRate;
    return renderedData.currents.filter((pt) =>
      pt.i !== undefined && pt.j !== undefined
        ? pt.i % step === 0 && pt.j % step === 0
        : true
    );
  }, [renderedData?.currents, autoDownsampleRate]);

  // Color ranges and stops
  const { valMin, valMax, stops } = useMemo(() => {
    let activeStops = TEMP_STOPS;
    const scheme = currentVarDef?.color_scheme;
    if (scheme === 'haline' || selectedVariable === 'salt') activeStops = SALT_STOPS;
    else if (scheme === 'spectral' || selectedVariable === 'zeta') activeStops = ZETA_STOPS;
    else if (scheme === 'viridis') activeStops = VIRIDIS_STOPS;
    else activeStops = TEMP_STOPS;

    if (!metadata || !metadata.ranges) return { valMin: 0, valMax: 1, stops: activeStops };

    const targetVar = currentVarDef?.nc_var || selectedVariable;
    const rangeObj = metadata.ranges[targetVar] || metadata.ranges[selectedVariable];
    if (!rangeObj) return { valMin: 0, valMax: 1, stops: activeStops };

    const isSurf = isSurfaceOnly;
    const range = !isSurf && Array.isArray(rangeObj) ? rangeObj[currentDepthIndex] : rangeObj;

    return {
      valMin: range && typeof range.min === 'number' ? range.min : 0,
      valMax: range && typeof range.max === 'number' ? range.max : 1,
      stops: activeStops
    };
  }, [selectedVariable, currentDepthIndex, metadata, currentVarDef, isSurfaceOnly]);

  const activeValMin =
    showContours && renderedData?.contours?.value_min !== undefined
      ? renderedData.contours.value_min
      : valMin;
  const activeValMax =
    showContours && renderedData?.contours?.value_max !== undefined
      ? renderedData.contours.value_max
      : valMax;

  const legendValues = useMemo(() => {
    const decimals = selectedVariable === 'temp' ? 1 : 2;
    const range = activeValMax - activeValMin;
    return [
      activeValMax.toFixed(decimals),
      (activeValMin + range * 0.75).toFixed(decimals),
      (activeValMin + range * 0.5).toFixed(decimals),
      (activeValMin + range * 0.25).toFixed(decimals),
      activeValMin.toFixed(decimals)
    ];
  }, [activeValMin, activeValMax, selectedVariable]);

  const maxSpeed = useMemo(() => {
    if (!metadata || !metadata.ranges) return 1.5;
    const dIdx = isSurfaceOnly ? 0 : currentDepthIndex;
    const uVar = currentVarDef?.nc_u_var || 'u';
    const vVar = currentVarDef?.nc_v_var || 'v';
    const rawU = metadata.ranges[uVar] || metadata.ranges.u;
    const rawV = metadata.ranges[vVar] || metadata.ranges.v;
    if (!rawU || !rawV) return 1.5;

    const uRange = Array.isArray(rawU) ? rawU[dIdx] : rawU;
    const vRange = Array.isArray(rawV) ? rawV[dIdx] : rawV;
    if (!uRange || !vRange) return 1.5;

    const uMin = typeof uRange.min === 'number' ? uRange.min : 0;
    const uMaxVal = typeof uRange.max === 'number' ? uRange.max : 1;
    const vMin = typeof vRange.min === 'number' ? vRange.min : 0;
    const vMaxVal = typeof vRange.max === 'number' ? vRange.max : 1;

    const uMax = Math.max(Math.abs(uMin), Math.abs(uMaxVal));
    const vMax = Math.max(Math.abs(vMin), Math.abs(vMaxVal));
    return Math.sqrt(uMax * uMax + vMax * vMax) || 1.5;
  }, [metadata, currentDepthIndex, currentVarDef, isSurfaceOnly]);

  const { currentMaxSpeed } = useMemo(() => {
    if (!renderedData?.currents || renderedData.currents.length === 0) {
      return { currentMaxSpeed: maxSpeed || 0 };
    }
    let maxS = -Infinity;
    for (let i = 0; i < renderedData.currents.length; i++) {
      const d = renderedData.currents[i];
      const s = Math.sqrt(d.u * d.u + d.v * d.v);
      if (s > maxS) maxS = s;
    }
    return {
      currentMaxSpeed: isFinite(maxS) ? maxS : 0
    };
  }, [renderedData?.currents, maxSpeed]);

  // Construct Deck.gl Layers
  const layers = useMemo(() => {
    return buildDeckLayers({
      maskData,
      showContours,
      renderedData,
      selectedMember,
      activeValMin,
      activeValMax,
      stops,
      showCurrents,
      displayCurrents,
      quantizedLatitude,
      quantizedZoom,
      autoMaxPixels,
      currentMaxSpeed,
      maxSpeed,
      autoDownsampleRate,
      showPoints,
      pointsData,
      onPointClick: (info) => {
        if (info.object) {
          const defaultVar = selectedVariable || (availableContourVars[0]?.id || 'temp');
          setClickedPoint({
            lat: info.object.lat,
            lng: info.object.lng,
            i: info.object.i,
            j: info.object.j
          });
          setTimeSeriesVariable(defaultVar);
        }
      },
      products,
      clickedProduct,
      onProductClick: handleProductClick
    });
  }, [
    maskData,
    showContours,
    renderedData,
    selectedMember,
    activeValMin,
    activeValMax,
    stops,
    showCurrents,
    displayCurrents,
    quantizedLatitude,
    quantizedZoom,
    autoMaxPixels,
    currentMaxSpeed,
    maxSpeed,
    autoDownsampleRate,
    showPoints,
    pointsData,
    selectedVariable,
    availableContourVars,
    products,
    clickedProduct,
    handleProductClick
  ]);

  // Handle Tooltips
  const getTooltip = ({ object }) => {
    if (!object) return null;

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
      const unit =
        currentVarDef?.unit ||
        (selectedVariable === 'temp' ? '°C' : selectedVariable === 'salt' ? 'g/kg' : 'm');
      const name =
        currentVarDef?.display_name ||
        (selectedVariable === 'temp'
          ? 'Temperature'
          : selectedVariable === 'salt'
            ? 'Salinity'
            : 'Sea Surface Height');

      const valDisplay =
        valMinVal !== undefined && valMaxVal !== undefined
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
      const angle = ((Math.atan2(object.v, object.u) * 180) / Math.PI + 360) % 360;
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

  const isLoading = loadingMembers || loadingPoints || loadingTimeSeries;

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
              const defaultVar = selectedVariable || (availableContourVars[0]?.id || 'temp');
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

      {/* 2. Top Header Title (Full-Width with logos, active model text, Access Data, Admin) */}
      <Header
        selectedMember={selectedMember}
        clickedProduct={clickedProduct}
        isLoading={isLoading}
        onNavigateAdmin={onNavigateAdmin}
      />

      {/* 3. Left Sidebar & Top Control Panel Stack */}
      <ControlPanel
        products={products}
        clickedProduct={clickedProduct}
        setClickedProduct={setClickedProduct}
        handleProductClick={handleProductClick}
        loadingMembers={loadingMembers}
        productMembers={productMembers}
        setProductMembers={setProductMembers}
        selectedMember={selectedMember}
        setSelectedMember={setSelectedMember}
        selectedGroup={selectedGroup}
        setSelectedGroup={setSelectedGroup}
        handleSelectMember={handleSelectMember}
        handleSelectVariableGroup={handleSelectVariableGroup}
        metadata={metadata}
        setMetadata={setMetadata}
        selectedVariable={selectedVariable}
        setSelectedVariable={setSelectedVariable}
        setCurrentDepthIndex={setCurrentDepthIndex}
        availableContourVars={availableContourVars}
        hasContoursOption={hasContoursOption}
        hasCurrents={hasCurrents}
        showContours={showContours}
        setShowContours={setShowContours}
        showCurrents={showCurrents}
        setShowCurrents={setShowCurrents}
        showPoints={showPoints}
        setShowPoints={setShowPoints}
        onResetViewport={() => setViewState(INITIAL_VIEW_STATE)}
      />

      {/* 4. Bottom-Left Legends (Contour Ramp & Vector Scale) */}
      <Legends
        selectedMember={selectedMember}
        metadata={metadata}
        showContours={showContours}
        showCurrents={showCurrents}
        stops={stops}
        legendValues={legendValues}
        currentVarDef={currentVarDef}
        selectedVariable={selectedVariable}
        autoMaxPixels={autoMaxPixels}
        quantizedZoom={quantizedZoom}
        currentMaxSpeed={currentMaxSpeed}
        viewState={viewState}
      />

      {/* 5. Right-side Vertical Depth Selector */}
      <DepthSelector
        selectedMember={selectedMember}
        metadata={metadata}
        currentDepthIndex={currentDepthIndex}
        setCurrentDepthIndex={setCurrentDepthIndex}
        isSurfaceOnly={isSurfaceOnly}
      />

      {/* 6. Bottom Timeline Playback Options */}
      <PlaybackControls
        selectedMember={selectedMember}
        metadata={metadata}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        currentTimeIndex={currentTimeIndex}
        setCurrentTimeIndex={setCurrentTimeIndex}
        playbackSpeed={playbackSpeed}
        setPlaybackSpeed={setPlaybackSpeed}
        bufferedRange={bufferedRange}
        formatTime={formatTime}
      />

      {/* 7. Time Series Modal Analysis */}
      <TimeSeriesPanel
        clickedPoint={clickedPoint}
        setClickedPoint={setClickedPoint}
        selectedGroup={selectedGroup}
        timeSeriesVariable={timeSeriesVariable}
        setTimeSeriesVariable={setTimeSeriesVariable}
        timeSeriesData={timeSeriesData}
        loadingTimeSeries={loadingTimeSeries}
        metadata={metadata}
        currentDepthIndex={currentDepthIndex}
      />
    </div>
  );
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (to) => {
    window.history.pushState({}, '', to);
    setCurrentPath(to);
  };

  const path = currentPath.toLowerCase();
  const isAdmin = path.includes('admin');

  if (isAdmin) {
    return (
      <ErrorBoundary>
        <Admin
          onBack={() =>
            navigate(
              window.location.pathname.includes('/ocean_model_visualiser/')
                ? '/ocean_model_visualiser/'
                : '/'
            )
          }
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Visualizer
        onNavigateAdmin={() =>
          navigate(
            window.location.pathname.includes('/ocean_model_visualiser/')
              ? '/ocean_model_visualiser/admin'
              : '/admin'
          )
        }
      />
    </ErrorBoundary>
  );
}
