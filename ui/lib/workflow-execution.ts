import { WorkflowGraph } from "./workflow-serialization";
import { validateWorkflow, ValidationResult } from "./workflow-validation";

export interface ExecutionOptions {
  client_id?: string;
  user_id?: string;
  user_query?: string;
  extra_data?: Record<string, any>;
}

export interface ExecutionResult {
  execution_id?: string;
  job_id?: string;
  status: "queued" | "running" | "completed" | "error";
  position?: number;
  queue_length?: number;
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
  job_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  position?: number | null;
  queue_length: number;
  created_at: number;
  started_at?: number | null;
  completed_at?: number | null;
  has_result: boolean;
  error?: string | null;
}

export interface QueueInfo {
  queue_length: number;
  current_job: string | null;
  is_processing: boolean;
  total_jobs: number;
}

// Callback for progress updates during execution
export type ProgressCallback = (status: ExecutionStatus) => void;

/**
 * Executes a workflow using the queue-based execution system
 * Jobs are queued and processed sequentially
 * 
 * @param workflow - The workflow to execute
 * @param options - Execution options
 * @param apiBaseUrl - Base URL for the API
 * @param onProgress - Optional callback for progress updates
 * @param pollInterval - How often to poll for status (ms)
 * @returns ExecutionResult with results when completed
 */
export async function executeWorkflow(
  workflow: WorkflowGraph,
  options: ExecutionOptions = {},
  apiBaseUrl: string = "http://localhost:7779",
  onProgress?: ProgressCallback,
  pollInterval: number = 500
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
    // Queue the workflow for execution
    const queueResponse = await fetch(`${apiBaseUrl}/api/v1/queue/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow,
        options,
      }),
    });

    if (!queueResponse.ok) {
      const errorText = await queueResponse.text();
      let errorMessage = `HTTP ${queueResponse.status}: ${errorText}`;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.detail || errorJson.error || errorJson.message || errorMessage;
      } catch {
        // If not JSON, use text as-is
      }

      return {
        status: "error",
        error: errorMessage,
      };
    }

    const queueResult = await queueResponse.json();
    const jobId = queueResult.job_id;

    // Notify initial queued status
    if (onProgress) {
      onProgress({
        job_id: jobId,
        status: "queued",
        position: queueResult.position,
        queue_length: queueResult.queue_length,
        created_at: Date.now() / 1000,
        has_result: false,
      });
    }

    // Poll for completion
    return await pollForResult(jobId, apiBaseUrl, onProgress, pollInterval);
    
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Polls for job completion and returns the result
 */
async function pollForResult(
  jobId: string,
  apiBaseUrl: string,
  onProgress?: ProgressCallback,
  pollInterval: number = 500
): Promise<ExecutionResult> {
  const maxAttempts = 600; // 5 minutes max at 500ms intervals
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const statusResponse = await fetch(`${apiBaseUrl}/api/v1/queue/status/${jobId}`);
      
      if (!statusResponse.ok) {
        if (statusResponse.status === 404) {
          return {
            status: "error",
            error: `Job ${jobId} not found`,
          };
        }
        throw new Error(`Status check failed: ${statusResponse.status}`);
      }

      const status: ExecutionStatus = await statusResponse.json();

      // Notify progress
      if (onProgress) {
        onProgress(status);
      }

      // Check if completed or failed
      if (status.status === "completed") {
        // Fetch the actual results
        const resultResponse = await fetch(`${apiBaseUrl}/api/v1/queue/result/${jobId}`);
        
        if (!resultResponse.ok) {
          return {
            status: "error",
            error: "Failed to fetch job results",
          };
        }

        const resultData = await resultResponse.json();
        
        return {
          job_id: jobId,
          status: "completed",
          results: resultData.results,
          execution_order: resultData.execution_order,
          message: "Workflow executed successfully",
        };
      }

      if (status.status === "failed") {
        return {
          job_id: jobId,
          status: "error",
          error: status.error || "Job execution failed",
        };
      }

      if (status.status === "cancelled") {
        return {
          job_id: jobId,
          status: "error",
          error: "Job was cancelled",
        };
      }

      // Still running or queued, wait and poll again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempts++;
      
    } catch (error) {
      // On network error, wait and retry
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempts++;
    }
  }

  return {
    job_id: jobId,
    status: "error",
    error: "Execution timed out waiting for results",
  };
}

/**
 * Gets the current execution status for a job
 */
export async function getExecutionStatus(
  jobId: string,
  apiBaseUrl: string = "http://localhost:7779"
): Promise<ExecutionStatus | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/queue/status/${jobId}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Status check failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to get execution status:", error);
    return null;
  }
}

/**
 * Gets overall queue information
 */
export async function getQueueInfo(
  apiBaseUrl: string = "http://localhost:7779"
): Promise<QueueInfo | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/queue/info`);
    
    if (!response.ok) {
      throw new Error(`Queue info failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to get queue info:", error);
    return null;
  }
}

/**
 * Cancels a queued job (cannot cancel running jobs)
 */
export async function cancelJob(
  jobId: string,
  apiBaseUrl: string = "http://localhost:7779"
): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/queue/cancel/${jobId}`, {
      method: "POST",
    });
    
    return response.ok;
  } catch (error) {
    console.error("Failed to cancel job:", error);
    return false;
  }
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
