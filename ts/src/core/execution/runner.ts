/**
 * WorkflowRunner – manages continuous workflow execution with a fast tick loop.
 * Mirrors Python src/core/execution/runner.py
 *
 * Architecture:
 *   • A single setInterval (DEFAULT_TICK_MS = 100ms) drives all running workflows.
 *   • Each tick calls onTick() on every CONTINUOUS node (scheduler, telegram_listener).
 *   • When an autonomous node fires, the runner identifies the downstream subgraph
 *     and executes it through the ExecutionEngine, passing the autonomous node's
 *     outputs as initial_node_outputs so they flow into the graph.
 *   • Node instances are kept alive across ticks so stateful nodes (offset tracking,
 *     message queues, fire-counts, etc.) persist correctly.
 */
import {
  WorkflowData,
  ConnectionData,
  GraphExecutionResult,
  NodeID,
  NodeData,
} from "../types";
import { ExecutionEngine } from "./engine";
import { BaseNode, ExecutionContext } from "./nodeBase";
import { getNodeClass, registerAllNodes } from "./nodeRegistry";
import { convertBackendResults } from "../../api/conversion";
import { getLogger } from "../../utils/logger";

const logger = getLogger("runner");

// ── Configuration ──────────────────────────────────────────────────────

/** How often the tick loop fires (ms). Python uses 0.1s = 100ms. */
const DEFAULT_TICK_MS = 100;

/** How long (ms) to retain a stopped workflow so getStatus() still works. */
const STOPPED_RETENTION_MS = 60_000;

/** Maximum number of concurrent running workflows. */
const MAX_RUNNING_WORKFLOWS = 5;

/** Maximum running workflows per user. */
const MAX_WORKFLOWS_PER_USER = 2;

// ── Types ──────────────────────────────────────────────────────────────

/** Mirrors Python RunnerState enum */
type RunnerState = "stopped" | "running" | "paused";

interface WorkflowState {
  workflowId: string;
  workflow: WorkflowData;
  contextVariables: Record<string, unknown>;
  state: RunnerState;

  /** Live node instances — persist across ticks */
  nodes: Map<NodeID, BaseNode>;
  /** Shared execution context (node_outputs accumulate across ticks) */
  context: ExecutionContext;

  tickCount: number;
  lastTickTime: number;
  nodeCount: number;
  latestResults: Record<string, unknown> | null;
  resultsVersion: number;

  /** Timer that removes the entry after it has been stopped. */
  cleanupTimer?: ReturnType<typeof setTimeout>;

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

export class WorkflowLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowLimitError";
  }
}

// ── Serialization helper (mirrors Python _make_serializable) ──────────

function makeSerializable(value: unknown, maxDepth = 5): unknown {
  if (maxDepth <= 0) return "<max depth reached>";

  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => makeSerializable(item, maxDepth - 1));
  }

  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      // Non-plain object – return type info
      const typeName = (value as Record<string, unknown>).constructor?.name ?? "Object";
      try {
        const strRepr = String(value);
        if (strRepr.length < 200 && !strRepr.startsWith("<")) {
          return `<${typeName}: ${strRepr}>`;
        }
      } catch {
        // ignore
      }
      return `<${typeName}>`;
    }

    // Plain object – recursively serialize
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[String(k)] = makeSerializable(v, maxDepth - 1);
    }
    return obj;
  }

  return String(value);
}

// ── Runner ─────────────────────────────────────────────────────────────

export class WorkflowRunner {
  private engine: ExecutionEngine;
  private workflows: Map<string, WorkflowState> = new Map();

  /** Global tick interval handle (started on first workflow, stopped when last workflow ends). */
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  /** Guard: true while a tick is processing (prevents overlapping ticks). */
  private tickInFlight = false;

  constructor() {
    this.engine = new ExecutionEngine();
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Start a workflow.
   *
   * Mirrors Python start_workflow:
   * - Uses workflow's own ID (not UUID)
   * - Checks if already running (returns existing)
   * - Enforces total + per-user limits
   * - Builds node instances once, initialises CONTINUOUS nodes
   */
  startWorkflow(
    workflow: WorkflowData,
    contextVariables: Record<string, unknown> = {},
    onTickComplete?: (result: TickResult) => void,
    onError?: (error: string) => void
  ): string {
    const workflowId = workflow.id ?? `workflow-${Date.now()}`;
    const userId = String(contextVariables.user_id ?? "anonymous");

    // Check if already running
    const existing = this.workflows.get(workflowId);
    if (existing && existing.state === "running") {
      logger.warning(`Workflow ${workflowId} is already running`);
      return workflowId;
    }

    // Check total running workflows limit
    const runningCount = this.listWorkflows().length;
    if (runningCount >= MAX_RUNNING_WORKFLOWS) {
      throw new WorkflowLimitError(
        `Maximum running workflows reached (${MAX_RUNNING_WORKFLOWS}). ` +
          `Please stop a workflow first.`
      );
    }

    // Check per-user limit
    const userRunningCount = Array.from(this.workflows.values()).filter(
      (s) =>
        s.state === "running" &&
        String(s.contextVariables.user_id ?? "anonymous") === userId
    ).length;
    if (userRunningCount >= MAX_WORKFLOWS_PER_USER) {
      throw new WorkflowLimitError(
        `You have ${userRunningCount} running workflows (max ${MAX_WORKFLOWS_PER_USER}). ` +
          `Please stop one first.`
      );
    }

    // Build live node instances (defensive: workflow.nodes may be undefined)
    registerAllNodes();
    const nodes = new Map<NodeID, BaseNode>();
    for (const nd of workflow.nodes ?? []) {
      const Ctor = getNodeClass(nd.type);
      if (!Ctor) {
        logger.error(`Unknown node type "${nd.type}" for node ${nd.id} – skipping`);
        continue;
      }
      nodes.set(nd.id, new Ctor(nd.id, nd));
    }

    // Check for autonomous nodes
    const hasAutonomous = Array.from(nodes.values()).some((n) => n.isAutonomous());
    if (!hasAutonomous) {
      logger.info(`Workflow ${workflowId} has no autonomous nodes — executing once`);
      // Execute once and return (matches Python)
      this.engine
        .execute(workflow, contextVariables)
        .then((r) => {
          onTickComplete?.({
            tick: 0,
            success: r.success,
            executedNodes: r.executionOrder ?? [],
            executionTime: r.totalExecutionTime,
            error: r.error ?? undefined,
          });
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`Workflow ${workflowId} one-shot execution failed: ${msg}`);
          onTickComplete?.({
            tick: 0,
            success: false,
            executedNodes: [],
            executionTime: 0,
            error: msg,
          });
        });
      return workflowId;
    }

    // Wire connections on the live nodes
    for (const conn of workflow.connections) {
      const target = nodes.get(conn.target_node);
      if (!target) continue;
      if (!target.inputConnections[conn.target_input]) {
        target.inputConnections[conn.target_input] = [];
      }
      target.inputConnections[conn.target_input].push({
        nodeId: conn.source_node,
        outputName: conn.source_output,
      });
    }

    const context: ExecutionContext = {
      variables: { ...contextVariables },
      nodeOutputs: {},
    };

    // Initialise CONTINUOUS nodes via initialize() (no side-effect-producing execute())
    for (const [nid, node] of nodes) {
      if (node.isAutonomous()) {
        try {
          // initialize() may be async (e.g. TelegramListenerNode fetches bot info)
          const maybePromise = node.initialize(workflow, nodes);
          if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
            (maybePromise as Promise<void>).catch((err) => {
              logger.warning(`Async initialize failed for autonomous node ${nid}: ${err}`);
            });
          }
          logger.debug(`Initialized autonomous node ${nid}`);
        } catch (err) {
          logger.warning(`Failed to initialize autonomous node ${nid}: ${err}`);
        }
      }
    }

    const state: WorkflowState = {
      workflowId,
      workflow,
      contextVariables: { ...contextVariables },
      state: "running",
      nodes,
      context,
      tickCount: 0,
      lastTickTime: 0.0,
      nodeCount: nodes.size,
      latestResults: null,
      resultsVersion: 0,
      onTickComplete,
      onError,
    };

    this.workflows.set(workflowId, state);
    logger.info(`Started workflow ${workflowId} with ${nodes.size} nodes`);

    // Ensure global tick loop is running
    this.ensureTickLoop();

    return workflowId;
  }

  stopWorkflow(workflowId: string): boolean {
    const state = this.workflows.get(workflowId);
    if (!state) {
      logger.warning(`Workflow ${workflowId} not found`);
      return false;
    }

    state.state = "stopped";
    logger.info(`Stopped workflow ${workflowId} after ${state.tickCount} ticks`);

    // Remove from running workflows (matches Python: del self._running_workflows[workflow_id])
    this.workflows.delete(workflowId);

    // Stop tick loop if no more running workflows
    if (!this.listWorkflows().length) this.stopTickLoop();

    return true;
  }

  stopAll(): void {
    const ids = Array.from(this.workflows.keys());
    for (const id of ids) this.stopWorkflow(id);
    logger.info(`Stopped all workflows (${ids.length})`);
  }

  /**
   * Get status of a workflow.
   * Mirrors Python get_status return shape.
   */
  getStatus(
    workflowId: string
  ): {
    workflow_id: string;
    state: string;
    tick_count: number;
    last_tick_time: number;
    node_count: number;
    latest_results: Record<string, unknown> | null;
    results_version: number;
  } | null {
    const s = this.workflows.get(workflowId);
    if (!s) return null;
    return {
      workflow_id: workflowId,
      state: s.state,
      tick_count: s.tickCount,
      last_tick_time: s.lastTickTime,
      node_count: s.nodeCount,
      latest_results: s.latestResults,
      results_version: s.resultsVersion,
    };
  }

  /** List IDs of all running workflows. Mirrors Python list_running. */
  listWorkflows(): string[] {
    return Array.from(this.workflows.values())
      .filter((s) => s.state === "running")
      .map((s) => s.workflowId);
  }

  /** Execute a workflow once (no scheduling). */
  async executeOnce(
    workflow: WorkflowData,
    contextVariables: Record<string, unknown> = {}
  ): Promise<GraphExecutionResult> {
    return this.engine.execute(workflow, contextVariables);
  }

  // ── Tick loop ──────────────────────────────────────────────────────

  private ensureTickLoop(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.globalTick(), DEFAULT_TICK_MS);
    logger.debug("Started global tick loop");
  }

  private stopTickLoop(): void {
    if (!this.tickTimer) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
    logger.debug("Stopped global tick loop");
  }

  private async globalTick(): Promise<void> {
    if (this.tickInFlight) return; // skip if previous tick still running
    this.tickInFlight = true;

    try {
      const running = Array.from(this.workflows.values()).filter(
        (s) => s.state === "running"
      );
      for (const state of running) {
        try {
          await this.processTick(state);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`Error in workflow ${state.workflowId}: ${msg}`);
          state.onError?.(msg);
        }
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  // ── Per-workflow tick processing (mirrors Python _process_tick) ─────

  private async processTick(state: WorkflowState): Promise<void> {
    state.tickCount++;
    state.lastTickTime = Date.now() / 1000;

    const triggeredNodes = new Set<NodeID>();
    /** Autonomous nodes that actually fired THIS tick (not stale from prior ticks) */
    const firedAutonomousNodes = new Set<NodeID>();

    // Call onTick on every autonomous node
    for (const [nodeId, node] of state.nodes) {
      if (!node.isAutonomous()) continue;

      const result = await node.onTick(state.context);
      if (result !== null) {
        // Node fired — store its outputs and track it
        state.context.nodeOutputs[nodeId] = result;
        firedAutonomousNodes.add(nodeId);

        // Find nodes connected to this node's outputs
        for (const conn of state.workflow.connections) {
          const sourceId = String(conn.source_node ?? conn["from"] ?? "");
          if (sourceId === String(nodeId)) {
            const targetId = String(conn.target_node ?? conn["to"] ?? "");
            triggeredNodes.add(targetId);
          }
        }
      }
    }

    // If any autonomous node fired, execute the downstream subgraph
    if (triggeredNodes.size) {
      // Log which autonomous nodes triggered and which targets were found
      for (const nodeId of firedAutonomousNodes) {
        const node = state.nodes.get(nodeId)!;
        const outputs = state.context.nodeOutputs[nodeId];
        const preview = outputs?.message
          ? String(outputs.message).slice(0, 80)
          : "<no message>";
        logger.info(
          `[Tick ${state.tickCount}] Autonomous node ${nodeId} (${node.nodeType}) triggered: ${preview}`
        );
      }
      logger.info(
        `[Tick ${state.tickCount}] Downstream targets: [${Array.from(triggeredNodes).join(", ")}]`
      );
      await this.executeSubgraph(state, triggeredNodes, firedAutonomousNodes);
    }
  }

  // ── Subgraph execution (mirrors Python _execute_subgraph) ──────────

  private async executeSubgraph(
    state: WorkflowState,
    triggeredIds: Set<NodeID>,
    firedThisTick: Set<NodeID>
  ): Promise<void> {
    const { workflow, nodes, context } = state;

    // Autonomous source nodes whose outputs are already in context
    const autonomousSources = new Set<NodeID>();
    for (const [nid, node] of nodes) {
      if (node.isAutonomous() && context.nodeOutputs[nid]) {
        autonomousSources.add(nid);
      }
    }

    // Step 1: BFS downstream from triggered nodes
    const downstream = this.getAllDownstream(workflow, triggeredIds, nodes);

    // Step 2: Find upstream dependencies of the downstream nodes
    const subgraphNodeIds = this.getSubgraphWithDependencies(
      workflow,
      downstream,
      nodes
    );

    logger.info(
      `Autonomous trigger → executing subgraph with ${subgraphNodeIds.size} nodes: [${Array.from(subgraphNodeIds).join(", ")}]`
    );

    // Step 3: Build a filtered workflow
    const subWorkflow = this.buildSubgraphWorkflow(
      workflow,
      subgraphNodeIds,
      autonomousSources
    );

    // Step 4: Execute through the engine with initial outputs from autonomous nodes
    const result = await this.engine.execute(
      subWorkflow,
      context.variables,
      { ...context.nodeOutputs }
    );

    // Update context with new outputs
    for (const nr of result.nodeResults) {
      const nodeId = nr.nodeId;
      if (nodeId && nr.success) {
        context.nodeOutputs[nodeId] = nr.outputs;
      }
    }

    // Store latest results for frontend polling (sanitized for JSON serialization)
    // Mirrors Python runner._execute_subgraph result format
    state.resultsVersion++;

    // Only include autonomous nodes that fired THIS tick (not stale from prior ticks)
    // This keeps latestResults.executed_nodes consistent with the actual tick activity.
    const autonomousExecuted: string[] = [];
    const autonomousResults: Array<[string, { outputs: unknown }]> = [];
    for (const nid of firedThisTick) {
      if (context.nodeOutputs[nid]) {
        autonomousExecuted.push(nid);
        autonomousResults.push([
          nid,
          { outputs: makeSerializable(context.nodeOutputs[nid]) },
        ]);
      }
    }

    const subgraphExecuted = result.executionOrder ?? [];
    // Unified executed set — used for BOTH latestResults and onTickComplete
    const allExecuted = [...autonomousExecuted, ...subgraphExecuted];

    // Log what we're about to send so we can debug flashing issues
    const successfulNodeIds = result.nodeResults
      .filter((nr) => nr.success)
      .map((nr) => String(nr.nodeId));
    const failedNodeIds = result.nodeResults
      .filter((nr) => !nr.success)
      .map((nr) => `${nr.nodeId}(${nr.error ?? "?"})`);

    logger.info(
      `[Subgraph] executed_nodes=[${allExecuted.join(", ")}] ` +
        `successful=[${successfulNodeIds.join(", ")}] ` +
        (failedNodeIds.length
          ? `failed=[${failedNodeIds.join(", ")}] `
          : "") +
        `engine_success=${result.success} version=${state.resultsVersion}`
    );

    const resultsMap = Object.fromEntries([
      ...autonomousResults,
      ...result.nodeResults
        .filter((nr) => nr.success)
        .map((nr) => [
          String(nr.nodeId),
          { outputs: makeSerializable(nr.outputs) },
        ]),
    ]);

    state.latestResults = {
      tick: state.tickCount,
      success: result.success,
      executed_nodes: allExecuted,
      results: resultsMap,
      error: result.error ?? null,
      version: state.resultsVersion,
    };

    // Completion callback uses the same unified allExecuted set
    state.onTickComplete?.({
      tick: state.tickCount,
      success: result.success,
      executedNodes: allExecuted,
      executionTime: result.totalExecutionTime,
      error: result.error ?? undefined,
    });

    if (result.success) {
      logger.info(
        `Subgraph execution completed successfully in ${result.totalExecutionTime}ms`
      );
    } else {
      logger.error(`Subgraph execution failed: ${result.error}`);
    }
  }

  // ── Graph helpers (mirrors Python _get_all_downstream etc.) ────────

  /** BFS to find all nodes downstream from `startNodes`. */
  private getAllDownstream(
    workflow: WorkflowData,
    startNodes: Set<NodeID>,
    nodes: Map<NodeID, BaseNode>
  ): Set<NodeID> {
    const connections = workflow.connections ?? [];
    const adj = new Map<NodeID, Set<NodeID>>();
    for (const nid of nodes.keys()) adj.set(nid, new Set());
    for (const conn of connections) {
      const sourceId = String(conn.source_node ?? conn["from"] ?? "");
      const targetId = String(conn.target_node ?? conn["to"] ?? "");
      adj.get(sourceId)?.add(targetId);
    }

    const downstream = new Set(startNodes);
    const queue = [...startNodes];
    while (queue.length) {
      const nid = queue.shift()!;
      for (const target of adj.get(nid) ?? []) {
        if (!downstream.has(target)) {
          downstream.add(target);
          queue.push(target);
        }
      }
    }
    return downstream;
  }

  /** BFS backwards to find upstream dependencies (excluding autonomous nodes). */
  private getSubgraphWithDependencies(
    workflow: WorkflowData,
    downstreamNodes: Set<NodeID>,
    nodes: Map<NodeID, BaseNode>
  ): Set<NodeID> {
    const connections = workflow.connections ?? [];
    const reverseAdj = new Map<NodeID, Set<NodeID>>();
    for (const nid of nodes.keys()) reverseAdj.set(nid, new Set());
    for (const conn of connections) {
      const sourceId = String(conn.source_node ?? conn["from"] ?? "");
      const targetId = String(conn.target_node ?? conn["to"] ?? "");
      reverseAdj.get(targetId)?.add(sourceId);
    }

    const subgraph = new Set(downstreamNodes);
    const queue = [...downstreamNodes];
    while (queue.length) {
      const nid = queue.shift()!;
      for (const source of reverseAdj.get(nid) ?? []) {
        if (!subgraph.has(source)) {
          const node = nodes.get(source);
          // Don't traverse into autonomous nodes — their outputs are already seeded
          if (node && !node.isAutonomous()) {
            subgraph.add(source);
            queue.push(source);
          }
        }
      }
    }
    return subgraph;
  }

  /** Build a filtered WorkflowData containing only the subgraph nodes. */
  private buildSubgraphWorkflow(
    workflow: WorkflowData,
    subgraphNodes: Set<NodeID>,
    autonomousSources: Set<NodeID>
  ): WorkflowData {
    const filteredNodes = (workflow.nodes ?? []).filter((n) =>
      subgraphNodes.has(n.id)
    );

    const filteredConnections = (workflow.connections ?? []).filter((conn) => {
      const sourceId = String(conn.source_node ?? conn["from"] ?? "");
      const targetId = String(conn.target_node ?? conn["to"] ?? "");
      if (!subgraphNodes.has(targetId)) return false;
      return (
        subgraphNodes.has(sourceId) ||
        autonomousSources.has(sourceId)
      );
    });

    return {
      id: workflow.id ?? "subgraph",
      name: workflow.name ?? "Subgraph",
      nodes: filteredNodes,
      connections: filteredConnections,
    };
  }
}
