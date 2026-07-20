// Configuration for the Frontend Application

// The URL of the backend API server.
// If VITE_API_URL is defined, it is used.
// If accessed directly on IP/localhost on port 8000/5173, defaults to port 8001.
// If accessed via domain reverse proxy (e.g. data.ocean.gov.za), defaults to relative path "".
export const API_URL = import.meta.env.VITE_API_URL || (
  typeof window !== 'undefined'
    ? (window.location.port === '8000' || window.location.port === '5173' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || /^172\./.test(window.location.hostname)
        ? `${window.location.protocol}//${window.location.hostname}:8001`
        : '')
    : ''
);
