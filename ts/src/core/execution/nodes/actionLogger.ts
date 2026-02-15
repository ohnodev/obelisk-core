/**
 * ActionLoggerNode – appends buy/sell results to clanker_actions.json.
 * Storage from clanker_storage_path / base_path / storage_instance.
 *
 * Inputs: buy_result, sell_result, holding (optional; from bag_checker when selling),
 *         system_note (optional; when set, log a non-trade entry e.g. "Insufficient funds."),
 *         clanker_storage_path / base_path / storage_instance, max_actions (default 100)
 *
 * Logs cost basis and PnL: on buy, costWei = valueWei (ETH spent). On sell, when holding
 * is provided, costEth from holding and pnlEth = valueEth - costEth.
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import { resolveActionsPath } from "./clankerStoragePath";

const logger = getLogger("actionLogger");

const DEFAULT_MAX_ACTIONS = 100;
const ETH_WEI = 1e18;

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class ActionLoggerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const buyResult = this.getInputValue("buy_result", context, undefined) as Record<string, unknown> | undefined;
    const sellResult = this.getInputValue("sell_result", context, undefined) as Record<string, unknown> | undefined;
    const actionsPath = resolveActionsPath(this, context);
    const maxActions = Math.min(
      1000,
      Math.max(1, getNum(this.getInputValue("max_actions", context, this.metadata.max_actions ?? DEFAULT_MAX_ACTIONS)) || DEFAULT_MAX_ACTIONS)
    );

    if (!actionsPath) {
      logger.warn("[ActionLogger] No clanker_storage_path or base_path or storage_instance, skipping");
      return { success: false, logged_count: 0, error: "clanker_storage_path or base_path or storage_instance required" };
    }

    const holding = this.getInputValue("holding", context, undefined) as Record<string, unknown> | undefined;
    const systemNote = this.getInputValue("system_note", context, undefined) as string | undefined;
    const entries: Array<{
      type: string;
      tokenAddress?: string;
      amountWei?: string;
      valueWei?: string;
      costWei?: string;
      costEth?: number;
      pnlEth?: number;
      txHash?: string;
      reason?: string;
      timestamp: number;
    }> = [];

    if (systemNote != null && String(systemNote).trim() !== "") {
      entries.push({
        type: "system",
        reason: String(systemNote).trim(),
        timestamp: Date.now(),
      });
    }

    if (buyResult?.success && buyResult?.token_address) {
      const valueWei = String(buyResult.value_wei ?? "0");
      entries.push({
        type: "buy",
        tokenAddress: String(buyResult.token_address).toLowerCase(),
        amountWei: String(buyResult.amount_wei ?? "0"),
        valueWei,
        costWei: valueWei,
        txHash: buyResult.txHash != null ? String(buyResult.txHash) : undefined,
        timestamp: Date.now(),
      });
    }
    if (sellResult?.success && sellResult?.token_address) {
      const valueWei = String(sellResult.value_wei ?? sellResult.eth_received ?? "0");
      const amountWeiSold = String(sellResult.amount_wei ?? "0");
      const sellEntry: (typeof entries)[0] = {
        type: "sell",
        tokenAddress: String(sellResult.token_address).toLowerCase(),
        amountWei: amountWeiSold,
        valueWei,
        txHash: sellResult.txHash != null ? String(sellResult.txHash) : undefined,
        timestamp: Date.now(),
      };
      const boughtAtPriceEth = holding && typeof holding.boughtAtPriceEth === "number" ? holding.boughtAtPriceEth : undefined;
      if (boughtAtPriceEth != null && Number(amountWeiSold) > 0) {
        const costEth = boughtAtPriceEth * (Number(amountWeiSold) / ETH_WEI);
        const valueEth = Number(valueWei) / ETH_WEI;
        const pnlEth = valueEth - costEth;
        sellEntry.costWei = String(BigInt(Math.round(costEth * ETH_WEI)));
        sellEntry.costEth = costEth;
        sellEntry.pnlEth = pnlEth;
      }
      entries.push(sellEntry);
    }

    if (entries.length === 0) {
      return { success: true, logged_count: 0 };
    }

    let list: unknown[] = [];
    if (fs.existsSync(actionsPath)) {
      try {
        const raw = fs.readFileSync(actionsPath, "utf-8");
        const data = JSON.parse(raw);
        list = Array.isArray(data) ? data : (data?.actions ?? []);
      } catch (e) {
        logger.warn(`[ActionLogger] Failed to read ${abbrevPathForLog(actionsPath)}: ${e}`);
      }
    }

    list.push(...entries);
    list = list.slice(-maxActions);

    try {
      ensureDir(actionsPath);
      fs.writeFileSync(actionsPath, JSON.stringify(list, null, 2), "utf-8");
      logger.info(`[ActionLogger] Appended ${entries.length} action(s), total ${list.length} (max ${maxActions})`);
      return { success: true, logged_count: entries.length };
    } catch (e) {
      logger.warn(`[ActionLogger] Failed to write ${abbrevPathForLog(actionsPath)}: ${e}`);
      return { success: false, logged_count: 0, error: String(e) };
    }
  }
}
