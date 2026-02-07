#!/usr/bin/env node
/**
 * Obelisk Agent Entrypoint (TypeScript build)
 * Loads a workflow from environment or file and runs it continuously.
 * Mirrors the Python docker/entrypoint.py behaviour.
 */
"use strict";

const fs = require("fs");
const path = require("path");

// The compiled runner lives in dist/ after tsc
const { WorkflowRunner } = require("./dist/core/execution/runner");

// ---------------------------------------------------------------------------
// Logger (simple console wrapper matching obelisk style)
// ---------------------------------------------------------------------------
const LOG_LEVEL = (process.env.OBELISK_LOG_LEVEL || "INFO").toUpperCase();

function log(level, ...args) {
  const ts = new Date().toISOString();
  console.log(`${ts}: [${level}] obelisk_agent:`, ...args);
}

const logger = {
  info: (...a) => log("INFO", ...a),
  warn: (...a) => log("WARN", ...a),
  error: (...a) => log("ERROR", ...a),
  debug: (...a) => {
    if (LOG_LEVEL === "DEBUG") log("DEBUG", ...a);
  },
};

// ---------------------------------------------------------------------------
// Load workflow
// ---------------------------------------------------------------------------
function loadWorkflow() {
  // 1. WORKFLOW_JSON env var (JSON string)
  const workflowJson = process.env.WORKFLOW_JSON;
  if (workflowJson) {
    logger.info("Loading workflow from WORKFLOW_JSON environment variable");
    try {
      return JSON.parse(workflowJson);
    } catch (e) {
      logger.error(`Failed to parse WORKFLOW_JSON: ${e.message}`);
      process.exit(1);
    }
  }

  // 2. WORKFLOW_FILE env var or default path
  const workflowFile =
    process.env.WORKFLOW_FILE || "/app/workflows/workflow.json";
  if (fs.existsSync(workflowFile)) {
    logger.info(`Loading workflow from file: ${workflowFile}`);
    try {
      const raw = fs.readFileSync(workflowFile, "utf-8");
      return JSON.parse(raw);
    } catch (e) {
      logger.error(`Failed to load workflow file: ${e.message}`);
      process.exit(1);
    }
  }

  logger.error(
    "No workflow found. Set WORKFLOW_JSON env var or mount workflow.json"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build context variables from environment
// ---------------------------------------------------------------------------
function buildContextVariables() {
  const context = {
    agent_id: process.env.AGENT_ID || "unknown",
    agent_name: process.env.AGENT_NAME || "unnamed",
  };

  // OBELISK_VAR_* env vars → context variables
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("OBELISK_VAR_")) {
      const varName = key.slice(12).toLowerCase();
      context[varName] = value;
    }
  }

  return context;
}

// ---------------------------------------------------------------------------
// Agent Runner
// ---------------------------------------------------------------------------
class AgentRunner {
  constructor() {
    this.runner = null;
    this.workflowId = null;
    this.running = true;

    // Graceful shutdown
    process.on("SIGTERM", () => this._handleShutdown("SIGTERM"));
    process.on("SIGINT", () => this._handleShutdown("SIGINT"));
  }

  _handleShutdown(signal) {
    logger.info(`Received ${signal}, shutting down...`);
    this.running = false;

    if (this.runner && this.workflowId) {
      try {
        this.runner.stopWorkflow(this.workflowId);
        logger.info("Workflow stopped successfully");
      } catch (e) {
        logger.error(`Error stopping workflow: ${e.message}`);
      }
    }

    // Give a moment for cleanup then exit
    setTimeout(() => process.exit(0), 1000);
  }

  _onTickComplete(result) {
    const tick = result.tick ?? "?";
    const success = result.success ?? false;
    const executed = result.executedNodes ?? [];

    if (success) {
      logger.info(`Tick #${tick} completed - executed ${executed.length} nodes`);
    } else {
      const error = result.error ?? "Unknown error";
      logger.error(`Tick #${tick} failed: ${error}`);
    }
  }

  _onError(error) {
    logger.error(`Workflow error: ${error}`);
  }

  run() {
    // Load workflow
    const workflow = loadWorkflow();
    const workflowName = workflow.name || workflow.id || "unknown";
    logger.info(`Starting agent with workflow: ${workflowName}`);

    // Build context
    const context = buildContextVariables();
    logger.info(`Context variables: ${Object.keys(context).join(", ")}`);

    // Create runner
    this.runner = new WorkflowRunner();

    // Start workflow
    this.workflowId = this.runner.startWorkflow(
      workflow,
      context,
      (result) => this._onTickComplete(result),
      (error) => this._onError(error)
    );

    logger.info(`Workflow started with ID: ${this.workflowId}`);
    logger.info("Agent running. Press Ctrl+C or send SIGTERM to stop.");

    // Keep-alive loop: check workflow status every second
    const checkInterval = setInterval(() => {
      if (!this.running) {
        clearInterval(checkInterval);
        return;
      }

      const status = this.runner.getStatus(this.workflowId);
      if (!status || status.state !== "running") {
        logger.warn("Workflow is no longer running");
        clearInterval(checkInterval);
        this.running = false;
      }
    }, 1000);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log("=".repeat(60));
console.log("  OBELISK AGENT (TypeScript)");
console.log("=".repeat(60));
console.log(`  Agent ID: ${process.env.AGENT_ID || "unknown"}`);
console.log(`  Agent Name: ${process.env.AGENT_NAME || "unnamed"}`);
console.log("=".repeat(60));
console.log();

const agent = new AgentRunner();
agent.run();
