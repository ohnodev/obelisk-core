/**
 * Base node class and execution context.
 * Mirrors Python src/core/execution/node_base.py
 */
import { NodeID, NodeData, StorageInterface } from "../types";
import { getLogger } from "../../utils/logger";

const logger = getLogger("nodeBase");

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

  /** Populated by the engine before execution: maps inputName → {nodeId, outputName} */
  inputConnections: Record<string, { nodeId: string; outputName: string }[]> =
    {};

  constructor(nodeId: string, nodeData: NodeData) {
    this.nodeId = nodeId;
    this.nodeType = nodeData.type;
    this.inputs = (nodeData.inputs as Record<string, unknown>) ?? {};
    this.metadata = (nodeData.metadata as Record<string, unknown>) ?? {};
  }

  /** Execute the node logic. Must be implemented by subclasses. */
  abstract execute(
    context: ExecutionContext
  ): Promise<Record<string, unknown>> | Record<string, unknown>;

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

    // 2. Direct input value
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

  /** Resolve {{varName}} templates against context.variables */
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
      return context.variables[varName] ?? value;
    }

    // Otherwise replace all {{var}} occurrences inline (always returns string).
    return value.replace(/\{\{(.+?)\}\}/g, (_match, varName: string) => {
      const resolved = context.variables[varName.trim()];
      return resolved !== undefined ? String(resolved) : _match;
    });
  }
}
