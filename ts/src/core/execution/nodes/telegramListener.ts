/**
 * TelegramListenerNode – autonomous node that polls Telegram for new messages.
 * Mirrors Python src/core/execution/nodes/telegram_listener.py
 *
 * This is a CONTINUOUS node. The WorkflowRunner calls onTick() every ~100ms;
 * the node respects its own poll_interval to avoid hammering the Telegram API.
 * When new messages arrive they are queued and emitted one-per-tick so each
 * message gets its own full downstream graph execution.
 */
import { BaseNode, ExecutionContext, ExecutionMode } from "../nodeBase";
import { WorkflowData, NodeID } from "../../types";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("telegramListener");

const API_BASE = "https://api.telegram.org/bot";

interface ParsedMessage {
  message: string;
  user_id: string;
  username: string;
  first_name: string;
  chat_id: string;
  chat_type: string;
  chat_title: string;
  message_id: number;
  is_reply_to_bot: boolean;
  is_mention: boolean;
  timestamp: number;
  raw_update: Record<string, unknown>;
}

export class TelegramListenerNode extends BaseNode {
  // ── CONTINUOUS execution mode ──────────────────────────────────────
  static override executionMode = ExecutionMode.CONTINUOUS;

  // ── Instance state (persists across ticks) ─────────────────────────
  private _botToken = "";
  private _pollInterval: number; // seconds
  private _timeout: number; // seconds
  private _lastUpdateId: number | null = null;
  private _lastPollTime = 0;
  private _messageCount = 0;
  private _botInfo: Record<string, unknown> | null = null;
  private _pendingMessages: ParsedMessage[] = [];

  constructor(nodeId: string, nodeData: import("../../types").NodeData) {
    super(nodeId, nodeData);

    const meta = this.metadata;
    this._botToken =
      (this.resolveEnvVar(meta.bot_token) as string) ||
      process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      "";
    this._pollInterval = Number(meta.poll_interval ?? 2);
    this._timeout = Number(meta.timeout ?? 30);

    logger.debug(
      `[TelegramListener ${nodeId}] Initialized: poll_interval=${this._pollInterval}s, timeout=${this._timeout}s`
    );
  }

  // ── initialize() — called once when runner starts the workflow ──────
  override async initialize(
    _workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): Promise<void> {
    // Fetch bot info so onTick can parse mentions / reply detection
    await this._getBotInfo();

    if (!this._botToken) {
      logger.warn("[TelegramListener] No bot_token — node will not poll");
    } else if (this._botInfo) {
      logger.info(
        `[TelegramListener] Ready to poll as @${(this._botInfo as any).username}`
      );
    }

    // Skip all pending updates so the bot only processes NEW messages
    await this._skipOldUpdates();

    // Seed timing so the first poll happens after poll_interval
    this._lastPollTime = Date.now() / 1000;
  }

  // ── execute() — returns current state (no side effects) ────────────
  async execute(_context: ExecutionContext): Promise<Record<string, unknown>> {
    return {
      trigger: false,
      message: "",
      user_id: "",
      username: "",
      chat_id: "",
      message_id: 0,
      is_reply_to_bot: false,
      is_mention: false,
      is_dm: false,
      raw_update: null,
    };
  }

  // ── onTick() — called every ~100ms by WorkflowRunner ──────────────
  async onTick(_context: ExecutionContext): Promise<Record<string, unknown> | null> {
    if (!this._botToken) return null;

    // 1. If we have pending messages from a previous poll, emit one
    if (this._pendingMessages.length) {
      return this._emitNextMessage();
    }

    // 2. Check if poll interval has elapsed
    const now = Date.now() / 1000;
    if (now - this._lastPollTime < this._pollInterval) return null;
    this._lastPollTime = now;

    // 3. Poll Telegram
    const updates = await this._getUpdates();
    if (!updates.length) return null;

    // 4. Parse all updates and queue them
    for (const update of updates) {
      const parsed = this._parseUpdate(update);
      if (parsed && parsed.message) {
        this._pendingMessages.push(parsed);
      }
    }

    if (this._pendingMessages.length) {
      logger.debug(
        `[TelegramListener ${this.nodeId}] Queued ${this._pendingMessages.length} messages for processing`
      );
      return this._emitNextMessage();
    }

    return null;
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Fast-forward past all pending Telegram updates so the bot starts
   * fresh.  Calls getUpdates with offset=-1 to grab only the very
   * latest update, records its update_id, and discards the message.
   */
  private async _skipOldUpdates(): Promise<void> {
    if (!this._botToken) return;

    try {
      const params = new URLSearchParams({
        offset: "-1",
        limit: "1",
        timeout: "0",
      });

      const url = `${API_BASE}${this._botToken}/getUpdates?${params}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const json = (await res.json()) as Record<string, unknown>;

      if (json.ok) {
        const updates = (json.result as Record<string, unknown>[]) ?? [];
        if (updates.length) {
          this._lastUpdateId = updates[updates.length - 1].update_id as number;
          logger.info(
            `[TelegramListener] Skipped old updates, starting after update_id=${this._lastUpdateId}`
          );
        } else {
          logger.info("[TelegramListener] No pending updates, starting fresh");
        }
      } else {
        const desc = (json.description as string) || JSON.stringify(json).slice(0, 300);
        logger.error(
          `[TelegramListener] Failed to skip old updates — API returned ok=false ` +
          `(HTTP ${res.status} ${res.statusText}): ${desc}`
        );
      }
    } catch (err) {
      logger.error(
        `[TelegramListener] Failed to skip old updates: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  private _emitNextMessage(): Record<string, unknown> | null {
    if (!this._pendingMessages.length) return null;
    const parsed = this._pendingMessages.shift()!;
    this._messageCount++;

    logger.info(
      `[TelegramListener ${this.nodeId}] Message #${this._messageCount} ` +
        `from @${parsed.username || parsed.user_id} ` +
        `in ${parsed.chat_type} ${parsed.chat_id}: ` +
        `${parsed.message.slice(0, 50)}...`
    );

    return {
      trigger: true,
      message: parsed.message,
      user_id: parsed.user_id,
      username: parsed.username,
      chat_id: parsed.chat_id,
      message_id: parsed.message_id,
      is_reply_to_bot: parsed.is_reply_to_bot,
      is_mention: parsed.is_mention,
      is_dm: parsed.chat_type === "private",
      raw_update: parsed.raw_update,
    };
  }

  private async _getBotInfo(): Promise<Record<string, unknown> | null> {
    if (this._botInfo) return this._botInfo;
    if (!this._botToken) return null;

    try {
      const res = await fetch(`${API_BASE}${this._botToken}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (json.ok) {
        this._botInfo = json.result as Record<string, unknown>;
        logger.info(
          `[TelegramListener] Bot info: @${(this._botInfo as any).username}`
        );
        return this._botInfo;
      }
    } catch (err) {
      logger.error(
        `[TelegramListener] Failed to get bot info: ${err instanceof Error ? err.message : err}`
      );
    }
    return null;
  }

  private async _getUpdates(): Promise<Record<string, unknown>[]> {
    if (!this._botToken) return [];

    try {
      const params = new URLSearchParams({
        timeout: String(this._timeout),
        allowed_updates: JSON.stringify(["message"]),
        limit: "10",
      });
      if (this._lastUpdateId !== null) {
        params.set("offset", String(this._lastUpdateId + 1));
      }

      const res = await fetch(
        `${API_BASE}${this._botToken}/getUpdates?${params}`,
        { signal: AbortSignal.timeout((this._timeout + 5) * 1000) }
      );
      const json = (await res.json()) as Record<string, unknown>;

      if (!json.ok) {
        logger.error(
          `[TelegramListener] API error: ${JSON.stringify(json).slice(0, 300)}`
        );
        return [];
      }

      const updates = (json.result as Record<string, unknown>[]) ?? [];
      if (updates.length) {
        this._lastUpdateId = Math.max(
          ...updates.map((u) => u.update_id as number)
        );
        logger.debug(
          `[TelegramListener] Got ${updates.length} updates, last_id=${this._lastUpdateId}`
        );
      }
      return updates;
    } catch (err) {
      if ((err as any)?.name === "TimeoutError") {
        logger.debug("[TelegramListener] Poll timeout (normal)");
      } else {
        logger.error(
          `[TelegramListener] Request error: ${err instanceof Error ? err.message : err}`
        );
      }
      return [];
    }
  }

  private _parseUpdate(update: Record<string, unknown>): ParsedMessage | null {
    const message = update.message as Record<string, unknown> | undefined;
    if (!message) return null;

    const text =
      (message.text as string) || (message.caption as string) || "";

    const fromUser = (message.from as Record<string, unknown>) ?? {};
    const userId = String(fromUser.id ?? "");
    const username = (fromUser.username as string) ?? "";
    const firstName = (fromUser.first_name as string) ?? "";

    const chat = (message.chat as Record<string, unknown>) ?? {};
    const chatId = String(chat.id ?? "");
    const chatType = (chat.type as string) ?? "";
    const chatTitle = (chat.title as string) ?? "";

    // Check if reply to bot
    const replyTo = (message.reply_to_message as Record<string, unknown>) ?? {};
    const replyFrom = (replyTo.from as Record<string, unknown>) ?? {};
    const isReplyToBot =
      !!this._botInfo && replyFrom.id === (this._botInfo as any).id;

    // Check if bot is @mentioned
    const botUsername = (this._botInfo as any)?.username ?? "";
    const isMention =
      botUsername ? text.toLowerCase().includes(`@${botUsername}`.toLowerCase()) : false;

    return {
      message: text,
      user_id: userId,
      username,
      first_name: firstName,
      chat_id: chatId,
      chat_type: chatType,
      chat_title: chatTitle,
      message_id: (message.message_id as number) ?? 0,
      is_reply_to_bot: isReplyToBot,
      is_mention: isMention,
      timestamp: (message.date as number) ?? 0,
      raw_update: update,
    };
  }
}
