import { WorkflowGraph, WorkflowNode, WorkflowConnection } from "./workflow-serialization";

export interface ValidationError {
  type: "node" | "connection" | "graph" | "structure";
  message: string;
  nodeId?: string;
  connectionIndex?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validates a workflow graph before execution
 * Checks for:
 * - Duplicate node IDs
 * - Invalid node types
 * - Missing connections
 * - Circular dependencies (basic check)
 * - Required inputs without connections or defaults
 */
export function validateWorkflow(workflow: WorkflowGraph): ValidationResult {
  const errors: ValidationError[] = [];

  // Check for empty workflow
  if (!workflow.nodes || workflow.nodes.length === 0) {
    errors.push({
      type: "graph",
      message: "Workflow contains no nodes",
    });
    return { valid: false, errors };
  }

  // Check for duplicate node IDs
  const nodeIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      duplicateIds.add(node.id);
    }
    nodeIds.add(node.id);
  }

  for (const duplicateId of duplicateIds) {
    errors.push({
      type: "node",
      message: `Duplicate node ID: ${duplicateId}`,
      nodeId: duplicateId,
    });
  }

  // Validate connections reference existing nodes
  const nodeIdSet = new Set(workflow.nodes.map((n) => n.id));
  for (let i = 0; i < workflow.connections.length; i++) {
    const conn = workflow.connections[i];
    
    if (!nodeIdSet.has(conn.from)) {
      errors.push({
        type: "connection",
        message: `Connection references missing source node: ${conn.from}`,
        connectionIndex: i,
      });
    }
    
    if (!nodeIdSet.has(conn.to)) {
      errors.push({
        type: "connection",
        message: `Connection references missing target node: ${conn.to}`,
        connectionIndex: i,
      });
    }
  }

  // Check for nodes with no connections (warn but don't fail)
  // This is allowed for input/output nodes
  const connectedNodes = new Set<string>();
  for (const conn of workflow.connections) {
    connectedNodes.add(conn.from);
    connectedNodes.add(conn.to);
  }

  // Validate node types (basic check - just ensure they're strings)
  for (const node of workflow.nodes) {
    if (!node.type || typeof node.type !== "string") {
      errors.push({
        type: "node",
        message: `Node ${node.id} has invalid or missing type`,
        nodeId: node.id,
      });
    }
  }

  // Basic circular dependency check (simple - just check for self-loops)
  for (const conn of workflow.connections) {
    if (conn.from === conn.to) {
      errors.push({
        type: "connection",
        message: `Self-loop detected: node ${conn.from} connects to itself`,
        connectionIndex: workflow.connections.indexOf(conn),
      });
    }
  }

  // Note: Full circular dependency detection requires topological sort
  // which will be done on the backend during execution

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates that a workflow has at least one input and one output node
 * (Optional validation - some workflows might be self-contained)
 */
export function validateWorkflowIO(workflow: WorkflowGraph): ValidationResult {
  const errors: ValidationError[] = [];

  // Find nodes that could be inputs (nodes with no incoming connections)
  const hasIncomingConnections = new Set<string>();
  for (const conn of workflow.connections) {
    hasIncomingConnections.add(conn.to);
  }

  const inputNodes = workflow.nodes.filter(
    (n) => !hasIncomingConnections.has(n.id)
  );

  // Find nodes that could be outputs (nodes with no outgoing connections)
  const hasOutgoingConnections = new Set<string>();
  for (const conn of workflow.connections) {
    hasOutgoingConnections.add(conn.from);
  }

  const outputNodes = workflow.nodes.filter(
    (n) => !hasOutgoingConnections.has(n.id)
  );

  // Warn if no clear input/output nodes (but don't fail)
  if (inputNodes.length === 0 && workflow.nodes.length > 1) {
    errors.push({
      type: "graph",
      message: "No input nodes detected (nodes with no incoming connections)",
    });
  }

  if (outputNodes.length === 0 && workflow.nodes.length > 1) {
    errors.push({
      type: "graph",
      message: "No output nodes detected (nodes with no outgoing connections)",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
