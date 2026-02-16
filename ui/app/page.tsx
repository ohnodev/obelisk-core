"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Canvas from "@/components/Canvas";
import Toolbar from "@/components/Toolbar";
import { WorkflowGraph } from "@/lib/litegraph";
import { serializeGraph } from "@/lib/litegraph";
import { executeWorkflow, updateNodeOutputs, ExecutionStatus } from "@/lib/workflow-execution";
import { useNotifications } from "@/components/Notification";
import { getApiUrls } from "@/lib/api-config";
import { getUserId } from "@/lib/user-id";
import "@/components/nodes"; // Register all node types

// Load default workflow: Clanker Autotrader V1.1
import defaultWorkflowData from "../workflows/clanker-autotrader-v1.1.json";

const DEFAULT_WORKFLOW: WorkflowGraph = defaultWorkflowData as WorkflowGraph;

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
  const { showNotification } = useNotifications();

  // Memoize onWorkflowChange to stabilize function reference
  // Empty dependency array ensures this function reference never changes
  const handleWorkflowChange = useCallback((newWorkflow: WorkflowGraph) => {
    // Only update if workflow actually changed (deep compare)
    if (!previousWorkflowRef.current || !workflowsEqual(previousWorkflowRef.current, newWorkflow)) {
      previousWorkflowRef.current = newWorkflow;
      setWorkflow(newWorkflow);
    }
  }, []); // Empty deps - function reference never changes

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

      // Extract user_query from text nodes that have {{user_query}} placeholder
      let userQuery = "";
      for (const node of currentWorkflow.nodes) {
        if (node.type === "text") {
          const textContent = (node.metadata?.text || node.inputs?.text || "").toString();
          if (textContent.includes("{{user_query}}")) {
            // Try to get actual value from the graph node
            const graphNode = graph.getNodeById(node.id as any) || 
                            (/^\d+$/.test(node.id) ? graph.getNodeById(parseInt(node.id, 10) as any) : null);
            if (graphNode) {
              const nodeText = (graphNode.properties as any)?.text || "";
              // If it's still the placeholder, use empty string (will be filled by backend)
              if (nodeText && nodeText !== "{{user_query}}") {
                userQuery = nodeText;
              }
            }
          }
        }
      }

      // Track last shown status to avoid duplicate notifications
      let lastStatus: string | null = null;

      // Progress callback to show queue status
      const onProgress = (status: ExecutionStatus) => {
        if (status.status === "queued" && lastStatus !== "queued") {
          const positionMsg = status.position !== null && status.position !== undefined && status.position > 0
            ? ` (position ${status.position + 1} in queue)`
            : "";
          showNotification(`Job queued${positionMsg}...`, "info", 2000);
          lastStatus = "queued";
        } else if (status.status === "running" && lastStatus !== "running") {
          showNotification("Executing workflow...", "info", 2000);
          lastStatus = "running";
        }
      };

      // Execute workflow using queue-based execution
      const { coreApi } = getApiUrls();
      const userId = getUserId();
      const result = await executeWorkflow(
        currentWorkflow,
        {
          client_id: userId,
          user_id: userId,
          user_query: userQuery || "Hello", // Default query if not found
        },
        coreApi,
        onProgress
      );

      if (result.status === "error") {
        console.error("Workflow execution failed:", result.error);
        showNotification(`Execution failed: ${result.error}`, "error", 8000);
        return;
      }

      // Update node outputs with results from backend
      if (result.results) {
        updateNodeOutputs(graph, result.results, result.execution_order);
        
        // Force canvas redraw to show updated outputs
        const canvas = (window as any).__obeliskCanvas;
        if (canvas) {
          canvas.dirty_canvas = true;
          canvas.draw(true);
        }
      }

      console.log("Workflow execution completed:", result.status);
      showNotification("Workflow executed successfully", "success", 3000);
    } catch (error) {
      console.error("Failed to execute workflow:", error);
      showNotification(
        `Execution error: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error",
        8000
      );
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
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh", // Use dvh for mobile browser UI awareness
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
    </>
  );
}
