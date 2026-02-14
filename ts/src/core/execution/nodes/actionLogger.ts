/**
 * ActionLoggerNode – appends buy/sell results to clanker_actions.json.
 * Storage from clanker_storage_path / base_path / storage_instance.
 *
 * Inputs: buy_result, sell_result, clanker_storage_path / base_path / storage_instance, max_actions (default 100)
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import { resolveActionsPath } from "./clankerStoragePath";

const logger = getLogger("actionLogger");

const DEFAULT_MAX_ACTIONS = 100;

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

    const entries: Array<{
      type: string;
      tokenAddress?: string;
      amountWei?: string;
      valueWei?: string;
      txHash?: string;
      timestamp: number;
    }> = [];

    if (buyResult?.success && buyResult?.token_address) {
      entries.push({
        type: "buy",
        tokenAddress: String(buyResult.token_address).toLowerCase(),
        amountWei: String(buyResult.amount_wei ?? "0"),
        valueWei: String(buyResult.value_wei ?? "0"),
        txHash: buyResult.txHash != null ? String(buyResult.txHash) : undefined,
        timestamp: Date.now(),
      });
    }
    if (sellResult?.success && sellResult?.token_address) {
      entries.push({
        type: "sell",
        tokenAddress: String(sellResult.token_address).toLowerCase(),
        amountWei: String(sellResult.amount_wei ?? "0"),
        valueWei: String(sellResult.value_wei ?? sellResult.eth_received ?? "0"),
        txHash: sellResult.txHash != null ? String(sellResult.txHash) : undefined,
        timestamp: Date.now(),
      });
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
