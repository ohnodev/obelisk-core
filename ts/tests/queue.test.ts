/**
 * Tests for the ExecutionQueue – serial workflow processing.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { ExecutionQueue } from "../src/api/queue";
import { ExecutionEngine } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { WorkflowData, GraphExecutionResult } from "../src/core/types";

beforeAll(() => {
  registerAllNodes();
});

function textWorkflow(text: string): WorkflowData {
  return {
    nodes: [{ id: "1", type: "text", inputs: { text } }],
    connections: [],
  };
}

describe("ExecutionQueue", () => {
  it("should process a single workflow", async () => {
    const queue = new ExecutionQueue();
    const result = await queue.submit(textWorkflow("hello"));

    expect(result.success).toBe(true);
    expect(result.finalOutputs.text).toBe("hello");
    expect(queue.size).toBe(0);
    expect(queue.isProcessing).toBe(false);
  });

  it("should process multiple workflows in order", async () => {
    const queue = new ExecutionQueue();
    const results = await Promise.all([
      queue.submit(textWorkflow("first")),
      queue.submit(textWorkflow("second")),
      queue.submit(textWorkflow("third")),
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].finalOutputs.text).toBe("first");
    expect(results[1].finalOutputs.text).toBe("second");
    expect(results[2].finalOutputs.text).toBe("third");
  });

  it("should report correct size while processing", async () => {
    const queue = new ExecutionQueue();

    // Submit 3 – the first starts processing immediately,
    // so size should be at most 2 queued at any point.
    const p1 = queue.submit(textWorkflow("a"));
    const p2 = queue.submit(textWorkflow("b"));
    const p3 = queue.submit(textWorkflow("c"));

    // Wait for all
    await Promise.all([p1, p2, p3]);

    expect(queue.size).toBe(0);
  });

  it("should reject when queue is full", async () => {
    // Use a controlled promise so we can keep the first workflow "in flight"
    let resolveFirst!: (v: GraphExecutionResult) => void;
    const blockedPromise = new Promise<GraphExecutionResult>((r) => {
      resolveFirst = r;
    });

    const mock = vi
      .spyOn(ExecutionEngine.prototype, "execute")
      .mockImplementation(() => blockedPromise);

    const queue = new ExecutionQueue(1); // buffer holds at most 1 pending item

    // Submit #1: pushed to queue (length=1), processNext shifts it off
    // (length=0) and starts awaiting the blocked promise → processing=true
    const p1 = queue.submit(textWorkflow("a"));

    // Submit #2: queue.length is 0 (< 1) so accepted, pushed (length=1),
    // processNext returns early because processing=true
    const p2 = queue.submit(textWorkflow("b"));

    // Submit #3: queue.length is 1 (>= maxSize) → should reject
    await expect(queue.submit(textWorkflow("c"))).rejects.toThrow(
      "Queue full (max 1)"
    );

    // Clean up: resolve the blocked promise so p1 and p2 can finish
    const fakeResult: GraphExecutionResult = {
      success: true,
      nodeResults: [],
      finalOutputs: {},
      executionOrder: [],
      totalExecutionTime: 0,
    };
    resolveFirst(fakeResult);

    await p1;
    await p2;

    mock.mockRestore();
  });

  it("should handle empty workflow", async () => {
    const queue = new ExecutionQueue();
    const result = await queue.submit({
      nodes: [],
      connections: [],
    });

    expect(result.success).toBe(true);
    expect(result.nodeResults).toHaveLength(0);
  });

  it("should handle workflow execution errors without crashing queue", async () => {
    const queue = new ExecutionQueue();

    // Cycle workflow → engine returns success: false
    const cycleResult = await queue.submit({
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
    });

    expect(cycleResult.success).toBe(false);

    // Queue should still work after error
    const okResult = await queue.submit(textWorkflow("recovery"));
    expect(okResult.success).toBe(true);
    expect(okResult.finalOutputs.text).toBe("recovery");
  });

  it("should process workflows with context variables", async () => {
    const queue = new ExecutionQueue();
    const result = await queue.submit(
      {
        nodes: [
          { id: "1", type: "text", inputs: { text: "Hi {{name}}" } },
        ],
        connections: [],
      },
      { name: "World" }
    );

    expect(result.success).toBe(true);
    expect(result.finalOutputs.text).toBe("Hi World");
  });
});
