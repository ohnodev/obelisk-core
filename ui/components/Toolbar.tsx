"use client";

import { useState } from "react";
import { WorkflowGraph } from "@/lib/litegraph";
import PlayIcon from "./icons/PlayIcon";
import SaveIcon from "./icons/SaveIcon";
import LoadIcon from "./icons/LoadIcon";

interface ToolbarProps {
  onExecute?: (getGraph?: () => any) => void | Promise<void>;
  onSave?: (workflow: WorkflowGraph) => void;
  onLoad?: (workflow: WorkflowGraph) => void;
  workflow?: WorkflowGraph;
}

export default function Toolbar({ onExecute, onSave, onLoad, workflow }: ToolbarProps) {
  const [isExecuting, setIsExecuting] = useState(false);

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

  return (
    <div
      className="toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1rem",
        background: "var(--color-bg-secondary)",
        borderBottom: "1px solid var(--color-border-primary)",
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

      <button
        onClick={handleExecute}
        disabled={isExecuting}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.625rem 1.25rem",
          background: isExecuting
            ? "var(--color-button-secondary-bg)"
            : "rgba(212, 175, 55, 0.15)",
          color: isExecuting
            ? "var(--color-text-muted)"
            : "var(--color-primary)",
          border: `1px solid ${isExecuting ? "var(--color-border-primary)" : "rgba(212, 175, 55, 0.4)"}`,
          borderRadius: "6px",
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: isExecuting ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          boxShadow: isExecuting
            ? "none"
            : "0 2px 8px rgba(212, 175, 55, 0.2)",
        }}
        onMouseEnter={(e) => {
          if (!isExecuting) {
            e.currentTarget.style.background = "rgba(212, 175, 55, 0.25)";
            e.currentTarget.style.borderColor = "rgba(212, 175, 55, 0.6)";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(212, 175, 55, 0.3)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isExecuting) {
            e.currentTarget.style.background = "rgba(212, 175, 55, 0.15)";
            e.currentTarget.style.borderColor = "rgba(212, 175, 55, 0.4)";
            e.currentTarget.style.boxShadow = "0 2px 8px rgba(212, 175, 55, 0.2)";
          }
        }}
      >
        <PlayIcon />
        <span>{isExecuting ? "Executing..." : "Queue Prompt"}</span>
      </button>
    </div>
  );
}
