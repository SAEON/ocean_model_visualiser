// Configuration for the Frontend Application

// The URL of the backend API server.
// Uses VITE_API_URL if specified at build time, otherwise binds to Vite BASE_URL
// so API requests match the app subpath (e.g. /ocean_model_visualiser/api/...).
export const API_URL = import.meta.env.VITE_API_URL || import.meta.env.BASE_URL.replace(/\/$/, '');
