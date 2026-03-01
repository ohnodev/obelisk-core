/**
 * Service config — non-secret values. Secrets (PRIVATE_KEY, RPC URL) stay in .env.
 */

// Polygon: min ~30 Gwei. Higher floor for congestion. Dynamic gas from gasstation.polygon.technology preferred.
export const POLYGON_GAS_TIP_GWEI = 120;
export const POLYGON_GAS_MAX_FEE_GWEI = 400;
