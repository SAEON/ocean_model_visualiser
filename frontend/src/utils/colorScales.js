// Color Map Stops
export const TEMP_STOPS = [
  { t: 0.0, color: [20, 30, 180] },    // Deep Indigo (Cold)
  { t: 0.25, color: [0, 180, 220] },   // Bright Cyan
  { t: 0.5, color: [253, 224, 71] },   // Bright Yellow (Neutral)
  { t: 0.75, color: [244, 100, 30] },  // Rich Orange
  { t: 1.0, color: [220, 20, 60] }     // Fire Crimson (Warm)
];

export const SALT_STOPS = [
  { t: 0.0, color: [90, 0, 150] },     // Deep Violet (Low Salinity)
  { t: 0.35, color: [13, 71, 161] },   // Royal Blue
  { t: 0.7, color: [0, 200, 180] },    // Electric Teal
  { t: 1.0, color: [255, 215, 0] }     // Gold (High Salinity)
];

export const ZETA_STOPS = [
  { t: 0.0, color: [220, 20, 180] },   // Low SSH (Hot Pink/Magenta)
  { t: 0.5, color: [30, 41, 59] },     // Zero SSH (Deep Slate)
  { t: 1.0, color: [0, 255, 127] }     // High SSH (Spring Green)
];

export const VIRIDIS_STOPS = [
  { t: 0.0, color: [68, 1, 84] },     // Dark Purple
  { t: 0.25, color: [59, 82, 139] },   // Blue
  { t: 0.5, color: [33, 145, 140] },   // Teal
  { t: 0.75, color: [94, 201, 98] },   // Green
  { t: 1.0, color: [253, 231, 37] }    // Yellow
];

export const SPEED_STOPS = [
  { t: 0.0, color: [30, 41, 59, 100] }, // Slow (Slate)
  { t: 0.2, color: [0, 191, 255] },    // Moderate (Deep Sky Blue)
  { t: 0.5, color: [0, 250, 154] },    // Good Flow (Medium Spring Green)
  { t: 0.8, color: [255, 215, 0] },    // Strong (Gold)
  { t: 1.0, color: [255, 0, 0] }       // Severe (Pure Red)
];

export const getColorStops = (scheme) => {
  if (scheme === 'thermal' || scheme === 'temp') return TEMP_STOPS;
  if (scheme === 'haline' || scheme === 'salt') return SALT_STOPS;
  if (scheme === 'spectral' || scheme === 'zeta') return ZETA_STOPS;
  return VIRIDIS_STOPS;
};

export const COLOR_SCHEMES = [
  {
    id: 'thermal',
    name: 'Thermal',
    description: 'Temperature (°C)',
    stops: TEMP_STOPS
  },
  {
    id: 'haline',
    name: 'Haline',
    description: 'Salinity (psu)',
    stops: SALT_STOPS
  },
  {
    id: 'spectral',
    name: 'Spectral',
    description: 'Sea Surface Height (m)',
    stops: ZETA_STOPS
  },
  {
    id: 'viridis',
    name: 'Viridis',
    description: 'General / Uniform',
    stops: VIRIDIS_STOPS
  }
];

export const getStopsGradientCss = (stops) => {
  if (!stops || stops.length === 0) return 'transparent';
  return `linear-gradient(to right, ${stops.map(s => `rgb(${s.color.slice(0, 3).join(',')}) ${Math.round(s.t * 100)}%`).join(', ')})`;
};

// Helper to interpolate between color stops
export function interpolateColor(t, stops) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (t >= s1.t && t <= s2.t) {
      const factor = (t - s1.t) / (s2.t - s1.t || 1);
      const r = Math.round(s1.color[0] + factor * (s2.color[0] - s1.color[0]));
      const g = Math.round(s1.color[1] + factor * (s2.color[1] - s1.color[1]));
      const b = Math.round(s1.color[2] + factor * (s2.color[2] - s1.color[2]));
      return [r, g, b];
    }
  }
  return stops[stops.length - 1].color;
}

export const getZoomParameters = (zoom) => {
  const z = zoom || 5.8;
  if (z < 5.5)  return { downsample: 10, maxPixels: 5 };
  if (z < 6.0)  return { downsample: 10, maxPixels: 10 };
  if (z < 6.5)  return { downsample: 8,  maxPixels: 10 };
  if (z < 7.0)  return { downsample: 7,  maxPixels: 15 };
  if (z < 7.5)  return { downsample: 6,  maxPixels: 15 };
  if (z < 8.0)  return { downsample: 5,  maxPixels: 15 };
  if (z < 9.0)  return { downsample: 5,  maxPixels: 20 };
  if (z < 10.0) return { downsample: 4,  maxPixels: 30 };
  if (z < 11.0) return { downsample: 3,  maxPixels: 30 };
  if (z < 12.0) return { downsample: 2,  maxPixels: 30 };
  return { downsample: 1, maxPixels: 30 };
};

export const calculateCenter = (coords) => {
  if (!coords || coords.length === 0) return { longitude: 18.5, latitude: -34.0 };
  let sumLng = 0;
  let sumLat = 0;
  coords.forEach(pt => {
    sumLng += pt[0];
    sumLat += pt[1];
  });
  return {
    longitude: sumLng / coords.length,
    latitude: sumLat / coords.length
  };
};

export function normalizeVar(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    if (v === 'currents') {
      return { id: 'currents', type: 'vector_pair', nc_u_var: 'u', nc_v_var: 'v', display_name: 'Currents', unit: 'm/s', color_scheme: 'viridis', is_surface_only: false };
    }
    if (v === 'zeta') {
      return { id: 'zeta', type: 'scalar_contour', nc_var: 'zeta', display_name: 'Sea Surface Height', unit: 'm', color_scheme: 'spectral', is_surface_only: true };
    }
    if (v === 'salt') {
      return { id: 'salt', type: 'scalar_contour', nc_var: 'salt', display_name: 'Salinity', unit: 'g/kg', color_scheme: 'haline', is_surface_only: false };
    }
    return { id: v, type: 'scalar_contour', nc_var: v, display_name: v === 'temp' ? 'Temperature' : v, unit: v === 'temp' ? '°C' : '', color_scheme: 'thermal', is_surface_only: false };
  }
  return {
    id: v.id || v.nc_var || 'var',
    type: v.type || (v.id === 'currents' ? 'vector_pair' : 'scalar_contour'),
    nc_var: v.nc_var || v.id,
    nc_u_var: v.nc_u_var || 'u',
    nc_v_var: v.nc_v_var || 'v',
    display_name: v.display_name || v.id || v.nc_var,
    unit: v.unit || '',
    color_scheme: v.color_scheme || 'thermal',
    is_surface_only: !!v.is_surface_only
  };
}
