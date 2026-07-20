// Configuration for the Frontend Application

// The URL of the backend API server.
// Uses VITE_API_URL if specified at build time, otherwise defaults to relative path ''
// so requests are proxied via the web server / Apache location rule (/api/...).
export const API_URL = import.meta.env.VITE_API_URL || '';
