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
}

export interface ClankerState {
  lastUpdated: number;
  tokens: Record<string, TokenState>;
  recentLaunches: LaunchEvent[];
}
