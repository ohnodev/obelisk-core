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
  execution_order?: string[]; // Order in which nodes were executed (for highlighting)
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
 * 
 * TODO: This function is currently stubbed. The backend endpoint
 * GET /api/v1/workflow/execute/{executionId} is not yet implemented.
 * 
 * To implement:
 * 1. Add GET handler in src/api/routes.py: @router.get("/workflow/execute/{execution_id}")
 * 2. Return ExecutionStatus matching POST /workflow/execute response shape
 * 3. Store execution state in backend (e.g., in-memory cache or database)
 * 
 * Future: Use this for polling execution progress on long-running workflows
 */
export async function getExecutionStatus(
  executionId: string,
  apiBaseUrl: string = "http://localhost:7779"
): Promise<ExecutionStatus> {
  // TODO: Implement backend endpoint GET /api/v1/workflow/execute/{executionId}
  throw new Error(
    `getExecutionStatus is not yet implemented. Backend endpoint GET /api/v1/workflow/execute/${executionId} needs to be added.`
  );
}

/**
 * Highlights nodes during execution (like ComfyUI)
 * Shows which nodes are currently executing or have completed
 */
export function highlightExecutingNodes(
  graph: any,
  executionOrder: string[] | undefined,
  delay: number = 100
): void {
  if (!executionOrder || !graph) return;

  // Clear any existing highlights
  const allNodes = graph._nodes || [];
  allNodes.forEach((node: any) => {
    if (node) {
      node.executing = false;
      node.executed = false;
    }
  });

  // Highlight nodes sequentially as they execute
  executionOrder.forEach((nodeId, index) => {
    setTimeout(() => {
      const node = graph.getNodeById(nodeId as any) || 
                  (/^\d+$/.test(nodeId) ? graph.getNodeById(parseInt(nodeId, 10) as any) : null);
      
      if (node) {
        // Mark as executing
        node.executing = true;
        node.executed = false;
        
        // Force redraw
        const canvas = (window as any).__obeliskCanvas;
        if (canvas) {
          canvas.dirty_canvas = true;
          canvas.draw(true);
        }
        
        // After a short delay, mark as executed
        setTimeout(() => {
          if (node) {
            node.executing = false;
            node.executed = true;
            
            // Force redraw again
            if (canvas) {
              canvas.dirty_canvas = true;
              canvas.draw(true);
            }
          }
        }, delay);
      }
    }, index * delay);
  });
}

/**
 * Updates node outputs in the frontend graph after execution
 * This is called after receiving results from backend
 */
export function updateNodeOutputs(
  graph: any,
  results: ExecutionResult["results"],
  executionOrder?: string[]
): void {
  if (!results || !graph) return;
  
  // Highlight nodes as they executed
  if (executionOrder) {
    highlightExecutingNodes(graph, executionOrder);
  }

  for (const [nodeId, nodeResult] of Object.entries(results)) {
    // Try to find node by raw string ID first (handles non-numeric IDs like "text-1" or UUIDs)
    let node = graph.getNodeById(nodeId as any);
    
    // Fallback: if not found and ID looks numeric, try parsing as number
    if (!node && /^\d+$/.test(nodeId)) {
      node = graph.getNodeById(parseInt(nodeId, 10) as any);
    }
    
    if (!node) {
      console.warn(`Node ${nodeId} not found in graph`);
      continue;
    }

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
          // Convert output value to string and ensure it's properly formatted
          // Use nullish coalescing to preserve falsy values like 0 and false
          const textValue = String(outputValue ?? "");
          
          console.log(`[updateNodeOutputs] Updating node ${nodeId} property ${outputName} to:`, textValue.substring(0, 50) + "...");
          
          // Get canvas instance for widget callbacks
          const canvas = (window as any).__obeliskCanvas;
          
          // Update widget FIRST (before setting property) to ensure widget reflects the value
          const widgets = (node as any).widgets as any[];
          if (widgets) {
            const widget = widgets.find((w: any) => w.name === outputName || w.name === "text");
            if (widget) {
              // Update widget value directly
              widget.value = textValue;
              
              // If widget has an input element, update it directly
              if (widget.input) {
                widget.input.value = textValue;
              }
              
              // Trigger widget update callback if it exists
              // Callback signature: (value, canvasInstance, node, pos, event)
              // Since we're programmatically updating after execution, we don't have
              // real pos/event, but we pass the canvas instance correctly
              if (widget.callback && canvas) {
                // Use node position as pos, no event for programmatic updates
                const nodePos = node.pos || [0, 0];
                try {
                  widget.callback(textValue, canvas, node, nodePos, null);
                } catch (e) {
                  console.warn(`[updateNodeOutputs] Widget callback error for node ${nodeId}:`, e);
                }
              }
            } else {
              console.warn(`[updateNodeOutputs] Widget not found for node ${nodeId}, outputName: ${outputName}`);
            }
          }
          
          // Set property (this should trigger onPropertyChanged)
          node.setProperty(outputName, textValue);
          
          // Also explicitly trigger property changed handler to sync widget
          if (node.onPropertyChanged) {
            try {
              node.onPropertyChanged(outputName, textValue);
            } catch (e) {
              console.warn(`[updateNodeOutputs] onPropertyChanged error for node ${nodeId}:`, e);
            }
          }
          
          // Force canvas redraw
          if (canvas) {
            canvas.dirty_canvas = true;
            canvas.draw(true);
          }
        }
      }
    }
  }
}
