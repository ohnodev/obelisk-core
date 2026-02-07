/**
 * API endpoint tests using supertest.
 *
 * Tests the Express server's /health, /, /execute, /workflows, and /queue
 * endpoints without starting a real HTTP listener.
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

// ── Health & info ───────────────────────────────────────────────────────

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
    expect(res.body.endpoints.health).toBe("/health");
    expect(res.body.endpoints.execute).toBe("POST /execute");
  });
});

// ── POST /execute ──────────────────────────────────────────────────────

describe("POST /execute", () => {
  it("should execute a simple text workflow", async () => {
    const res = await request(app)
      .post("/execute")
      .send({
        workflow: {
          nodes: [{ id: "1", type: "text", inputs: { text: "hello world" } }],
          connections: [],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.finalOutputs.text).toBe("hello world");
    expect(res.body.nodeResults).toHaveLength(1);
  });

  it("should execute workflow with context variables", async () => {
    const res = await request(app)
      .post("/execute")
      .send({
        workflow: {
          nodes: [
            { id: "1", type: "text", inputs: { text: "Hello {{name}}!" } },
          ],
          connections: [],
        },
        context_variables: { name: "Obelisk" },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.finalOutputs.text).toBe("Hello Obelisk!");
  });

  it("should execute a chained workflow", async () => {
    const res = await request(app)
      .post("/execute")
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
    expect(res.body.success).toBe(true);
    expect(res.body.executionOrder).toEqual(["a", "b"]);
    expect(res.body.finalOutputs.text).toBe("pass-through");
  });

  it("should execute an inference workflow (mocked)", async () => {
    const mock = vi
      .spyOn(InferenceClient.prototype, "generate")
      .mockResolvedValue({
        response: "Mocked LLM response",
        source: "mock",
      });

    const res = await request(app)
      .post("/execute")
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
    expect(res.body.success).toBe(true);
    expect(res.body.finalOutputs.text).toBe("Mocked LLM response");

    mock.mockRestore();
  });

  it("should return 400 when workflow is missing", async () => {
    const res = await request(app).post("/execute").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("workflow");
  });

  it("should return 400 when nodes are missing", async () => {
    const res = await request(app)
      .post("/execute")
      .send({ workflow: { connections: [] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("workflow");
  });

  it("should handle cycle errors gracefully", async () => {
    const res = await request(app)
      .post("/execute")
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
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("cycle");
  });
});

// ── GET /queue/status ──────────────────────────────────────────────────

describe("GET /queue/status", () => {
  it("should return queue state", async () => {
    const res = await request(app).get("/queue/status");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("queue_size");
    expect(res.body).toHaveProperty("is_processing");
    expect(typeof res.body.queue_size).toBe("number");
    expect(typeof res.body.is_processing).toBe("boolean");
  });
});

// ── Workflow lifecycle: start → status → list → stop ────────────────────

describe("Workflow lifecycle", () => {
  let workflowId: string;

  it("POST /workflows/start should start a workflow", async () => {
    const res = await request(app)
      .post("/workflows/start")
      .send({
        workflow: {
          nodes: [{ id: "1", type: "text", inputs: { text: "tick" } }],
          connections: [],
        },
        tick_interval_ms: 600_000, // very long so it doesn't fire during test
      });

    expect(res.status).toBe(200);
    expect(res.body.workflow_id).toBeDefined();
    expect(res.body.state).toBe("running");
    workflowId = res.body.workflow_id;
  });

  it("GET /workflows/:id/status should return running state", async () => {
    // Wait briefly for the first async tick to complete
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app).get(`/workflows/${workflowId}/status`);

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("running");
    expect(res.body.tickCount).toBeGreaterThanOrEqual(1); // first tick fires immediately
  });

  it("GET /workflows should list active workflows", async () => {
    const res = await request(app).get("/workflows");

    expect(res.status).toBe(200);
    expect(res.body.workflows).toBeInstanceOf(Array);
    const ids = res.body.workflows.map((w: any) => w.workflow_id);
    expect(ids).toContain(workflowId);
  });

  it("POST /workflows/:id/stop should stop the workflow", async () => {
    const res = await request(app).post(`/workflows/${workflowId}/stop`);

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("stopped");
  });

  it("GET /workflows/:id/status should return stopped state", async () => {
    const res = await request(app).get(`/workflows/${workflowId}/status`);

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("stopped");
  });

  it("POST /workflows/:id/stop on unknown ID should return 404", async () => {
    const res = await request(app).post("/workflows/nonexistent-id/stop");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  it("POST /workflows/start with missing workflow should return 400", async () => {
    const res = await request(app).post("/workflows/start").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("workflow");
  });
});
