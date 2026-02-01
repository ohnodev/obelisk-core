"use client";

import { useState } from "react";
import { WorkflowGraph } from "@/lib/litegraph";

interface ToolbarProps {
  onExecute?: () => void;
  onSave?: (workflow: WorkflowGraph) => void;
  onLoad?: () => void;
  workflow?: WorkflowGraph;
}

export default function Toolbar({ onExecute, onSave, onLoad, workflow }: ToolbarProps) {
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      if (onExecute) {
        await onExecute();
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const handleSave = () => {
    if (onSave && workflow) {
      onSave(workflow);
      // Download as JSON file
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
              // The parent component should handle loading the workflow
              if (onLoad) {
                onLoad();
              }
            } catch (error) {
              console.error("Failed to load workflow:", error);
            }
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
        gap: "1rem",
        padding: "0.75rem 1rem",
        background: "var(--color-bg-secondary)",
        borderBottom: "1px solid var(--color-border-primary)",
        zIndex: 10,
      }}
    >
      <button
        onClick={handleExecute}
        disabled={isExecuting}
        style={{
          padding: "0.5rem 1rem",
          background: isExecuting
            ? "var(--color-button-secondary-bg)"
            : "var(--color-button-primary-bg)",
          color: "var(--color-button-primary-text)",
          border: "1px solid var(--color-button-primary-border)",
          borderRadius: "4px",
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          cursor: isExecuting ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
        }}
        onMouseEnter={(e) => {
          if (!isExecuting) {
            e.currentTarget.style.background = "var(--color-button-primary-bg-hover)";
            e.currentTarget.style.borderColor = "var(--color-border-active)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isExecuting) {
            e.currentTarget.style.background = "var(--color-button-primary-bg)";
            e.currentTarget.style.borderColor = "var(--color-button-primary-border)";
          }
        }}
      >
        {isExecuting ? "⏳ Executing..." : "▶ Play"}
      </button>

      <button
        onClick={handleSave}
        disabled={!workflow}
        style={{
          padding: "0.5rem 1rem",
          background: "var(--color-button-secondary-bg)",
          color: "var(--color-button-secondary-text)",
          border: "1px solid var(--color-button-secondary-border)",
          borderRadius: "4px",
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          cursor: workflow ? "pointer" : "not-allowed",
          transition: "all 0.2s ease",
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
        💾 Save
      </button>

      <button
        onClick={handleLoad}
        style={{
          padding: "0.5rem 1rem",
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
        📂 Load
      </button>
    </div>
  );
}
