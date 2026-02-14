/**
 * Tests that workflow JSON (as produced by UI serializeGraph) converts correctly
 * and executes through the backend. Validates the serialization format round-trip.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import path from "path";
import fs from "fs";
import { convertFrontendWorkflow } from "../src/api/conversion";
import { ExecutionEngine } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { InferenceClient } from "../src/core/execution/nodes/inference/inferenceClient";

beforeAll(() => {
  registerAllNodes();
});

const workflowsDir = path.join(__dirname, "../../ui/workflows");

function loadWorkflow(name: string): Record<string, unknown> {
  const p = path.join(workflowsDir, `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`Workflow file not found: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

describe("Workflow serialization format (UI → backend)", () => {
  it("should convert and execute default.json (Telegram bot workflow)", async () => {
    const frontend = loadWorkflow("default");
    const workflow = convertFrontendWorkflow(frontend);

    expect(workflow.nodes.length).toBeGreaterThan(0);
    expect(workflow.connections.length).toBeGreaterThan(0);

    // Mock fetch only for blockchain service URLs (default.json has blockchain_config)
    const mockState = { lastUpdated: 0, tokens: {}, recentLaunches: [] };
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init?: unknown) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/clanker/state")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockState),
          } as Response);
        }
        return realFetch(url as string, init as RequestInit);
      })
    );

    // Mock inference for nodes that need it
    vi.spyOn(InferenceClient.prototype, "generate").mockResolvedValue({
      response: "Test response",
      source: "mock",
    });

    const engine = new ExecutionEngine();
    const result = await engine.execute(workflow);

    // Should complete (autonomous nodes may not fire in one-shot, but graph should run)
    expect(result).toBeDefined();
    expect(result.executionOrder).toBeDefined();
    expect(result.executionOrder!.length).toBeGreaterThan(0);
    expect(result.nodeResults.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should convert girlfriend.json (Aria HTTP workflow) and run engine", async () => {
    const frontend = loadWorkflow("girlfriend");
    // Use high port to avoid EADDRINUSE (engine calls _setup which starts HttpListener)
    const httpNode = (frontend.nodes as Record<string, unknown>[]).find(
      (n) => n.type === "http_listener"
    );
    if (httpNode?.metadata && typeof httpNode.metadata === "object") {
      (httpNode.metadata as Record<string, unknown>).port = 18999;
    }
    const workflow = convertFrontendWorkflow(frontend);

    expect(workflow.nodes.length).toBeGreaterThan(0);
    expect(workflow.connections.length).toBeGreaterThan(0);

    vi.spyOn(InferenceClient.prototype, "generate").mockResolvedValue({
      response: "Hey! What's up?",
      source: "mock",
    });

    const engine = new ExecutionEngine();
    const result = await engine.execute(workflow);

    // In one-shot mode http_listener doesn't fire, so memory_selector may fail; structure is valid
    expect(result).toBeDefined();
    expect(result.executionOrder).toBeDefined();
    expect(result.executionOrder!.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  it("should convert sora.json and run engine", async () => {
    const frontend = loadWorkflow("sora");
    const httpNode = (frontend.nodes as Record<string, unknown>[]).find(
      (n) => n.type === "http_listener"
    );
    if (httpNode?.metadata && typeof httpNode.metadata === "object") {
      (httpNode.metadata as Record<string, unknown>).port = 18998;
    }
    const workflow = convertFrontendWorkflow(frontend);

    expect(workflow.nodes.length).toBeGreaterThan(0);

    vi.spyOn(InferenceClient.prototype, "generate").mockResolvedValue({
      response: "Greetings.",
      source: "mock",
    });

    const engine = new ExecutionEngine();
    const result = await engine.execute(workflow);

    expect(result).toBeDefined();
    expect(result.executionOrder!.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  it("should convert and execute crab.json (Crab AI Telegram bot)", async () => {
    const frontend = loadWorkflow("crab");
    const workflow = convertFrontendWorkflow(frontend);

    expect(workflow.nodes.length).toBeGreaterThan(0);
    expect(workflow.connections.length).toBeGreaterThan(0);

    vi.spyOn(InferenceClient.prototype, "generate").mockResolvedValue({
      response: '{"result": true, "confidence": "high", "reasoning": "crab"}',
      source: "mock",
    });

    const engine = new ExecutionEngine();
    const result = await engine.execute(workflow);

    expect(result).toBeDefined();
    expect(result.executionOrder!.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  it("should preserve node ids and connection structure in conversion", () => {
    const frontend = loadWorkflow("girlfriend");
    const workflow = convertFrontendWorkflow(frontend);

    const nodeIds = new Set(workflow.nodes.map((n) => n.id));
    expect(nodeIds.size).toBe(workflow.nodes.length);

    for (const conn of workflow.connections) {
      expect(nodeIds.has(conn.source_node)).toBe(true);
      expect(nodeIds.has(conn.target_node)).toBe(true);
    }
  });
});
