"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Canvas from "@/components/Canvas";
import Toolbar from "@/components/Toolbar";
import { WorkflowGraph } from "@/lib/litegraph";
import { serializeGraph } from "@/lib/litegraph";
import { executeWorkflow, updateNodeOutputs } from "@/lib/workflow-execution";
import "@/components/nodes"; // Register all node types

// Load default workflow from JSON file
// Use dynamic import to handle JSON files in Next.js
let DEFAULT_WORKFLOW: WorkflowGraph;

try {
  // In Next.js, we can import JSON directly
  const defaultWorkflowData = require("../workflows/chat.json");
  DEFAULT_WORKFLOW = defaultWorkflowData as WorkflowGraph;
} catch (error) {
  // Fallback workflow if JSON can't be loaded
  console.warn("Could not load workflow from JSON, using fallback:", error);
  DEFAULT_WORKFLOW = {
    id: "obelisk-chat-workflow",
    name: "Basic Chat Workflow",
    nodes: [],
    connections: [],
  };
}

// Deep compare two workflow objects
function workflowsEqual(a: WorkflowGraph, b: WorkflowGraph): boolean {
  if (a.id !== b.id || a.name !== b.name) return false;
  if (a.nodes.length !== b.nodes.length) return false;
  if (a.connections.length !== b.connections.length) return false;
  
  // Compare nodes
  for (let i = 0; i < a.nodes.length; i++) {
    const nodeA = a.nodes[i];
    const nodeB = b.nodes[i];
    if (nodeA.id !== nodeB.id || nodeA.type !== nodeB.type) return false;
    // Compare positions
    if (nodeA.position?.x !== nodeB.position?.x || nodeA.position?.y !== nodeB.position?.y) return false;
    // Compare inputs (deep compare)
    const inputsA = JSON.stringify(nodeA.inputs || {});
    const inputsB = JSON.stringify(nodeB.inputs || {});
    if (inputsA !== inputsB) return false;
    // Compare metadata (deep compare)
    const metadataA = JSON.stringify(nodeA.metadata || {});
    const metadataB = JSON.stringify(nodeB.metadata || {});
    if (metadataA !== metadataB) return false;
  }
  
  // Compare connections
  for (let i = 0; i < a.connections.length; i++) {
    const connA = a.connections[i] as any;
    const connB = b.connections[i] as any;
    if (connA.from !== connB.from || connA.to !== connB.to ||
        connA.from_output !== connB.from_output || connA.to_input !== connB.to_input) {
      return false;
    }
    // Compare connection metadata if it exists
    const metadataA = JSON.stringify(connA.metadata || {});
    const metadataB = JSON.stringify(connB.metadata || {});
    if (metadataA !== metadataB) return false;
  }
  
  return true;
}

export default function Home() {
  const [workflow, setWorkflow] = useState<WorkflowGraph | undefined>(DEFAULT_WORKFLOW);
  const previousWorkflowRef = useRef<WorkflowGraph | undefined>(DEFAULT_WORKFLOW);

  // Memoize onWorkflowChange to stabilize function reference
  const handleWorkflowChange = useCallback((newWorkflow: WorkflowGraph) => {
    // Only update if workflow actually changed (deep compare)
    if (!previousWorkflowRef.current || !workflowsEqual(previousWorkflowRef.current, newWorkflow)) {
      previousWorkflowRef.current = newWorkflow;
      setWorkflow(newWorkflow);
    }
  }, []);

  const handleExecute = async (getGraph?: () => any) => {
    if (!workflow) {
      console.warn("No workflow to execute");
      return;
    }

    try {
      if (!getGraph) {
        console.warn("Graph getter not available");
        return;
      }
      
      const graph = getGraph();
      if (!graph) {
        console.warn("Graph not available");
        return;
      }

      // Serialize the current graph state to get latest workflow
      const currentWorkflow = serializeGraph(graph);
      console.log("Executing workflow:", currentWorkflow.name, "with", currentWorkflow.nodes.length, "nodes");

      // Execute workflow using ComfyUI-style execution engine
      const result = await executeWorkflow(currentWorkflow, {
        client_id: "default_user",
      });

      if (result.status === "error") {
        console.error("Workflow execution failed:", result.error);
        // TODO: Show error in UI (toast, notification, etc.)
        alert(`Execution failed: ${result.error}`);
        return;
      }

      // Update node outputs with results from backend
      if (result.results) {
        updateNodeOutputs(graph, result.results);
        
        // Force canvas redraw to show updated outputs
        const canvas = (window as any).__obeliskCanvas;
        if (canvas) {
          canvas.dirty_canvas = true;
          canvas.draw(true);
        }
      }

      console.log("Workflow execution completed:", result.status);
    } catch (error) {
      console.error("Failed to execute workflow:", error);
      alert(`Execution error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleLoad = (workflow: WorkflowGraph) => {
    // Use imperative API to load workflow directly into canvas
    const loadWorkflow = (window as any).__obeliskLoadWorkflow;
    if (loadWorkflow) {
      loadWorkflow(workflow);
      // Also update state for consistency
      setWorkflow(workflow);
    } else {
      // Fallback: update state (but Canvas won't reload without dependency)
      setWorkflow(workflow);
    }
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
        <Canvas 
          onWorkflowChange={handleWorkflowChange} 
          initialWorkflow={workflow || DEFAULT_WORKFLOW}
          onExecute={handleExecute}
        />
      </div>
    </div>
  );
}
