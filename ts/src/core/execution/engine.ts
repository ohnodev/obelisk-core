/**
 * Execution Engine – topological sort + DAG execution.
 * Mirrors Python src/core/execution/engine.py
 *
 * 1. Parses workflow JSON (nodes + connections)
 * 2. Builds a DAG and computes topological execution order
 * 3. Instantiates node classes via the registry
 * 4. Executes nodes in order, propagating outputs via connections
 */
import {
  NodeID,
  WorkflowData,
  ConnectionData,
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

    try {
      // 1. Build node instances
      const nodeMap = this.buildNodeMap(workflow);
      if (!nodeMap.size) {
        return {
          success: true,
          nodeResults: [],
          finalOutputs: {},
          executionOrder: [],
          totalExecutionTime: 0,
        };
      }

      // 2. Wire input connections
      this.wireConnections(nodeMap, workflow.connections);

      // 3. Topological sort
      const order = this.topologicalSort(nodeMap, workflow.connections);

      // 4. Execute nodes in order
      const context: ExecutionContext = {
        variables: { ...contextVariables },
        nodeOutputs: { ...initialNodeOutputs },
      };

      const nodeResults: GraphExecutionResult["nodeResults"] = [];

      for (const nodeId of order) {
        const node = nodeMap.get(nodeId);
        if (!node) continue;

        const nodeStart = Date.now();
        try {
          const outputs = await node.execute(context);
          context.nodeOutputs[nodeId] = outputs;

          nodeResults.push({
            nodeId,
            success: true,
            outputs,
            executionTime: Date.now() - nodeStart,
          });

          logger.debug(
            `Node ${nodeId} (${node.nodeType}) executed in ${Date.now() - nodeStart}ms`
          );
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : String(err);
          logger.error(`Node ${nodeId} (${node.nodeType}) failed: ${errorMsg}`);

          nodeResults.push({
            nodeId,
            success: false,
            outputs: {},
            error: errorMsg,
            executionTime: Date.now() - nodeStart,
          });
        }
      }

      // 5. Collect final outputs (from terminal nodes – nodes with no downstream)
      const finalOutputs = this.collectFinalOutputs(
        nodeMap,
        workflow.connections,
        context
      );

      const overallSuccess = nodeResults.every((r) => r.success);

      return {
        graphId: workflow.id,
        success: overallSuccess,
        nodeResults,
        finalOutputs,
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
  private wireConnections(
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
   * Kahn's algorithm for topological sort.
   * Throws CycleError if the graph contains a cycle.
   */
  private topologicalSort(
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
      throw new CycleError(
        `Workflow contains a cycle – only ${sorted.length}/${nodeIds.length} nodes could be sorted`
      );
    }

    return sorted;
  }

  /**
   * Collect outputs from terminal nodes (nodes that are not a source for any connection).
   * Merges all their outputs into a single dict.
   */
  private collectFinalOutputs(
    nodeMap: Map<NodeID, BaseNode>,
    connections: ConnectionData[],
    context: ExecutionContext
  ): Record<string, unknown> {
    const sourceNodes = new Set(connections.map((c) => c.source_node));
    const terminalNodes = Array.from(nodeMap.keys()).filter(
      (id) => !sourceNodes.has(id)
    );

    const finalOutputs: Record<string, unknown> = {};
    for (const nodeId of terminalNodes) {
      const outputs = context.nodeOutputs[nodeId];
      if (outputs) {
        Object.assign(finalOutputs, outputs);
      }
    }
    return finalOutputs;
  }
}
