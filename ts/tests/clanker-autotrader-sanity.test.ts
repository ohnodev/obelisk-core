/**
 * Sanity test for the Clanker autotrader workflow.
 * Loads clanker-autotrader-v1.json, converts it, and runs it once to verify
 * the workflow starts and key nodes execute (Wallet, Balance Checker, Boolean Logic,
 * Blockchain Config, Clanker Launch Summary, etc.). Uses .env from obelisk-core and
 * blockchain-service so RPC_URL, SWAP_PRIVATE_KEY, TELEGRAM_*, etc. are available.
 *
 * Run with: npm test -- clanker-autotrader-sanity
 * Or: npx vitest run tests/clanker-autotrader-sanity.test.ts
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// Load .env from obelisk-core root and blockchain-service (same as clanker-buy integration test)
for (const rel of [
  path.join("..", "..", ".env"),
  path.join("..", "..", "blockchain-service", ".env"),
]) {
  const envPath = path.resolve(__dirname, rel);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

import { convertFrontendWorkflow } from "../src/api/conversion";
import { ExecutionEngine } from "../src/core/execution/engine";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { InferenceClient } from "../src/core/execution/nodes/inference/inferenceClient";

beforeAll(() => {
  registerAllNodes();
});

const workflowsDir = path.join(__dirname, "../../ui/workflows");
const WORKFLOW_FILE = "clanker-autotrader-v1.json";

function loadClankerWorkflow(): Record<string, unknown> {
  const p = path.join(workflowsDir, WORKFLOW_FILE);
  if (!fs.existsSync(p)) {
    throw new Error(`Workflow not found: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

describe("Clanker autotrader workflow sanity", () => {
  it("should load, convert, and run the Clanker autotrader workflow once without crashing", async () => {
    const frontend = loadClankerWorkflow();
    const workflow = convertFrontendWorkflow(frontend as any);

    expect(workflow.nodes.length).toBeGreaterThan(0);
    expect(workflow.connections.length).toBeGreaterThan(0);

    // Mock fetch only for blockchain service API (no real base.theobelisk.ai required)
    const mockState = { lastUpdated: Date.now(), tokens: {}, recentLaunches: [] };
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/clanker/state")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockState),
          } as Response);
        }
        return realFetch(url as string);
      })
    );

    // Mock inference so we don't require a running inference server for sanity
    vi.spyOn(InferenceClient.prototype, "generate").mockResolvedValue({
      response: JSON.stringify({
        actions: [{ action: "reply", params: { text: "Sanity check – no buy." } }],
      }),
      source: "mock",
    });

    const engine = new ExecutionEngine();
    const result = await engine.execute(workflow, {}, {});

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.executionOrder).toBeDefined();
    expect(result.executionOrder!.length).toBeGreaterThan(0);
    expect(result.nodeResults.length).toBeGreaterThan(0);

    // Key nodes for the buy path should have run (order depends on topology)
    const executedIds = new Set(result.nodeResults.map((r) => r.nodeId));
    expect(executedIds.has("1")).toBe(true); // blockchain_config
    expect(executedIds.has("8")).toBe(true); // wallet
    expect(executedIds.has("10")).toBe(true); // memory_storage
    expect(executedIds.has("22")).toBe(true); // balance_checker
    expect(executedIds.has("23")).toBe(true); // boolean_logic
    expect(executedIds.has("2")).toBe(true); // scheduler (60–120s)
    expect(executedIds.has("3")).toBe(true); // clanker_launch_summary

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }, 30_000);

  it("should have env loaded when .env is present (optional)", () => {
    const envPath = path.resolve(__dirname, "..", "..", "blockchain-service", ".env");
    if (!fs.existsSync(envPath)) return; // skip when no .env
    const hasEnv =
      !!process.env.RPC_URL ||
      !!process.env.SWAP_PRIVATE_KEY ||
      !!process.env.TELEGRAM_BOT_TOKEN;
    expect(hasEnv).toBe(true);
  });
});
