/**
 * Conversion helpers between frontend and backend workflow formats.
 * Mirrors Python _convert_frontend_to_backend_format / _convert_backend_to_frontend_results
 *
 * Frontend (UI / LiteGraph) uses:
 *   connections: [{ from, from_output, to, to_input }]
 *
 * Backend (ExecutionEngine) uses:
 *   connections: [{ source_node, source_output, target_node, target_input }]
 */

import { WorkflowData, NodeData, ConnectionData, GraphExecutionResult, normalizeConnection } from "../core/types";

// ─── Frontend → Backend ────────────────────────────────────────────────

interface FrontendConnection {
  id?: string;
  from?: string;
  from_output?: string;
  to?: string;
  to_input?: string;
  // May already be in backend form
  source_node?: string;
  source_output?: string;
  target_node?: string;
  target_input?: string;
}

interface FrontendNode {
  id: string | number;
  type: string;
  position?: { x: number; y: number };
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface FrontendWorkflow {
  id?: string;
  name?: string;
  nodes?: FrontendNode[];
  connections?: FrontendConnection[];
  metadata?: Record<string, unknown>;
}

/**
 * Convert a frontend workflow JSON to the backend WorkflowData shape
 * expected by ExecutionEngine.
 */
export function convertFrontendWorkflow(frontend: FrontendWorkflow): WorkflowData {
  const nodes: NodeData[] = (frontend.nodes ?? []).map((n) => {
    const node: NodeData = {
      id: String(n.id),
      type: n.type,
      position: n.position ?? { x: 0, y: 0 },
    };

    // Merge inputs and metadata (backend expects both)
    const inputs = n.inputs ?? {};
    const metadata = n.metadata ?? {};
    if (Object.keys(inputs).length) node.inputs = inputs;
    if (Object.keys(metadata).length) node.metadata = metadata;

    return node;
  });

  const connections: ConnectionData[] = (frontend.connections ?? [])
    .map((c, i) => {
      const conn = normalizeConnection({ ...c, id: c.id ?? `conn-${i}` } as unknown as Record<string, unknown>);
      // Skip invalid connections with missing endpoints
      if (!conn.source_node || !conn.target_node) return null;
      return conn;
    })
    .filter((c): c is ConnectionData => c !== null);

  return {
    id: frontend.id ?? "workflow-1",
    name: frontend.name ?? "Obelisk Workflow",
    nodes,
    connections,
    metadata: frontend.metadata,
  };
}

// ─── Backend → Frontend results ────────────────────────────────────────

/**
 * Make a value JSON-serializable (handles class instances, etc.)
 */
function serializeValue(value: unknown): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (typeof value === "object") {
    // Check for class instances (non-plain objects)
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      return {
        _type: (value as Record<string, unknown>).constructor?.name ?? "Object",
        _repr: String(value).slice(0, 100),
      };
    }
    // Plain object – recursively serialize
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = serializeValue(v);
    }
    return obj;
  }
  return String(value);
}

/**
 * Convert backend GraphExecutionResult to the frontend results map:
 *   { [nodeId]: { outputs: { ... } } }
 */
export function convertBackendResults(
  result: GraphExecutionResult
): Record<string, { outputs: Record<string, unknown> }> {
  const out: Record<string, { outputs: Record<string, unknown> }> = {};

  for (const nr of result.nodeResults) {
    if (nr.success && nr.nodeId) {
      const serialised: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(nr.outputs)) {
        serialised[k] = serializeValue(v);
      }
      out[String(nr.nodeId)] = { outputs: serialised };
    }
  }

  return out;
}

// ─── Context variable extraction ───────────────────────────────────────

/**
 * Extract context variables from the frontend "options" object.
 * Matches the Python logic in routes.py and queue.py.
 */
export function extractContextVariables(
  options?: Record<string, unknown>
): Record<string, unknown> {
  if (!options) return {};

  const vars: Record<string, unknown> = {};

  if (options.client_id) vars.user_id = options.client_id;
  if (options.user_id) vars.user_id = options.user_id; // overrides client_id
  if (options.user_query) vars.user_query = options.user_query;
  if (options.extra_data && typeof options.extra_data === "object") {
    Object.assign(vars, options.extra_data);
  }
  if (options.variables && typeof options.variables === "object") {
    Object.assign(vars, options.variables);
  }

  return vars;
}
