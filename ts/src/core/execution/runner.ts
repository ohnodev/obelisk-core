/**
 * WorkflowRunner – manages workflow lifecycle and scheduling.
 * Mirrors Python src/core/execution/runner.py
 *
 * Responsibilities:
 * - Start / stop workflows
 * - Periodic tick-based execution (for schedulers)
 * - Status tracking with latest results + version counter
 *
 * Ticks use a self-scheduling async loop (setTimeout + await) instead of
 * setInterval to guarantee a new tick never starts while the previous one
 * is still in flight.
 */
import crypto from "crypto";
import {
  WorkflowData,
  GraphExecutionResult,
} from "../types";
import { ExecutionEngine } from "./engine";
import { SchedulerNode } from "./nodes/scheduler";
import { convertBackendResults } from "../../api/conversion";
import { getLogger } from "../../utils/logger";

const logger = getLogger("runner");

/** How long (ms) to retain a stopped workflow in the map so getStatus() still works. */
const STOPPED_RETENTION_MS = 60_000;

interface WorkflowState {
  workflowId: string;
  workflow: WorkflowData;
  contextVariables: Record<string, unknown>;
  state: "running" | "stopped" | "error";
  tickCount: number;
  tickInterval: number; // ms
  /** Handle for the next scheduled setTimeout (undefined when a tick is in flight). */
  timer?: ReturnType<typeof setTimeout>;
  /** Timer that removes the entry from the map after it has been stopped. */
  cleanupTimer?: ReturnType<typeof setTimeout>;
  /** True while executeTick is running – prevents overlapping ticks. */
  inFlight: boolean;
  /** Last time a tick executed (epoch seconds) */
  lastTickTime: number | null;
  /** Number of nodes in the workflow */
  nodeCount: number;
  /** Frontend-formatted results from the most recent tick */
  latestResults: Record<string, unknown> | null;
  /** Incremented on each tick – frontend can use this to detect new results */
  resultsVersion: number;
  onTickComplete?: (result: TickResult) => void;
  onError?: (error: string) => void;
}

export interface TickResult {
  tick: number;
  success: boolean;
  executedNodes: string[];
  error?: string;
  executionTime?: number;
}

export class WorkflowRunner {
  private engine: ExecutionEngine;
  private workflows: Map<string, WorkflowState> = new Map();

  constructor() {
    this.engine = new ExecutionEngine();
  }

  /**
   * Start a workflow.
   *
   * @param workflow          Workflow JSON
   * @param contextVariables  Variables injected into execution
   * @param tickIntervalMs    Time between ticks (default 30 000 ms)
   * @param onTickComplete    Callback after each tick
   * @param onError           Callback on error
   * @returns A unique workflow ID
   */
  startWorkflow(
    workflow: WorkflowData,
    contextVariables: Record<string, unknown> = {},
    tickIntervalMs = 30_000,
    onTickComplete?: (result: TickResult) => void,
    onError?: (error: string) => void
  ): string {
    const workflowId = crypto.randomUUID();

    // Reset any stale scheduler state for this workflow
    SchedulerNode.resetWorkflow(workflowId);

    // Inject _workflowId so SchedulerNode can scope its fire-times
    const vars = { ...contextVariables, _workflowId: workflowId };

    const state: WorkflowState = {
      workflowId,
      workflow,
      contextVariables: vars,
      state: "running",
      tickCount: 0,
      tickInterval: tickIntervalMs,
      inFlight: false,
      lastTickTime: null,
      nodeCount: workflow.nodes?.length ?? 0,
      latestResults: null,
      resultsVersion: 0,
      onTickComplete,
      onError,
    };

    this.workflows.set(workflowId, state);

    logger.info(`Workflow ${workflowId} started (tick every ${tickIntervalMs}ms)`);

    // Kick off the self-scheduling tick loop (first tick fires immediately)
    this.scheduleNextTick(workflowId, 0);

    return workflowId;
  }

  /** Stop a running workflow. The entry is retained briefly for getStatus() then purged. */
  stopWorkflow(workflowId: string): boolean {
    const state = this.workflows.get(workflowId);
    if (!state) return false;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    state.state = "stopped";

    // Clear scheduler fire-times so a future restart begins fresh
    SchedulerNode.resetWorkflow(workflowId);

    // Schedule removal from the map so it doesn't grow unbounded
    state.cleanupTimer = setTimeout(() => {
      this.workflows.delete(workflowId);
    }, STOPPED_RETENTION_MS);

    logger.info(`Workflow ${workflowId} stopped after ${state.tickCount} ticks`);
    return true;
  }

  /** Stop all running workflows */
  stopAll(): void {
    const ids = this.listWorkflows();
    for (const id of ids) {
      this.stopWorkflow(id);
    }
    logger.info(`Stopped all workflows (${ids.length})`);
  }

  /**
   * Get status of a workflow.
   * Returns a shape matching Python's WorkflowStatusResponse.
   */
  getStatus(
    workflowId: string
  ): {
    state: string;
    tickCount: number;
    lastTickTime: number | null;
    nodeCount: number;
    latestResults: Record<string, unknown> | null;
    resultsVersion: number;
  } | null {
    const s = this.workflows.get(workflowId);
    if (!s) return null;
    return {
      state: s.state,
      tickCount: s.tickCount,
      lastTickTime: s.lastTickTime,
      nodeCount: s.nodeCount,
      latestResults: s.latestResults,
      resultsVersion: s.resultsVersion,
    };
  }

  /** List IDs of currently running workflows (excludes stopped/errored). */
  listWorkflows(): string[] {
    return Array.from(this.workflows.values())
      .filter((s) => s.state === "running")
      .map((s) => s.workflowId);
  }

  /** Execute a single workflow synchronously (no scheduling) */
  async executeOnce(
    workflow: WorkflowData,
    contextVariables: Record<string, unknown> = {}
  ): Promise<GraphExecutionResult> {
    return this.engine.execute(workflow, contextVariables);
  }

  // ── Private ────────────────────────────────────────────────────────

  /**
   * Schedule the next tick after `delayMs` milliseconds.
   * Uses setTimeout + await so ticks never overlap.
   */
  private scheduleNextTick(workflowId: string, delayMs: number): void {
    const state = this.workflows.get(workflowId);
    if (!state || state.state !== "running") return;

    state.timer = setTimeout(async () => {
      state.timer = undefined;

      // Guard: skip if already in flight or no longer running
      if (state.inFlight || state.state !== "running") return;

      state.inFlight = true;
      try {
        await this.executeTick(workflowId);
      } finally {
        state.inFlight = false;
      }

      // Schedule the next tick (only if still running after execution)
      if (state.state === "running") {
        this.scheduleNextTick(workflowId, state.tickInterval);
      }
    }, delayMs);
  }

  private async executeTick(workflowId: string): Promise<void> {
    const state = this.workflows.get(workflowId);
    if (!state || state.state !== "running") return;

    state.tickCount++;
    const tickNum = state.tickCount;
    state.lastTickTime = Date.now() / 1000;

    try {
      const result = await this.engine.execute(
        state.workflow,
        state.contextVariables
      );

      // Increment version and store frontend-formatted results
      state.resultsVersion++;
      state.latestResults = {
        tick: tickNum,
        success: result.success,
        executed_nodes: result.executionOrder ?? [],
        results: convertBackendResults(result),
        error: result.error,
        version: state.resultsVersion,
      };

      const tickResult: TickResult = {
        tick: tickNum,
        success: result.success,
        executedNodes: result.executionOrder ?? [],
        executionTime: result.totalExecutionTime,
      };

      if (!result.success) {
        tickResult.error = result.error;
      }

      state.onTickComplete?.(tickResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Tick #${tickNum} error: ${msg}`);
      state.onError?.(msg);
    }
  }
}
