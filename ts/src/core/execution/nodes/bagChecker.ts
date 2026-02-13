/**
 * BagCheckerNode – on each new swap, checks if we hold that token and if current price
 * hits profit target or stop loss; outputs should_sell and sell_params for ClankerSell.
 *
 * Inputs: swap (from OnSwapTrigger), bag_state_path, state (Clanker state for current price)
 * Outputs: should_sell (boolean), sell_params (object when should_sell), holding (current bag entry when we hold)
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import type { ClankerBagState, BagHolding } from "./clankerBags";

const logger = getLogger("bagChecker");

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class BagCheckerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const swap = this.getInputValue("swap", context, undefined) as Record<string, unknown> | null | undefined;
    const trigger = this.getInputValue("trigger", context, false) as boolean;
    const bagStatePath = (this.getInputValue("bag_state_path", context, undefined) as string) ?? "";
    const statePath = (this.getInputValue("state_path", context, undefined) as string) ?? "";
    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;

    const resolvedBagPath = bagStatePath || (statePath ? path.join(path.dirname(statePath), "clanker_bags.json") : "");

    if (!trigger || !swap) {
      return { should_sell: false, sell_params: null, holding: null };
    }

    const tokenAddress = String(swap.tokenAddress ?? "").toLowerCase();
    if (!tokenAddress) return { should_sell: false, sell_params: null, holding: null };

    let bagState: ClankerBagState = { lastUpdated: 0, holdings: {} };
    if (resolvedBagPath && fs.existsSync(resolvedBagPath)) {
      try {
        const raw = fs.readFileSync(resolvedBagPath, "utf-8");
        bagState = JSON.parse(raw) as ClankerBagState;
      } catch (e) {
        logger.warn(`[BagChecker] Failed to read bag state ${resolvedBagPath}: ${e}`);
        return { should_sell: false, sell_params: null, holding: null };
      }
    }

    const holding = bagState.holdings?.[tokenAddress] as BagHolding | undefined;
    if (!holding) return { should_sell: false, sell_params: null, holding: null };

    let currentPriceEth = holding.boughtAtPriceEth;
    if (state?.tokens && typeof state.tokens === "object") {
      const t = (state.tokens as Record<string, Record<string, unknown>>)[tokenAddress];
      if (t && getNum(t.lastPrice) > 0) currentPriceEth = getNum(t.lastPrice);
    }
    if (swap.priceEth != null && Number(swap.priceEth) > 0) currentPriceEth = Number(swap.priceEth);

    const boughtAt = holding.boughtAtPriceEth;
    if (boughtAt <= 0) return { should_sell: false, sell_params: null, holding };

    const profitPct = ((currentPriceEth - boughtAt) / boughtAt) * 100;
    const hitTarget = profitPct >= (holding.profitTargetPercent ?? 50);
    const hitStop = profitPct <= -(holding.stopLossPercent ?? 20);

    if (!hitTarget && !hitStop) {
      return { should_sell: false, sell_params: null, holding };
    }

    const sell_params = {
      token_address: holding.tokenAddress,
      amount_wei: holding.amountWei,
      pool_fee: holding.poolFee,
      tick_spacing: holding.tickSpacing,
      hook_address: holding.hookAddress,
      currency0: holding.currency0,
      currency1: holding.currency1,
    };

    logger.info(`[BagChecker] Sell signal: token ${holding.tokenAddress} profitPct=${profitPct.toFixed(1)}% (target=${holding.profitTargetPercent}% stop=${holding.stopLossPercent}%)`);
    return { should_sell: true, sell_params, holding };
  }
}
