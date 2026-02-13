/**
 * Bag state: our Clanker holdings and profit/stop-loss targets.
 * Persisted to a JSON file (e.g. blockchain-service/data/clanker_bags.json).
 */

export interface BagHolding {
  tokenAddress: string;
  amountWei: string;
  poolFee: number;
  tickSpacing: number;
  hookAddress: string;
  currency0: string;
  currency1: string;
  boughtAtPriceEth: number;
  boughtAtTimestamp: number;
  profitTargetPercent: number;
  stopLossPercent: number;
}

export interface ClankerBagState {
  lastUpdated: number;
  holdings: Record<string, BagHolding>;
}

export const DEFAULT_PROFIT_TARGET_PERCENT = 50;
export const DEFAULT_STOP_LOSS_PERCENT = 20;
