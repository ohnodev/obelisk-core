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

/** Safely parse a value as BigInt; handles scientific notation and decimals that would throw. */
function safeBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  const s = String(v ?? "0").trim();

  // Fast path: plain integer string (no decimals, no exponent)
  try { return BigInt(s); } catch { /* fall through */ }

  // Parse scientific notation / decimal strings into an exact integer string
  // e.g. "1.5e18" → "1500000000000000000", "1000.0" → "1000"
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (m) {
    try {
      const sign = m[1];
      const intPart = m[2];
      const fracPart = m[3] ?? "";
      const exp = Number(m[4] ?? "0");
      const digits = intPart + fracPart;
      const netExp = exp - fracPart.length;

      let intStr: string;
      if (netExp >= 0) {
        intStr = digits + "0".repeat(netExp);
      } else {
        // Truncate fractional remainder (floor toward zero)
        const cutPos = digits.length + netExp;
        intStr = cutPos <= 0 ? "0" : digits.slice(0, cutPos);
      }
      intStr = intStr.replace(/^0+/, "") || "0";
      const result = BigInt(sign + intStr);
      logger.debug(`[safeBigInt] Parsed "${s}" → ${result}`);
      return result;
    } catch { /* fall through to Number fallback */ }
  }

  // Last resort: lossy Number fallback (precision loss for values > 2^53)
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    logger.warn(`[safeBigInt] Invalid input "${s}", defaulting to 0`);
    return 0n;
  }
  logger.warn(`[safeBigInt] Number fallback for "${s}" → ${Math.round(n)} (may lose precision)`);
  return BigInt(Math.round(n));
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
    // Clanker tokens use 18 decimals; we use BigInt for wei arithmetic and convert to Number only at the end.
    // safeBigInt handles scientific notation / decimal strings that raw BigInt() would throw on.
    const valueWeiBI = safeBigInt(buyResult.value_wei);
    const amountWeiBI = safeBigInt(amountWei);
    let decimals = 18;
    if (state?.tokens && typeof state.tokens === "object") {
      const t = (state.tokens as Record<string, Record<string, unknown>>)[tokenAddress];
      if (t != null) decimals = Math.min(18, Math.max(0, getNum(t.decimals) || 18));
    }
    const decimalsMultiplier = 10 ** decimals;
    const ETH_WEI = 10 ** 18;
    const numerator = valueWeiBI * BigInt(decimalsMultiplier);
    const denominator = BigInt(ETH_WEI) * amountWeiBI;
    let boughtAtPriceEth = denominator !== 0n ? Number(numerator) / Number(denominator) : 0;
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
    const existing = bagState.holdings[tokenAddress] as BagHolding | undefined;
    if (existing && existing.amountWei) {
      // Accumulate: add token amounts and compute weighted-average cost basis
      const oldAmtBI = safeBigInt(existing.amountWei);
      const newAmtBI = safeBigInt(holding.amountWei);
      const totalAmtBI = oldAmtBI + newAmtBI;
      holding.amountWei = String(totalAmtBI);
      const oldAmt = Number(oldAmtBI);
      const newAmt = Number(newAmtBI);
      const totalAmt = oldAmt + newAmt;
      if (totalAmt > 0) {
        holding.boughtAtPriceEth =
          (existing.boughtAtPriceEth * oldAmt + boughtAtPriceEth * newAmt) / totalAmt;
      }
      holding.boughtAtTimestamp = existing.boughtAtTimestamp;
      logger.info(`[AddToBags] Accumulated ${tokenAddress}: prev=${String(oldAmtBI)} + new=${String(newAmtBI)} = ${String(totalAmtBI)}`);
    }
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
