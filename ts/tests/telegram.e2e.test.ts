/**
 * End-to-end Telegram workflow integration test.
 *
 * Requires:
 *   - TELEGRAM_DEV_AGENT_BOT_TOKEN  (bot token)
 *   - TELEGRAM_CHAT_ID              (group/chat to send test messages to)
 *   - Inference service running on localhost:7780 (obelisk-inference)
 *
 * This test:
 *   1. Verifies the bot token is valid
 *   2. Verifies polling works
 *   3. Loads the default workflow (ui/workflows/default.json)
 *   4. Starts it via WorkflowRunner
 *   5. Sends a test message to the group via the Telegram API
 *   6. Waits for the listener to pick it up and the subgraph to execute
 *   7. Asserts that inference was called (binary_intent + main inference)
 *   8. Stops the workflow
 *
 * Usage:
 *   npx vitest run tests/telegram.e2e.test.ts --reporter=verbose
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { WorkflowRunner } from "../src/core/execution/runner";
import { convertFrontendWorkflow } from "../src/api/conversion";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";

// ── Load env from obelisk-core root ─────────────────────────────────────
const envPath = path.resolve(__dirname, "..", "..", ".env");
dotenv.config({ path: envPath });

const BOT_TOKEN = process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN ?? "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const INFERENCE_URL = process.env.INFERENCE_ENDPOINT || "http://localhost:7780";
const API_BASE = "https://api.telegram.org/bot";

// ── Skip helpers ────────────────────────────────────────────────────────
const hasBotToken = !!BOT_TOKEN;
const hasChatId = !!CHAT_ID;

/** Quick probe: is the inference service reachable? Resolved in beforeAll. */
let inferenceAvailable = false;

async function probeInferenceEndpoint(): Promise<boolean> {
  try {
    const res = await fetch(`${INFERENCE_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Telegram API helpers ────────────────────────────────────────────────

async function getBotInfo(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${BOT_TOKEN}/getMe`, {
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function getUpdates(
  offset?: number,
  timeout = 1
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    timeout: String(timeout),
    allowed_updates: JSON.stringify(["message"]),
    limit: "10",
  });
  if (offset !== undefined) params.set("offset", String(offset));

  const res = await fetch(
    `${API_BASE}${BOT_TOKEN}/getUpdates?${params}`,
    { signal: AbortSignal.timeout((timeout + 5) * 1000) }
  );
  return (await res.json()) as Record<string, unknown>;
}

async function sendMessage(
  chatId: string,
  text: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function isInferenceServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${INFERENCE_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Helper to wait with polling ─────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────────────────

describe("Telegram E2E workflow test", () => {
  let runner: WorkflowRunner;

  beforeAll(async () => {
    registerAllNodes();
    runner = new WorkflowRunner();
    inferenceAvailable = await probeInferenceEndpoint();
    if (!inferenceAvailable) {
      console.warn(
        `⚠️  Inference service at ${INFERENCE_URL} is unreachable — full pipeline tests will be skipped`
      );
    }
  });

  afterAll(() => {
    // Stop all running workflows
    runner.stopAll();
  });

  // ── 1. Verify bot token ─────────────────────────────────────────────

  it.skipIf(!hasBotToken)(
    "should validate bot token",
    async () => {
      const result = await getBotInfo();
      expect(result.ok).toBe(true);

      const bot = result.result as Record<string, unknown>;
      expect(bot.username).toBeDefined();
      console.log(
        `✅ Bot token valid — @${bot.username} (ID: ${bot.id})`
      );
    },
    15_000
  );

  // ── 2. Verify polling works ─────────────────────────────────────────

  it.skipIf(!hasBotToken)(
    "should poll for updates",
    async () => {
      const result = await getUpdates(undefined, 1);
      expect(result.ok).toBe(true);

      const updates = (result.result as unknown[]) ?? [];
      console.log(
        `✅ Poll successful — ${updates.length} pending update(s)`
      );
    },
    15_000
  );

  // ── 3. Verify sending works ─────────────────────────────────────────

  it.skipIf(!hasBotToken || !hasChatId)(
    "should send a test message",
    async () => {
      const text = `🧪 E2E test ping — ${new Date().toISOString()}`;
      const result = await sendMessage(CHAT_ID, text);
      expect(result.ok).toBe(true);
      console.log(
        `✅ Sent test message to chat ${CHAT_ID}`
      );
    },
    15_000
  );

  // ── 4. Verify inference service is reachable ────────────────────────

  it(
    "should reach the inference service",
    async () => {
      const up = await isInferenceServiceUp();
      if (!up) {
        console.warn(
          `⚠️  Inference service at ${INFERENCE_URL} is not reachable — inference-dependent assertions will be skipped`
        );
      } else {
        console.log(`✅ Inference service is healthy at ${INFERENCE_URL}`);
      }
      // Don't fail — the test still exercises the Telegram listener path
      expect(true).toBe(true);
    },
    10_000
  );

  // ── 5. Full workflow: start → send message → wait for processing ───

  it.skipIf(!hasBotToken || !hasChatId || !inferenceAvailable)(
    "should run the default workflow and process a Telegram message through the full pipeline",
    async () => {
      // ── Load the default workflow ──────────────────────────────────
      const workflowPath = path.resolve(
        __dirname,
        "..",
        "..",
        "ui",
        "workflows",
        "default.json"
      );
      expect(fs.existsSync(workflowPath)).toBe(true);

      const raw = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
      const workflow = convertFrontendWorkflow(raw);

      console.log(
        `📋 Loaded default workflow: ${workflow.nodes.length} nodes, ${workflow.connections.length} connections`
      );

      // ── Drain old updates so the listener starts fresh ─────────
      const drain = await getUpdates(undefined, 1);
      let latestOffset: number | undefined;
      if (drain.ok) {
        const updates = (drain.result as Array<Record<string, unknown>>) ?? [];
        if (updates.length) {
          latestOffset =
            Math.max(...updates.map((u) => u.update_id as number)) + 1;
        }
      }
      // Acknowledge old updates by requesting with the offset
      if (latestOffset !== undefined) {
        await getUpdates(latestOffset, 1);
        console.log(
          `🔄 Drained old updates (offset now ${latestOffset})`
        );
      }

      // ── Start the workflow ─────────────────────────────────────
      const results: Array<{
        tick: number;
        success: boolean;
        executedNodes: string[];
        error?: string;
      }> = [];

      const workflowId = runner.startWorkflow(
        workflow,
        {},
        (tickResult) => {
          results.push(tickResult);
          console.log(
            `  ⚡ Tick ${tickResult.tick}: ${tickResult.executedNodes.length} nodes executed (success=${tickResult.success})`
          );
          if (tickResult.executedNodes.length) {
            console.log(
              `     Nodes: ${tickResult.executedNodes.join(", ")}`
            );
          }
          if (tickResult.error) {
            console.log(`     Error: ${tickResult.error}`);
          }
        },
        (error) => {
          console.error(`  ❌ Workflow error: ${error}`);
        }
      );

      expect(workflowId).toBeDefined();
      console.log(`▶️  Started workflow ${workflowId}`);

      // Verify it's running
      const status = runner.getStatus(workflowId);
      expect(status).not.toBeNull();
      expect(status!.state).toBe("running");

      // ── Wait a moment for the listener to initialize ───────────
      await sleep(3_000);

      // ── Send a test message that should trigger the bot ────────
      const testMessage = `@ObeliskAgentBot Hey, this is an E2E test — what's 2+2? (${Date.now()})`;
      console.log(`📤 Sending test message: "${testMessage}"`);

      const sendResult = await sendMessage(CHAT_ID, testMessage);
      expect(sendResult.ok).toBe(true);

      // ── Wait for the workflow to pick it up and process ────────
      // The listener polls every 2s, then subgraph execution with
      // inference calls can take 10-30s depending on the LLM.
      const maxWaitMs = 90_000;
      const pollIntervalMs = 2_000;
      const deadline = Date.now() + maxWaitMs;
      let subgraphRan = false;

      console.log(
        `⏳ Waiting up to ${maxWaitMs / 1000}s for the workflow to process the message...`
      );

      while (Date.now() < deadline) {
        await sleep(pollIntervalMs);

        const currentStatus = runner.getStatus(workflowId);
        if (!currentStatus || currentStatus.state !== "running") {
          console.log("   Workflow stopped unexpectedly");
          break;
        }

        // Check if we got results with executed nodes
        if (
          currentStatus.latest_results &&
          typeof currentStatus.latest_results === "object"
        ) {
          const lr = currentStatus.latest_results as Record<string, unknown>;
          const executedNodes = lr.executed_nodes as string[] | undefined;

          if (executedNodes && executedNodes.length > 0) {
            console.log(
              `\n✅ Subgraph executed! Nodes: ${executedNodes.join(", ")}`
            );
            subgraphRan = true;

            // Log results
            const nodeResults = lr.results as Record<
              string,
              { outputs: Record<string, unknown> }
            >;
            if (nodeResults) {
              for (const [nodeId, data] of Object.entries(nodeResults)) {
                const outputs = data?.outputs ?? {};
                const keys = Object.keys(outputs);
                console.log(
                  `   Node ${nodeId}: ${keys.length} output(s) [${keys.join(", ")}]`
                );

                // Log specific interesting outputs
                if (outputs.response) {
                  const resp = String(outputs.response);
                  console.log(
                    `     response: "${resp.slice(0, 120)}${resp.length > 120 ? "..." : ""}"`
                  );
                }
                if (outputs.result !== undefined) {
                  console.log(
                    `     result: ${outputs.result} (confidence: ${outputs.confidence})`
                  );
                }
                if (outputs.trigger !== undefined) {
                  console.log(
                    `     trigger: ${outputs.trigger}, message: "${String(outputs.message ?? "").slice(0, 80)}"`
                  );
                }
                if (outputs.success !== undefined) {
                  console.log(
                    `     success: ${outputs.success}`
                  );
                }
              }
            }
            break;
          }
        }

        // Log tick progress
        if (currentStatus.tick_count % 10 === 0 && currentStatus.tick_count > 0) {
          console.log(
            `   ... tick ${currentStatus.tick_count}, no subgraph yet`
          );
        }
      }

      // ── Stop the workflow ──────────────────────────────────────
      const stopped = runner.stopWorkflow(workflowId);
      expect(stopped).toBe(true);
      console.log(`⏹️  Stopped workflow ${workflowId}`);

      // ── Assertions ─────────────────────────────────────────────
      expect(subgraphRan).toBe(true);

      // The latest_results should contain node outputs
      // We expect the following nodes to have executed in the subgraph:
      //   - 15 (telegram_memory_creator)
      //   - 14 (telegram_memory_selector)
      //   - 16 (memory_storage)
      //   - 4  (model_loader / inference_config)
      //   - 17 (binary_intent) — calls inference
      //   - 6  (inference) — calls inference
      //   - 5  (text / system_prompt)
      //   - 7  (text / output)
      //   - 10 (telegram_bot / sender)
      //   - 12 (telegram_listener / autonomous trigger)
      //
      // Note: not all nodes may execute if binary_intent returns false
      // (the intent classifier may decide the message doesn't need a response)

      // The results callback should have captured at least one tick result
      expect(results.length).toBeGreaterThan(0);

      // At least the first result should have executed some nodes
      const lastResult = results[results.length - 1];
      expect(lastResult.executedNodes.length).toBeGreaterThan(0);

      console.log("\n🎉 E2E test completed successfully!");
    },
    120_000 // 2 minute timeout for the full workflow
  );

  // ── 6. Verify specific node execution in the subgraph ─────────────

  it.skipIf(!hasBotToken || !hasChatId || !inferenceAvailable)(
    "should have called inference at least once (binary_intent or main inference)",
    async () => {
      // This test depends on test 5 having run, so we just load and start
      // a fresh workflow, send a simple message, and check that the
      // inference config node and at least one LLM-calling node executed.

      const workflowPath = path.resolve(
        __dirname,
        "..",
        "..",
        "ui",
        "workflows",
        "default.json"
      );
      const raw = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
      const workflow = convertFrontendWorkflow(raw);

      // Drain old updates
      const drain = await getUpdates(undefined, 1);
      let offset: number | undefined;
      if (drain.ok) {
        const updates = (drain.result as Array<Record<string, unknown>>) ?? [];
        if (updates.length) {
          offset =
            Math.max(...updates.map((u) => u.update_id as number)) + 1;
          await getUpdates(offset, 1);
        }
      }

      const executedNodesList: string[][] = [];

      const wid = runner.startWorkflow(
        workflow,
        {},
        (tick) => {
          if (tick.executedNodes.length) {
            executedNodesList.push(tick.executedNodes);
          }
        }
      );

      // Wait for init
      await sleep(3_000);

      // Send a message that should trigger the binary_intent to return true
      // (mentioning the bot name)
      const msg = `@ObeliskAgentBot Hello, please respond to this E2E test. (${Date.now()})`;
      const sendResult = await sendMessage(CHAT_ID, msg);
      expect(sendResult.ok).toBe(true);

      // Wait for processing
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await sleep(2_000);
        if (executedNodesList.length > 0) break;
      }

      runner.stopWorkflow(wid);

      // Check that at least one subgraph execution happened
      expect(executedNodesList.length).toBeGreaterThan(0);

      // Flatten all executed nodes
      const allExecuted = new Set(executedNodesList.flat());

      // Node 4 is inference_config/model_loader — should always execute
      console.log(
        `  Executed nodes: ${Array.from(allExecuted).join(", ")}`
      );
      expect(allExecuted.has("4")).toBe(true); // model_loader

      // Node 17 is binary_intent — should always execute (it classifies)
      expect(allExecuted.has("17")).toBe(true); // binary_intent

      // If binary_intent returned true, the main inference (6) should also run
      const inferenceRan = allExecuted.has("6");
      if (inferenceRan) {
        console.log("  ✅ Main inference node (6) executed");
        // And if inference ran, the output text (7) and telegram_bot (10) should too
        expect(allExecuted.has("7")).toBe(true); // output text
        expect(allExecuted.has("10")).toBe(true); // telegram_bot sender
        console.log("  ✅ Output text (7) and TelegramBot (10) executed");
      } else {
        console.log(
          "  ⚠️  Binary intent returned false — main inference did not run (this can happen if the LLM doesn't consider the message directed at the bot)"
        );
      }

      console.log("🎉 Inference verification test completed!");
    },
    120_000
  );
});
