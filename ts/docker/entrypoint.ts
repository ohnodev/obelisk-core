/**
 * Obelisk Agent Entrypoint (TypeScript edition)
 * Loads a workflow from environment or file and runs it continuously.
 * Mirrors Python docker/entrypoint.py
 */
import fs from "fs";
import path from "path";
import { WorkflowRunner, TickResult } from "../src/core/execution/runner";
import { WorkflowData } from "../src/core/types";
import { getLogger } from "../src/utils/logger";

const logger = getLogger("entrypoint");

// ── Load workflow ─────────────────────────────────────────────────────

function loadWorkflow(): WorkflowData {
  // 1. WORKFLOW_JSON env var
  const workflowJson = process.env.WORKFLOW_JSON;
  if (workflowJson) {
    logger.info("Loading workflow from WORKFLOW_JSON environment variable");
    try {
      return JSON.parse(workflowJson) as WorkflowData;
    } catch (e) {
      logger.error(`Failed to parse WORKFLOW_JSON: ${e}`);
      process.exit(1);
    }
  }

  // 2. WORKFLOW_FILE env var or default path
  const workflowFile =
    process.env.WORKFLOW_FILE || "/app/workflows/workflow.json";
  if (fs.existsSync(workflowFile)) {
    logger.info(`Loading workflow from file: ${workflowFile}`);
    try {
      return JSON.parse(
        fs.readFileSync(workflowFile, "utf-8")
      ) as WorkflowData;
    } catch (e) {
      logger.error(`Failed to load workflow file: ${e}`);
      process.exit(1);
    }
  }

  logger.error(
    "No workflow found. Set WORKFLOW_JSON env var or mount workflow.json"
  );
  process.exit(1);
}

// ── Build context variables ───────────────────────────────────────────
// Only agent_id and agent_name. Workflow env is from process.env (deploy env_vars).
function buildContextVariables(): Record<string, string> {
  return {
    agent_id: process.env.AGENT_ID ?? "unknown",
    agent_name: process.env.AGENT_NAME ?? "unnamed",
  };
}

// ── Agent runner ──────────────────────────────────────────────────────

class AgentRunner {
  private runner: WorkflowRunner;
  private workflowId: string | null = null;
  private running = true;

  constructor() {
    this.runner = new WorkflowRunner();

    process.on("SIGTERM", () => this.shutdown());
    process.on("SIGINT", () => this.shutdown());
  }

  private shutdown(): void {
    logger.info("Received shutdown signal...");
    this.running = false;
    if (this.workflowId) {
      this.runner.stopWorkflow(this.workflowId);
      logger.info("Workflow stopped");
    }
  }

  async run(): Promise<void> {
    const workflow = loadWorkflow();
    const name = workflow.name ?? workflow.id ?? "unknown";
    logger.info(`Starting agent with workflow: ${name}`);

    const context = buildContextVariables();
    logger.info(`Context variables: ${Object.keys(context).join(", ")}`);

    this.workflowId = await this.runner.startWorkflow(
      workflow,
      context,
      30_000,
      (result: TickResult) => {
        if (result.success) {
          logger.info(
            `Tick #${result.tick} completed – ${result.executedNodes.length} nodes`
          );
        } else {
          logger.error(`Tick #${result.tick} failed: ${result.error}`);
        }
      },
      (error: string) => {
        logger.error(`Workflow error: ${error}`);
      }
    );

    logger.info(`Workflow started with ID: ${this.workflowId}`);
    logger.info("Agent running. Send SIGTERM to stop.");

    // Keep process alive
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = this.runner.getStatus(this.workflowId);
      if (!status || status.state !== "running") {
        logger.warn("Workflow is no longer running");
        break;
      }
    }

    logger.info("Agent shutdown complete");
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  OBELISK AGENT (TypeScript)");
  console.log("=".repeat(60));
  console.log(`  Agent ID: ${process.env.AGENT_ID ?? "unknown"}`);
  console.log(`  Agent Name: ${process.env.AGENT_NAME ?? "unnamed"}`);
  console.log("=".repeat(60));
  console.log();

  const agent = new AgentRunner();
  await agent.run();
}

main().catch((e) => {
  logger.error(`Fatal error: ${e}`);
  process.exit(1);
});
