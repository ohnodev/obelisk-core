/**
 * Execution Engine – topological sort + DAG execution.
 * Mirrors Python src/core/execution/engine.py
 *
 * 1. Validates workflow graph structure
 * 2. Builds a DAG and computes topological execution order
 * 3. Instantiates node classes via the registry
 * 4. Executes nodes in order, propagating outputs via connections
 *    – Stops on first error (matches Python behaviour)
 */
import {
  NodeID,
  WorkflowData,
  ConnectionData,
  NodeData,
  GraphExecutionResult,
} from "../types";
import { BaseNode, ExecutionContext } from "./nodeBase";
import { getNodeClass, registerAllNodes } from "./nodeRegistry";
import { getLogger } from "../../utils/logger";

const logger = getLogger("engine");

export class CycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleError";
  }
}

export class ExecutionEngine {
  constructor() {
    // Ensure all node types are registered
    registerAllNodes();
  }

  // ── Main entry point ────────────────────────────────────────────────

  /**
   * Execute a workflow graph.
   *
   * @param workflow  The workflow JSON (nodes + connections)
   * @param contextVariables  Variables injected into execution (user_query, etc.)
   * @param initialNodeOutputs  Pre-seeded node outputs (e.g. from autonomous nodes in the runner)
   * @returns Execution result with per-node outputs
   */
  async execute(
    workflow: WorkflowData,
    contextVariables: Record<string, unknown> = {},
    initialNodeOutputs: Record<NodeID, Record<string, unknown>> = {}
  ): Promise<GraphExecutionResult> {
    const startTime = Date.now();

    logger.info(
      `Executing workflow: ${workflow.name ?? workflow.id ?? "unknown"}`
    );

    try {
      // 1. Validate graph (allow external sources if their outputs are provided)
      const externalSources = new Set(Object.keys(initialNodeOutputs));
      if (!this.validateGraph(workflow, externalSources)) {
        return {
          graphId: workflow.id ?? "unknown",
          success: false,
          nodeResults: [],
          finalOutputs: {},
          error: "Graph validation failed",
          totalExecutionTime: Date.now() - startTime,
        };
      }

      // 2. Build node instances
      const nodeMap = this.buildNodeMap(workflow);
      if (!nodeMap.size) {
        return {
          graphId: workflow.id ?? "unknown",
          success: true,
          nodeResults: [],
          finalOutputs: {},
          executionOrder: [],
          totalExecutionTime: 0,
        };
      }

      // 3. Second pass: setup all nodes (allows cross-node discovery)
      for (const node of nodeMap.values()) {
        node._setup(workflow, nodeMap);
      }

      // 4. Resolve execution order (topological sort)
      let order: NodeID[];
      try {
        order = this.topologicalSort(nodeMap, workflow.connections);
      } catch (err) {
        if (err instanceof CycleError) {
          return {
            graphId: workflow.id ?? "unknown",
            success: false,
            nodeResults: [],
            finalOutputs: {},
            error: `Cycle detected in workflow graph: ${err.message}`,
            totalExecutionTime: Date.now() - startTime,
          };
        }
        throw err;
      }

      // 5. Create execution context with pre-seeded outputs
      const context: ExecutionContext = {
        variables: { ...contextVariables },
        nodeOutputs: { ...initialNodeOutputs }, // copy to avoid mutation
      };

      // 6. Execute nodes in order
      const nodeResults: GraphExecutionResult["nodeResults"] = [];
      const errors: string[] = [];

      for (const nodeId of order) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;

        const nodeStart = Date.now();
        try {
          // Resolve inputs from connections (mirrors Python _resolve_node_inputs)
          const resolvedInputs = this.resolveNodeInputs(
            node,
            workflow,
            context
          );

          // Save original inputs, apply resolved values
          const originalInputs = { ...node.inputs };
          Object.assign(node.inputs, resolvedInputs);

          // Execute node
          const outputs = await node.execute(context);

          // Store outputs in context
          context.nodeOutputs[nodeId] = outputs;

          // Restore original inputs (prevents side-effects across ticks)
          node.inputs = originalInputs;

          const nodeExecTime = Date.now() - nodeStart;
          nodeResults.push({
            nodeId,
            success: true,
            outputs,
            executionTime: nodeExecTime,
          });

          // Log per-node execution at INFO level so it's visible in logs
          // (Python logs at debug, but we want visibility for debugging)
          const outputKeys = Object.keys(outputs);
          const outputSummary = outputKeys
            .map((k) => {
              const v = outputs[k];
              if (v === null || v === undefined) return `${k}=null`;
              if (typeof v === "string") return `${k}="${v.length > 60 ? v.slice(0, 60) + "..." : v}"`;
              if (typeof v === "boolean" || typeof v === "number") return `${k}=${v}`;
              return `${k}=<${typeof v}>`;
            })
            .join(", ");
          logger.info(
            `  Node ${nodeId} (${node.nodeType}) → ${nodeExecTime}ms [${outputSummary}]`
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const fullErrMsg = `Node ${nodeId} (${node.nodeType}) failed: ${errorMsg}`;
          errors.push(fullErrMsg);
          logger.error(`  ✗ ${fullErrMsg}`);

          nodeResults.push({
            nodeId,
            success: false,
            outputs: {},
            error: errorMsg,
            executionTime: Date.now() - nodeStart,
          });

          // Stop execution on error (matches Python behaviour)
          break;
        }
      }

      // 7. Collect final outputs (from output_text nodes – matches Python)
      const finalOutputs = this.collectFinalOutputs(workflow, context);

      const overallSuccess = errors.length === 0;

      logger.info(
        `Workflow execution ${overallSuccess ? "succeeded" : "failed"} in ${Date.now() - startTime}ms`
      );

      return {
        graphId: workflow.id,
        success: overallSuccess,
        nodeResults,
        finalOutputs,
        error: errors.length ? errors.join("; ") : undefined,
        executionOrder: order,
        totalExecutionTime: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Execution failed: ${errorMsg}`);
      return {
        graphId: workflow.id,
        success: false,
        nodeResults: [],
        finalOutputs: {},
        error: errorMsg,
        totalExecutionTime: Date.now() - startTime,
      };
    }
  }

  // ── Graph validation (mirrors Python validate_graph) ────────────────

  /**
   * Validate workflow graph structure.
   *
   * @param workflow  The workflow to validate
   * @param externalSources  Node IDs that are valid sources even if not in
   *   the workflow (used for autonomous nodes whose outputs are passed via
   *   initialNodeOutputs)
   */
  validateGraph(
    workflow: WorkflowData,
    externalSources: Set<NodeID> = new Set()
  ): boolean {
    if (!workflow.nodes || workflow.nodes.length === 0) {
      logger.error("Workflow has no nodes");
      return false;
    }

    if (!workflow.connections) {
      workflow.connections = [];
    }

    // Check all connections reference valid nodes
    const nodeIds = new Set(workflow.nodes.map((n) => String(n.id)));

    for (const conn of workflow.connections) {
      // Support both formats: source_node/target_node (backend) and from/to (frontend)
      const sourceId = String(conn.source_node ?? conn["from"] ?? "");
      const targetId = String(conn.target_node ?? conn["to"] ?? "");

      if (
        !nodeIds.has(sourceId) &&
        !externalSources.has(sourceId)
      ) {
        logger.error(
          `Connection references invalid source node: ${sourceId}`
        );
        return false;
      }
      if (!nodeIds.has(targetId)) {
        logger.error(
          `Connection references invalid target node: ${targetId}`
        );
        return false;
      }
    }

    // Check all node types are registered
    for (const node of workflow.nodes) {
      if (!node.type) {
        logger.error(`Node ${node.id} has no type`);
        return false;
      }
      if (!getNodeClass(node.type)) {
        logger.error(`Unknown node type: ${node.type}`);
        return false;
      }
    }

    return true;
  }

  // ── Helpers (public so WorkflowRunner can use for subgraph building) ─

  buildNodeMap(workflow: WorkflowData): Map<NodeID, BaseNode> {
    const map = new Map<NodeID, BaseNode>();
    for (const nodeData of workflow.nodes) {
      const Ctor = getNodeClass(nodeData.type);
      if (!Ctor) {
        logger.error(
          `Unknown node type "${nodeData.type}" for node ${nodeData.id} – skipping`
        );
        continue;
      }
      map.set(nodeData.id, new Ctor(nodeData.id, nodeData));
    }
    return map;
  }

  /**
   * Wire input connections so each node knows where its inputs come from.
   */
  wireConnections(
    nodeMap: Map<NodeID, BaseNode>,
    connections: ConnectionData[]
  ): void {
    for (const conn of connections) {
      const targetNode = nodeMap.get(conn.target_node);
      if (!targetNode) continue;
      if (!targetNode.inputConnections[conn.target_input]) {
        targetNode.inputConnections[conn.target_input] = [];
      }
      targetNode.inputConnections[conn.target_input].push({
        nodeId: conn.source_node,
        outputName: conn.source_output,
      });
    }
  }

  /**
   * Resolve node inputs from connections and context variables.
   * Mirrors Python _resolve_node_inputs.
   */
  resolveNodeInputs(
    node: BaseNode,
    workflow: WorkflowData,
    context: ExecutionContext
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    const connections = workflow.connections ?? [];

    // Find all connections targeting this node
    // Support both formats: source_node/target_node (backend) and from/to (frontend)
    for (const conn of connections) {
      const targetId = String(conn.target_node ?? conn["to"] ?? "");
      if (targetId !== String(node.nodeId)) continue;

      const sourceId = String(conn.source_node ?? conn["from"] ?? "");
      const sourceOutput = String(
        conn.source_output ?? conn["from_output"] ?? "default"
      );
      const targetInput = String(
        conn.target_input ?? conn["to_input"] ?? "default"
      );

      // Get output from source node
      const sourceOutputs = context.nodeOutputs[String(sourceId)];
      if (sourceOutputs) {
        const val = sourceOutputs[String(sourceOutput)];
        if (val !== undefined) {
          resolved[String(targetInput)] = val;
        }
      }
    }

    // Also resolve template variables in direct inputs
    for (const [inputName, inputValue] of Object.entries(node.inputs)) {
      if (inputName in resolved) continue; // Don't override connections

      if (
        typeof inputValue === "string" &&
        inputValue.startsWith("{{") &&
        inputValue.endsWith("}}")
      ) {
        const varName = inputValue.slice(2, -2).trim();
        // Check process.env first
        if (varName.startsWith("process.env.")) {
          const envKey = varName.slice("process.env.".length);
          if (process.env[envKey] !== undefined) {
            resolved[inputName] = process.env[envKey];
            logger.debug(
              `[Engine] Resolved env template ${inputName}={{${varName}}} for node ${node.nodeId}`
            );
          } else {
            logger.warning(
              `[Engine] Env template ${inputName}={{${varName}}} not found for node ${node.nodeId}`
            );
          }
        } else if (varName in context.variables) {
          resolved[inputName] = context.variables[varName];
          logger.debug(
            `[Engine] Resolved template variable ${inputName}={{${varName}}} to '${context.variables[varName]}' for node ${node.nodeId}`
          );
        } else {
          // Variable doesn't exist - log warning and leave unresolved
          logger.warning(
            `[Engine] Template variable ${inputName}={{${varName}}} not found in context.variables (available: ${Object.keys(context.variables).join(", ")}) for node ${node.nodeId}`
          );
        }
      } else {
        resolved[inputName] = inputValue;
      }
    }

    return resolved;
  }

  /**
   * Kahn's algorithm for topological sort.
   * Throws CycleError if the graph contains a cycle.
   */
  topologicalSort(
    nodeMap: Map<NodeID, BaseNode>,
    connections: ConnectionData[]
  ): NodeID[] {
    const nodeIds = Array.from(nodeMap.keys());
    const inDegree: Record<NodeID, number> = {};
    const adjacency: Record<NodeID, Set<NodeID>> = {};

    for (const id of nodeIds) {
      inDegree[id] = 0;
      adjacency[id] = new Set();
    }

    for (const conn of connections) {
      if (!nodeMap.has(conn.source_node) || !nodeMap.has(conn.target_node))
        continue;
      // Avoid counting duplicate edges
      if (!adjacency[conn.source_node].has(conn.target_node)) {
        adjacency[conn.source_node].add(conn.target_node);
        inDegree[conn.target_node]++;
      }
    }

    const queue: NodeID[] = nodeIds.filter((id) => inDegree[id] === 0);
    const sorted: NodeID[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);
      for (const neighbour of adjacency[current]) {
        inDegree[neighbour]--;
        if (inDegree[neighbour] === 0) {
          queue.push(neighbour);
        }
      }
    }

    if (sorted.length !== nodeIds.length) {
      const executedSet = new Set(sorted);
      const cycleNodes = nodeIds.filter((id) => !executedSet.has(id));
      throw new CycleError(
        `${sorted.length}/${nodeIds.length} nodes in execution order. ` +
          `Nodes involved in cycle: ${cycleNodes.join(", ")}`
      );
    }

    return sorted;
  }

  /**
   * Collect final outputs from output_text nodes.
   * Mirrors Python _collect_final_outputs.
   */
  private collectFinalOutputs(
    workflow: WorkflowData,
    context: ExecutionContext
  ): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};

    for (const nodeData of workflow.nodes) {
      if (nodeData.type === "output_text") {
        const nodeId = nodeData.id;
        const nodeOutputs = context.nodeOutputs[nodeId];
        if (nodeOutputs) {
          Object.assign(outputs, nodeOutputs);
        }
      }
    }

    return outputs;
  }
}
