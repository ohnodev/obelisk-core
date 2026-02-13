/**
 * State shapes for Clanker tracker. Persisted to a single JSON file.
 */

export interface LastSwapItem {
  timestamp: number;
  side: "buy" | "sell";
  /** Volume in ETH (WETH) for this swap */
  volumeEth: number;
  /** Sender address for unique maker count */
  sender?: string;
  /** Price in ETH (per token) at swap time (optional) */
  priceEth?: number;
  /** @deprecated use volumeEth */
  volumeUsd?: number;
  /** @deprecated use priceEth */
  priceUsd?: number;
}

export interface TokenState {
  tokenAddress: string;
  currency0: string;
  currency1: string;
  poolId: string;
  hookAddress: string;
  feeTier: number;
  tickSpacing: number;
  launchTime: number;
  totalSwaps: number;
  totalBuys: number;
  totalSells: number;
  /** Rolling 24h volume in ETH */
  volume24h: number;
  /** Last N swaps for context */
  last20Swaps: LastSwapItem[];
  /** Volume in last 1m / 5m / 15m / 30m / 1h (ETH), computed from swap history */
  volume1m?: number;
  volume5m?: number;
  volume15m?: number;
  volume30m?: number;
  volume1h?: number;
  /** Unique buyers (makers) from swap history */
  totalMakers?: number;
  /** Last known price in ETH (per token) from latest swap */
  lastPrice?: number;
  /** Price change % over interval (from swap price history in ETH) */
  priceChange1m?: number;
  priceChange5m?: number;
  priceChange15m?: number;
  priceChange30m?: number;
  priceChange1h?: number;
  /** Block number when pool was initialized */
  blockNumber: number;
  transactionHash: string;
  /** From TokenCreated in same tx — required; we only track pools that have TokenCreated */
  name: string;
  symbol: string;
  tokenImage: string;
  tokenMetadata: string;
  /** From GodMulticall — required; we only add tokens when we have valid pool + token info */
  decimals: number;
  totalSupply: string;
}

export interface LaunchEvent {
  tokenAddress: string;
  currency0: string;
  currency1: string;
  poolId: string;
  hookAddress: string;
  feeTier: number;
  tickSpacing: number;
  launchTime: number;
  blockNumber: number;
  transactionHash: string;
  /** From TokenCreated in same tx — required; we only add launches when TokenCreated is present */
  name: string;
  symbol: string;
  tokenImage: string;
  tokenMetadata: string;
  /** From GodMulticall — required; we only add launch when we have valid token info */
  decimals: number;
  totalSupply: string;
}

export interface ClankerState {
  lastUpdated: number;
  tokens: Record<string, TokenState>;
  recentLaunches: LaunchEvent[];
}
