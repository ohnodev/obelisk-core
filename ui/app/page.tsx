"use client";

import { useState, useEffect } from "react";
import Canvas from "@/components/Canvas";
import Toolbar from "@/components/Toolbar";
import { WorkflowGraph } from "@/lib/litegraph";
import "@/components/nodes"; // Register all node types

// Default chat workflow - simple: Text -> Model Loader -> Sampler -> Text
const DEFAULT_WORKFLOW: WorkflowGraph = {
  id: "obelisk-chat-workflow",
  name: "Basic Chat Workflow",
  nodes: [
    {
      id: "1",
      type: "text",
      position: { x: 100, y: 300 },
      metadata: {
        text: "Hello world!",
      },
    },
    {
      id: "2",
      type: "model_loader",
      position: { x: 300, y: 120 },
      inputs: {
        model_path: "models/default_model",
        auto_load: true,
      },
    },
    {
      id: "3",
      type: "sampler",
      position: { x: 700, y: 300 },
      inputs: {
        quantum_influence: 0.7,
        max_length: 1024,
      },
    },
    {
      id: "4",
      type: "text",
      position: { x: 1000, y: 300 },
      inputs: {
        text: "",
      },
    },
  ],
  connections: [
    {
      from: "1",
      from_output: "text",
      to: "3",
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
      from_output: "response",
      to: "4",
      to_input: "text",
    },
  ],
};

export default function Home() {
  const [workflow, setWorkflow] = useState<WorkflowGraph | undefined>(DEFAULT_WORKFLOW);

  const handleWorkflowChange = (newWorkflow: WorkflowGraph) => {
    setWorkflow(newWorkflow);
  };

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

      // Get the input text node
      const inputNode = graph.getNodeById(1);
      if (!inputNode) {
        console.warn("Input node not found");
        return;
      }

      // Get the text value from the input node
      const inputText = (inputNode.properties as any)?.text || "";
      const userQuery = inputText || "Hello world";
      
      console.log("Executing workflow with query:", userQuery);

      // Try to call backend API (obelisk-core server on port 7779)
      // Use /api/v1/generate endpoint for now (workflow execution endpoint coming)
      try {
        const response = await fetch("http://localhost:7779/api/v1/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: userQuery,
            user_id: "default_user",
          }),
        });

        if (response.ok) {
          const result = await response.json();
          
          // Extract response from API result
          const llmResponse = result.response || result.text || result.message || "";
          
          // Update the output text node with the response
          const outputNode = graph.getNodeById(4);
          if (outputNode && llmResponse) {
            outputNode.setProperty("text", llmResponse);
            // Update widget value if it exists
            const widgets = (outputNode as any).widgets as any[];
            if (widgets) {
              const widget = widgets.find((w: any) => w.name === "text");
              if (widget) {
                widget.value = llmResponse;
              }
            }
            // Force canvas redraw
            const canvas = (window as any).__obeliskCanvas;
            if (canvas) {
              canvas.dirty_canvas = true;
              canvas.draw(true);
            }
          }
          return;
        }
      } catch (apiError) {
        console.log("API not available, using simulation:", apiError);
      }

      // Fallback: simulate execution for testing
      const outputNode = graph.getNodeById(4);
      if (outputNode) {
        const simulatedResponse = `[Simulated] Response to: "${userQuery}"\n\nThis is a simulated response. The backend API is not yet connected.`;
        outputNode.setProperty("text", simulatedResponse);
        // Update widget value if it exists
        const widgets = (outputNode as any).widgets as any[];
        if (widgets) {
          const widget = widgets.find((w: any) => w.name === "text");
          if (widget) {
            widget.value = simulatedResponse;
          }
        }
        // Force canvas redraw
        const canvas = (window as any).__obeliskCanvas;
        if (canvas) {
          canvas.dirty_canvas = true;
          canvas.draw(true);
        }
      }
    } catch (error) {
      console.error("Failed to execute workflow:", error);
    }
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
        <Canvas 
          onWorkflowChange={handleWorkflowChange} 
          initialWorkflow={DEFAULT_WORKFLOW}
          onExecute={handleExecute}
        />
      </div>
    </div>
  );
}
