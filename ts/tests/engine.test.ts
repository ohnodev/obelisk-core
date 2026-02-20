/**
 * Tests for the ExecutionEngine – topology, DAG execution, and cycle detection.
 * Mirrors the behaviour of Python src/core/execution/engine.py
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

  it("should reject an empty workflow (matches Python validate_graph)", async () => {
    const workflow: WorkflowData = { nodes: [], connections: [] };
    const result = await engine.execute(workflow);
    // Python: "Workflow has no nodes" → validation failure
    expect(result.success).toBe(false);
    expect(result.error).toContain("validation");
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
    expect(result.nodeResults[0].outputs.text).toBe(
      "What is the meaning of life?"
    );
  });

  it("should detect cycles and return error (matches Python)", async () => {
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
    expect(result.error).toContain("ycle"); // "Cycle" or "cycle"
  });

  it("should reject workflows with unknown node types (matches Python validate_graph)", async () => {
    const workflow: WorkflowData = {
      nodes: [
        { id: "1", type: "nonexistent_node_type", inputs: {} },
        { id: "2", type: "text", inputs: { text: "ok" } },
      ],
      connections: [],
    };
    const result = await engine.execute(workflow);
    // Python: "Unknown node type: nonexistent_node_type" → validation failure
    expect(result.success).toBe(false);
    expect(result.error).toContain("validation");
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
    expect(result.nodeResults[2].outputs.text).toBe("first");
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
    expect(result.nodeResults[0].outputs.model).toBeDefined();
  });

  it("should fail validation for unknown node type", async () => {
    const workflow: WorkflowData = {
      nodes: [{ id: "1", type: "unknown_node_type", inputs: {} }],
      connections: [],
    };
    const result = await engine.execute(workflow);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Graph validation failed");
    expect(result.nodeResults).toHaveLength(0);
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

  it("should support initialNodeOutputs for subgraph execution", async () => {
    const workflow: WorkflowData = {
      nodes: [{ id: "downstream", type: "text", inputs: {} }],
      connections: [
        {
          source_node: "upstream", // not in nodes — simulates autonomous source
          source_output: "text",
          target_node: "downstream",
          target_input: "text",
        },
      ],
    };

    // upstream's output is pre-seeded
    const initialOutputs = { upstream: { text: "from autonomous" } };

    const result = await engine.execute(workflow, {}, initialOutputs);
    expect(result.success).toBe(true);
    expect(result.nodeResults[0].outputs.text).toBe("from autonomous");
  });
});
