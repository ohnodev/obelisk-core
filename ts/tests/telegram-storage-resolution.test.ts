/**
 * Unit test: resolve user_id from storage by reply_to_message_id (or username).
 * No inference, no Telegram API — only the storage lookup logic.
 */
import { describe, it, expect } from "vitest";
import type { StorageInterface } from "../src/core/types";
import type { ActivityLog } from "../src/core/types";
import { resolveUserIdFromStorage } from "../src/core/execution/nodes/telegramAction";

function mockStorage(logs: ActivityLog[]): StorageInterface {
  return {
    getActivityLogs: async () => logs,
  } as unknown as StorageInterface;
}

describe("resolveUserIdFromStorage", () => {
  const chatId = "12345";
  const storedMessageId = 999;
  const storedUserId = "888";
  const storedUsername = "alice";

  const oneLog: ActivityLog = {
    type: "telegram_message",
    message: "Hello",
    metadata: {
      chat_id: chatId,
      message_id: storedMessageId,
      user_id: storedUserId,
      username: storedUsername,
    },
  };

  it("resolves user_id by message_id (reply_to_message_id scenario)", async () => {
    const storage = mockStorage([oneLog]);
    const params = { message_id: storedMessageId };
    const result = await resolveUserIdFromStorage(storage, chatId, params);
    expect(result).toBe(storedUserId);
  });

  it("resolves user_id by message_id when message_id is string", async () => {
    const storage = mockStorage([oneLog]);
    const params = { message_id: String(storedMessageId) };
    const result = await resolveUserIdFromStorage(storage, chatId, params);
    expect(result).toBe(storedUserId);
  });

  it("resolves user_id by username", async () => {
    const storage = mockStorage([oneLog]);
    const params = { username: storedUsername };
    const result = await resolveUserIdFromStorage(storage, chatId, params);
    expect(result).toBe(storedUserId);
  });

  it("resolves user_id by username with @ prefix", async () => {
    const storage = mockStorage([oneLog]);
    const params = { username: `@${storedUsername}` };
    const result = await resolveUserIdFromStorage(storage, chatId, params);
    expect(result).toBe(storedUserId);
  });

  it("returns empty string when message_id not in storage", async () => {
    const storage = mockStorage([oneLog]);
    const params = { message_id: 111 };
    const result = await resolveUserIdFromStorage(storage, chatId, params);
    expect(result).toBe("");
  });

  it("returns empty string when chat_id does not match", async () => {
    const storage = mockStorage([oneLog]);
    const params = { message_id: storedMessageId };
    const result = await resolveUserIdFromStorage(storage, "other_chat", params);
    expect(result).toBe("");
  });

  it("returns empty string when storage is undefined", async () => {
    const params = { message_id: storedMessageId };
    const result = await resolveUserIdFromStorage(undefined, chatId, params);
    expect(result).toBe("");
  });

  it("returns empty string when chatId is empty", async () => {
    const storage = mockStorage([oneLog]);
    const params = { message_id: storedMessageId };
    const result = await resolveUserIdFromStorage(storage, "", params);
    expect(result).toBe("");
  });

  it("prefers message_id over username when both present", async () => {
    const storage = mockStorage([oneLog]);
    const params = { message_id: storedMessageId, username: "other" };
    const result = await resolveUserIdFromStorage(storage, chatId, params);
    expect(result).toBe(storedUserId);
  });
});
