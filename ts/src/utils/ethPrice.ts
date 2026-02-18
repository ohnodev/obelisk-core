/**
 * Fetches the cached ETH/USD price from the blockchain service.
 * Returns 0 if unavailable (caller decides whether to skip USD display).
 */

const FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_BLOCKCHAIN_URL = "http://localhost:8888";

export interface EthPriceResult {
  usd: number;
  updatedAt: number;
  source: string;
  stale: boolean;
}

export async function fetchEthUsdPrice(blockchainServiceUrl?: string): Promise<number> {
  const base = (
    blockchainServiceUrl ||
    process.env.BLOCKCHAIN_SERVICE_URL ||
    DEFAULT_BLOCKCHAIN_URL
  ).replace(/\/$/, "");

  try {
    const res = await fetch(`${base}/eth-price`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as EthPriceResult;
    return data?.usd > 0 ? data.usd : 0;
  } catch {
    return 0;
  }
}
