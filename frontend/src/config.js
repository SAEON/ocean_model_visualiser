// Configuration for the Frontend Application

// The URL of the backend API server.
// By default, this resolves dynamically to the browser's current hostname on port 8001.
// You can override this by setting the VITE_API_URL environment variable during build,
// or by changing the hardcoded string here.
export const API_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8001` : '');
