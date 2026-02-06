/**
 * API Configuration
 * Automatically detects dev/prod mode based on window URL
 */

// Check if we're in a browser environment
const isBrowser = typeof window !== "undefined";

// Detect if we're in dev mode (localhost)
export const isDevMode = isBrowser 
  ? window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  : true; // Default to dev mode during SSR

// API URLs
const DEV_CORE_API = "http://localhost:7779";
const PROD_CORE_API = "https://core.theobelisk.ai";

const DEV_SERVICE_API = "http://localhost:8090";
const PROD_SERVICE_API = "https://api.theobelisk.ai";

// Export the appropriate URLs based on mode
export const API_BASE_URL = isDevMode ? DEV_CORE_API : PROD_CORE_API;
export const DEPLOYMENT_API_URL = isDevMode ? DEV_SERVICE_API : PROD_SERVICE_API;

// Helper to get URLs (useful for components that need to react to changes)
export function getApiUrls() {
  const devMode = isBrowser 
    ? window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    : true;
  
  return {
    isDevMode: devMode,
    coreApi: devMode ? DEV_CORE_API : PROD_CORE_API,
    serviceApi: devMode ? DEV_SERVICE_API : PROD_SERVICE_API,
  };
}
