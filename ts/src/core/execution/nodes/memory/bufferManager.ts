/**
 * RecentBufferManager – manages per-user RecentConversationBuffer instances.
 * Mirrors Python src/core/execution/nodes/memory/buffer_manager.py
 */
import { RecentConversationBuffer } from "./recentBuffer";
import { StorageInterface, Interaction } from "../../../types";
import { getLogger } from "../../../../utils/logger";

const logger = getLogger("bufferManager");

export class RecentBufferManager {
  private readonly k: number;
  private buffers: Record<string, RecentConversationBuffer> = {};

  constructor(k = 10) {
    const parsed = Number(k);
    this.k = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 10;
  }

  /**
   * Get or create a buffer for a user, loaded from storage.
   */
  async getBuffer(
    userId: string,
    storage: StorageInterface,
    limit?: number
  ): Promise<RecentConversationBuffer> {
    const loadLimit = limit ?? this.k * 2;
    const interactions: Interaction[] = await storage.getUserInteractions(
      userId,
      loadLimit
    );

    logger.debug(
      `[BufferManager] Loading ${interactions.length} interactions for user_id=${userId}, limit=${loadLimit}`
    );

    // Create or clear buffer
    if (!this.buffers[userId]) {
      this.buffers[userId] = new RecentConversationBuffer(this.k);
    } else {
      this.buffers[userId].clear();
    }

    const buffer = this.buffers[userId];

    // Convert interactions to messages (chronological order: oldest → newest)
    let messageCount = 0;
    for (const interaction of interactions) {
      if (interaction.query) {
        buffer.addUserMessage(interaction.query);
        messageCount++;
      }
      if (interaction.response) {
        buffer.addAiMessage(interaction.response);
        messageCount++;
      }
    }

    logger.debug(
      `[BufferManager] Added ${messageCount} messages to buffer for user_id=${userId}`
    );

    return buffer;
  }

  clearBuffer(userId: string): void {
    if (this.buffers[userId]) {
      this.buffers[userId].clear();
      delete this.buffers[userId];
    }
  }

  clearAll(): void {
    for (const userId of Object.keys(this.buffers)) {
      this.clearBuffer(userId);
    }
  }
}
