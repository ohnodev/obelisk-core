/**
 * Tests for the WorkflowRunner – lifecycle management and tick scheduling.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { WorkflowRunner, TickResult } from "../src/core/execution/runner";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { WorkflowData } from "../src/core/types";
import { InferenceClient } from "../src/core/execution/nodes/inference/inferenceClient";

beforeAll(() => {
  registerAllNodes();
});

const simpleWorkflow: WorkflowData = {
  nodes: [{ id: "1", type: "text", inputs: { text: "tick output" } }],
  connections: [],
};

describe("WorkflowRunner", () => {
  let runner: WorkflowRunner;

  beforeAll(() => {
    runner = new WorkflowRunner();
  });

  afterEach(() => {
    // Stop all workflows to clear timers
    for (const id of runner.listWorkflows()) {
      runner.stopWorkflow(id);
    }
  });

  it("should start a workflow and return an ID", () => {
    const id = runner.startWorkflow(simpleWorkflow, {}, 999_999);

    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("should report running state after start", async () => {
    const id = runner.startWorkflow(simpleWorkflow, {}, 999_999);

    // Wait a bit for the first tick to complete
    await new Promise((r) => setTimeout(r, 50));

    const status = runner.getStatus(id);
    expect(status).not.toBeNull();
    expect(status!.state).toBe("running");
    expect(status!.tickCount).toBeGreaterThanOrEqual(1);
    // New fields from Python-compatible status
    expect(status!.nodeCount).toBe(1);
    expect(status!.resultsVersion).toBeGreaterThanOrEqual(1);
    expect(status!.latestResults).not.toBeNull();
  });

  it("should stop a workflow", () => {
    const id = runner.startWorkflow(simpleWorkflow, {}, 999_999);

    const stopped = runner.stopWorkflow(id);
    expect(stopped).toBe(true);

    const status = runner.getStatus(id);
    expect(status!.state).toBe("stopped");
  });

  it("should return false when stopping unknown workflow", () => {
    expect(runner.stopWorkflow("nonexistent")).toBe(false);
  });

  it("should return null status for unknown workflow", () => {
    expect(runner.getStatus("nonexistent")).toBeNull();
  });

  it("should list active workflows", () => {
    const id1 = runner.startWorkflow(simpleWorkflow, {}, 999_999);
    const id2 = runner.startWorkflow(simpleWorkflow, {}, 999_999);

    const list = runner.listWorkflows();
    expect(list).toContain(id1);
    expect(list).toContain(id2);
  });

  it("should invoke onTickComplete callback", async () => {
    const tickResults: TickResult[] = [];

    runner.startWorkflow(
      simpleWorkflow,
      {},
      999_999,
      (result) => tickResults.push(result)
    );

    // Wait for first tick
    await new Promise((r) => setTimeout(r, 100));

    expect(tickResults.length).toBeGreaterThanOrEqual(1);
    expect(tickResults[0].success).toBe(true);
    expect(tickResults[0].tick).toBe(1);
    expect(tickResults[0].executedNodes).toContain("1");
  });

  it("should execute once (no scheduling)", async () => {
    const result = await runner.executeOnce(simpleWorkflow);

    expect(result.success).toBe(true);
    expect(result.finalOutputs.text).toBe("tick output");
  });

  it("should executeOnce with context variables", async () => {
    const workflow: WorkflowData = {
      nodes: [{ id: "1", type: "text", inputs: { text: "{{greeting}}" } }],
      connections: [],
    };

    const result = await runner.executeOnce(workflow, {
      greeting: "Ahoy!",
    });

    expect(result.success).toBe(true);
    expect(result.finalOutputs.text).toBe("Ahoy!");
  });

  it("should executeOnce a full inference workflow (mocked)", async () => {
    const mock = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Runner says hello!",
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
          id: "prompt",
          type: "text",
          inputs: { text: "Say hello" },
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
          source_node: "prompt",
          source_output: "text",
          target_node: "llm",
          target_input: "prompt",
        },
      ],
    };

    const result = await runner.executeOnce(workflow);

    expect(result.success).toBe(true);
    expect(result.finalOutputs.text).toBe("Runner says hello!");

    mock.mockRestore();
  });

  it("should handle cycle errors in executeOnce", async () => {
    const cycleWorkflow: WorkflowData = {
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

    const result = await runner.executeOnce(cycleWorkflow);
    expect(result.success).toBe(false);
    expect(result.error).toContain("cycle");
  });
});
