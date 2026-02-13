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
 * Allowed action types: reply, send_dm, pin_message, timeout_message_author, delete_message,
 * delete_reply_to_message, pin_reply_to_message, timeout_reply_to_author (no message_id — use listener reply_to_message_id).
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { extractJsonFromLlmResponse } from "../../../utils/jsonParser";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("actionRouter");

/**
 * When full JSON parse fails, try to extract the first "text" value from a reply action
 * so we can still send that as the reply instead of raw JSON (handles emojis and escaped quotes).
 */
function extractReplyTextFromJsonLike(raw: string): string | null {
  const textKey = '"text"';
  const idx = raw.indexOf(textKey);
  if (idx < 0) return null;
  const afterKey = raw.slice(idx + textKey.length);
  const colonQuote = afterKey.match(/\s*:\s*"/);
  if (!colonQuote) return null;
  const start = idx + textKey.length + (colonQuote.index ?? 0) + colonQuote[0].length;
  let end = start;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      end = i;
      break;
    }
  }
  if (end <= start) return null;
  const value = raw.slice(start, end);
  try {
    return JSON.parse('"' + value.replace(/"/g, '\\"') + '"') as string;
  } catch {
    return value;
  }
}

const ALLOWED_ACTIONS = new Set([
  "reply",
  "send_message",
  "send_dm",
  "pin_message",
  "timeout_message_author",
  "delete_message",
  "delete_reply_to_message",
  "pin_reply_to_message",
  "timeout_reply_to_author",
  "buy",
  "sell",
]);

const MAX_TIMEOUT_SECONDS = 60;

export interface ActionItem {
  action: string;
  params: Record<string, unknown>;
}

function isActionItem(raw: unknown): raw is ActionItem {
  if (typeof raw !== "object" || raw === null || typeof (raw as ActionItem).action !== "string")
    return false;
  const p = (raw as ActionItem).params;
  return p === undefined || p === null || (typeof p === "object" && p !== null);
}

function normalizeParams(item: ActionItem): Record<string, unknown> {
  const p = item.params;
  return p && typeof p === "object" && p !== null ? { ...p } : {};
}

export class ActionRouterNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const response = this.getInputValue("response", context, "") as string;
    const responseStr = response != null ? String(response).trim() : "";

    let actions: ActionItem[] = [];
    let parsedSuccessfully = false;

    if (responseStr) {
      try {
        // Same JSON parser as BinaryIntent: handles <think>, markdown code blocks, truncated JSON
        const parsed = extractJsonFromLlmResponse(
          responseStr,
          "action_router"
        ) as Record<string, unknown> | unknown[];
        // Accept either { "actions": [ ... ] } or a top-level array [ { "action": "buy", ... }, ... ]
        const rawList = Array.isArray(parsed)
          ? parsed
          : (parsed as Record<string, unknown>)?.actions;
        if (Array.isArray(rawList)) {
          parsedSuccessfully = true;
          for (const item of rawList) {
            if (!isActionItem(item)) continue;
            const action = String(item.action).toLowerCase();
            if (!ALLOWED_ACTIONS.has(action)) {
              logger.debug(
                `[ActionRouter ${this.nodeId}] Skipping disallowed action: ${action}`
              );
              continue;
            }
            let params = normalizeParams(item);

            // Cap duration for timeout_message_author and timeout_reply_to_author
            if (action === "timeout_message_author" || action === "timeout_reply_to_author") {
              let duration = Number(params.duration_seconds ?? params.duration ?? 60);
              if (!Number.isFinite(duration) || duration < 0) duration = 60;
              duration = Math.min(duration, MAX_TIMEOUT_SECONDS);
              params = { ...params, duration_seconds: duration };
            }

            actions.push({ action, params });
          }
        } else {
          parsedSuccessfully = true; // valid JSON but no actions array
        }
      } catch (_e) {
        // Fallback: try to extract reply text from JSON-like string so we don't send raw JSON
        const extracted = extractReplyTextFromJsonLike(responseStr);
        if (extracted != null && extracted.length > 0) {
          actions = [{ action: "send_message", params: { text: extracted } }];
          logger.debug(
            `[ActionRouter ${this.nodeId}] Parse failed; extracted text (${extracted.length} chars), sending as send_message`
          );
        } else if (responseStr.trimStart().startsWith("{")) {
          actions = [
            { action: "send_message", params: { text: "Sorry, I couldn't process that." } },
          ];
          logger.debug(
            `[ActionRouter ${this.nodeId}] Parse failed and no text found; response looks like JSON, sending fallback send_message`
          );
        } else {
          logger.debug(
            `[ActionRouter ${this.nodeId}] No valid JSON actions, using full response as send_message`
          );
        }
      }
    }

// Only send raw response as message when parsing failed. When we parsed successfully
// and got empty actions (e.g. no buy), do not send the raw JSON to the user.
if (actions.length === 0 && responseStr && !parsedSuccessfully) {
  actions = [
    {
      action: "send_message",
      params: { text: responseStr },
    },
  ];
} else if (actions.length > 0) {
      const hasSendMessage = actions.some((a) => a.action === "send_message");
      const hasReply = actions.some((a) => a.action === "reply");
      const onlyTradingActions = actions.every(
        (a) => a.action === "buy" || a.action === "sell"
      );
      // Don't add default message when only buy/sell — buy_notify/sell_notify send the message
      if (!hasSendMessage && !hasReply && !onlyTradingActions) {
        actions.push({ action: "send_message", params: { text: "Done." } });
      }
      // Clanker autotrader: at most one buy and one send_message per run (normalize reply → send_message)
      const buys = actions.filter((a) => a.action === "buy");
      const messages = actions.filter(
        (a) => a.action === "send_message" || a.action === "reply"
      );
      if (buys.length > 1 || messages.length > 1) {
        const oneMessage =
          messages.length > 0
            ? { action: "send_message" as const, params: messages[0].params }
            : null;
        actions = [
          ...(buys.length > 0 ? [buys[0]] : []),
          ...(oneMessage ? [oneMessage] : []),
        ];
        logger.info(
          `[ActionRouter ${this.nodeId}] Capped to 1 buy + 1 send_message (had ${buys.length} buys, ${messages.length} message(s))`
        );
      } else if (messages.length === 1 && messages[0].action === "reply") {
        // Normalize reply to send_message so we never quote-reply
        const idx = actions.findIndex((a) => a === messages[0]);
        if (idx >= 0) actions[idx] = { action: "send_message", params: messages[0].params };
      }
    }

    logger.info(
      `[ActionRouter ${this.nodeId}] Parsed ${actions.length} action(s): ${actions.map((a) => a.action).join(", ") || "none"}`
    );

    return { tg_actions: actions };
  }
}
