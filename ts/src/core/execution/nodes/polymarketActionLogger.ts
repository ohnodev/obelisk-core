/**
 * PolymarketActionLoggerNode – logs every sniper tick (trade or no-action) for stats visibility.
 * Writes to polymarket_actions.json. Enables /polymarket/stats to show lastActions so users see activity
 * even when no trade occurs. Uses PolymarketSniperAction schema for frontend parsing and visual cues.
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import { resolvePolymarketActionsPath } from "./polymarketStoragePath";
import {
  POLYMARKET_SNIPER_ACTION_SCHEMA_VERSION,
  type PolymarketSniperAction,
  type SniperActionContext,
} from "../../../types/polymarketSniper";

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
    const sniperContextDirect = this.getInputValue("sniper_context", context, undefined) as SniperActionContext | undefined;
    const sniperContextFromOrder = orderResult?.sniper_context as SniperActionContext | undefined;
    const sniperContext = sniperContextDirect ?? sniperContextFromOrder;

    const parseErrorMinRaw = this.getInputValue("parse_error_time_window_min", context, undefined);
    const parseErrorMaxRaw = this.getInputValue("parse_error_time_window_max", context, undefined);
    const parseErrorEdgeRaw = this.getInputValue("parse_error_edge_threshold", context, undefined);
    const parseErrorEdgeT0Raw = this.getInputValue("parse_error_edge_at_t_minus_0", context, undefined);
    const parseErrorDistRaw = this.getInputValue("parse_error_distance_max_abs", context, undefined);
    const parseErrors: string[] = [];
    if (parseErrorMinRaw !== undefined && parseErrorMinRaw !== null) {
      parseErrors.push(String(parseErrorMinRaw));
    }
    if (parseErrorMaxRaw !== undefined && parseErrorMaxRaw !== null) {
      parseErrors.push(String(parseErrorMaxRaw));
    }
    if (parseErrorEdgeRaw !== undefined && parseErrorEdgeRaw !== null) {
      parseErrors.push(String(parseErrorEdgeRaw));
    }
    if (parseErrorEdgeT0Raw !== undefined && parseErrorEdgeT0Raw !== null) {
      parseErrors.push(String(parseErrorEdgeT0Raw));
    }
    if (parseErrorDistRaw !== undefined && parseErrorDistRaw !== null) {
      parseErrors.push(String(parseErrorDistRaw));
    }

    const maxActionsRaw =
      this.getInputValue("max_actions", context, undefined) ??
      this.resolveEnvVar(this.metadata.max_actions) ??
      this.metadata.max_actions ??
      DEFAULT_MAX_ACTIONS;
    const parsed = parseInt(String(maxActionsRaw), 10);
    const maxActions = Math.min(200, Math.max(1, Number.isNaN(parsed) ? DEFAULT_MAX_ACTIONS : parsed));

    const didTrade = orderResult?.success === true && orderResult?.skipped !== true;
    const reasonRaw = evaluateReason ?? orderReason ?? (String(signalRaw) === "none" ? "no signal" : "skipped");
    const reasonStr = String(reasonRaw).trim().toLowerCase();
    const canonicalReason: "order_placed" | "not_in_window" | "no_signal" =
      didTrade ? "order_placed"
      : /not_in_window|not in window|notinwindow/.test(reasonStr) ? "not_in_window"
      : /no_signal|no signal|none|skipped/.test(reasonStr) ? "no_signal"
      : "no_signal";

    const action: PolymarketSniperAction = {
      ts: Date.now(),
      action: didTrade ? "order_placed" : "no_action",
      reason: canonicalReason,
      schema_version: POLYMARKET_SNIPER_ACTION_SCHEMA_VERSION,
      ...(parseErrors.length > 0 && { parse_errors: parseErrors }),
    };

    if (didTrade) {
      const resp = orderResult?.response as Record<string, unknown> | undefined;
      action.token_id =
        (orderResult?.token_id ?? orderResult?.tokenId ?? resp?.tokenId ?? resp?.token_id) as string | undefined;
      action.order_id =
        (orderResult?.order_id ?? orderResult?.orderId ?? resp?.orderId ?? resp?.order_id) as string | undefined;
      action.price = orderResult?.price as number | undefined;
      action.size = orderResult?.size as number | undefined;
    } else if (sniperContext) {
      action.context = sniperContext;
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
    list = Array.isArray(list) ? list : [];

    list.push(action);
    list = list.slice(-maxActions);

    try {
      ensureDir(actionsPath);
      fs.writeFileSync(actionsPath, JSON.stringify(list, null, 2), "utf-8");
      return { success: true, logged: true, action: action.action, reason: String(action.reason) };
    } catch (e) {
      logger.warn(`[PolymarketActionLogger] Failed to write ${abbrevPathForLog(actionsPath)}: ${e}`);
      return { success: false, logged: false, error: String(e) };
    }
  }
}
