"use client";

import { useState, useEffect } from "react";
import Canvas from "@/components/Canvas";
import Toolbar from "@/components/Toolbar";
import { WorkflowGraph } from "@/lib/litegraph";
import "@/components/nodes"; // Register all node types

// Default chat workflow
const DEFAULT_WORKFLOW: WorkflowGraph = {
  id: "obelisk-chat-workflow",
  name: "Basic Chat Workflow",
  nodes: [
    {
      id: "1",
      type: "text",
      position: { x: 100, y: 200 },
      inputs: {
        text: "{{user_query}}",
      },
    },
    {
      id: "2",
      type: "model_loader",
      position: { x: 500, y: 100 },
      inputs: {
        model_path: "models/default_model",
        auto_load: true,
      },
    },
    {
      id: "3",
      type: "lora_loader",
      position: { x: 800, y: 100 },
      inputs: {
        lora_path: "lora/default_lora",
        auto_load: true,
        lora_enabled: true,
      },
    },
    {
      id: "4",
      type: "memory_adapter",
      position: { x: 500, y: 400 },
      inputs: {
        user_id: "{{user_id}}",
        query: "{{user_query}}",
      },
    },
    {
      id: "5",
      type: "sampler",
      position: { x: 1100, y: 200 },
      inputs: {
        quantum_influence: 0.7,
        max_length: 1024,
      },
    },
    {
      id: "6",
      type: "text",
      position: { x: 1400, y: 200 },
      inputs: {
        text: "",
      },
    },
  ],
  connections: [
    {
      from: "1",
      from_output: "text",
      to: "4",
      to_input: "query",
    },
    {
      from: "1",
      from_output: "text",
      to: "5",
      to_input: "query",
    },
    {
      from: "2",
      from_output: "model",
      to: "3",
      to_input: "model",
    },
    {
      from: "3",
      from_output: "model",
      to: "5",
      to_input: "model",
    },
    {
      from: "4",
      from_output: "memory",
      to: "5",
      to_input: "memory",
    },
    {
      from: "5",
      from_output: "response",
      to: "6",
      to_input: "text",
    },
  ],
};

export default function Home() {
  const [workflow, setWorkflow] = useState<WorkflowGraph | undefined>(DEFAULT_WORKFLOW);

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
        <Canvas onWorkflowChange={handleWorkflowChange} initialWorkflow={DEFAULT_WORKFLOW} />
      </div>
    </div>
  );
}
