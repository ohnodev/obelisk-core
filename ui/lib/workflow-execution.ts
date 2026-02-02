import { WorkflowGraph } from "./workflow-serialization";
import { validateWorkflow, ValidationResult } from "./workflow-validation";

export interface ExecutionOptions {
  client_id?: string;
  extra_data?: Record<string, any>;
}

export interface ExecutionResult {
  execution_id?: string;
  status: "queued" | "running" | "completed" | "error";
  results?: {
    [nodeId: string]: {
      outputs: Record<string, any>;
    };
  };
  error?: string;
  message?: string;
}

export interface ExecutionStatus {
  execution_id: string;
  status: "queued" | "running" | "completed" | "error";
  progress?: {
    current_node?: string;
    completed_nodes?: string[];
    total_nodes?: number;
  };
  results?: ExecutionResult["results"];
  error?: string;
}

/**
 * Executes a workflow by serializing it and sending to backend
 * Follows ComfyUI-style execution pattern
 */
export async function executeWorkflow(
  workflow: WorkflowGraph,
  options: ExecutionOptions = {},
  apiBaseUrl: string = "http://localhost:7779"
): Promise<ExecutionResult> {
  // Validate workflow before execution
  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => e.message).join("; ");
    return {
      status: "error",
      error: `Workflow validation failed: ${errorMessages}`,
    };
  }

  try {
    // Send workflow to backend execution endpoint
    const response = await fetch(`${apiBaseUrl}/api/v1/workflow/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow,
        options,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}: ${errorText}`;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch {
        // If not JSON, use text as-is
      }

      return {
        status: "error",
        error: errorMessage,
      };
    }

    const result: ExecutionResult = await response.json();
    return result;
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Checks execution status (for long-running workflows)
 * Future: Use this for polling execution progress
 */
export async function getExecutionStatus(
  executionId: string,
  apiBaseUrl: string = "http://localhost:7779"
): Promise<ExecutionStatus> {
  try {
    const response = await fetch(
      `${apiBaseUrl}/api/v1/workflow/execute/${executionId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to get execution status"
    );
  }
}

/**
 * Updates node outputs in the frontend graph after execution
 * This is called after receiving results from backend
 */
export function updateNodeOutputs(
  graph: any,
  results: ExecutionResult["results"]
): void {
  if (!results || !graph) return;

  for (const [nodeId, nodeResult] of Object.entries(results)) {
    const node = graph.getNodeById(parseInt(nodeId, 10));
    if (!node) continue;

    // Update node outputs
    if (nodeResult.outputs) {
      for (const [outputName, outputValue] of Object.entries(
        nodeResult.outputs
      )) {
        const outputSlot = node.outputs?.find(
          (out: any) => out.name === outputName
        );
        if (outputSlot !== undefined) {
          const slotIndex = node.outputs?.indexOf(outputSlot) ?? -1;
          if (slotIndex >= 0) {
            node.setOutputData(slotIndex, outputValue);
          }
        }

        // Also update properties if this is a property-based output
        // (e.g., text nodes store output in properties)
        if (outputName === "text" || outputName === "output") {
          node.setProperty(outputName, outputValue);
          
          // Update widget if it exists
          const widgets = (node as any).widgets as any[];
          if (widgets) {
            const widget = widgets.find((w: any) => w.name === outputName);
            if (widget) {
              widget.value = outputValue;
            }
          }
        }
      }
    }
  }
}
