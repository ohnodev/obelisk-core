/**
 * State shapes for Clanker tracker. Persisted to a single JSON file.
 */

export interface LastSwapItem {
  timestamp: number;
  side: "buy" | "sell";
  volumeUsd: number;
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
  /** Rolling 24h volume in USD (approximate from swap amounts) */
  volume24h: number;
  /** Last N swaps for context */
  last20Swaps: LastSwapItem[];
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
