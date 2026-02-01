"use client";

import { useEffect, useRef, useState } from "react";
import { LGraph, LGraphCanvas, LGraphNode, LiteGraph } from "@/lib/litegraph-index";
import { serializeGraph, deserializeGraph, WorkflowGraph } from "@/lib/workflow-serialization";
import NodeMenu from "./NodeMenu";
// LiteGraph CSS is imported in globals.css

interface CanvasProps {
  onWorkflowChange?: (workflow: WorkflowGraph) => void;
  initialWorkflow?: WorkflowGraph;
  onExecute?: (getGraph: () => any) => Promise<void>;
}

export default function Canvas({ onWorkflowChange, initialWorkflow, onExecute }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<any>(null);
  const canvasInstanceRef = useRef<any>(null);
  const workflowLoadedRef = useRef(false);
  const isDeserializingRef = useRef(false);
  const initialWorkflowLoadedRef = useRef(false);
  const [nodeMenuVisible, setNodeMenuVisible] = useState(false);
  const [nodeMenuPosition, setNodeMenuPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize Litegraph
    const graph = new LGraph();
    graphRef.current = graph;

    // Configure LiteGraph colors for better text contrast BEFORE creating canvas
    // Use type assertion since some constants may not be in TypeScript definitions
    const LG = (typeof window !== "undefined" && (window as any).LiteGraph) || LiteGraph;
    LG.NODE_TITLE_COLOR = "#FFFFFF"; // White title text for unselected nodes
    LG.NODE_SELECTED_TITLE_COLOR = "#FFFFFF"; // White title text for selected nodes
    LG.NODE_TEXT_COLOR = "#FFFFFF"; // White text for visibility
    LG.NODE_SUBTEXT_SIZE = 12;
    LG.NODE_TEXT_SIZE = 14;
    LG.NODE_DEFAULT_COLOR = "#333333";
    LG.NODE_DEFAULT_BGCOLOR = "#2a2a2a";
    LG.NODE_DEFAULT_BOXCOLOR = "#666666";
    LG.NODE_BOX_OUTLINE_COLOR = "#FFFFFF";
    LG.NODE_SELECTED_BORDER_COLOR = "#d4af37"; // Golden border for selected nodes
    LG.NODE_SELECTED_BORDER_WIDTH = 2;
    LG.WIDGET_TEXT_COLOR = "#FFFFFF";
    LG.WIDGET_SECONDARY_TEXT_COLOR = "#CCCCCC";
    LG.WIDGET_BGCOLOR = "#1a1a1a";
    LG.WIDGET_OUTLINE_COLOR = "#555555";


    // Set up canvas with proper device pixel ratio for crisp rendering
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    const graphCanvas = new LG.LGraphCanvas(canvas, graph, {
      autoresize: true,
    });
    
    // Override LiteGraph's resize to maintain DPR
    const originalResize = graphCanvas.resize.bind(graphCanvas);
    graphCanvas.resize = function() {
      if (!canvas) return originalResize();
      const currentDPR = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * currentDPR;
      canvas.height = rect.height * currentDPR;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(currentDPR, currentDPR);
      }
      return originalResize();
    };
    canvasInstanceRef.current = graphCanvas;
    
    // Enable node resizing (drag from bottom-right corner)
    (graphCanvas as any).allow_resize_nodes = true;
    
    // Configure LiteGraph to not show node names in slot labels
    // Override the slot label rendering to only show slot name
    const originalDrawSlotLabel = (graphCanvas as any).drawSlotLabel;
    if (originalDrawSlotLabel) {
      (graphCanvas as any).drawSlotLabel = function(slot: any, ctx: CanvasRenderingContext2D, pos: number[]) {
        // Only draw the slot name, not the node title
        if (slot && slot.name) {
          ctx.fillStyle = "#FFFFFF";
          ctx.font = `${LiteGraph.NODE_SUBTEXT_SIZE}px Arial`;
          ctx.textAlign = slot.type === "output" ? "right" : "left";
          const labelX = slot.type === "output" ? pos[0] - 5 : pos[0] + 5;
          ctx.fillText(slot.name, labelX, pos[1] + 4);
        }
      };
    }

    // Override drawNode to prevent title text from being drawn in body (only slots should show)
    const originalDrawNode = (graphCanvas as any).drawNode;
    (graphCanvas as any).drawNode = function(node: any, ctx: CanvasRenderingContext2D) {
      // Temporarily clear title during body drawing, restore after
      const originalTitle = node.title;
      node.title = "";
      originalDrawNode.call(this, node, ctx);
      node.title = originalTitle;
    };
    
    // Store reference for resize handler
    const canvasInstance = graphCanvas;

    const canvasElement = canvasRef.current;

    // Handle right-click to show node menu
    const handleCanvasRightClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Use screen coordinates for menu position (NodeMenu uses position: fixed)
      setNodeMenuPosition({
        x: e.clientX,
        y: e.clientY,
      });
      // Store canvas coordinates for node placement (used in handleNodeSelect)
      if (canvasInstanceRef.current) {
        const canvasPos = canvasInstanceRef.current.convertEventToCanvasOffset(e);
        // Store in a ref or state for use in handleNodeSelect
        (canvasInstanceRef.current as any)._lastRightClickCanvasPos = canvasPos;
      }
      setNodeMenuVisible(true);
    };

    canvasElement.addEventListener("contextmenu", handleCanvasRightClick);

    // Load initial workflow only once on mount (not on every prop change)
    // Store timeout IDs for cleanup
    let workflowLoadTimeout: NodeJS.Timeout | null = null;
    let deserializingTimeout: NodeJS.Timeout | null = null;
    if (initialWorkflow && !initialWorkflowLoadedRef.current) {
      // Use setTimeout to ensure graph is fully initialized
      workflowLoadTimeout = setTimeout(() => {
        // Check if graph is empty (no nodes) before loading
        const nodeCount = (graph as any)._nodes?.length || 0;
        if (nodeCount === 0) {
          isDeserializingRef.current = true;
          try {
            deserializeGraph(graph, initialWorkflow);
            workflowLoadedRef.current = true;
            initialWorkflowLoadedRef.current = true; // Mark as loaded
            // Force canvas to redraw with correct positions
            if (graphCanvas) {
              graphCanvas.draw(true);
            }
          } finally {
            // Allow change detection after deserialization completes
            deserializingTimeout = setTimeout(() => {
              isDeserializingRef.current = false;
            }, 100);
          }
        }
      }, 0);
    }

    // Listen to graph changes - throttle to avoid killing FPS
    let changeTimeout: NodeJS.Timeout | null = null;
    const handleGraphChange = () => {
      // Don't serialize during initial deserialization
      if (isDeserializingRef.current) return;
      
      if (changeTimeout) return; // Already queued
      
      changeTimeout = setTimeout(() => {
        changeTimeout = null;
        if (onWorkflowChange && graphRef.current) {
          try {
            const workflow = serializeGraph(graphRef.current);
            onWorkflowChange(workflow);
          } catch (error) {
            console.error("Error serializing graph:", error);
          }
        }
      }, 1000); // Only serialize every 1 second max to avoid FPS issues
    };

    // Use graph events instead of draw callback to avoid FPS issues
    // Hook into node changes via graph methods
    const originalAdd = graph.add.bind(graph);
    graph.add = function(node: any) {
      const result = originalAdd(node);
      handleGraphChange();
      return result;
    };

    const originalRemove = graph.remove.bind(graph);
    graph.remove = function(node: any) {
      const result = originalRemove(node);
      handleGraphChange();
      return result;
    };

    // Subscribe to broader graph change events (connections, node moves, property edits)
    if ((graph as any).on_change) {
      const originalOnChange = (graph as any).on_change;
      (graph as any).on_change = function(this: any) {
        if (originalOnChange) {
          originalOnChange.apply(this, arguments);
        }
        handleGraphChange();
      };
    } else {
      // If on_change doesn't exist, create it
      (graph as any).on_change = function() {
        handleGraphChange();
      };
    }

    // Also listen for afterChange if available
    if ((graph as any).onAfterChange) {
      const originalOnAfterChange = (graph as any).onAfterChange;
      (graph as any).onAfterChange = function(this: any) {
        if (originalOnAfterChange) {
          originalOnAfterChange.apply(this, arguments);
        }
        handleGraphChange();
      };
    }

    // Start the graph
    graph.start();

    // Expose graph methods via global (for toolbar to use)
    // Update globals whenever graph/canvas instances are created
    (window as any).__obeliskGraph = graphRef.current;
    (window as any).__obeliskCanvas = canvasInstanceRef.current;

    // Handle window resize - maintain DPR
    const handleResize = () => {
      if (!canvasRef.current) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvasRef.current.getBoundingClientRect();
      canvasRef.current.width = rect.width * dpr;
      canvasRef.current.height = rect.height * dpr;
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
      if (canvasInstance) {
        canvasInstance.resize();
      }
    };
    window.addEventListener('resize', handleResize);

    // DPR is now handled in handleResize - no need to check on every draw
    // This improves performance significantly


    // Cleanup
    return () => {
      // Clear timeouts to prevent mutations after unmount
      if (changeTimeout) {
        clearTimeout(changeTimeout);
      }
      if (workflowLoadTimeout) {
        clearTimeout(workflowLoadTimeout);
      }
      if (deserializingTimeout) {
        clearTimeout(deserializingTimeout);
      }
      window.removeEventListener('resize', handleResize);
      canvasElement.removeEventListener("contextmenu", handleCanvasRightClick);
      graph.stop();
      // Clear global references when component unmounts
      (window as any).__obeliskGraph = undefined;
      (window as any).__obeliskCanvas = undefined;
      // Reset refs on cleanup so workflow can reload on remount
      workflowLoadedRef.current = false;
      isDeserializingRef.current = false;
      initialWorkflowLoadedRef.current = false;
    };
  }, [onWorkflowChange]); // Removed initialWorkflow - only load once on mount

  const handleNodeSelect = (nodeType: string) => {
    if (!graphRef.current || !canvasRef.current || !canvasInstanceRef.current) return;

    const LG = (typeof window !== "undefined" && (window as any).LiteGraph) || LiteGraph;
    const node = LG.createNode(nodeType);
    if (node) {
      // Position node at menu click location using canvas coordinates
      const canvasPos = (canvasInstanceRef.current as any)._lastRightClickCanvasPos;
      if (canvasPos && Array.isArray(canvasPos) && canvasPos.length >= 2) {
        node.pos = [canvasPos[0], canvasPos[1]];
      } else {
        // Fallback: use menu position (may not be accurate but better than nothing)
        node.pos = [nodeMenuPosition.x, nodeMenuPosition.y];
      }
      graphRef.current.add(node);
    }
  };


  return (
    <>
      <div className="canvas-container hide-scrollbar" style={{ width: "100%", height: "100%", position: "relative" }} aria-label="Workflow canvas">
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            background: "var(--color-bg-primary)",
            imageRendering: "crisp-edges",
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
