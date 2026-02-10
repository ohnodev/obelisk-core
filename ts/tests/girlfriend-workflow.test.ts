/**
 * Integration tests for the Aria/Sora "girlfriend" workflow.
 *
 * Verifies:
 * 1. The query saved to MemoryCreator is the raw user message — no system
 *    prompt leakage.
 * 2. Different storage paths keep conversations isolated (no memory
 *    bleeding between characters).
 * 3. The MemorySelector loads the correct conversation context for
 *    each character.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { ExecutionEngine } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { WorkflowData } from "../src/core/types";
import { InferenceClient } from "../src/core/execution/nodes/inference/inferenceClient";
import { LocalJSONStorage } from "../src/storage/localJson";

// ── Setup ──────────────────────────────────────────────────────────────

beforeAll(() => {
  registerAllNodes();
});

const engine = new ExecutionEngine();

// Temporary directory for test storage
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "obelisk-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Build a non-autonomous version of the girlfriend workflow.
 *
 * Replaces the HttpListenerNode (autonomous) with a simple Text node for the
 * user message, and hardcodes a storage path so we can inspect files afterwards.
 *
 * The pipeline mirrors girlfriend.json exactly:
 *   message ──→ MemorySelector ──→ InferenceNode ──→ MemoryCreator
 *                                                 ╰→ (response output)
 */
function buildGirlfriendWorkflow(opts: {
  storagePath: string;
  systemPrompt: string;
  userMessage: string;
  userId?: string;
}): WorkflowData {
  const userId = opts.userId ?? "test-user";

  return {
    id: "test-girlfriend",
    name: "Test Girlfriend Workflow",
    nodes: [
      // Simulated HTTP Listener outputs (using text nodes)
      {
        id: "msg",
        type: "text",
        inputs: { text: opts.userMessage },
      },
      {
        id: "uid",
        type: "text",
        inputs: { text: userId },
      },
      // Inference Config
      {
        id: "config",
        type: "inference_config",
        inputs: {},
        metadata: { use_default: true },
      },
      // Memory Storage
      {
        id: "storage",
        type: "memory_storage",
        inputs: {},
        metadata: {
          storage_path: opts.storagePath,
          storage_type: "local_json",
        },
      },
      // Memory Selector
      {
        id: "mem_sel",
        type: "memory_selector",
        inputs: {},
        metadata: {
          enable_recent_buffer: true,
          k: 10,
        },
      },
      // Inference
      {
        id: "inference",
        type: "inference",
        inputs: {},
        metadata: {
          system_prompt: opts.systemPrompt,
          quantum_influence: 0.7,
          max_length: 1024,
          enable_thinking: false,
        },
      },
      // Memory Creator
      {
        id: "mem_create",
        type: "memory_creator",
        inputs: {},
        metadata: {
          summarize_threshold: 999, // don't trigger summarization in tests
        },
      },
    ],
    connections: [
      // message → MemorySelector.query
      {
        source_node: "msg",
        source_output: "text",
        target_node: "mem_sel",
        target_input: "query",
      },
      // uid → MemorySelector.user_id
      {
        source_node: "uid",
        source_output: "text",
        target_node: "mem_sel",
        target_input: "user_id",
      },
      // config → MemorySelector.model
      {
        source_node: "config",
        source_output: "model",
        target_node: "mem_sel",
        target_input: "model",
      },
      // config → Inference.model
      {
        source_node: "config",
        source_output: "model",
        target_node: "inference",
        target_input: "model",
      },
      // config → MemoryCreator.model
      {
        source_node: "config",
        source_output: "model",
        target_node: "mem_create",
        target_input: "model",
      },
      // storage → MemorySelector.storage_instance
      {
        source_node: "storage",
        source_output: "storage_instance",
        target_node: "mem_sel",
        target_input: "storage_instance",
      },
      // storage → MemoryCreator.storage_instance
      {
        source_node: "storage",
        source_output: "storage_instance",
        target_node: "mem_create",
        target_input: "storage_instance",
      },
      // MemorySelector.query → Inference.query
      {
        source_node: "mem_sel",
        source_output: "query",
        target_node: "inference",
        target_input: "query",
      },
      // MemorySelector.context → Inference.context
      {
        source_node: "mem_sel",
        source_output: "context",
        target_node: "inference",
        target_input: "context",
      },
      // Inference.response → MemoryCreator.response
      {
        source_node: "inference",
        source_output: "response",
        target_node: "mem_create",
        target_input: "response",
      },
      // Raw message → MemoryCreator.query (directly from user, NOT from inference)
      {
        source_node: "msg",
        source_output: "text",
        target_node: "mem_create",
        target_input: "query",
      },
      // uid → MemoryCreator.user_id
      {
        source_node: "uid",
        source_output: "text",
        target_node: "mem_create",
        target_input: "user_id",
      },
    ],
  };
}

/**
 * Read saved interactions from a LocalJSONStorage data directory.
 *
 * Reads ALL JSON files in interactionsDir (sorted for determinism), parses
 * each (handling both array and single-object payloads), and returns the
 * aggregated list of interactions whose user_id === userId.
 */
function readSavedInteractions(storagePath: string, userId: string) {
  const interactionsDir = path.join(storagePath, "memory", "interactions");
  const files = fs.existsSync(interactionsDir)
    ? fs.readdirSync(interactionsDir).filter((f) => f.endsWith(".json")).sort()
    : [];

  const result: any[] = [];

  for (const file of files) {
    const data = JSON.parse(
      fs.readFileSync(path.join(interactionsDir, file), "utf-8")
    );
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.user_id === userId) {
          result.push(item);
        }
      }
    } else if (data && typeof data === "object" && data.user_id === userId) {
      result.push(data);
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────
// 1. Query saved to memory should be the raw user message, NOT the system
//    prompt + user message.
// ────────────────────────────────────────────────────────────────────────

describe("Girlfriend workflow — query storage", () => {
  it("should save the raw user message to memory, not the system prompt", async () => {
    const storagePath = path.join(tmpDir, "aria");
    const userMessage = "Hey Aria, how are you?";
    const systemPrompt =
      "You are Aria — The Playful One. You're energetic, witty, and guaranteed to make people smile.";

    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Hey! I'm doing amazing, thanks for asking! 😜",
        source: "mock",
      });

    const workflow = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage,
    });

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);

    // Check the inference node received the correct query
    const inferenceResult = result.nodeResults.find(
      (r) => r.nodeId === "inference"
    );
    expect(inferenceResult?.outputs.query).toBe(userMessage);
    expect(inferenceResult?.outputs.response).toBe(
      "Hey! I'm doing amazing, thanks for asking! 😜"
    );

    // Verify inference was called with the RAW query (no system prompt in query arg).
    // MemorySelectorNode may also call generate(), so find the specific call
    // whose first argument matches userMessage.
    const generateCall = inferenceGenerate.mock.calls.find(
      (call) => call[0] === userMessage
    );
    expect(generateCall).toBeDefined();

    const queryArg = generateCall![0] as string;
    expect(queryArg).toBe(userMessage);
    expect(queryArg).not.toContain("[Character:");
    expect(queryArg).not.toContain("You are Aria");
    expect(queryArg).not.toContain("User says:");

    // The system prompt should be in the second argument (systemPrompt)
    const systemPromptArg = generateCall![1] as string;
    expect(systemPromptArg).toContain("You are Aria");

    // Check saved interactions in storage
    const interactions = readSavedInteractions(storagePath, "test-user");
    expect(interactions.length).toBe(1);
    expect(interactions[0].query).toBe(userMessage);
    expect(interactions[0].query).not.toContain("[Character:");
    expect(interactions[0].query).not.toContain("You are Aria");
    expect(interactions[0].query).not.toContain("system_prompt");
    expect(interactions[0].response).toBe(
      "Hey! I'm doing amazing, thanks for asking! 😜"
    );
    expect(interactions[0].user_id).toBe("test-user");

    inferenceGenerate.mockRestore();
  });

  it("should preserve the original user message through multiple interactions", async () => {
    const storagePath = path.join(tmpDir, "aria-multi");
    const systemPrompt =
      "You are Aria — The Playful One. Keep responses short.";

    let callCount = 0;
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockImplementation(async () => {
        callCount++;
        return {
          response: `Mock response ${callCount}`,
          source: "mock",
        };
      });

    // First interaction
    const workflow1 = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage: "Hello!",
    });
    const result1 = await engine.execute(workflow1);
    expect(result1.success).toBe(true);

    // Second interaction
    const workflow2 = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage: "What's your favorite color?",
    });
    const result2 = await engine.execute(workflow2);
    expect(result2.success).toBe(true);

    // Third interaction
    const workflow3 = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage: "Tell me a joke",
    });
    const result3 = await engine.execute(workflow3);
    expect(result3.success).toBe(true);

    // Verify all saved interactions have clean queries
    const interactions = readSavedInteractions(storagePath, "test-user");
    expect(interactions.length).toBeGreaterThanOrEqual(3);

    for (const interaction of interactions) {
      // No interaction should contain the system prompt in its query
      expect(interaction.query).not.toContain("[Character:");
      expect(interaction.query).not.toContain("You are Aria");
      expect(interaction.query).not.toContain("system_prompt");
      expect(interaction.query).not.toContain("User says:");
    }

    // Verify the actual queries are the raw messages
    expect(interactions[0].query).toBe("Hello!");
    expect(interactions[1].query).toBe("What's your favorite color?");
    expect(interactions[2].query).toBe("Tell me a joke");

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Memory isolation — different characters on different storage paths
//    should NOT see each other's conversations.
// ────────────────────────────────────────────────────────────────────────

describe("Girlfriend workflow — memory isolation", () => {
  it("should keep Aria and Sora conversations isolated on different storage paths", async () => {
    const ariaStoragePath = path.join(tmpDir, "aria-isolated");
    const soraStoragePath = path.join(tmpDir, "sora-isolated");

    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Mock response",
        source: "mock",
      });

    // Run Aria workflow
    const ariaWorkflow = buildGirlfriendWorkflow({
      storagePath: ariaStoragePath,
      systemPrompt: "You are Aria — The Playful One.",
      userMessage: "Hey Aria!",
      userId: "user-alice",
    });
    const ariaResult = await engine.execute(ariaWorkflow);
    expect(ariaResult.success).toBe(true);

    // Run Sora workflow
    const soraWorkflow = buildGirlfriendWorkflow({
      storagePath: soraStoragePath,
      systemPrompt: "You are Sora — The Elegant One.",
      userMessage: "Hello Sora!",
      userId: "user-alice",
    });
    const soraResult = await engine.execute(soraWorkflow);
    expect(soraResult.success).toBe(true);

    // Verify Aria's storage only contains Aria's conversations
    const ariaInteractions = readSavedInteractions(
      ariaStoragePath,
      "user-alice"
    );
    expect(ariaInteractions.length).toBe(1);
    expect(ariaInteractions[0].query).toBe("Hey Aria!");

    // Verify Sora's storage only contains Sora's conversations
    const soraInteractions = readSavedInteractions(
      soraStoragePath,
      "user-alice"
    );
    expect(soraInteractions.length).toBe(1);
    expect(soraInteractions[0].query).toBe("Hello Sora!");

    inferenceGenerate.mockRestore();
  });

  it("should demonstrate memory bleeding when using the SAME storage path (current bug)", async () => {
    // This test documents the current behaviour: when both characters use the
    // same storage_path, their conversations bleed into each other.
    const sharedStoragePath = path.join(tmpDir, "shared");

    let callCount = 0;
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockImplementation(async () => {
        callCount++;
        return {
          response: `Response ${callCount}`,
          source: "mock",
        };
      });

    // Run Aria workflow with shared storage
    const ariaWorkflow = buildGirlfriendWorkflow({
      storagePath: sharedStoragePath,
      systemPrompt: "You are Aria — The Playful One.",
      userMessage: "Hey Aria!",
      userId: "anonymous", // same user as production
    });
    const ariaResult = await engine.execute(ariaWorkflow);
    expect(ariaResult.success).toBe(true);

    // Run Sora workflow with same shared storage
    const soraWorkflow = buildGirlfriendWorkflow({
      storagePath: sharedStoragePath,
      systemPrompt: "You are Sora — The Elegant One.",
      userMessage: "Hello Sora!",
      userId: "anonymous", // same user as production
    });
    const soraResult = await engine.execute(soraWorkflow);
    expect(soraResult.success).toBe(true);

    // With shared storage, both interactions appear in the same file
    const allInteractions = readSavedInteractions(
      sharedStoragePath,
      "anonymous"
    );
    // Both Aria and Sora messages are in the same storage → memory bleeding
    expect(allInteractions.length).toBe(2);
    expect(allInteractions[0].query).toBe("Hey Aria!");
    expect(allInteractions[1].query).toBe("Hello Sora!");

    // When MemorySelector loads context for the next Sora conversation,
    // it will see Aria's "Hey Aria!" in the history → identity confusion.
    // This is the bug the user observed in production.

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Memory recall — the second message should include the first
//    conversation in the context sent to the LLM.
// ────────────────────────────────────────────────────────────────────────

describe("Girlfriend workflow — memory recall", () => {
  it("should include previous conversation in context on the second message", async () => {
    const storagePath = path.join(tmpDir, "memory-recall");
    const systemPrompt = "You are Aria — The Playful One.";

    let callCount = 0;
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { response: "Ooh green is such a vibe! 💚", source: "mock" };
        }
        return { response: "Your favorite color is green! 💚", source: "mock" };
      });

    // ── Turn 1: tell the agent your favorite color ──────────────────
    const workflow1 = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage: "My favorite color is green",
    });
    const result1 = await engine.execute(workflow1);
    expect(result1.success).toBe(true);

    // Verify first turn was saved to storage
    const interactionsAfterTurn1 = readSavedInteractions(
      storagePath,
      "test-user"
    );
    expect(interactionsAfterTurn1.length).toBe(1);
    expect(interactionsAfterTurn1[0].query).toBe("My favorite color is green");
    expect(interactionsAfterTurn1[0].response).toBe(
      "Ooh green is such a vibe! 💚"
    );

    // Reset call tracking for turn 2
    inferenceGenerate.mockClear();
    callCount = 1; // next call will be callCount=2

    // ── Turn 2: ask if it remembers ─────────────────────────────────
    const workflow2 = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage: "What's my favorite color?",
    });
    const result2 = await engine.execute(workflow2);
    expect(result2.success).toBe(true);

    // Now inspect the generate() calls from turn 2.
    // The MemorySelectorNode loads the buffer from storage, then passes
    // it as context → InferenceNode merges it into the system prompt or
    // conversation_history before calling generate().
    const turn2Calls = inferenceGenerate.mock.calls;

    // Find the inference call (the one with "What's my favorite color?")
    const inferenceCall = turn2Calls.find(
      (c) => c[0] === "What's my favorite color?"
    );
    expect(inferenceCall).toBeDefined();

    // The system prompt (arg 1) should now include the previous
    // conversation from the buffer (merged as chat history).
    const sentSystemPrompt = inferenceCall![1] as string;

    // The conversation history (arg 4) should contain the previous exchange
    const conversationHistory = inferenceCall![4] as
      | Array<Record<string, string>>
      | null;

    // At least ONE of these should contain our previous conversation:
    // Either the system prompt has "Chat History" appended, or
    // conversationHistory has the previous messages.
    const systemPromptHasHistory =
      sentSystemPrompt.includes("My favorite color is green") ||
      sentSystemPrompt.includes("green is such a vibe");
    const historyHasPreviousConvo =
      conversationHistory !== null &&
      conversationHistory !== undefined &&
      conversationHistory.length > 0 &&
      conversationHistory.some(
        (msg) =>
          msg.content?.includes("My favorite color is green") ||
          msg.content?.includes("green is such a vibe")
      );

    expect(systemPromptHasHistory || historyHasPreviousConvo).toBe(true);

    // Verify we can identify which mechanism was used
    if (historyHasPreviousConvo) {
      // conversation_history approach: messages array
      const userMsg = conversationHistory!.find(
        (m) => m.role === "user" && m.content?.includes("favorite color")
      );
      const aiMsg = conversationHistory!.find(
        (m) =>
          m.role === "assistant" && m.content?.includes("green is such a vibe")
      );
      expect(userMsg).toBeDefined();
      expect(aiMsg).toBeDefined();
    }

    if (systemPromptHasHistory) {
      // System prompt approach: chat history appended
      expect(sentSystemPrompt).toContain("You are Aria");
      expect(sentSystemPrompt).toContain("My favorite color is green");
    }

    inferenceGenerate.mockRestore();
  });

  it("should accumulate multiple turns in context", async () => {
    const storagePath = path.join(tmpDir, "multi-recall");
    const systemPrompt = "You are Aria — The Playful One.";

    let callCount = 0;
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockImplementation(async () => {
        callCount++;
        switch (callCount) {
          case 1:
            return { response: "Green, nice! 💚", source: "mock" };
          case 2:
            return { response: "Pizza is the best! 🍕", source: "mock" };
          default:
            return {
              response: "You love green and pizza!",
              source: "mock",
            };
        }
      });

    // Turn 1
    const w1 = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage: "My favorite color is green",
    });
    expect((await engine.execute(w1)).success).toBe(true);

    // Turn 2
    const w2 = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage: "My favorite food is pizza",
    });
    expect((await engine.execute(w2)).success).toBe(true);

    // Reset for turn 3
    inferenceGenerate.mockClear();
    callCount = 2;

    // Turn 3: ask about both
    const w3 = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage: "What are my favorites?",
    });
    const result3 = await engine.execute(w3);
    expect(result3.success).toBe(true);

    // Find the inference call for turn 3
    const turn3Calls = inferenceGenerate.mock.calls;
    const inferenceCall = turn3Calls.find(
      (c) => c[0] === "What are my favorites?"
    );
    expect(inferenceCall).toBeDefined();

    const sentSystemPrompt = inferenceCall![1] as string;
    const conversationHistory = inferenceCall![4] as
      | Array<Record<string, string>>
      | null;

    // Both previous conversations should be present somewhere
    const allContext = [
      sentSystemPrompt,
      ...(conversationHistory?.map((m) => m.content) ?? []),
    ].join("\n");

    expect(allContext).toContain("favorite color is green");
    expect(allContext).toContain("favorite food is pizza");

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. InferenceNode should pass system prompt via the systemPrompt argument
//    to generate(), NOT concatenated into the query.
// ────────────────────────────────────────────────────────────────────────

describe("Girlfriend workflow — inference call signature", () => {
  it("should send system prompt as a separate argument, not embedded in query", async () => {
    const storagePath = path.join(tmpDir, "call-sig");
    const userMessage = "What's up?";
    const systemPrompt = "You are Aria — The Playful One. Be fun and witty.";

    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Not much, just vibing! 😜",
        source: "mock",
      });

    const workflow = buildGirlfriendWorkflow({
      storagePath,
      systemPrompt,
      userMessage,
    });

    const result = await engine.execute(workflow);
    expect(result.success).toBe(true);

    // Find the inference call (not memory selector's call)
    // The inference node's generate() call should have query as first arg
    // and systemPrompt as second arg
    const calls = inferenceGenerate.mock.calls;

    // There should be at least one call (the inference node's call)
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // Check the last call (the actual inference node, not memory selector)
    // The inference node call should have the user message as query
    const inferenceCall = calls.find((c) => c[0] === userMessage);
    expect(inferenceCall).toBeDefined();

    // query (arg 0) should be the raw user message
    expect(inferenceCall![0]).toBe(userMessage);
    expect(inferenceCall![0]).not.toContain(systemPrompt);

    // system_prompt (arg 1) should contain the system prompt
    const sentSystemPrompt = inferenceCall![1] as string;
    expect(sentSystemPrompt).toContain("You are Aria");

    inferenceGenerate.mockRestore();
  });
});
