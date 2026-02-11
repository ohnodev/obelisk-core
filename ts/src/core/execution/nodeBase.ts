/**
 * Base node class and execution context.
 * Mirrors Python src/core/execution/node_base.py
 */
import { NodeID, NodeData, StorageInterface, WorkflowData } from "../types";
import { getLogger } from "../../utils/logger";

const logger = getLogger("nodeBase");

/**
 * Node execution modes for autonomous workflows.
 *
 * ONCE:       Execute once per workflow run (default behaviour)
 * CONTINUOUS: Keep executing on each tick (scheduler / listener nodes)
 * TRIGGERED:  Execute only when a trigger input fires
 */
export enum ExecutionMode {
  ONCE = "once",
  CONTINUOUS = "continuous",
  TRIGGERED = "triggered",
}

/** Shared context passed to every node during execution */
export interface ExecutionContext {
  /** Context variables (user_query, user_id, etc.) */
  variables: Record<string, unknown>;
  /** Collected outputs from already-executed upstream nodes, keyed by nodeId */
  nodeOutputs: Record<NodeID, Record<string, unknown>>;
  /** Active storage instance (resolved from MemoryStorageNode) */
  storage?: StorageInterface;
}

/**
 * Abstract base class for all workflow nodes.
 *
 * Subclasses MUST override `execute()`.
 */
export abstract class BaseNode {
  readonly nodeId: string;
  readonly nodeType: string;
  inputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
  position: { x: number; y: number };

  /** Default execution mode — override in subclasses (e.g. SchedulerNode, TelegramListenerNode). */
  static executionMode: ExecutionMode = ExecutionMode.ONCE;

  /** Populated by the engine before execution: maps inputName → {nodeId, outputName} */
  inputConnections: Record<string, { nodeId: string; outputName: string }[]> =
    {};

  /** Internal triggered state (for TRIGGERED mode nodes) */
  private _triggered = false;

  constructor(nodeId: string, nodeData: NodeData) {
    this.nodeId = nodeId;
    this.nodeType = nodeData.type;
    // Deep copy inputs to prevent mutations from affecting original workflow
    this.inputs = JSON.parse(
      JSON.stringify((nodeData.inputs as Record<string, unknown>) ?? {})
    );
    this.metadata = (nodeData.metadata as Record<string, unknown>) ?? {};
    this.position = nodeData.position ?? { x: 0, y: 0 };
  }

  // ── Setup / Initialization ──────────────────────────────────────────

  /**
   * Initialize node after all nodes are built.
   * Called by engine/runner to allow nodes to set up relationships and state.
   * Override in subclasses for custom initialization (e.g. TelegramListenerNode
   * fetches bot info, SchedulerNode seeds timing state).
   *
   * May return a Promise for async initialisation (e.g. network calls).
   *
   * Mirrors Python `initialize()`.
   */
  initialize(
    _workflow: WorkflowData,
    _allNodes: Map<NodeID, BaseNode>
  ): void | Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Setup node after all nodes are built (alias for initialize for backward compat).
   * Called by engine to allow nodes to set up relationships.
   *
   * Mirrors Python `_setup()`.
   */
  _setup(
    workflow: WorkflowData,
    allNodes: Map<NodeID, BaseNode>
  ): void | Promise<void> {
    return this.initialize(workflow, allNodes);
  }

  // ── Autonomous-node helpers ───────────────────────────────────────

  /** True when this node runs continuously (CONTINUOUS mode). */
  isAutonomous(): boolean {
    return (this.constructor as typeof BaseNode).executionMode === ExecutionMode.CONTINUOUS;
  }

  /** True when this node only runs when triggered. */
  isTriggered(): boolean {
    return (this.constructor as typeof BaseNode).executionMode === ExecutionMode.TRIGGERED;
  }

  /** Set the triggered state for this node. */
  setTriggered(value = true): void {
    this._triggered = value;
  }

  /** Check if node was triggered and clear the trigger state. */
  checkAndClearTrigger(): boolean {
    const wasTriggered = this._triggered;
    this._triggered = false;
    return wasTriggered;
  }

  /**
   * Called on each runner tick for CONTINUOUS nodes.
   * Return an output dict to "fire" the node this tick, or `null` to skip.
   * Override in autonomous subclasses (SchedulerNode, TelegramListenerNode).
   */
  onTick(_context: ExecutionContext): Promise<Record<string, unknown> | null> | Record<string, unknown> | null {
    return null;
  }

  /** Execute the node logic. Must be implemented by subclasses. */
  abstract execute(
    context: ExecutionContext
  ): Promise<Record<string, unknown>> | Record<string, unknown>;

  /**
   * Clean up resources when the workflow is stopped (e.g. close HTTP server).
   * Override in subclasses that acquire resources in initialize().
   */
  dispose(): void | Promise<void> {
    // Default: no-op
  }

  // ── Input resolution ────────────────────────────────────────────────

  /**
   * Resolve an input value.
   *
   * Priority:
   * 1. Connected upstream output (via inputConnections)
   * 2. Direct value in this.inputs
   * 3. Metadata fallback (node.properties in the frontend)
   * 4. defaultValue
   */
  getInputValue(
    inputName: string,
    context: ExecutionContext,
    defaultValue: unknown = undefined
  ): unknown {
    // 1. Check connections
    const connections = this.inputConnections[inputName];
    if (connections && connections.length > 0) {
      // Use the first connection (most recent)
      const conn = connections[0];
      const upstreamOutputs = context.nodeOutputs[conn.nodeId];
      if (upstreamOutputs !== undefined) {
        const val = upstreamOutputs[conn.outputName];
        if (val !== undefined) {
          logger.debug(
            `[Node ${this.nodeId}] Input '${inputName}' resolved from node ${conn.nodeId}.${conn.outputName}`
          );
          return val;
        }
      }
    }

    // 2. Direct input value (check if it's a template variable)
    if (inputName in this.inputs) {
      const raw = this.inputs[inputName];
      return this.resolveTemplateVariable(raw, context);
    }

    // 3. Metadata fallback
    if (inputName in this.metadata) {
      const raw = this.metadata[inputName];
      return this.resolveTemplateVariable(raw, context);
    }

    return defaultValue;
  }

  // ── Template / Env variable resolution ──────────────────────────────

  /**
   * Resolve {{process.env.VAR}} templates against real environment variables.
   * Works without an ExecutionContext — safe to call for metadata values.
   */
  protected resolveEnvVar(value: unknown): unknown {
    if (typeof value !== "string") return value;

    // Single template: {{process.env.VAR}}
    const fullMatch = value.match(/^\{\{(.+?)\}\}$/);
    if (fullMatch) {
      const varName = fullMatch[1].trim();
      if (varName.startsWith("process.env.")) {
        const envKey = varName.slice("process.env.".length);
        return process.env[envKey] ?? value;
      }
    }

    // Inline replacement for multiple templates
    return value.replace(/\{\{(.+?)\}\}/g, (_match, varName: string) => {
      const trimmed = varName.trim();
      if (trimmed.startsWith("process.env.")) {
        const envKey = trimmed.slice("process.env.".length);
        return process.env[envKey] ?? _match;
      }
      return _match;
    });
  }

  /** Resolve {{varName}} templates against context.variables and process.env */
  protected resolveTemplateVariable(
    value: unknown,
    context: ExecutionContext
  ): unknown {
    if (typeof value !== "string") return value;

    // If the entire value is a single template, return the raw variable
    // (preserves non-string types like objects / numbers).
    const fullMatch = value.match(/^\{\{(.+?)\}\}$/);
    if (fullMatch) {
      const varName = fullMatch[1].trim();
      // Check process.env first
      if (varName.startsWith("process.env.")) {
        const envKey = varName.slice("process.env.".length);
        return process.env[envKey] ?? value;
      }
      // Only resolve if variable exists in context (don't overwrite with undefined)
      if (varName in context.variables) {
        return context.variables[varName];
      }
      return value; // leave unresolved
    }

    // Otherwise replace all {{var}} occurrences inline (always returns string).
    return value.replace(/\{\{(.+?)\}\}/g, (_match, varName: string) => {
      const trimmed = varName.trim();
      if (trimmed.startsWith("process.env.")) {
        const envKey = trimmed.slice("process.env.".length);
        return process.env[envKey] ?? _match;
      }
      const resolved = context.variables[trimmed];
      return resolved !== undefined ? String(resolved) : _match;
    });
  }
}
