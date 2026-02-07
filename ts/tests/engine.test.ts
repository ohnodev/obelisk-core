/**
 * Tests for the ExecutionEngine – topology, DAG execution, and cycle detection.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ExecutionEngine, CycleError } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { WorkflowData } from "../src/core/types";

beforeAll(() => {
  registerAllNodes();
});

describe("ExecutionEngine", () => {
  const engine = new ExecutionEngine();

  it("should execute an empty workflow", async () => {
    const workflow: WorkflowData = { nodes: [], connections: [] };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(true);
    expect(result.nodeResults).toEqual([]);
    expect(result.executionOrder).toEqual([]);
  });

  it("should execute a single TextNode", async () => {
    const workflow: WorkflowData = {
      nodes: [
        {
          id: "1",
          type: "text",
          inputs: { text: "hello world" },
        },
      ],
      connections: [],
    };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(true);
    expect(result.nodeResults).toHaveLength(1);
    expect(result.nodeResults[0].outputs.text).toBe("hello world");
    expect(result.finalOutputs.text).toBe("hello world");
  });

  it("should chain two TextNodes via a connection", async () => {
    const workflow: WorkflowData = {
      nodes: [
        { id: "1", type: "text", inputs: { text: "upstream" } },
        { id: "2", type: "text", inputs: {} },
      ],
      connections: [
        {
          source_node: "1",
          source_output: "text",
          target_node: "2",
          target_input: "text",
        },
      ],
    };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(true);
    expect(result.executionOrder).toEqual(["1", "2"]);
    // Node 2 receives "upstream" from node 1
    expect(result.nodeResults[1].outputs.text).toBe("upstream");
    // Only node 2 is terminal
    expect(result.finalOutputs.text).toBe("upstream");
  });

  it("should resolve {{template}} variables from context", async () => {
    const workflow: WorkflowData = {
      nodes: [
        { id: "1", type: "text", inputs: { text: "{{user_query}}" } },
      ],
      connections: [],
    };
    const result = await engine.execute(workflow, {
      user_query: "What is the meaning of life?",
    });
    expect(result.success).toBe(true);
    expect(result.finalOutputs.text).toBe("What is the meaning of life?");
  });

  it("should detect cycles and throw CycleError", async () => {
    const workflow: WorkflowData = {
      nodes: [
        { id: "1", type: "text", inputs: {} },
        { id: "2", type: "text", inputs: {} },
      ],
      connections: [
        {
          source_node: "1",
          source_output: "text",
          target_node: "2",
          target_input: "text",
        },
        {
          source_node: "2",
          source_output: "text",
          target_node: "1",
          target_input: "text",
        },
      ],
    };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(false);
    expect(result.error).toContain("cycle");
  });

  it("should skip unknown node types gracefully", async () => {
    const workflow: WorkflowData = {
      nodes: [
        { id: "1", type: "nonexistent_node_type", inputs: {} },
        { id: "2", type: "text", inputs: { text: "ok" } },
      ],
      connections: [],
    };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(true);
    // Only the valid text node should execute
    expect(result.nodeResults).toHaveLength(1);
    expect(result.finalOutputs.text).toBe("ok");
  });

  it("should execute a three-node linear chain in order", async () => {
    const workflow: WorkflowData = {
      nodes: [
        { id: "a", type: "text", inputs: { text: "first" } },
        { id: "b", type: "text", inputs: {} },
        { id: "c", type: "text", inputs: {} },
      ],
      connections: [
        {
          source_node: "a",
          source_output: "text",
          target_node: "b",
          target_input: "text",
        },
        {
          source_node: "b",
          source_output: "text",
          target_node: "c",
          target_input: "text",
        },
      ],
    };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(true);
    expect(result.executionOrder).toEqual(["a", "b", "c"]);
    // The value propagates through the chain
    expect(result.finalOutputs.text).toBe("first");
  });

  it("should handle InferenceConfigNode creating a client", async () => {
    const workflow: WorkflowData = {
      nodes: [
        {
          id: "1",
          type: "inference_config",
          inputs: {},
          metadata: { use_default: true },
        },
      ],
      connections: [],
    };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(true);
    expect(result.finalOutputs.model).toBeDefined();
  });

  it("should handle LoRA stub throwing an error", async () => {
    const workflow: WorkflowData = {
      nodes: [{ id: "1", type: "lora_loader", inputs: {} }],
      connections: [],
    };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(false); // Node failure propagates to overall result
    expect(result.nodeResults[0].success).toBe(false);
    expect(result.nodeResults[0].error).toContain("not supported");
  });

  it("should measure execution time", async () => {
    const workflow: WorkflowData = {
      nodes: [{ id: "1", type: "text", inputs: { text: "timing" } }],
      connections: [],
    };
    const result = await engine.execute(workflow);
    expect(result.totalExecutionTime).toBeGreaterThanOrEqual(0);
    expect(result.nodeResults[0].executionTime).toBeGreaterThanOrEqual(0);
  });
});
