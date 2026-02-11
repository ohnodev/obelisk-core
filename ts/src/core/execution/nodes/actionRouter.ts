/**
 * ActionRouterNode – parses LLM response into a list of actions (abstract).
 * Expects inference to return JSON (same "JSON mode" as BinaryIntent: no markdown, no extra text).
 * Uses the same extractJsonFromLlmResponse() as binary intent: strips <think> blocks, code fences,
 * and recovers JSON from messy or truncated output.
 *
 * Inputs:
 *   response: String from Inference node (required) – expected to be JSON with "actions" array
 *
 * Outputs:
 *   tg_actions: Array of { action: string, params: Record<string, unknown> }
 *
 * Allowed action types: reply, send_dm, pin_message, timeout_message_author, delete_message.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("actionRouter");

const ALLOWED_ACTIONS = new Set([
  "reply",
  "send_dm",
  "pin_message",
  "timeout_message_author",
  "delete_message",
]);

const MAX_TIMEOUT_SECONDS = 60;

export interface ActionItem {
  action: string;
  params: Record<string, unknown>;
}

function isActionItem(raw: unknown): raw is ActionItem {
  return (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as ActionItem).action === "string" &&
    typeof (raw as ActionItem).params === "object" &&
    (raw as ActionItem).params !== null
  );
}

export class ActionRouterNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const response = this.getInputValue("response", context, "") as string;
    const responseStr = response != null ? String(response).trim() : "";

    let actions: ActionItem[] = [];

    if (responseStr) {
      try {
        // Same JSON parser as BinaryIntent: handles <think>, markdown code blocks, truncated JSON
        const parsed = extractJsonFromLlmResponse(
          responseStr,
          "action_router"
        ) as Record<string, unknown>;
        const rawList = parsed?.actions;
        if (Array.isArray(rawList)) {
          for (const item of rawList) {
            if (!isActionItem(item)) continue;
            const action = String(item.action).toLowerCase();
            if (!ALLOWED_ACTIONS.has(action)) {
              logger.debug(
                `[ActionRouter ${this.nodeId}] Skipping disallowed action: ${action}`
              );
              continue;
            }
            let params = { ...(item.params as Record<string, unknown>) };

            // Cap duration for timeout_message_author
            if (action === "timeout_message_author") {
              let duration = Number(params.duration_seconds ?? params.duration ?? 60);
              if (!Number.isFinite(duration) || duration < 0) duration = 60;
              duration = Math.min(duration, MAX_TIMEOUT_SECONDS);
              params = { ...params, duration_seconds: duration };
            }

            actions.push({ action, params });
          }
        }
      } catch (_e) {
        // Fallback: treat entire response as single reply
        logger.debug(
          `[ActionRouter ${this.nodeId}] No valid JSON actions, using full response as reply`
        );
      }
    }

    if (actions.length === 0 && responseStr) {
      actions = [
        {
          action: "reply",
          params: { text: responseStr },
        },
      ];
    }

    logger.info(
      `[ActionRouter ${this.nodeId}] Parsed ${actions.length} action(s): ${actions.map((a) => a.action).join(", ") || "none"}`
    );

    return { tg_actions: actions };
  }
}
