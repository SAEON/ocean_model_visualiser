import { useState, useRef, useEffect, useMemo } from 'react';
import { API_URL } from '../config';
import { getContourCacheKey, getCurrentsCacheKey } from '../utils/cacheKeys';

/**
 * Custom hook to stream NDJSON frames and manage in-memory frame cache
 */
export function useFrameStream({
  metadata,
  selectedGroup,
  selectedVariable,
  currentDepthIndex,
  currentTimeIndex,
  simplification,
  showContours,
  showCurrents,
  currentVarDef
}) {
  const [contourCache, setContourCache] = useState({});
  const [currentsCache, setCurrentsCache] = useState({});

  const contourCacheRef = useRef(contourCache);
  const currentsCacheRef = useRef(currentsCache);
  contourCacheRef.current = contourCache;
  currentsCacheRef.current = currentsCache;

  const fetchingFrameKeysRef = useRef(new Set());
  const currentTimeIndexRef = useRef(currentTimeIndex);
  currentTimeIndexRef.current = currentTimeIndex;

  // Single-frame fetcher
  const fetchFrameData = async (
    filePath,
    targetVar,
    varId,
    depth,
    time,
    tolerance,
    needContours,
    needCurrents,
    signal
  ) => {
    const contourKey = getContourCacheKey(filePath, varId, depth, time, tolerance);
    const currentsKey = getCurrentsCacheKey(filePath, depth, time);
    const requestKey = `${contourKey}__${currentsKey}__c${needContours}_v${needCurrents}`;

    if (fetchingFrameKeysRef.current.has(requestKey)) return;
    fetchingFrameKeysRef.current.add(requestKey);

    try {
      const frameUrl =
        `${API_URL}/api/frame?variable=${encodeURIComponent(targetVar)}&time=${time}&depth=${depth}&tolerance=${tolerance}` +
        `&include_contours=${needContours}&include_currents=${needCurrents}` +
        (filePath ? `&file_path=${encodeURIComponent(filePath)}` : '');
      const res = await fetch(frameUrl, { signal });
      if (res.status === 304) {
        return;
      }
      if (!res.ok) {
        return;
      }
      const data = await res.json();

      if (data.contours) {
        setContourCache((prev) => {
          const updated = { ...prev, [contourKey]: data.contours };
          contourCacheRef.current = updated;
          return updated;
        });
      }
      if (data.currents) {
        setCurrentsCache((prev) => {
          const updated = { ...prev, [currentsKey]: data.currents };
          currentsCacheRef.current = updated;
          return updated;
        });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(`Failed to fetch frame ${requestKey}:`, err);
      }
    } finally {
      fetchingFrameKeysRef.current.delete(requestKey);
    }
  };

  // NDJSON streaming reader effect
  useEffect(() => {
    if (!metadata || !selectedGroup) return;

    let isCancelled = false;
    let flushTimeout = null;
    const controller = new AbortController();
    const filePath = selectedGroup.file_path || '';

    // Dynamic surface-only check
    const isSurface = currentVarDef?.is_surface_only || selectedVariable === 'zeta';
    const dIdx = isSurface ? 0 : currentDepthIndex;
    const numSteps = metadata.times?.length || 0;
    const startIdx = currentTimeIndexRef.current || 0;

    const targetVar = currentVarDef?.nc_var || selectedVariable;

    let stagedContours = {};
    let stagedCurrents = {};

    const flushStateUpdates = () => {
      if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
      }
      if (Object.keys(stagedContours).length > 0) {
        const batch = stagedContours;
        stagedContours = {};
        setContourCache((prev) => ({ ...prev, ...batch }));
      }
      if (Object.keys(stagedCurrents).length > 0) {
        const batch = stagedCurrents;
        stagedCurrents = {};
        setCurrentsCache((prev) => ({ ...prev, ...batch }));
      }
    };

    const scheduleFlush = () => {
      if (!flushTimeout) {
        flushTimeout = setTimeout(flushStateUpdates, 60);
      }
    };

    const streamPrefetch = async () => {
      // 1. Fetch active initial frame immediately if missing
      const firstContourKey = getContourCacheKey(filePath, selectedVariable, dIdx, startIdx, simplification);
      const firstCurrentsKey = getCurrentsCacheKey(filePath, dIdx, startIdx);
      const needFirstContours = showContours && !contourCacheRef.current[firstContourKey];
      const needFirstCurrents = showCurrents && !currentsCacheRef.current[firstCurrentsKey];

      if (needFirstContours || needFirstCurrents) {
        await fetchFrameData(
          filePath,
          targetVar,
          selectedVariable,
          dIdx,
          startIdx,
          simplification,
          needFirstContours,
          needFirstCurrents,
          controller.signal
        );
      }

      if (isCancelled || controller.signal.aborted) return;

      // 2. Stream all remaining frames over ONE single HTTP connection
      const streamUrl =
        `${API_URL}/api/stream_frames?variable=${encodeURIComponent(targetVar)}&depth=${dIdx}&tolerance=${simplification}` +
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
          partialLine = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              const tIdx = data.time;
              const cKey = getContourCacheKey(filePath, selectedVariable, dIdx, tIdx, simplification);
              const vKey = getCurrentsCacheKey(filePath, dIdx, tIdx);

              if (data.contours) {
                contourCacheRef.current[cKey] = data.contours;
                stagedContours[cKey] = data.contours;
              }
              if (data.currents) {
                currentsCacheRef.current[vKey] = data.currents;
                stagedCurrents[vKey] = data.currents;
              }
            } catch (e) {
              console.error('Error parsing stream line:', e);
            }
          }

          if (Object.keys(stagedContours).length > 0 || Object.keys(stagedCurrents).length > 0) {
            scheduleFlush();
          }
        }

        flushStateUpdates();
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Frame streaming failed:', err);
        }
      } finally {
        flushStateUpdates();
      }
    };

    streamPrefetch();

    return () => {
      isCancelled = true;
      controller.abort();
      if (flushTimeout) clearTimeout(flushTimeout);
    };
  }, [
    metadata,
    selectedGroup,
    selectedVariable,
    currentDepthIndex,
    simplification,
    showContours,
    showCurrents,
    currentVarDef
  ]);

  // Active rendered data lookup
  const renderedData = useMemo(() => {
    if (!selectedGroup) return null;
    const filePath = selectedGroup.file_path || '';
    const isSurface = currentVarDef?.is_surface_only || selectedVariable === 'zeta';
    const dIdx = isSurface ? 0 : currentDepthIndex;
    const contourKey = getContourCacheKey(filePath, selectedVariable, dIdx, currentTimeIndex, simplification);
    const currentsKey = getCurrentsCacheKey(filePath, dIdx, currentTimeIndex);

    return {
      contours: contourCache[contourKey] || null,
      currents: currentsCache[currentsKey] || null
    };
  }, [
    selectedGroup,
    selectedVariable,
    currentDepthIndex,
    currentTimeIndex,
    simplification,
    contourCache,
    currentsCache,
    currentVarDef
  ]);

  return {
    renderedData,
    contourCache,
    currentsCache,
    contourCacheRef,
    currentsCacheRef,
    setContourCache,
    setCurrentsCache
  };
}
