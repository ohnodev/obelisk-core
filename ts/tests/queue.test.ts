/**
 * Tests for the job-based ExecutionQueue.
 * Mirrors the Python src/api/queue.py behaviour.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { ExecutionQueue, QueueFullError } from "../src/api/queue";
import { ExecutionEngine } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { GraphExecutionResult } from "../src/core/types";

beforeAll(() => {
  registerAllNodes();
});

/** Helper – minimal frontend-format text workflow */
function textWorkflow(text: string): Record<string, unknown> {
  return {
    nodes: [{ id: "1", type: "text", inputs: { text } }],
    connections: [],
  };
}

describe("ExecutionQueue", () => {
  it("should enqueue a job and return a job object", () => {
    const queue = new ExecutionQueue();
    const job = queue.enqueue(textWorkflow("hello"));

    expect(job.id).toBeDefined();
    // Job may already be "running" since processNext() fires immediately
    expect(["queued", "running"]).toContain(job.status);
    expect(typeof job.createdAt).toBe("number");
  });

  it("should process a job to completion", async () => {
    const queue = new ExecutionQueue();
    const job = queue.enqueue(textWorkflow("hello"));

    // Wait for processing
    await new Promise((r) => setTimeout(r, 100));

    const status = queue.getStatus(job.id);
    expect(status).not.toBeNull();
    expect(status!.status).toBe("completed");
    expect(status!.has_result).toBe(true);

    const result = queue.getResult(job.id);
    expect(result).not.toBeNull();
    expect("results" in result!).toBe(true);
    if ("results" in result!) {
      expect(result.results["1"].outputs.text).toBe("hello");
    }
  });

  it("should process multiple jobs sequentially", async () => {
    const queue = new ExecutionQueue();
    const job1 = queue.enqueue(textWorkflow("first"));
    const job2 = queue.enqueue(textWorkflow("second"));
    const job3 = queue.enqueue(textWorkflow("third"));

    // Wait for all to finish
    await new Promise((r) => setTimeout(r, 300));

    for (const j of [job1, job2, job3]) {
      const status = queue.getStatus(j.id);
      expect(status!.status).toBe("completed");
    }

    const r1 = queue.getResult(job1.id) as any;
    const r2 = queue.getResult(job2.id) as any;
    const r3 = queue.getResult(job3.id) as any;
    expect(r1.results["1"].outputs.text).toBe("first");
    expect(r2.results["1"].outputs.text).toBe("second");
    expect(r3.results["1"].outputs.text).toBe("third");
  });

  it("should reject when queue is full", async () => {
    // Use a controlled promise so we can keep the first job "in flight"
    let resolveFirst!: (v: GraphExecutionResult) => void;
    const blockedPromise = new Promise<GraphExecutionResult>((r) => {
      resolveFirst = r;
    });

    const mock = vi
      .spyOn(ExecutionEngine.prototype, "execute")
      .mockImplementation(() => blockedPromise);

    // maxQueueSize=1 → only 1 pending item allowed in the buffer
    const queue = new ExecutionQueue(1);

    // Job #1: enqueued, immediately starts processing → pending=0
    queue.enqueue(textWorkflow("a"));

    // Job #2: goes into pending (pending=1) since processing is busy
    queue.enqueue(textWorkflow("b"));

    // Job #3: pending=1 >= maxQueueSize=1 → should throw
    expect(() => queue.enqueue(textWorkflow("c"))).toThrow(QueueFullError);
    expect(() => queue.enqueue(textWorkflow("c"))).toThrow("Queue is full");

    // Cleanup
    resolveFirst({
      success: true,
      nodeResults: [],
      finalOutputs: {},
      executionOrder: [],
      totalExecutionTime: 0,
    });

    // Wait for queue to drain
    await new Promise((r) => setTimeout(r, 100));
    mock.mockRestore();
  });

  it("should handle workflow execution errors", async () => {
    const queue = new ExecutionQueue();

    // Cycle workflow → engine returns success: false
    const job = queue.enqueue({
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

    // Wait for processing
    await new Promise((r) => setTimeout(r, 100));

    const status = queue.getStatus(job.id);
    // Cycle workflows return success: false from the engine,
    // so the job should be marked as "failed" with the error preserved
    expect(status!.status).toBe("failed");

    // Queue should still work after error
    const okJob = queue.enqueue(textWorkflow("recovery"));
    await new Promise((r) => setTimeout(r, 100));
    const okResult = queue.getResult(okJob.id) as any;
    expect(okResult.results["1"].outputs.text).toBe("recovery");
  });

  it("should cancel a queued job", async () => {
    // Block processing so jobs stay in pending
    let resolveFirst!: (v: GraphExecutionResult) => void;
    const blockedPromise = new Promise<GraphExecutionResult>((r) => {
      resolveFirst = r;
    });

    const mock = vi
      .spyOn(ExecutionEngine.prototype, "execute")
      .mockImplementation(() => blockedPromise);

    const queue = new ExecutionQueue();

    // Job 1 starts processing
    const job1 = queue.enqueue(textWorkflow("first"));
    // Job 2 stays in pending
    const job2 = queue.enqueue(textWorkflow("second"));

    expect(queue.getJob(job2.id)!.status).toBe("queued");

    const cancelled = queue.cancel(job2.id);
    expect(cancelled).toBe(true);
    expect(queue.getJob(job2.id)!.status).toBe("cancelled");
    expect(queue.size).toBe(0); // pending is now empty

    // Can't cancel a running job
    expect(queue.cancel(job1.id)).toBe(false);

    // Cleanup
    resolveFirst({
      success: true,
      nodeResults: [],
      finalOutputs: {},
      executionOrder: [],
      totalExecutionTime: 0,
    });
    await new Promise((r) => setTimeout(r, 100));
    mock.mockRestore();
  });

  it("should report queue info", () => {
    const queue = new ExecutionQueue();
    const info = queue.getQueueInfo();

    expect(info.queue_length).toBe(0);
    expect(info.current_job).toBeNull();
    expect(info.is_processing).toBe(false);
    expect(info.total_jobs).toBe(0);
  });

  it("should convert frontend connection format", async () => {
    const queue = new ExecutionQueue();

    // Use frontend-style connections (from/to instead of source_node/target_node)
    const job = queue.enqueue({
      nodes: [
        { id: "a", type: "text", inputs: { text: "origin" } },
        { id: "b", type: "text", inputs: {} },
      ],
      connections: [
        {
          from: "a",
          from_output: "text",
          to: "b",
          to_input: "text",
        },
      ],
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = queue.getResult(job.id) as any;
    expect(result.results["b"].outputs.text).toBe("origin");
  });
});
