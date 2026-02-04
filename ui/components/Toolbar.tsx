"use client";

import { useState, useEffect, useRef } from "react";
import { WorkflowGraph } from "@/lib/litegraph";
import { updateNodeOutputs } from "@/lib/workflow-execution";
import PlayIcon from "./icons/PlayIcon";
import SaveIcon from "./icons/SaveIcon";
import LoadIcon from "./icons/LoadIcon";
import StopIcon from "./icons/StopIcon";

interface ToolbarProps {
  onExecute?: (getGraph?: () => any) => void | Promise<void>;
  onSave?: (workflow: WorkflowGraph) => void;
  onLoad?: (workflow: WorkflowGraph) => void;
  workflow?: WorkflowGraph;
  apiBaseUrl?: string;
}

export default function Toolbar({ onExecute, onSave, onLoad, workflow, apiBaseUrl = "http://localhost:7779" }: ToolbarProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);
  const lastResultsVersionRef = useRef<number>(0);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      // Call the execute handler from window (exposed by Canvas)
      const executeHandler = (window as any).__obeliskExecute;
      if (executeHandler) {
        await executeHandler();
      } else if (onExecute) {
        // Pass getGraph function if available
        const getGraph = () => (window as any).__obeliskGraph;
        await onExecute(getGraph);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const handleSave = () => {
    // Manually serialize current workflow from canvas
    const serializeWorkflow = (window as any).__obeliskSerializeWorkflow;
    if (serializeWorkflow) {
      const currentWorkflow = serializeWorkflow();
      if (currentWorkflow) {
        if (onSave) {
          onSave(currentWorkflow);
        }
        // Download as JSON file
        const blob = new Blob([JSON.stringify(currentWorkflow, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${currentWorkflow.name || "workflow"}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } else if (onSave && workflow) {
      // Fallback to prop workflow if serialize function not available
      onSave(workflow);
      const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workflow.name || "workflow"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleLoad = () => {
    if (onLoad) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const workflow = JSON.parse(event.target?.result as string);
              // Pass the parsed workflow to the parent component
              if (onLoad) {
                onLoad(workflow);
              }
            } catch (error) {
              console.error("Failed to load workflow:", error);
            }
          };
          reader.onerror = () => {
            console.error("Failed to read workflow file");
          };
          reader.readAsText(file);
        }
      };
      input.click();
    }
  };

  // Cleanup status polling on unmount
  useEffect(() => {
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, []);

  const handleRunToggle = async () => {
    if (isRunning && runningWorkflowId) {
      // Stop the workflow
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/workflow/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow_id: runningWorkflowId }),
        });
        
        if (response.ok) {
          setIsRunning(false);
          setRunningWorkflowId(null);
          if (statusPollRef.current) {
            clearInterval(statusPollRef.current);
            statusPollRef.current = null;
          }
        }
      } catch (error) {
        console.error("Failed to stop workflow:", error);
      }
    } else {
      // Start the workflow
      const serializeWorkflow = (window as any).__obeliskSerializeWorkflow;
      if (!serializeWorkflow) {
        console.error("Workflow serializer not available");
        return;
      }
      
      const currentWorkflow = serializeWorkflow();
      if (!currentWorkflow) {
        console.error("No workflow to run");
        return;
      }
      
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/workflow/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow: currentWorkflow,
            options: {
              user_id: "ui_user",
            },
          }),
        });
        
        if (response.ok) {
          const result = await response.json();
          setIsRunning(true);
          setRunningWorkflowId(result.workflow_id);
          
          // Reset results version tracking
          lastResultsVersionRef.current = 0;
          
          // Start polling for status and results
          statusPollRef.current = setInterval(async () => {
            try {
              const statusRes = await fetch(`${apiBaseUrl}/api/v1/workflow/status/${result.workflow_id}`);
              if (statusRes.ok) {
                const status = await statusRes.json();
                
                // Check if workflow stopped
                if (status.state !== "running") {
                  setIsRunning(false);
                  setRunningWorkflowId(null);
                  if (statusPollRef.current) {
                    clearInterval(statusPollRef.current);
                    statusPollRef.current = null;
                  }
                  return;
                }
                
                // Check if there are new results to apply
                if (status.results_version && status.results_version > lastResultsVersionRef.current) {
                  lastResultsVersionRef.current = status.results_version;
                  
                  // Apply results to the graph
                  if (status.latest_results?.results) {
                    const graph = (window as any).__obeliskGraph;
                    if (graph) {
                      console.log("[Scheduler] Applying new results to graph, version:", status.results_version);
                      updateNodeOutputs(graph, status.latest_results.results, status.latest_results.executed_nodes);
                    }
                  }
                }
              }
            } catch {
              // Ignore polling errors
            }
          }, 1000); // Poll more frequently for smoother updates
        }
      } catch (error) {
        console.error("Failed to start workflow:", error);
      }
    }
  };

  return (
    <div
      className="toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.5rem 1rem",
        background: "rgba(15, 20, 25, 0.15)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <button
          onClick={handleSave}
          disabled={!workflow}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            background: "var(--color-button-secondary-bg)",
            color: "var(--color-button-secondary-text)",
            border: "1px solid var(--color-button-secondary-border)",
            borderRadius: "4px",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            cursor: workflow ? "pointer" : "not-allowed",
            transition: "all 0.2s ease",
            opacity: workflow ? 1 : 0.5,
          }}
          onMouseEnter={(e) => {
            if (workflow) {
              e.currentTarget.style.background = "var(--color-button-secondary-bg-hover)";
              e.currentTarget.style.borderColor = "var(--color-border-hover)";
            }
          }}
          onMouseLeave={(e) => {
            if (workflow) {
              e.currentTarget.style.background = "var(--color-button-secondary-bg)";
              e.currentTarget.style.borderColor = "var(--color-button-secondary-border)";
            }
          }}
        >
          <SaveIcon />
          <span>Save</span>
        </button>

        <button
          onClick={handleLoad}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            background: "var(--color-button-secondary-bg)",
            color: "var(--color-button-secondary-text)",
            border: "1px solid var(--color-button-secondary-border)",
            borderRadius: "4px",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-button-secondary-bg-hover)";
            e.currentTarget.style.borderColor = "var(--color-border-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--color-button-secondary-bg)";
            e.currentTarget.style.borderColor = "var(--color-button-secondary-border)";
          }}
        >
          <LoadIcon />
          <span>Load</span>
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {/* Run/Stop toggle for autonomous workflows */}
        <button
          onClick={handleRunToggle}
          disabled={isExecuting}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: isRunning
              ? "rgba(231, 76, 60, 0.08)"
              : "rgba(155, 89, 182, 0.08)",
            color: isRunning
              ? "#e74c3c"
              : "#9b59b6",
            border: `1px solid ${isRunning ? "rgba(231, 76, 60, 0.25)" : "rgba(155, 89, 182, 0.25)"}`,
            borderRadius: "4px",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: isExecuting ? "not-allowed" : "pointer",
            transition: "all 0.2s ease",
            boxShadow: isRunning
              ? "0 2px 6px rgba(231, 76, 60, 0.15)"
              : "0 2px 6px rgba(155, 89, 182, 0.15)",
            opacity: isExecuting ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isExecuting) {
              if (isRunning) {
                e.currentTarget.style.background = "rgba(231, 76, 60, 0.15)";
                e.currentTarget.style.borderColor = "rgba(231, 76, 60, 0.4)";
              } else {
                e.currentTarget.style.background = "rgba(155, 89, 182, 0.15)";
                e.currentTarget.style.borderColor = "rgba(155, 89, 182, 0.4)";
              }
            }
          }}
          onMouseLeave={(e) => {
            if (!isExecuting) {
              if (isRunning) {
                e.currentTarget.style.background = "rgba(231, 76, 60, 0.08)";
                e.currentTarget.style.borderColor = "rgba(231, 76, 60, 0.25)";
              } else {
                e.currentTarget.style.background = "rgba(155, 89, 182, 0.08)";
                e.currentTarget.style.borderColor = "rgba(155, 89, 182, 0.25)";
              }
            }
          }}
          title={isRunning ? "Stop autonomous execution" : "Start autonomous execution"}
        >
          {isRunning ? <StopIcon /> : <PlayIcon />}
          <span>{isRunning ? "Stop" : "Run"}</span>
        </button>

        {/* Execute once button */}
        <button
          onClick={handleExecute}
          disabled={isExecuting || isRunning}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1.25rem",
            background: isExecuting || isRunning
              ? "var(--color-button-secondary-bg)"
              : "rgba(212, 175, 55, 0.08)",
            color: isExecuting || isRunning
              ? "var(--color-text-muted)"
              : "var(--color-primary)",
            border: `1px solid ${isExecuting || isRunning ? "var(--color-border-primary)" : "rgba(212, 175, 55, 0.25)"}`,
            borderRadius: "4px",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: isExecuting || isRunning ? "not-allowed" : "pointer",
            transition: "all 0.2s ease",
            boxShadow: isExecuting || isRunning
              ? "none"
              : "0 2px 6px rgba(212, 175, 55, 0.15)",
            opacity: isRunning ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isExecuting && !isRunning) {
              e.currentTarget.style.background = "rgba(212, 175, 55, 0.15)";
              e.currentTarget.style.borderColor = "rgba(212, 175, 55, 0.4)";
              e.currentTarget.style.boxShadow = "0 3px 10px rgba(212, 175, 55, 0.2)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isExecuting && !isRunning) {
              e.currentTarget.style.background = "rgba(212, 175, 55, 0.08)";
              e.currentTarget.style.borderColor = "rgba(212, 175, 55, 0.25)";
              e.currentTarget.style.boxShadow = "0 2px 6px rgba(212, 175, 55, 0.15)";
            }
          }}
          title="Execute workflow once"
        >
          <PlayIcon />
          <span>{isExecuting ? "Executing..." : "Queue Prompt"}</span>
        </button>
      </div>
    </div>
  );
}
