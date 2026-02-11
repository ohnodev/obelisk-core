/**
 * ActionRouterNode – parses LLM response into a list of actions.
 * Abstract: outputs a single list; specific executors (e.g. Telegram Action) handle execution.
 *
 * Inputs:
 *   response: String from Inference node (required)
 *   chat_id, message_id, user_id: Optional context from listener for filling params
 *
 * Outputs:
 *   actions: Array of { action: string, params: Record<string, unknown> }
 *
 * Allowed action types: reply, send_dm, pin_message, timeout, delete_message.
 * If parsing fails or no JSON actions array, fallback: entire response as one reply action.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("actionRouter");

const ALLOWED_ACTIONS = new Set([
  "reply",
  "send_dm",
  "pin_message",
  "timeout",
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
    const chatId = this.getInputValue("chat_id", context, "") as string;
    const messageId = this.getInputValue("message_id", context, undefined) as
      | number
      | string
      | undefined;
    const userId = this.getInputValue("user_id", context, "") as string;
    const replyToMessageIdRaw = this.getInputValue("reply_to_message_id", context, undefined);
    const replyToMessageId = replyToMessageIdRaw != null ? Number(replyToMessageIdRaw) : undefined;
    const replyToUserId = this.getInputValue("reply_to_message_user_id", context, undefined) as string | undefined;

    const responseStr = response != null ? String(response).trim() : "";

    let actions: ActionItem[] = [];

    if (responseStr) {
      try {
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

            // Cap timeout duration to MAX_TIMEOUT_SECONDS
            if (action === "timeout") {
              let duration = Number(params.duration_seconds ?? params.duration ?? 60);
              if (!Number.isFinite(duration) || duration < 0) duration = 60;
              duration = Math.min(duration, MAX_TIMEOUT_SECONDS);
              params = { ...params, duration_seconds: duration };
            }

            // Fill in context where params don't specify (reply-to takes precedence for delete/pin)
            if (action === "pin_message" && params.message_id == null) {
              params.message_id = replyToMessageId ?? (typeof messageId === "number" ? messageId : messageId != null ? Number(messageId) : undefined);
            }
            if (action === "delete_message" && params.message_id == null) {
              params.message_id = replyToMessageId ?? (typeof messageId === "number" ? messageId : messageId != null ? Number(messageId) : undefined);
            }
            if (action === "timeout" && params.user_id == null) {
              params.user_id = replyToUserId ?? userId ?? undefined;
            }
            if (action === "send_dm" && params.user_id == null) {
              params.user_id = replyToUserId ?? userId ?? undefined;
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

    return { actions };
  }
}
