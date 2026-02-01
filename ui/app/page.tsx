"use client";

import { useState, useEffect } from "react";
import Canvas from "@/components/Canvas";
import Toolbar from "@/components/Toolbar";
import { WorkflowGraph } from "@/lib/litegraph";
import "@/components/nodes"; // Register all node types

export default function Home() {
  const [workflow, setWorkflow] = useState<WorkflowGraph | undefined>(undefined);

  const handleWorkflowChange = (newWorkflow: WorkflowGraph) => {
    setWorkflow(newWorkflow);
  };

  const handleExecute = async () => {
    if (!workflow) {
      console.warn("No workflow to execute");
      return;
    }

    // In a future PR, this will call the backend API
    console.log("Executing workflow:", workflow);
    // TODO: POST to /api/execute with workflow JSON
  };

  const handleLoad = () => {
    // The load functionality is handled in Toolbar component
    // This is just a placeholder for future enhancements
    console.log("Load workflow");
  };

  const handleSave = (workflow: WorkflowGraph) => {
    // This is handled in the Toolbar component
    // Placeholder for consistency
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        position: "relative",
        zIndex: 1,
      }}
    >
      <Toolbar
        onExecute={handleExecute}
        onSave={handleSave}
        onLoad={handleLoad}
        workflow={workflow}
      />
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Canvas onWorkflowChange={handleWorkflowChange} />
      </div>
    </div>
  );
}
