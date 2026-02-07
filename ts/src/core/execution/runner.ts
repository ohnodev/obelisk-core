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
import crypto from "crypto";
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

/** How often the tick loop fires (ms). Python uses 100ms. */
const DEFAULT_TICK_MS = 100;

/** How long (ms) to retain a stopped workflow so getStatus() still works. */
const STOPPED_RETENTION_MS = 60_000;

/** Maximum number of concurrent running workflows. */
const MAX_RUNNING_WORKFLOWS = 5;

// ── Types ──────────────────────────────────────────────────────────────

interface WorkflowState {
  workflowId: string;
  workflow: WorkflowData;
  contextVariables: Record<string, unknown>;
  state: "running" | "stopped" | "error";

  /** Live node instances — persist across ticks */
  nodes: Map<NodeID, BaseNode>;
  /** Shared execution context (node_outputs accumulate across ticks) */
  context: ExecutionContext;

  tickCount: number;
  lastTickTime: number | null;
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
   * Builds node instances once, initialises CONTINUOUS nodes (execute()),
   * then joins the global tick loop.
   */
  startWorkflow(
    workflow: WorkflowData,
    contextVariables: Record<string, unknown> = {},
    _tickIntervalMs?: number, // kept for API compat, ignored (uses DEFAULT_TICK_MS)
    onTickComplete?: (result: TickResult) => void,
    onError?: (error: string) => void
  ): string {
    // Throttle
    const runningCount = this.listWorkflows().length;
    if (runningCount >= MAX_RUNNING_WORKFLOWS) {
      throw new Error(
        `Maximum running workflows reached (${MAX_RUNNING_WORKFLOWS}). Stop one first.`
      );
    }

    const workflowId = crypto.randomUUID();

    // Build live node instances
    registerAllNodes();
    const nodes = new Map<NodeID, BaseNode>();
    for (const nd of workflow.nodes) {
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

    const vars = { ...contextVariables, _workflowId: workflowId };
    const context: ExecutionContext = {
      variables: vars,
      nodeOutputs: {},
    };

    // Initialise CONTINUOUS nodes (seed timing state)
    for (const [nid, node] of nodes) {
      if (node.isAutonomous()) {
        try {
          node.execute(context);
          logger.debug(`Initialized autonomous node ${nid}`);
        } catch (err) {
          logger.warn(`Failed to initialize autonomous node ${nid}: ${err}`);
        }
      }
    }

    const state: WorkflowState = {
      workflowId,
      workflow,
      contextVariables: vars,
      state: "running",
      nodes,
      context,
      tickCount: 0,
      lastTickTime: null,
      nodeCount: nodes.size,
      latestResults: null,
      resultsVersion: 0,
      onTickComplete,
      onError,
    };

    this.workflows.set(workflowId, state);
    logger.info(`Workflow ${workflowId} started (tick every ${DEFAULT_TICK_MS}ms)`);

    // Ensure global tick loop is running
    this.ensureTickLoop();

    return workflowId;
  }

  stopWorkflow(workflowId: string): boolean {
    const state = this.workflows.get(workflowId);
    if (!state) return false;

    state.state = "stopped";

    // Schedule cleanup so getStatus() still works briefly
    state.cleanupTimer = setTimeout(() => {
      this.workflows.delete(workflowId);
    }, STOPPED_RETENTION_MS);

    logger.info(`Workflow ${workflowId} stopped after ${state.tickCount} ticks`);

    // Stop tick loop if no more running workflows
    if (!this.listWorkflows().length) this.stopTickLoop();

    return true;
  }

  stopAll(): void {
    const ids = this.listWorkflows();
    for (const id of ids) this.stopWorkflow(id);
    logger.info(`Stopped all workflows (${ids.length})`);
  }

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

    // Call onTick on every autonomous node
    for (const [nodeId, node] of state.nodes) {
      if (!node.isAutonomous()) continue;

      const result = await node.onTick(state.context);
      if (result !== null) {
        // Node fired — store its outputs and find downstream targets
        state.context.nodeOutputs[nodeId] = result;

        for (const conn of state.workflow.connections) {
          if (conn.source_node === nodeId) {
            triggeredNodes.add(conn.target_node);
          }
        }
      }
    }

    // If any autonomous node fired, execute the downstream subgraph
    if (triggeredNodes.size) {
      await this.executeSubgraph(state, triggeredNodes);
    }
  }

  // ── Subgraph execution (mirrors Python _execute_subgraph) ──────────

  private async executeSubgraph(
    state: WorkflowState,
    triggeredIds: Set<NodeID>
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
    const downstream = this.getAllDownstream(workflow.connections, triggeredIds, nodes);

    // Step 2: Find upstream dependencies of the downstream nodes
    const subgraphNodeIds = this.getSubgraphWithDependencies(
      workflow.connections,
      downstream,
      nodes
    );

    logger.info(
      `Scheduler triggered – executing subgraph with ${subgraphNodeIds.size} nodes`
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

    // Merge outputs back into context
    for (const nr of result.nodeResults) {
      if (nr.success) {
        context.nodeOutputs[nr.nodeId] = nr.outputs;
      }
    }

    // Store latest results for frontend polling
    state.resultsVersion++;
    state.latestResults = {
      tick: state.tickCount,
      success: result.success,
      executed_nodes: result.executionOrder ?? [],
      results: convertBackendResults(result),
      error: result.error,
      version: state.resultsVersion,
    };

    state.onTickComplete?.({
      tick: state.tickCount,
      success: result.success,
      executedNodes: result.executionOrder ?? [],
      executionTime: result.totalExecutionTime,
      error: result.error ?? undefined,
    });

    if (result.success) {
      logger.info("Subgraph execution completed successfully");
    } else {
      logger.error(`Subgraph execution failed: ${result.error}`);
    }
  }

  // ── Graph helpers (mirrors Python _get_all_downstream etc.) ────────

  /** BFS to find all nodes downstream from `startNodes`. */
  private getAllDownstream(
    connections: ConnectionData[],
    startNodes: Set<NodeID>,
    nodes: Map<NodeID, BaseNode>
  ): Set<NodeID> {
    const adj = new Map<NodeID, Set<NodeID>>();
    for (const nid of nodes.keys()) adj.set(nid, new Set());
    for (const conn of connections) {
      adj.get(conn.source_node)?.add(conn.target_node);
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
    connections: ConnectionData[],
    downstreamNodes: Set<NodeID>,
    nodes: Map<NodeID, BaseNode>
  ): Set<NodeID> {
    const reverseAdj = new Map<NodeID, Set<NodeID>>();
    for (const nid of nodes.keys()) reverseAdj.set(nid, new Set());
    for (const conn of connections) {
      reverseAdj.get(conn.target_node)?.add(conn.source_node);
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
    const filteredNodes = workflow.nodes.filter((n) =>
      subgraphNodes.has(n.id)
    );

    const filteredConnections = workflow.connections.filter((conn) => {
      if (!subgraphNodes.has(conn.target_node)) return false;
      return (
        subgraphNodes.has(conn.source_node) ||
        autonomousSources.has(conn.source_node)
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
