/**
 * Tests for the WorkflowRunner – lifecycle management and tick scheduling.
 * Mirrors the behaviour of Python src/core/execution/runner.py
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { WorkflowRunner, TickResult, WorkflowLimitError } from "../src/core/execution/runner";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { WorkflowData } from "../src/core/types";
import { InferenceClient } from "../src/core/execution/nodes/inference/inferenceClient";

beforeAll(() => {
  registerAllNodes();
});

/** Simple workflow with no autonomous nodes — used for executeOnce tests */
const simpleWorkflow: WorkflowData = {
  id: "test-simple",
  nodes: [{ id: "1", type: "text", inputs: { text: "tick output" } }],
  connections: [],
};

/**
 * Workflow with a scheduler (autonomous) node.
 * This will be tracked as "running" in the runner.
 * Short interval so tests don't hang.
 */
const schedulerWorkflow: WorkflowData = {
  id: "test-scheduler",
  nodes: [
    {
      id: "sched",
      type: "scheduler",
      inputs: {},
      metadata: { min_seconds: 0.1, max_seconds: 0.2, enabled: true },
    },
    { id: "text", type: "text", inputs: { text: "triggered" } },
  ],
  connections: [
    {
      source_node: "sched",
      source_output: "trigger",
      target_node: "text",
      target_input: "trigger",
    },
  ],
};

describe("WorkflowRunner", () => {
  let runner: WorkflowRunner;

  beforeAll(() => {
    runner = new WorkflowRunner();
  });

  afterEach(() => {
    // Stop all workflows to clear timers
    runner.stopAll();
  });

  // ── Start / Stop ─────────────────────────────────────────────────

  it("should start a workflow and return its ID", () => {
    const id = runner.startWorkflow(schedulerWorkflow);

    expect(id).toBe("test-scheduler"); // uses workflow.id, not UUID
    expect(typeof id).toBe("string");
  });

  it("should return existing ID if workflow is already running (matches Python)", () => {
    const id1 = runner.startWorkflow(schedulerWorkflow);
    const id2 = runner.startWorkflow(schedulerWorkflow);

    expect(id1).toBe(id2); // same workflow — Python returns existing
  });

  it("should report running state after start", () => {
    const id = runner.startWorkflow(schedulerWorkflow);

    const status = runner.getStatus(id);
    expect(status).not.toBeNull();
    expect(status!.state).toBe("running");
    expect(status!.node_count).toBe(2); // sched + text
  });

  it("should stop a workflow", () => {
    const id = runner.startWorkflow(schedulerWorkflow);

    const stopped = runner.stopWorkflow(id);
    expect(stopped).toBe(true);

    // After stop, workflow is deleted (matches Python: del self._running_workflows[id])
    const status = runner.getStatus(id);
    expect(status).toBeNull();
  });

  it("should return false when stopping unknown workflow", () => {
    expect(runner.stopWorkflow("nonexistent")).toBe(false);
  });

  it("should return null status for unknown workflow", () => {
    expect(runner.getStatus("nonexistent")).toBeNull();
  });

  it("should list active workflows", () => {
    // Use different workflow IDs so both are tracked
    const w1: WorkflowData = { ...schedulerWorkflow, id: "sched-1" };
    const w2: WorkflowData = { ...schedulerWorkflow, id: "sched-2" };

    const id1 = runner.startWorkflow(w1);
    const id2 = runner.startWorkflow(w2);

    const list = runner.listWorkflows();
    expect(list).toContain(id1);
    expect(list).toContain(id2);
  });

  it("should stop all workflows", () => {
    const w1: WorkflowData = { ...schedulerWorkflow, id: "stop-all-1" };
    const w2: WorkflowData = { ...schedulerWorkflow, id: "stop-all-2" };

    runner.startWorkflow(w1);
    runner.startWorkflow(w2);
    expect(runner.listWorkflows().length).toBe(2);

    runner.stopAll();
    expect(runner.listWorkflows().length).toBe(0);
  });

  // ── Execute once (no scheduling) ──────────────────────────────────

  it("should execute once for workflow with no autonomous nodes", async () => {
    const result = await runner.executeOnce(simpleWorkflow);

    expect(result.success).toBe(true);
    expect(result.nodeResults[0].outputs.text).toBe("tick output");
  });

  it("should executeOnce with context variables", async () => {
    const workflow: WorkflowData = {
      id: "ctx-var-test",
      nodes: [{ id: "1", type: "text", inputs: { text: "{{greeting}}" } }],
      connections: [],
    };

    const result = await runner.executeOnce(workflow, {
      greeting: "Ahoy!",
    });

    expect(result.success).toBe(true);
    expect(result.nodeResults[0].outputs.text).toBe("Ahoy!");
  });

  it("should executeOnce a full inference workflow (mocked)", async () => {
    const mock = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Runner says hello!",
        source: "mock",
      });

    const workflow: WorkflowData = {
      id: "mock-inference",
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

    const result = await runner.executeOnce(workflow);

    expect(result.success).toBe(true);
    // LLM is terminal node — check nodeResults
    const llmResult = result.nodeResults.find((r) => r.nodeId === "llm");
    expect(llmResult?.outputs.response).toBe("Runner says hello!");

    mock.mockRestore();
  });

  it("should handle cycle errors in executeOnce", async () => {
    const cycleWorkflow: WorkflowData = {
      id: "cycle-test",
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
    expect(result.error).toContain("ycle"); // "Cycle" or "cycle"
  });

  // ── Non-autonomous workflow: executed once, not tracked ────────────

  it("should execute non-autonomous workflow once and not track it", () => {
    const id = runner.startWorkflow(simpleWorkflow);

    expect(id).toBe("test-simple");
    // Not tracked as running (matches Python behaviour: no autonomous nodes → execute once)
    expect(runner.listWorkflows()).not.toContain(id);
    expect(runner.getStatus(id)).toBeNull();
  });

  // ── Tick loop ─────────────────────────────────────────────────────

  it("should tick and update lastTickTime", async () => {
    const id = runner.startWorkflow(schedulerWorkflow);

    // Wait for a couple ticks (100ms each)
    await new Promise((r) => setTimeout(r, 250));

    const status = runner.getStatus(id);
    expect(status).not.toBeNull();
    expect(status!.tick_count).toBeGreaterThan(0);
    expect(status!.last_tick_time).toBeGreaterThan(0);
  });
});
