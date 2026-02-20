/**
 * BagCheckerNode – on scheduler trigger, reads state + bag state from storage,
 * checks each holding against current price; if any hits profit target, stop loss,
 * or sell timer, outputs should_sell and sell_params.
 *
 * Inputs: trigger, state (from Blockchain Config), storage_instance (for bags),
 *         sell_timer_minutes (default 5; 0 = disabled),
 *         profit_target_percent (default 50), stop_loss_percent (default 20) – e.g. from env via text nodes
 */
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import type { ClankerBagState, BagHolding } from "./clankerBags";
import { DEFAULT_PROFIT_TARGET_PERCENT, DEFAULT_STOP_LOSS_PERCENT } from "./clankerBags";
import { resolveBagsPath } from "./clankerStoragePath";

const logger = getLogger("bagChecker");

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Treat empty or invalid input as unset so env-driven text nodes don't override defaults. */
function numOrFallback(raw: unknown, fallback: number): number {
  if (raw === "" || (typeof raw === "string" && raw.trim() === "")) return fallback;
  const n = getNum(raw);
  return n > 0 ? n : fallback;
}

export class BagCheckerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const trigger = this.getInputValue("trigger", context, false) as boolean;
    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const timerFromMeta = getNum(this.metadata.sell_timer_minutes ?? 5);
    const sellTimerMinutes = Math.max(
      0,
      numOrFallback(this.getInputValue("sell_timer_minutes", context, undefined), timerFromMeta)
    );
    const profitFromMeta = getNum(this.metadata.profit_target_percent ?? DEFAULT_PROFIT_TARGET_PERCENT);
    const stopFromMeta = getNum(this.metadata.stop_loss_percent ?? DEFAULT_STOP_LOSS_PERCENT);
    const profitFromInput = numOrFallback(this.getInputValue("profit_target_percent", context, undefined), profitFromMeta);
    const stopFromInput = numOrFallback(this.getInputValue("stop_loss_percent", context, undefined), stopFromMeta);
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
      const profitTarget = holding.profitTargetPercent ?? profitFromInput;
      const stopLoss = holding.stopLossPercent ?? stopFromInput;
      const hitTarget = profitPct >= profitTarget;
      const hitStop = profitPct <= -stopLoss;

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
        logger.info(`[BagChecker] Sell signal: token ${holding.tokenAddress} profitPct=${profitPct.toFixed(1)}% (target=${profitTarget}% stop=${stopLoss}%)`);
      }
      return { should_sell: true, sell_params, holding };
    }

    return { should_sell: false, sell_params: null, holding: null };
  }
}
