/**
 * Recent Conversation Buffer – sliding window of recent messages for prompt
 * injection.
 * Mirrors Python src/core/execution/nodes/memory/recent_buffer.py
 *
 * The Python version uses LangChain's InMemoryChatMessageHistory.
 * This TS version keeps it simple: an array of {role, content} messages.
 */

export interface ChatMessage {
  role: "human" | "ai";
  content: string;
}

export class RecentConversationBuffer {
  readonly k: number;
  messages: ChatMessage[] = [];

  constructor(k = 10) {
    const parsed = Number(k);
    this.k = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 10;
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: "human", content });
    this.trim();
  }

  addAiMessage(content: string): void {
    this.messages.push({ role: "ai", content });
    this.trim();
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  clear(): void {
    this.messages = [];
  }

  private trim(): void {
    const maxMessages = this.k * 2;
    if (this.messages.length > maxMessages) {
      this.messages = this.messages.slice(-maxMessages);
    }
  }
}
