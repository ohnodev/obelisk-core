/**
 * AddToBagsNode – after a successful Clanker buy, add the position to bag state (clanker_bags.json)
 * with profit target and stop loss. Storage from clanker_storage_path / base_path / storage_instance.
 *
 * Cost basis (boughtAtPriceEth): derived from buy_result (valueWei / amountWei = ETH per token) so
 * PnL on sell is correct. Falls back to state.tokens[].lastPrice only if buy result has no valueWei.
 *
 * Inputs: buy_result, state (fallback for boughtAtPriceEth), base_path / storage_instance, profit_target_percent, stop_loss_percent
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import type { ClankerBagState, BagHolding } from "./clankerBags";
import { DEFAULT_PROFIT_TARGET_PERCENT, DEFAULT_STOP_LOSS_PERCENT } from "./clankerBags";
import { resolveBagsPath } from "./clankerStoragePath";

const logger = getLogger("addToBags");

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class AddToBagsNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const buyResult = this.getInputValue("buy_result", context, undefined) as Record<string, unknown> | undefined;
    const state = this.getInputValue("state", context, undefined) as Record<string, unknown> | undefined;
    const resolvedBagPath = resolveBagsPath(this, context);
    if (!resolvedBagPath) {
      return { success: false, error: "clanker_storage_path or base_path or storage_instance required" };
    }

    if (!buyResult?.success || !buyResult?.token_address) {
      return { success: false, error: "No successful buy result" };
    }

    const tokenAddress = String(buyResult.token_address).toLowerCase();
    const amountWei = String(buyResult.amount_wei ?? "0");
    const poolFee = getNum(buyResult.pool_fee) || 0;
    const tickSpacing = getNum(buyResult.tick_spacing) ?? 0;
    const hookAddress = String(buyResult.hook_address ?? "").trim();
    const currency0 = String(buyResult.currency0 ?? "").trim();
    const currency1 = String(buyResult.currency1 ?? "").trim();

    const profitTargetPercent = getNum(this.getInputValue("profit_target_percent", context, undefined)) || DEFAULT_PROFIT_TARGET_PERCENT;
    const stopLossPercent = getNum(this.getInputValue("stop_loss_percent", context, undefined)) || DEFAULT_STOP_LOSS_PERCENT;

    // Cost basis from buy result (ETH spent / tokens received = ETH per token) so PnL on sell is correct.
    // Clanker tokens use 18 decimals; we normalize by token decimals (from state, fallback 18) so cost basis
    // is correct for any token and we avoid huge errors for non-18-decimal tokens.
    const valueWei = Number(buyResult.value_wei ?? 0);
    const amountWeiNum = Number(amountWei);
    let decimals = 18;
    if (state?.tokens && typeof state.tokens === "object") {
      const t = (state.tokens as Record<string, Record<string, unknown>>)[tokenAddress];
      if (t != null) decimals = Math.min(18, Math.max(0, getNum(t.decimals) || 18));
    }
    const tokenAmountHuman = amountWeiNum / Math.pow(10, decimals);
    const valueEth = valueWei / 1e18;
    let boughtAtPriceEth = tokenAmountHuman > 0 && valueEth > 0 ? valueEth / tokenAmountHuman : 0;
    if (boughtAtPriceEth <= 0 && state?.tokens && typeof state.tokens === "object") {
      const t = (state.tokens as Record<string, Record<string, unknown>>)[tokenAddress];
      if (t && getNum(t.lastPrice) > 0) boughtAtPriceEth = getNum(t.lastPrice);
    }

    const holding: BagHolding = {
      tokenAddress,
      amountWei,
      poolFee,
      tickSpacing,
      hookAddress,
      currency0,
      currency1,
      boughtAtPriceEth,
      boughtAtTimestamp: Date.now(),
      profitTargetPercent,
      stopLossPercent,
    };

    // Always try to load existing bags from storage first; only start fresh if file missing
    let bagState: ClankerBagState = { lastUpdated: 0, holdings: {} };
    if (fs.existsSync(resolvedBagPath)) {
      try {
        const raw = fs.readFileSync(resolvedBagPath, "utf-8");
        bagState = JSON.parse(raw) as ClankerBagState;
      } catch (e) {
        logger.warn(`[AddToBags] Failed to load bag state from ${abbrevPathForLog(resolvedBagPath)}: ${e}. Not overwriting.`);
        return { success: false, error: "Failed to load bag state from storage" };
      }
    }
    if (!bagState.holdings) bagState.holdings = {};
    bagState.holdings[tokenAddress] = holding;
    bagState.lastUpdated = Date.now();

    try {
      const dir = path.dirname(resolvedBagPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolvedBagPath, JSON.stringify(bagState, null, 2), "utf-8");
      logger.info(`[AddToBags] Added ${tokenAddress} target=${profitTargetPercent}% stop=${stopLossPercent}%`);
      return { success: true, holding };
    } catch (e) {
      logger.warn(`[AddToBags] Failed to write ${abbrevPathForLog(resolvedBagPath)}: ${e}`);
      return { success: false, error: String(e) };
    }
  }
}
