"use client";

import { useEffect, useRef, useState } from "react";
import { LGraph, LGraphCanvas, LiteGraph } from "litegraph.js";
import { serializeGraph, deserializeGraph, WorkflowGraph } from "@/lib/litegraph";
import NodeMenu from "./NodeMenu";
import "litegraph.js/css/litegraph.css";

interface CanvasProps {
  onWorkflowChange?: (workflow: WorkflowGraph) => void;
  initialWorkflow?: WorkflowGraph;
}

export default function Canvas({ onWorkflowChange, initialWorkflow }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<LGraph | null>(null);
  const canvasInstanceRef = useRef<LGraphCanvas | null>(null);
  const [nodeMenuVisible, setNodeMenuVisible] = useState(false);
  const [nodeMenuPosition, setNodeMenuPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize Litegraph
    const graph = new LGraph();
    graphRef.current = graph;

    const canvas = new LGraphCanvas(canvasRef.current, graph, {
      autoresize: true,
    });
    canvasInstanceRef.current = canvas;

    // Set up cursor changes - Litegraph handles this internally, but we can enhance it
    // The CSS will handle cursor changes based on hover states

    // Handle right-click to show node menu
    const handleCanvasRightClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setNodeMenuPosition({
        x: e.clientX,
        y: e.clientY,
      });
      setNodeMenuVisible(true);
    };

    // Attach right-click handler to canvas
    const canvasElement = canvasRef.current;
    canvasElement.addEventListener("contextmenu", handleCanvasRightClick);

    // Load initial workflow if provided
    if (initialWorkflow) {
      deserializeGraph(graph, initialWorkflow);
    }

    // Poll for changes (simpler than event system)
    let lastNodeCount = 0;
    const checkForChanges = () => {
      const currentNodeCount = (graph as any)._nodes?.length || 0;
      if (currentNodeCount !== lastNodeCount || onWorkflowChange) {
        lastNodeCount = currentNodeCount;
        if (onWorkflowChange && graphRef.current) {
          try {
            const workflow = serializeGraph(graphRef.current);
            onWorkflowChange(workflow);
          } catch (error) {
            console.error("Error serializing graph:", error);
          }
        }
      }
    };

    // Check for changes periodically
    const changeInterval = setInterval(checkForChanges, 500);

    // Start the graph
    graph.start();

    // Cleanup
    return () => {
      clearInterval(changeInterval);
      canvasElement.removeEventListener("contextmenu", handleCanvasRightClick);
      graph.stop();
    };
  }, [onWorkflowChange, initialWorkflow]);

  const handleNodeSelect = (nodeType: string) => {
    if (!graphRef.current || !canvasRef.current) return;

    const node = LiteGraph.createNode(nodeType);
    if (node) {
      // Position node at menu click location (adjusted for canvas coordinates)
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const canvasX = nodeMenuPosition.x - canvasRect.left;
      const canvasY = nodeMenuPosition.y - canvasRect.top;
      node.pos = [canvasX, canvasY];
      graphRef.current.add(node);
    }
  };

  // Expose graph methods via ref (for toolbar to use)
  useEffect(() => {
    if (canvasInstanceRef.current && graphRef.current) {
      // Store references for external access if needed
      (window as any).__obeliskGraph = graphRef.current;
      (window as any).__obeliskCanvas = canvasInstanceRef.current;
    }
  }, []);

  return (
    <>
      <div className="canvas-container" style={{ width: "100%", height: "100%", position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            background: "var(--color-bg-primary)",
          }}
        />
      </div>
      <NodeMenu
        visible={nodeMenuVisible}
        x={nodeMenuPosition.x}
        y={nodeMenuPosition.y}
        onClose={() => setNodeMenuVisible(false)}
        onNodeSelect={handleNodeSelect}
      />
    </>
  );
}
