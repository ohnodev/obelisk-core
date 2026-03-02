/**
 * PolymarketActionLoggerNode – logs every sniper tick (trade or no-action) for stats visibility.
 * Writes to polymarket_actions.json. Enables /polymarket/stats to show lastActions so users see activity
 * even when no trade occurs (e.g. "no_action: outside time window", "no_action: edge below threshold").
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import { resolvePolymarketActionsPath } from "./polymarketStoragePath";

const logger = getLogger("polymarketActionLogger");

const DEFAULT_MAX_ACTIONS = 100;

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class PolymarketActionLoggerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, logged: false, reason: "trigger is false" };
    }

    const actionsPath = resolvePolymarketActionsPath(this, context);
    if (!actionsPath) {
      return { success: false, logged: false, error: "storage path not resolved" };
    }

    const orderResult = this.getInputValue("order_result", context, undefined) as Record<string, unknown> | undefined;
    const evaluateReason = this.getInputValue("reason", context, undefined) as string | undefined;
    const orderReason = orderResult?.reason as string | undefined;
    const signalRaw = this.getInputValue("signal", context, undefined);

    const maxActionsRaw =
      this.getInputValue("max_actions", context, undefined) ??
      this.resolveEnvVar(this.metadata.max_actions) ??
      this.metadata.max_actions ??
      DEFAULT_MAX_ACTIONS;
    const maxActions = Math.min(200, Math.max(1, parseInt(String(maxActionsRaw), 10) || DEFAULT_MAX_ACTIONS));

    const didTrade = orderResult?.success === true && orderResult?.skipped !== true;
    const action: Record<string, unknown> = {
      ts: Date.now(),
      action: didTrade ? "order_placed" : "no_action",
    };

    if (didTrade) {
      const resp = orderResult?.response as Record<string, unknown> | undefined;
      action.token_id =
        orderResult?.token_id ?? orderResult?.tokenId ?? resp?.tokenId ?? resp?.token_id;
      action.order_id = orderResult?.order_id ?? resp?.orderId ?? resp?.order_id;
    } else {
      const reason = evaluateReason ?? orderReason ?? (String(signalRaw) === "none" ? "no signal" : "skipped");
      action.reason = typeof reason === "string" ? reason : String(reason);
    }

    let list: unknown[] = [];
    if (fs.existsSync(actionsPath)) {
      try {
        const raw = fs.readFileSync(actionsPath, "utf-8");
        const data = JSON.parse(raw);
        list = Array.isArray(data) ? data : (data?.actions ?? []);
      } catch (e) {
        logger.warn(`[PolymarketActionLogger] Failed to read ${abbrevPathForLog(actionsPath)}: ${e}`);
      }
    }

    list.push(action);
    list = list.slice(-maxActions);

    try {
      ensureDir(actionsPath);
      fs.writeFileSync(actionsPath, JSON.stringify(list, null, 2), "utf-8");
      return { success: true, logged: true, action: action.action, reason: action.reason };
    } catch (e) {
      logger.warn(`[PolymarketActionLogger] Failed to write ${abbrevPathForLog(actionsPath)}: ${e}`);
      return { success: false, logged: false, error: String(e) };
    }
  }
}
