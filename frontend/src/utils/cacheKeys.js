/**
 * Centralized cache key generator for ocean model frames and currents.
 * Keeps keys consistent across single frame fetches, streaming, and buffer calculations.
 */

export function getContourCacheKey(filePath, variable, depthIdx, timeIdx, tolerance = 0.001) {
  return `${filePath || ''}_${variable}_${depthIdx}_${timeIdx}_tol${tolerance}`;
}

export function getCurrentsCacheKey(filePath, depthIdx, timeIdx) {
  return `${filePath || ''}_${depthIdx}_${timeIdx}`;
}

