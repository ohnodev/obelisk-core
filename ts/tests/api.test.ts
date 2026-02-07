/**
 * API endpoint tests using supertest.
 *
 * Tests the Express server's /health, /, /api/v1/workflow/*, and /api/v1/queue/*
 * endpoints without starting a real HTTP listener.
 *
 * Route structure mirrors Python FastAPI: routes mounted at /api/v1
 */
import { describe, it, expect, beforeAll, vi, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/api/server";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { InferenceClient } from "../src/core/execution/nodes/inference/inferenceClient";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  registerAllNodes();
  app = createApp();
});

// ── Health & info (root-level) ──────────────────────────────────────────

describe("GET /health", () => {
  it("should return healthy status", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.runtime).toBe("typescript");
    expect(res.body.version).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });
});

describe("GET /", () => {
  it("should return service info with endpoints", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body.service).toBe("Obelisk Core");
    expect(res.body.runtime).toBe("typescript");
    expect(res.body.endpoints).toBeDefined();
    expect(res.body.endpoints.workflow_execute).toBe(
      "POST /api/v1/workflow/execute"
    );
    expect(res.body.endpoints.workflow_run).toBe(
      "POST /api/v1/workflow/run"
    );
  });
});

// ── POST /api/v1/workflow/execute ─────────────────────────────────────

describe("POST /api/v1/workflow/execute", () => {
  it("should execute a simple text workflow", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/execute")
      .send({
        workflow: {
          nodes: [{ id: "1", type: "text", inputs: { text: "hello world" } }],
          connections: [],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.results).toBeDefined();
    expect(res.body.results["1"]).toBeDefined();
    expect(res.body.results["1"].outputs.text).toBe("hello world");
    expect(res.body.execution_order).toContain("1");
  });

  it("should execute workflow with context variables via options", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/execute")
      .send({
        workflow: {
          nodes: [
            { id: "1", type: "text", inputs: { text: "Hello {{user_id}}!" } },
          ],
          connections: [],
        },
        options: { user_id: "Obelisk" },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.results["1"].outputs.text).toBe("Hello Obelisk!");
  });

  it("should execute a chained workflow", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/execute")
      .send({
        workflow: {
          nodes: [
            { id: "a", type: "text", inputs: { text: "pass-through" } },
            { id: "b", type: "text", inputs: {} },
          ],
          connections: [
            {
              source_node: "a",
              source_output: "text",
              target_node: "b",
              target_input: "text",
            },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.execution_order).toEqual(["a", "b"]);
    expect(res.body.results["b"].outputs.text).toBe("pass-through");
  });

  it("should handle frontend connection format (from/to)", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/execute")
      .send({
        workflow: {
          nodes: [
            { id: "1", type: "text", inputs: { text: "data" } },
            { id: "2", type: "text", inputs: {} },
          ],
          connections: [
            {
              from: "1",
              from_output: "text",
              to: "2",
              to_input: "text",
            },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.results["2"].outputs.text).toBe("data");
  });

  it("should execute an inference workflow (mocked)", async () => {
    const mock = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Mocked LLM response",
        source: "mock",
      });

    const res = await request(app)
      .post("/api/v1/workflow/execute")
      .send({
        workflow: {
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
              inputs: { text: "Tell me a joke" },
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
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.results["llm"].outputs.text).toBe("Mocked LLM response");

    mock.mockRestore();
  });

  it("should return 400 when workflow is missing", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/execute")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("workflow");
  });

  it("should handle cycle errors gracefully", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/execute")
      .send({
        workflow: {
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
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("error");
    expect(res.body.error).toContain("ycle"); // "Cycle" or "cycle"
  });
});

// ── GET /api/v1/queue/info ───────────────────────────────────────────

describe("GET /api/v1/queue/info", () => {
  it("should return queue state", async () => {
    const res = await request(app).get("/api/v1/queue/info");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("queue_length");
    expect(res.body).toHaveProperty("is_processing");
    expect(typeof res.body.queue_length).toBe("number");
    expect(typeof res.body.is_processing).toBe("boolean");
  });
});

// ── Workflow lifecycle: run → status → running → stop ─────────────────
//
// Use a scheduler workflow so the runner keeps it "running" (non-autonomous
// workflows are executed once and not tracked, matching Python).

const schedulerWorkflow = {
  id: "api-lifecycle-test",
  nodes: [
    {
      id: "sched",
      type: "scheduler",
      inputs: {},
      metadata: { min_seconds: 60, max_seconds: 120, enabled: true },
    },
    { id: "txt", type: "text", inputs: { text: "tick" } },
  ],
  connections: [
    {
      source_node: "sched",
      source_output: "trigger",
      target_node: "txt",
      target_input: "trigger",
    },
  ],
};

describe("Workflow lifecycle", () => {
  let workflowId: string;

  afterAll(async () => {
    // Clean up any running workflows from this test suite
    await request(app).post("/api/v1/workflow/stop-all");
  });

  it("POST /api/v1/workflow/run should start a scheduler workflow", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/run")
      .send({ workflow: schedulerWorkflow });

    expect(res.status).toBe(200);
    expect(res.body.workflow_id).toBeDefined();
    expect(res.body.status).toBe("running");
    expect(res.body.message).toContain("started");
    workflowId = res.body.workflow_id;
  });

  it("GET /api/v1/workflow/status/:id should return running state", async () => {
    const res = await request(app).get(
      `/api/v1/workflow/status/${workflowId}`
    );

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("running");
    // Python-compatible fields
    expect(res.body).toHaveProperty("tick_count");
    expect(res.body).toHaveProperty("results_version");
    expect(res.body).toHaveProperty("node_count");
    expect(res.body.node_count).toBe(2);
  });

  it("GET /api/v1/workflow/running should list active workflows", async () => {
    const res = await request(app).get("/api/v1/workflow/running");

    expect(res.status).toBe(200);
    expect(res.body.workflows).toBeInstanceOf(Array);
    expect(res.body.workflows).toContain(workflowId);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/v1/workflow/stop should stop the workflow", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/stop")
      .send({ workflow_id: workflowId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("stopped");
    expect(res.body.workflow_id).toBe(workflowId);
  });

  it("GET /api/v1/workflow/status/:id returns not_found after stop", async () => {
    // Python deletes the workflow on stop, so getStatus returns None → not_found
    const res = await request(app).get(
      `/api/v1/workflow/status/${workflowId}`
    );

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("not_found");
  });

  it("POST /api/v1/workflow/stop-all should stop everything", async () => {
    // Start a scheduler workflow first
    const startRes = await request(app)
      .post("/api/v1/workflow/run")
      .send({
        workflow: { ...schedulerWorkflow, id: "stop-all-api-test" },
      });
    expect(startRes.body.status).toBe("running");

    const res = await request(app).post("/api/v1/workflow/stop-all");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("stopped");

    // Verify it's gone
    const statusRes = await request(app).get(
      `/api/v1/workflow/status/${startRes.body.workflow_id}`
    );
    expect(statusRes.body.state).toBe("not_found");
  });

  it("POST /api/v1/workflow/stop on unknown ID should return not_found", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/stop")
      .send({ workflow_id: "nonexistent-id" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("not_found");
  });

  it("POST /api/v1/workflow/run with missing workflow should return 400", async () => {
    const res = await request(app)
      .post("/api/v1/workflow/run")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("workflow");
  });
});

// ── Queue endpoints ─────────────────────────────────────────────────────

describe("Queue endpoints", () => {
  it("POST /api/v1/queue/execute should enqueue and return job_id", async () => {
    const res = await request(app)
      .post("/api/v1/queue/execute")
      .send({
        workflow: {
          nodes: [{ id: "1", type: "text", inputs: { text: "queued" } }],
          connections: [],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.job_id).toBeDefined();
    // Job may already be "running" since processNext() fires immediately
    expect(["queued", "running"]).toContain(res.body.status);
    expect(typeof res.body.position).toBe("number");
    expect(typeof res.body.queue_length).toBe("number");

    // Wait for job to complete, then check result
    await new Promise((r) => setTimeout(r, 100));

    const resultRes = await request(app).get(
      `/api/v1/queue/result/${res.body.job_id}`
    );
    expect(resultRes.status).toBe(200);
    expect(resultRes.body.status).toBe("completed");
    expect(resultRes.body.results["1"].outputs.text).toBe("queued");
  });

  it("GET /api/v1/queue/status/:job_id should return 404 for unknown job", async () => {
    const res = await request(app).get("/api/v1/queue/status/unknown-id");
    expect(res.status).toBe(404);
  });
});
