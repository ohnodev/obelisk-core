/**
 * BagCheckerNode – on scheduler trigger, reads state + bag state from storage,
 * checks each holding against current price; if any hits profit target, stop loss,
 * or sell timer, outputs should_sell and sell_params.
 *
 * Inputs: trigger, state (from Blockchain Config), clanker_storage_path / base_path / storage_instance (for bags),
 *         sell_timer_minutes (default 5; 0 = disabled)
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import type { ClankerBagState, BagHolding } from "./clankerBags";
import { resolveBagsPath } from "./clankerStoragePath";

const logger = getLogger("bagChecker");

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class BagCheckerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const trigger = this.getInputValue("trigger", context, false) as boolean;
    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const sellTimerMinutes = Math.max(
      0,
      getNum(this.getInputValue("sell_timer_minutes", context, this.metadata.sell_timer_minutes ?? 5))
    );
    const resolvedBagPath = resolveBagsPath(this, context);

    if (!trigger) {
      return { should_sell: false, sell_params: null, holding: null };
    }

    // On restart / each run: try to load bags from storage first; only use empty state if file missing or unreadable
    let bagState: ClankerBagState = { lastUpdated: 0, holdings: {} };
    if (resolvedBagPath && fs.existsSync(resolvedBagPath)) {
      try {
        const raw = fs.readFileSync(resolvedBagPath, "utf-8");
        bagState = JSON.parse(raw) as ClankerBagState;
      } catch (e) {
        logger.warn(`[BagChecker] Failed to read bag state ${abbrevPathForLog(resolvedBagPath)}: ${e}`);
        return { should_sell: false, sell_params: null, holding: null };
      }
    }

    const holdings = bagState.holdings ?? {};
    const tokens = state?.tokens && typeof state.tokens === "object" ? (state.tokens as Record<string, Record<string, unknown>>) : {};

    for (const tokenAddress of Object.keys(holdings)) {
      const holding = holdings[tokenAddress] as BagHolding;
      if (!holding) continue;

      let currentPriceEth = holding.boughtAtPriceEth;
      const t = tokens[tokenAddress.toLowerCase()];
      if (t && getNum(t.lastPrice) > 0) currentPriceEth = getNum(t.lastPrice);

      const boughtAt = holding.boughtAtPriceEth;
      if (boughtAt <= 0) continue;

      const profitPct = ((currentPriceEth - boughtAt) / boughtAt) * 100;
      const hitTarget = profitPct >= (holding.profitTargetPercent ?? 50);
      const hitStop = profitPct <= -(holding.stopLossPercent ?? 20);

      const boughtAtTs = holding.boughtAtTimestamp ?? 0;
      const heldMs = Date.now() - boughtAtTs;
      const timerMinutes = sellTimerMinutes > 0 ? sellTimerMinutes : 0;
      const hitTimer = timerMinutes > 0 && heldMs >= timerMinutes * 60 * 1000;

      if (!hitTarget && !hitStop && !hitTimer) continue;

      const sell_params = {
        token_address: holding.tokenAddress,
        amount_wei: holding.amountWei,
        pool_fee: holding.poolFee,
        tick_spacing: holding.tickSpacing,
        hook_address: holding.hookAddress,
        currency0: holding.currency0,
        currency1: holding.currency1,
      };

      if (hitTimer && !hitTarget && !hitStop) {
        logger.info(`[BagChecker] Sell signal: token ${holding.tokenAddress} timeout (held ${(heldMs / 60000).toFixed(1)}m >= ${timerMinutes}m, no profit target)`);
      } else {
        logger.info(`[BagChecker] Sell signal: token ${holding.tokenAddress} profitPct=${profitPct.toFixed(1)}% (target=${holding.profitTargetPercent}% stop=${holding.stopLossPercent}%)`);
      }
      return { should_sell: true, sell_params, holding };
    }

    return { should_sell: false, sell_params: null, holding: null };
  }
}
