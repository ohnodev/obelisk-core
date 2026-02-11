/**
 * TelegramActionNode – executes a list of actions via the Telegram Bot API.
 * Consumes the actions array from ActionRouterNode.
 *
 * Inputs:
 *   actions: Array of { action, params } from Action Router (required)
 *   chat_id, message_id, user_id: Context from listener
 *   storage_instance: Used to resolve message_id → author user_id (e.g. timeout_message_author) or username → user_id
 *   reply_to_message_id: When the user replied to a message; used as fallback for delete_message/pin_message/timeout_message_author when model omits message_id
 *   bot_id / bot_token: Same resolution as TelegramBotNode
 *
 * Outputs:
 *   success: Boolean (true if all actions succeeded)
 *   results: Array of { action, success, response? } per action
 *   debug_text: One-line summary string
 *
 * Supported actions: reply, send_dm, pin_message, timeout_message_author, delete_message,
 * delete_reply_to_message, pin_reply_to_message, timeout_reply_to_author (use reply_to_message_id; no message_id in params).
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { getLogger } from "../../../utils/logger";
import type { ActionItem } from "./actionRouter";

const logger = getLogger("telegramAction");

const API_BASE = "https://api.telegram.org/bot";

/**
 * Resolve user_id from storage by message_id (author of that message) or by username.
 * Exported for unit tests. Returns empty string if not found.
 */
export async function resolveUserIdFromStorage(
  storage: StorageInterface | undefined,
  chatId: string,
  params: Record<string, unknown>
): Promise<string> {
  if (!storage || !chatId) return "";
  try {
    const logs = await storage.getActivityLogs("telegram_message", 200);
    const byChat = logs.filter((log) => String(log.metadata?.chat_id ?? "") === String(chatId));

    const byMessageId =
      params.message_id != null
        ? byChat.find((log) => Number(log.metadata?.message_id) === Number(params.message_id))
        : null;
    if (byMessageId?.metadata?.user_id) return String(byMessageId.metadata.user_id);

    const usernameRaw = (params.username as string) ?? "";
    const username = usernameRaw.replace(/^@/, "").toLowerCase();
    if (!username) return "";
    const byUsername = byChat.find((log) => {
      const u = String(log.metadata?.username ?? "").toLowerCase();
      return u === username || u === `@${username}`;
    });
    if (byUsername?.metadata?.user_id) return String(byUsername.metadata.user_id);
  } catch (err) {
    logger.warn(`[TelegramAction] resolveUserIdFromStorage failed: ${err}`);
  }
  return "";
}

interface ActionResult {
  action: string;
  success: boolean;
  response?: Record<string, unknown>;
}

function getActionsArray(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ActionItem =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as ActionItem).action === "string" &&
      typeof (item as ActionItem).params === "object" &&
      (item as ActionItem).params !== null
  );
}

export class TelegramActionNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const actions = getActionsArray(
      this.getInputValue("actions", context, undefined)
    );
    const botToken =
      (this.getInputValue("bot_id", context, undefined) as string) ||
      (this.getInputValue("bot_token", context, undefined) as string) ||
      (this.resolveEnvVar(this.metadata.bot_id) as string) ||
      (this.resolveEnvVar(this.metadata.bot_token) as string) ||
      process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      "";
    const chatId = (this.getInputValue("chat_id", context, undefined) as string) ?? "";
    const messageIdRaw = this.getInputValue("message_id", context, undefined);
    const messageId =
      messageIdRaw != null
        ? typeof messageIdRaw === "number"
          ? messageIdRaw
          : Number(messageIdRaw)
        : undefined;
    const userId = (this.getInputValue("user_id", context, undefined) as string) ?? "";
    const replyToMessageIdRaw = this.getInputValue("reply_to_message_id", context, undefined);
    const replyToMessageId =
      replyToMessageIdRaw != null && replyToMessageIdRaw !== ""
        ? Number(replyToMessageIdRaw)
        : undefined;
    const storage = this.getInputValue("storage_instance", context, undefined) as StorageInterface | undefined;

    if (!botToken) {
      throw new Error(
        `TelegramActionNode ${this.nodeId}: bot_token is required`
      );
    }

    if (actions.length === 0) {
      logger.debug(
        `[TelegramAction ${this.nodeId}] No actions to execute, skipping`
      );
      return {
        success: true,
        results: [],
        debug_text: "success: true, 0 actions",
      };
    }

    const results: ActionResult[] = [];
    let allSuccess = true;
    const deletedInBatch = new Set<number>();

    for (const { action, params } of actions) {
      const result = await this.runAction(
        botToken,
        action,
        params,
        chatId,
        messageId,
        userId,
        Number.isFinite(replyToMessageId) ? replyToMessageId : undefined,
        storage,
        deletedInBatch
      );
      results.push(result);
      if (!result.success) allSuccess = false;
    }

    const debugParts = [
      `success: ${allSuccess}`,
      `${results.length} action(s)`,
      ...results.map((r) => `${r.action}: ${r.success ? "ok" : "fail"}`),
    ];
    const debug_text = debugParts.join(" | ");

    return {
      success: allSuccess,
      results,
      debug_text,
    };
  }

  private async runAction(
    token: string,
    action: string,
    params: Record<string, unknown>,
    chatId: string,
    messageId: number | undefined,
    userId: string,
    replyToMessageId: number | undefined,
    storage: StorageInterface | undefined,
    deletedInBatch?: Set<number>
  ): Promise<ActionResult> {
    try {
      switch (action) {
        case "reply": {
          const text = (params.text as string) ?? "";
          if (!text) {
            logger.debug("[TelegramAction] reply skipped: no text");
            return { action: "reply", success: true };
          }
          const url = `${API_BASE}${token}/sendMessage`;
          const payload: Record<string, unknown> = {
            chat_id: chatId,
            text,
            parse_mode: "HTML",
          };
          // Prefer reply_to_message_id (message user replied to); skip if we already deleted it in this batch
          const preferId =
            replyToMessageId != null && Number.isFinite(replyToMessageId)
              ? replyToMessageId
              : messageId != null && Number.isFinite(messageId)
                ? messageId
                : undefined;
          if (
            preferId != null &&
            !deletedInBatch?.has(preferId)
          ) {
            payload.reply_parameters = { message_id: preferId };
          }
          let data = await this.post(url, payload);
          let ok = (data?.ok as boolean) === true;
          // If reply failed (e.g. "message to be replied not found" — message was deleted), send without reply
          if (!ok && payload.reply_parameters) {
            logger.warn(
              `[TelegramAction] Reply failed (message_id=${preferId}), sending without reply: ${(data?.description as string) ?? ""}`
            );
            delete payload.reply_parameters;
            data = await this.post(url, payload);
            ok = (data?.ok as boolean) === true;
          }
          return { action: "reply", success: ok, response: data };
        }

        case "send_dm": {
          const text = (params.text as string) ?? "";
          let targetUserId = (params.user_id as string) ?? userId;
          if (!targetUserId && (params.username as string)) {
            targetUserId = await this.resolveUserIdFromStorage(storage, chatId, params);
          }
          if (!text || !targetUserId) {
            logger.warn("[TelegramAction] send_dm skipped: missing text or user_id");
            return { action: "send_dm", success: false };
          }
          const url = `${API_BASE}${token}/sendMessage`;
          const payload = {
            chat_id: targetUserId,
            text,
            parse_mode: "HTML",
          };
          const data = await this.post(url, payload);
          const ok = (data?.ok as boolean) === true;
          return { action: "send_dm", success: ok, response: data };
        }

        case "pin_message": {
          const pinMid =
            params.message_id != null ? Number(params.message_id) : replyToMessageId;
          if (chatId === "" || pinMid == null || !Number.isFinite(pinMid)) {
            logger.warn("[TelegramAction] pin_message skipped: missing chat_id or message_id (use reply_to_message_id when user replies to a message)");
            return { action: "pin_message", success: false };
          }
          const url = `${API_BASE}${token}/pinChatMessage`;
          const payload = { chat_id: chatId, message_id: pinMid };
          const data = await this.post(url, payload);
          const ok = (data?.ok as boolean) === true;
          return { action: "pin_message", success: ok, response: data };
        }

        case "timeout_message_author": {
          const timeoutMsgId =
            params.message_id != null ? Number(params.message_id) : replyToMessageId;
          if (chatId === "" || timeoutMsgId == null || !Number.isFinite(timeoutMsgId)) {
            logger.warn("[TelegramAction] timeout_message_author skipped: missing chat_id or message_id (use reply_to_message_id when user replies to a message)");
            return { action: "timeout_message_author", success: false };
          }
          const targetUser = await resolveUserIdFromStorage(storage, chatId, { message_id: timeoutMsgId });
          if (!targetUser) {
            logger.warn("[TelegramAction] timeout_message_author skipped: could not resolve user_id from storage for message_id");
            return { action: "timeout_message_author", success: false };
          }
          const durationSeconds = Math.min(
            Number(params.duration_seconds ?? params.duration ?? 60) || 60,
            60
          );
          const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;
          const url = `${API_BASE}${token}/restrictChatMember`;
          const payload = {
            chat_id: chatId,
            user_id: targetUser,
            permissions: {
              can_send_messages: false,
              can_send_audios: false,
              can_send_documents: false,
              can_send_photos: false,
              can_send_videos: false,
              can_send_video_notes: false,
              can_send_voice_notes: false,
              can_send_polls: false,
              can_send_other_messages: false,
              can_add_web_page_previews: false,
              can_change_info: false,
              can_invite_users: false,
              can_pin_messages: false,
            },
            until_date: untilDate,
          };
          const data = await this.post(url, payload);
          const ok = (data?.ok as boolean) === true;
          return { action: "timeout_message_author", success: ok, response: data };
        }

        case "delete_message": {
          const delMid =
            params.message_id != null ? Number(params.message_id) : replyToMessageId;
          if (chatId === "" || delMid == null || !Number.isFinite(delMid)) {
            logger.warn("[TelegramAction] delete_message skipped: missing chat_id or message_id (use reply_to_message_id when user replies to a message)");
            return { action: "delete_message", success: false };
          }
          const url = `${API_BASE}${token}/deleteMessage`;
          const payload = { chat_id: chatId, message_id: delMid };
          const data = await this.post(url, payload);
          const ok = (data?.ok as boolean) === true;
          if (ok) deletedInBatch?.add(delMid);
          return { action: "delete_message", success: ok, response: data };
        }

        case "delete_reply_to_message": {
          if (chatId === "" || replyToMessageId == null || !Number.isFinite(replyToMessageId)) {
            logger.warn("[TelegramAction] delete_reply_to_message skipped: no reply_to_message_id (user must reply to the message to delete)");
            return { action: "delete_reply_to_message", success: false };
          }
          const url = `${API_BASE}${token}/deleteMessage`;
          const payload = { chat_id: chatId, message_id: replyToMessageId };
          const data = await this.post(url, payload);
          const ok = (data?.ok as boolean) === true;
          if (ok) deletedInBatch?.add(replyToMessageId);
          return { action: "delete_reply_to_message", success: ok, response: data };
        }

        case "pin_reply_to_message": {
          if (chatId === "" || replyToMessageId == null || !Number.isFinite(replyToMessageId)) {
            logger.warn("[TelegramAction] pin_reply_to_message skipped: no reply_to_message_id (user must reply to the message to pin)");
            return { action: "pin_reply_to_message", success: false };
          }
          const url = `${API_BASE}${token}/pinChatMessage`;
          const payload = { chat_id: chatId, message_id: replyToMessageId };
          const data = await this.post(url, payload);
          const ok = (data?.ok as boolean) === true;
          return { action: "pin_reply_to_message", success: ok, response: data };
        }

        case "timeout_reply_to_author": {
          if (chatId === "" || replyToMessageId == null || !Number.isFinite(replyToMessageId)) {
            logger.warn("[TelegramAction] timeout_reply_to_author skipped: no reply_to_message_id (user must reply to the message)");
            return { action: "timeout_reply_to_author", success: false };
          }
          const targetUser = await resolveUserIdFromStorage(storage, chatId, { message_id: replyToMessageId });
          if (!targetUser) {
            logger.warn("[TelegramAction] timeout_reply_to_author skipped: could not resolve user_id from storage for reply_to message");
            return { action: "timeout_reply_to_author", success: false };
          }
          const durationSeconds = Math.min(
            Number(params.duration_seconds ?? params.duration ?? 60) || 60,
            60
          );
          const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;
          const url = `${API_BASE}${token}/restrictChatMember`;
          const payload = {
            chat_id: chatId,
            user_id: targetUser,
            permissions: {
              can_send_messages: false,
              can_send_audios: false,
              can_send_documents: false,
              can_send_photos: false,
              can_send_videos: false,
              can_send_video_notes: false,
              can_send_voice_notes: false,
              can_send_polls: false,
              can_send_other_messages: false,
              can_add_web_page_previews: false,
              can_change_info: false,
              can_invite_users: false,
              can_pin_messages: false,
            },
            until_date: untilDate,
          };
          const data = await this.post(url, payload);
          const ok = (data?.ok as boolean) === true;
          return { action: "timeout_reply_to_author", success: ok, response: data };
        }

        default:
          logger.warn(`[TelegramAction] Unknown action: ${action}`);
          return { action, success: false };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[TelegramAction] ${action} failed: ${msg}`);
      return { action, success: false, response: { error: msg } };
    }
  }

  private async resolveUserIdFromStorage(
    storage: StorageInterface | undefined,
    chatId: string,
    params: Record<string, unknown>
  ): Promise<string> {
    return resolveUserIdFromStorage(storage, chatId, params);
  }

  private async post(
    url: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as Record<string, unknown>;
  }
}
