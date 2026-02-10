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
 */
function readSavedInteractions(storagePath: string, userId: string) {
  const interactionsDir = path.join(storagePath, "memory", "interactions");
  const files = fs.existsSync(interactionsDir)
    ? fs.readdirSync(interactionsDir).filter((f) => f.endsWith(".json"))
    : [];

  for (const file of files) {
    const data = JSON.parse(
      fs.readFileSync(path.join(interactionsDir, file), "utf-8")
    );
    // Check if any interaction belongs to the target user
    if (Array.isArray(data) && data.some((i: any) => i.user_id === userId)) {
      return data;
    }
  }
  return [];
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

    // Verify inference was called with the RAW query (no system prompt in query arg)
    const generateCall = inferenceGenerate.mock.calls[0];
    const queryArg = generateCall[0] as string;
    expect(queryArg).toBe(userMessage);
    expect(queryArg).not.toContain("[Character:");
    expect(queryArg).not.toContain("You are Aria");
    expect(queryArg).not.toContain("User says:");

    // The system prompt should be in the second argument (systemPrompt)
    const systemPromptArg = generateCall[1] as string;
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
// 3. InferenceNode should pass system prompt via the systemPrompt argument
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
