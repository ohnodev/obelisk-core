/**
 * Integration tests for full workflow execution.
 *
 * These tests build realistic multi-node workflows and mock the inference
 * service so we can verify the entire pipeline end-to-end without a live LLM.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { ExecutionEngine } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { WorkflowData } from "../src/core/types";
import { InferenceClient } from "../src/core/execution/nodes/inference/inferenceClient";

// ── Helper: build a mock InferenceClient ───────────────────────────────

function mockInferenceClient(
  responseText: string,
  opts?: { thinkingContent?: string; error?: string }
): InferenceClient {
  const client = new InferenceClient({ endpointUrl: "http://mock:0" });
  vi.spyOn(client, "generate").mockResolvedValue({
    response: responseText,
    thinkingContent: opts?.thinkingContent,
    source: "mock",
    error: opts?.error,
  });
  return client;
}

beforeAll(() => {
  registerAllNodes();
});

const engine = new ExecutionEngine();

// ────────────────────────────────────────────────────────────────────────
// 1. Simple chat workflow:  InferenceConfig → Text (system) + Text (query) → Inference
// ────────────────────────────────────────────────────────────────────────

describe("Simple chat workflow", () => {
  it("should pipe a prompt through inference and return text", async () => {
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Hello! I'm Obelisk.",
        thinkingContent: "Let me think...",
        source: "mock",
      });

    const workflow: WorkflowData = {
      nodes: [
        {
          id: "config",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
        {
          id: "system",
          type: "text",
          inputs: { text: "You are a helpful assistant." },
        },
        {
          id: "query",
          type: "text",
          inputs: { text: "Hello, who are you?" },
        },
        {
          id: "llm",
          type: "inference",
          inputs: {},
        },
      ],
      connections: [
        {
          source_node: "config",
          source_output: "model",
          target_node: "llm",
          target_input: "model",
        },
        {
          source_node: "system",
          source_output: "text",
          target_node: "llm",
          target_input: "system_prompt",
        },
        {
          source_node: "query",
          source_output: "text",
          target_node: "llm",
          target_input: "query",
        },
      ],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    expect(result.executionOrder).toHaveLength(4);
    // Check inference node output via nodeResults
    const llmResult = result.nodeResults.find((r) => r.nodeId === "llm");
    expect(llmResult?.outputs.response).toBe("Hello! I'm Obelisk.");

    // Verify the inference client was called with the query
    expect(inferenceGenerate).toHaveBeenCalled();
    const callArgs = inferenceGenerate.mock.calls[0];
    expect(callArgs[0]).toBe("Hello, who are you?");

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Prompt with template variables from context
// ────────────────────────────────────────────────────────────────────────

describe("Template-variable workflow", () => {
  it("should inject user_query into the prompt and run inference", async () => {
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "42 is the answer.",
        source: "mock",
      });

    const workflow: WorkflowData = {
      nodes: [
        {
          id: "config",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
        {
          id: "system",
          type: "text",
          inputs: { text: "You are a helpful assistant." },
        },
        {
          id: "query",
          type: "text",
          inputs: { text: "User asks: {{user_query}}" },
        },
        {
          id: "llm",
          type: "inference",
          inputs: {},
        },
      ],
      connections: [
        {
          source_node: "config",
          source_output: "model",
          target_node: "llm",
          target_input: "model",
        },
        {
          source_node: "system",
          source_output: "text",
          target_node: "llm",
          target_input: "system_prompt",
        },
        {
          source_node: "query",
          source_output: "text",
          target_node: "llm",
          target_input: "query",
        },
      ],
    };

    const result = await engine.execute(workflow, {
      user_query: "What is the meaning of life?",
    });

    expect(result.success).toBe(true);
    // Check inference node output via nodeResults
    const llmResult = result.nodeResults.find((r) => r.nodeId === "llm");
    expect(llmResult?.outputs.response).toBe("42 is the answer.");

    // The prompt should have resolved the template
    const callArgs = inferenceGenerate.mock.calls[0];
    expect(callArgs[0]).toBe("User asks: What is the meaning of life?");

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Binary intent classification
// ────────────────────────────────────────────────────────────────────────

describe("Binary intent workflow", () => {
  it("should classify a message and return true/false + reasoning", async () => {
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: '{"result": true, "confidence": "high", "reasoning": "User is asking a direct question"}',
        source: "mock",
      });

    const workflow: WorkflowData = {
      nodes: [
        {
          id: "config",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
        {
          id: "msg",
          type: "text",
          inputs: { text: "Hey, can you help me with something?" },
        },
        {
          id: "intent",
          type: "binary_intent",
          inputs: {},
          metadata: {
            intent_criteria: "Does this message require a response?",
          },
        },
      ],
      connections: [
        {
          source_node: "config",
          source_output: "model",
          target_node: "intent",
          target_input: "model",
        },
        {
          source_node: "msg",
          source_output: "text",
          target_node: "intent",
          target_input: "message",
        },
      ],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    // Check binary_intent node output via nodeResults
    const intentResult = result.nodeResults.find((r) => r.nodeId === "intent");
    expect(intentResult?.outputs.result).toBe(true);
    expect(intentResult?.outputs.reasoning).toBe(
      "User is asking a direct question"
    );
    // When intent is true, the original message is passed through
    expect(intentResult?.outputs.message).toBe(
      "Hey, can you help me with something?"
    );

    inferenceGenerate.mockRestore();
  });

  it("should return false and null message when intent is negative", async () => {
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: '{"result": false, "confidence": "high", "reasoning": "Just a greeting"}',
        source: "mock",
      });

    const workflow: WorkflowData = {
      nodes: [
        {
          id: "config",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
        {
          id: "msg",
          type: "text",
          inputs: { text: "Hi there" },
        },
        {
          id: "intent",
          type: "binary_intent",
          inputs: {},
          metadata: {
            intent_criteria: "Is the user asking a complex question?",
          },
        },
      ],
      connections: [
        {
          source_node: "config",
          source_output: "model",
          target_node: "intent",
          target_input: "model",
        },
        {
          source_node: "msg",
          source_output: "text",
          target_node: "intent",
          target_input: "message",
        },
      ],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    // Check binary_intent node output via nodeResults
    const intentResult = result.nodeResults.find((r) => r.nodeId === "intent");
    expect(intentResult?.outputs.result).toBe(false);
    expect(intentResult?.outputs.message).toBeNull();

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Diamond DAG – two source nodes merge into one inference node
// ────────────────────────────────────────────────────────────────────────

describe("Diamond DAG workflow", () => {
  it("should merge outputs from two upstream nodes into inference", async () => {
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Combined result",
        source: "mock",
      });

    const workflow: WorkflowData = {
      nodes: [
        {
          id: "config",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
        {
          id: "system",
          type: "text",
          inputs: { text: "You are a helpful assistant." },
        },
        {
          id: "user_q",
          type: "text",
          inputs: { text: "Explain quantum physics." },
        },
        {
          id: "llm",
          type: "inference",
          inputs: {},
        },
      ],
      connections: [
        {
          source_node: "config",
          source_output: "model",
          target_node: "llm",
          target_input: "model",
        },
        {
          source_node: "system",
          source_output: "text",
          target_node: "llm",
          target_input: "system_prompt",
        },
        {
          source_node: "user_q",
          source_output: "text",
          target_node: "llm",
          target_input: "query",
        },
      ],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    // Check inference node output via nodeResults
    const llmResult = result.nodeResults.find((r) => r.nodeId === "llm");
    expect(llmResult?.outputs.response).toBe("Combined result");
    // Verify execution order: config and system first, then llm
    const llmIdx = result.executionOrder!.indexOf("llm");
    const configIdx = result.executionOrder!.indexOf("config");
    const systemIdx = result.executionOrder!.indexOf("system");
    expect(llmIdx).toBeGreaterThan(configIdx);
    expect(llmIdx).toBeGreaterThan(systemIdx);

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Inference with empty query → should return gracefully
// ────────────────────────────────────────────────────────────────────────

describe("Empty prompt handling", () => {
  it("should return empty response when inference gets no query", async () => {
    const workflow: WorkflowData = {
      nodes: [
        {
          id: "config",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
        {
          id: "llm",
          type: "inference",
          inputs: {},
        },
      ],
      connections: [
        {
          source_node: "config",
          source_output: "model",
          target_node: "llm",
          target_input: "model",
        },
      ],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    // Empty query returns early with empty response (matches Python)
    const llmResult = result.nodeResults.find((r) => r.nodeId === "llm");
    expect(llmResult?.outputs.response).toBe("");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6. Missing model → inference node should fail but not crash engine
// ────────────────────────────────────────────────────────────────────────

describe("Missing model error handling", () => {
  it("should report error when inference node has no model input", async () => {
    const workflow: WorkflowData = {
      nodes: [
        {
          id: "system",
          type: "text",
          inputs: { text: "You are helpful." },
        },
        {
          id: "query_node",
          type: "text",
          inputs: { text: "Hello" },
        },
        {
          id: "llm",
          type: "inference",
          inputs: {},
        },
      ],
      connections: [
        {
          source_node: "system",
          source_output: "text",
          target_node: "llm",
          target_input: "system_prompt",
        },
        {
          source_node: "query_node",
          source_output: "text",
          target_node: "llm",
          target_input: "query",
        },
      ],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(false); // Node failure propagates to overall result
    // The inference node should have failed
    const llmResult = result.nodeResults.find((r) => r.nodeId === "llm");
    expect(llmResult?.success).toBe(false);
    expect(llmResult?.error).toContain("model");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 7. Inference error propagation
// ────────────────────────────────────────────────────────────────────────

describe("Inference error propagation", () => {
  it("should handle inference service errors gracefully", async () => {
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "",
        source: "mock",
        error: "Connection refused",
      });

    const workflow: WorkflowData = {
      nodes: [
        {
          id: "config",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
        {
          id: "system",
          type: "text",
          inputs: { text: "You are a helpful assistant." },
        },
        {
          id: "query_node",
          type: "text",
          inputs: { text: "Hello" },
        },
        {
          id: "llm",
          type: "inference",
          inputs: {},
        },
      ],
      connections: [
        {
          source_node: "config",
          source_output: "model",
          target_node: "llm",
          target_input: "model",
        },
        {
          source_node: "system",
          source_output: "text",
          target_node: "llm",
          target_input: "system_prompt",
        },
        {
          source_node: "query_node",
          source_output: "text",
          target_node: "llm",
          target_input: "query",
        },
      ],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    // The node succeeded (no throw), but response is empty
    const llmResult = result.nodeResults.find((r) => r.nodeId === "llm");
    expect(llmResult?.success).toBe(true);
    expect(llmResult?.outputs.response).toBe("");

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 8. Multi-step chain: Text → Inference → BinaryIntent
// ────────────────────────────────────────────────────────────────────────

describe("Multi-step chain: inference then intent classification", () => {
  it("should chain inference output into binary intent", async () => {
    let callCount = 0;
    const inferenceGenerate = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: inference node
          return {
            response: "Yes, I can definitely help you with that!",
            source: "mock",
          };
        }
        // Second call: binary intent node
        return {
          response: '{"result": true, "confidence": "high", "reasoning": "Affirmative response"}',
          source: "mock",
        };
      });

    const workflow: WorkflowData = {
      nodes: [
        {
          id: "config",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
        {
          id: "system",
          type: "text",
          inputs: { text: "You are a helpful assistant." },
        },
        {
          id: "query_node",
          type: "text",
          inputs: { text: "Can you help me?" },
        },
        {
          id: "llm",
          type: "inference",
          inputs: {},
        },
        {
          id: "intent",
          type: "binary_intent",
          inputs: {},
          metadata: {
            intent_criteria:
              "Does this response indicate willingness to help?",
          },
        },
      ],
      connections: [
        {
          source_node: "config",
          source_output: "model",
          target_node: "llm",
          target_input: "model",
        },
        {
          source_node: "config",
          source_output: "model",
          target_node: "intent",
          target_input: "model",
        },
        {
          source_node: "system",
          source_output: "text",
          target_node: "llm",
          target_input: "system_prompt",
        },
        {
          source_node: "query_node",
          source_output: "text",
          target_node: "llm",
          target_input: "query",
        },
        {
          source_node: "llm",
          source_output: "response",
          target_node: "intent",
          target_input: "message",
        },
      ],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    // Check binary_intent node output via nodeResults
    const intentResult = result.nodeResults.find((r) => r.nodeId === "intent");
    expect(intentResult?.outputs.result).toBe(true);
    expect(intentResult?.outputs.reasoning).toBe("Affirmative response");

    // Verify two generate() calls happened (one for inference, one for intent)
    expect(inferenceGenerate).toHaveBeenCalledTimes(2);

    inferenceGenerate.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 9. Parallel source nodes feeding into one target
// ────────────────────────────────────────────────────────────────────────

describe("Parallel sources", () => {
  it("should correctly wire multiple independent chains", async () => {
    const workflow: WorkflowData = {
      nodes: [
        { id: "a", type: "text", inputs: { text: "alpha" } },
        { id: "b", type: "text", inputs: { text: "beta" } },
        { id: "c", type: "text", inputs: { text: "gamma" } },
      ],
      connections: [],
    };

    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    expect(result.executionOrder).toHaveLength(3);
    // All three nodes executed successfully (no output_text nodes → finalOutputs is empty)
    expect(result.nodeResults).toHaveLength(3);
    expect(result.nodeResults[2].outputs.text).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 10. Large linear chain (stress test)
// ────────────────────────────────────────────────────────────────────────

describe("Large linear chain", () => {
  it("should handle a chain of 20 text nodes", async () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "text",
      inputs: i === 0 ? { text: "start" } : {},
    }));

    const connections = Array.from({ length: 19 }, (_, i) => ({
      source_node: `n${i}`,
      source_output: "text",
      target_node: `n${i + 1}`,
      target_input: "text",
    }));

    const workflow: WorkflowData = { nodes, connections };
    const result = await engine.execute(workflow);

    expect(result.success).toBe(true);
    expect(result.executionOrder).toHaveLength(20);
    expect(result.executionOrder![0]).toBe("n0");
    expect(result.executionOrder![19]).toBe("n19");
    // The value should propagate all the way through (check last node's output)
    const lastNodeResult = result.nodeResults.find((r) => r.nodeId === "n19");
    expect(lastNodeResult?.outputs.text).toBe("start");
  });
});
