"use client";

import { useEffect, useRef, useState } from "react";
import { LGraph, LGraphCanvas, LGraphNode, LiteGraph } from "@/lib/litegraph-index";
import { serializeGraph, deserializeGraph, WorkflowGraph } from "@/lib/workflow-serialization";
import NodeMenu from "./NodeMenu";
import TextareaWidget from "./widgets/TextareaWidget";
// LiteGraph CSS is imported in globals.css

interface CanvasProps {
  onWorkflowChange?: (workflow: WorkflowGraph) => void;
  initialWorkflow?: WorkflowGraph;
}

export default function Canvas({ onWorkflowChange, initialWorkflow }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<any>(null);
  const canvasInstanceRef = useRef<any>(null);
  const workflowLoadedRef = useRef(false);
  const isDeserializingRef = useRef(false);
  const [nodeMenuVisible, setNodeMenuVisible] = useState(false);
  const [nodeMenuPosition, setNodeMenuPosition] = useState({ x: 0, y: 0 });
  const [textareaWidgets, setTextareaWidgets] = useState<Array<{
    nodeId: string;
    widgetName: string;
    value: string;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  }>>([]);

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
      setNodeMenuPosition({
        x: e.clientX,
        y: e.clientY,
      });
      setNodeMenuVisible(true);
    };

    canvasElement.addEventListener("contextmenu", handleCanvasRightClick);

    // Allow zoom with Ctrl/Cmd + wheel, prevent accidental zoom on normal scroll
    const handleWheel = (e: WheelEvent) => {
      // Only allow zoom if Ctrl or Cmd is held
      if (e.ctrlKey || e.metaKey) {
        // Allow zoom - don't prevent, let LiteGraph handle it
        return;
      }
      // Normal scroll without modifier - prevent zoom but don't block the event
      // LiteGraph's default behavior will be prevented by our override below
    };

    // Override LiteGraph's wheel handler to only allow zoom with modifier
    const originalOnWheel = (graphCanvas as any).onWheel || (graphCanvas as any).on_mouse_wheel;
    if (originalOnWheel) {
      (graphCanvas as any).onWheel = function(e: WheelEvent) {
        // Only allow zoom with explicit modifier
        if (e.ctrlKey || e.metaKey) {
          return originalOnWheel.call(this, e);
        }
        // Otherwise, prevent zoom (but don't prevent default to allow page scroll)
        return false;
      };
    }

    canvasElement.addEventListener("wheel", handleWheel, { passive: true });

    // Load initial workflow if provided and graph is empty
    // This ensures workflow loads on mount and after HMR refreshes
    if (initialWorkflow) {
      // Use setTimeout to ensure graph is fully initialized
      setTimeout(() => {
        // Check if graph is empty (no nodes) before loading
        const nodeCount = (graph as any)._nodes?.length || 0;
        if (nodeCount === 0) {
          isDeserializingRef.current = true;
          try {
            deserializeGraph(graph, initialWorkflow);
            workflowLoadedRef.current = true;
            // Force canvas to redraw with correct positions
            if (graphCanvas) {
              graphCanvas.draw(true);
            }
          } finally {
            // Allow change detection after deserialization completes
            setTimeout(() => {
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

    // Start the graph
    graph.start();


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
    const handleResizeWithUpdate = () => {
      handleResize();
      updateTextareaWidgets();
    };
    window.addEventListener('resize', handleResizeWithUpdate);
    
      // Function to update textarea widget positions
      const updateTextareaWidgets = () => {
        if (!canvasRef.current || !graphCanvas) return;
        
        const widgets: Array<{
          nodeId: string;
          widgetName: string;
          value: string;
          x: number;
          y: number;
          width: number;
          height: number;
          visible: boolean;
        }> = [];

        const nodes = (graph as any)._nodes || [];
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const ds = (graphCanvas as any).ds || { scale: 1, offset: [0, 0] };
        
        for (const node of nodes) {
          if (!node.widgets) continue;
          
          for (const widget of node.widgets) {
            if (widget.type === "textarea" && !widget.disabled) {
              const titleHeight = LG.NODE_TITLE_HEIGHT || 30;
              const padding = 10;
              const margin = 15;
              
              // Calculate widget position in canvas coordinates
              const widgetX = node.pos[0] + margin;
              const widgetY = node.pos[1] + titleHeight + padding;
              const widgetWidth = (widget.width || node.size[0]) - (margin * 2);
              const widgetHeight = node.size[1] - titleHeight - (padding * 2);
              
              // Convert to screen coordinates (accounting for canvas transform)
              const screenX = canvasRect.left + (widgetX * ds.scale) + (ds.offset[0] || 0);
              const screenY = canvasRect.top + (widgetY * ds.scale) + (ds.offset[1] || 0);
              const screenWidth = widgetWidth * ds.scale;
              const screenHeight = widgetHeight * ds.scale;
              
              // Check if node is visible (rough check)
              const nodeScreenX = canvasRect.left + (node.pos[0] * ds.scale) + (ds.offset[0] || 0);
              const nodeScreenY = canvasRect.top + (node.pos[1] * ds.scale) + (ds.offset[1] || 0);
              const isVisible = 
                nodeScreenX + (node.size[0] * ds.scale) > 0 &&
                nodeScreenX < canvasRect.width &&
                nodeScreenY + (node.size[1] * ds.scale) > 0 &&
                nodeScreenY < canvasRect.height;
              
              widgets.push({
                nodeId: String(node.id),
                widgetName: widget.name || "textarea",
                value: String(widget.value || ""),
                x: screenX,
                y: screenY,
                width: screenWidth,
                height: screenHeight,
                visible: isVisible && !node.flags?.collapsed,
              });
            }
          }
        }
        
        setTextareaWidgets(widgets);
      };

      // Ensure DPR is maintained on every draw (LiteGraph might reset it)
      const originalDrawWithDPR = graphCanvas.draw.bind(graphCanvas);
      graphCanvas.draw = function(force: boolean) {
        if (canvas) {
          const currentDPR = window.devicePixelRatio || 1;
          const rect = canvas.getBoundingClientRect();
          const expectedWidth = rect.width * currentDPR;
          const expectedHeight = rect.height * currentDPR;
          
          // Check if canvas size or transform is wrong
          if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
            canvas.width = expectedWidth;
            canvas.height = expectedHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.scale(currentDPR, currentDPR);
            }
          } else {
            // Check transform
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const transform = ctx.getTransform();
              if (Math.abs(transform.a - currentDPR) > 0.01 || Math.abs(transform.d - currentDPR) > 0.01) {
                ctx.scale(currentDPR / transform.a, currentDPR / transform.d);
              }
            }
          }
        }
        
        const result = originalDrawWithDPR(force);
        
        // Update textarea widget positions - use RAF to batch React updates
        // This prevents double-rendering artifacts while keeping updates smooth
        if (!graphCanvas._textareaUpdateScheduled) {
          graphCanvas._textareaUpdateScheduled = true;
          requestAnimationFrame(() => {
            updateTextareaWidgets();
            graphCanvas._textareaUpdateScheduled = false;
          });
        }
        
        return result;
      };

      // Initial update
      updateTextareaWidgets();
      
      // Throttle updates on graph change to avoid excessive updates
      let updateTimeout: NodeJS.Timeout | null = null;
      const originalGraphChange = graph.onChange || (() => {});
      graph.onChange = function() {
        originalGraphChange.call(this);
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
          updateTextareaWidgets();
          updateTimeout = null;
        }, 16); // ~60fps
      };

    // Cleanup
    return () => {
      if (changeTimeout) {
        clearTimeout(changeTimeout);
      }
      window.removeEventListener('resize', handleResize);
      canvasElement.removeEventListener("contextmenu", handleCanvasRightClick);
      canvasElement.removeEventListener("wheel", handleWheel);
      graph.stop();
      // Reset refs on cleanup so workflow can reload on remount
      workflowLoadedRef.current = false;
      isDeserializingRef.current = false;
    };
  }, [onWorkflowChange, initialWorkflow]); // Include initialWorkflow to reload on prop change

  const handleNodeSelect = (nodeType: string) => {
    if (!graphRef.current || !canvasRef.current) return;

    const LG = (typeof window !== "undefined" && (window as any).LiteGraph) || LiteGraph;
    const node = LG.createNode(nodeType);
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

  // Handle textarea widget value changes
  const handleTextareaChange = (nodeId: string, widgetName: string, value: string) => {
    if (!graphRef.current) return;
    
    const node = graphRef.current.getNodeById(Number(nodeId));
    if (!node || !node.widgets) return;
    
    const widget = node.widgets.find((w: any) => w.name === widgetName && w.type === "textarea");
    if (!widget) return;
    
    const oldValue = widget.value;
    widget.value = value;
    
    // Update property if widget has one
    if (widget.options && widget.options.property) {
      node.setProperty(widget.options.property, value);
    }
    
    // Call widget callback
    if (widget.callback) {
      const canvas = canvasInstanceRef.current;
      const pos = canvas ? (canvas as any).graph_mouse : [0, 0];
      widget.callback(value, canvas, node, pos, null);
    }
    
    // Trigger node widget changed event
    if (node.onWidgetChanged) {
      node.onWidgetChanged(widgetName, value, oldValue, widget);
    }
    
    // Mark graph as changed
    if (node.graph) {
      node.graph._version++;
    }
    
    // Force canvas redraw
    if (canvasInstanceRef.current) {
      (canvasInstanceRef.current as any).dirty_canvas = true;
      (canvasInstanceRef.current as any).draw(true);
    }
  };

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
            imageRendering: "crisp-edges",
          }}
        />
        {/* Render React textarea widgets over canvas */}
        {textareaWidgets.map((widget) => (
          <TextareaWidget
            key={`${widget.nodeId}-${widget.widgetName}`}
            value={widget.value}
            onChange={(value) => handleTextareaChange(widget.nodeId, widget.widgetName, value)}
            x={widget.x}
            y={widget.y}
            width={widget.width}
            height={widget.height}
            nodeId={widget.nodeId}
            visible={widget.visible}
          />
        ))}
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
