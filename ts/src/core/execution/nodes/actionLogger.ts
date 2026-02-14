/**
 * ActionLoggerNode – appends buy/sell results to clanker_actions.json (same dir as state).
 * Keeps only the last N actions (default 100) to avoid unbounded growth.
 *
 * Inputs: buy_result (from Clanker Buy), sell_result (from Clanker Sell), state_path (from Blockchain Config),
 *         optional storage_instance (if provided, use basePath for actions file; else use state_path dir),
 *         max_actions (number, default 100)
 * Outputs: success, logged_count (1 if one action logged, 0 if none)
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";

const logger = getLogger("actionLogger");

const ACTIONS_FILE_NAME = "clanker_actions.json";
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
    const statePath = (this.getInputValue("state_path", context, undefined) as string) ?? "";
    const storageInstance = this.getInputValue("storage_instance", context, undefined) as Record<string, unknown> | undefined;
    const maxActions = Math.min(
      1000,
      Math.max(1, getNum(this.getInputValue("max_actions", context, this.metadata.max_actions ?? DEFAULT_MAX_ACTIONS)) || DEFAULT_MAX_ACTIONS)
    );

    let actionsPath: string;
    if (storageInstance?.basePath) {
      actionsPath = path.join(String(storageInstance.basePath), ACTIONS_FILE_NAME);
    } else if (statePath) {
      actionsPath = path.join(path.dirname(statePath), ACTIONS_FILE_NAME);
    } else {
      logger.warn("[ActionLogger] No state_path or storage_instance.basePath, skipping");
      return { success: false, logged_count: 0, error: "state_path or storage_instance required" };
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
