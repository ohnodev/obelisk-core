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
  const deserializingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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


    // Create LGraphCanvas - let LiteGraph handle it normally
    const canvas = canvasRef.current;
    const graphCanvas = new LG.LGraphCanvas(canvas, graph, {
      autoresize: true,
    });
    canvasInstanceRef.current = graphCanvas;
    
    // Handle DPR separately like ComfyUI does - don't override resize
    // Use ResizeObserver pattern to handle canvas sizing with DPR
    const resizeCanvas = () => {
      if (!canvas) return;
      const scale = Math.max(window.devicePixelRatio || 1, 1);
      const { width, height } = canvas.getBoundingClientRect();
      const expectedWidth = Math.round(width * scale);
      const expectedHeight = Math.round(height * scale);
      
      // Only resize if dimensions actually changed (avoid clearing canvas unnecessarily)
      if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
        canvas.width = expectedWidth;
        canvas.height = expectedHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(scale, scale);
        }
      }
    };
    
    // Override draw() to maintain DPR - LiteGraph resets transform during draw
    // Only check/fix DPR when canvas size actually changes (not every frame)
    const originalDraw = graphCanvas.draw.bind(graphCanvas);
    let lastCanvasWidth = 0;
    let lastCanvasHeight = 0;
    
    graphCanvas.draw = function(forceFG?: boolean, forceBG?: boolean) {
      // Recompute DPR at the start of each draw call (not stale)
      const dpr = Math.max(window.devicePixelRatio || 1, 1);
      
      if (canvas) {
        // Only resize if dimensions actually changed (not on every draw)
        const rect = canvas.getBoundingClientRect();
        const expectedWidth = Math.round(rect.width * dpr);
        const expectedHeight = Math.round(rect.height * dpr);
        
        if (canvas.width !== expectedWidth || canvas.height !== expectedHeight ||
            lastCanvasWidth !== expectedWidth || lastCanvasHeight !== expectedHeight) {
          // Canvas size changed, update DPR
          canvas.width = expectedWidth;
          canvas.height = expectedHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.scale(dpr, dpr);
          }
          lastCanvasWidth = expectedWidth;
          lastCanvasHeight = expectedHeight;
        } else {
          // Check if transform was reset (LiteGraph might have done it)
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const transform = ctx.getTransform();
            const epsilon = 0.01;
            const needsFixX = Math.abs(transform.a - dpr) > epsilon;
            const needsFixY = Math.abs(transform.d - dpr) > epsilon;
            
            if (needsFixX || needsFixY) {
              // Transform was reset, fix it using freshly computed dpr
              // Guard against division by zero
              const scaleX = Math.abs(transform.a) > epsilon ? dpr / transform.a : 1;
              const scaleY = Math.abs(transform.d) > epsilon ? dpr / transform.d : 1;
              // Only apply scale if values are finite
              if (Number.isFinite(scaleX) && Number.isFinite(scaleY)) {
                ctx.scale(scaleX, scaleY);
              }
            }
          }
        }
      }
      // Then call LiteGraph's draw with both arguments
      return originalDraw(forceFG, forceBG);
    };
    
    // Initial resize
    resizeCanvas();
    
    // Watch for canvas size changes
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      graphCanvas.draw(true, true);
    });
    resizeObserver.observe(canvas);
    
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
    
    // Override processMouseWheel to prevent page scrolling and handle zoom
    const originalProcessMouseWheel = (graphCanvas as any).processMouseWheel;
    (graphCanvas as any).processMouseWheel = function(e: WheelEvent) {
      // Prevent page scrolling
      e.preventDefault();
      e.stopPropagation();
      // Legacy support
      if ((e as any).cancelBubble !== undefined) {
        (e as any).cancelBubble = true;
      }
      
      // Compute delta for zoom
      const delta = e.deltaY || (e as any).wheelDelta || 0;
      // Convert event to canvas coordinates
      const canvas_pos = this.convertEventToCanvasOffset(e);
      
      // Calculate zoom factor (negative delta = zoom in, positive = zoom out)
      const zoomFactor = delta > 0 ? 0.9 : 1.1;
      
      // Apply zoom using LiteGraph's changeDeltaScale method
      if (this.changeDeltaScale) {
        this.changeDeltaScale(zoomFactor, canvas_pos);
      }
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

    // ========== MOBILE TOUCH SUPPORT ==========
    // Track touch state for gesture handling - defined BEFORE double-click handler
    let touchState = {
      active: false,
      lastTouches: [] as { x: number; y: number }[],
      initialPinchDistance: 0,
      lastPinchDistance: 0,
      isPinching: false,
      lastTouchEnd: 0, // Track last touch end time to prevent double-tap triggering dblclick
      isTouchDevice: false, // Track if user is using touch
    };

    // Handle double-click to show node menu (instead of LiteGraph's widget popover)
    // But NOT if we're in touch mode (to prevent pinch from triggering menu)
    const handleCanvasDoubleClick = (e: MouseEvent) => {
      // Ignore double-click if it was triggered by touch (within 500ms of last touch)
      const timeSinceTouch = Date.now() - touchState.lastTouchEnd;
      if (touchState.isTouchDevice && timeSinceTouch < 500) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
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
    canvasElement.addEventListener("dblclick", handleCanvasDoubleClick);

    // Calculate distance between two touch points
    const getTouchDistance = (touches: TouchList): number => {
      if (touches.length < 2) return 0;
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Get center point between two touches
    const getTouchCenter = (touches: TouchList): { x: number; y: number } => {
      if (touches.length < 2) {
        return { x: touches[0].clientX, y: touches[0].clientY };
      }
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    };

    // Create synthetic mouse event from touch
    const createMouseEvent = (type: string, touch: Touch, originalEvent: TouchEvent): MouseEvent => {
      return new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: touch.clientX,
        clientY: touch.clientY,
        screenX: touch.screenX,
        screenY: touch.screenY,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        ctrlKey: originalEvent.ctrlKey,
        altKey: originalEvent.altKey,
        shiftKey: originalEvent.shiftKey,
        metaKey: originalEvent.metaKey,
      });
    };

    // Handle touch start
    const handleTouchStart = (e: TouchEvent) => {
      // Mark as touch device
      touchState.isTouchDevice = true;
      
      // Prevent default to avoid scrolling and LiteGraph's default touch handling
      e.preventDefault();
      e.stopPropagation();
      
      // Close any open menus when touching
      setNodeMenuVisible(false);
      
      // Disable LiteGraph's search box if it exists
      if (canvasInstanceRef.current) {
        canvasInstanceRef.current.allow_searchbox = false;
      }
      
      touchState.active = true;
      touchState.lastTouches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
      
      if (e.touches.length === 2) {
        // Two finger touch - start pinch tracking
        // Cancel any ongoing single-touch drag first
        if (!touchState.isPinching) {
          const mouseUpEvent = new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: touchState.lastTouches[0]?.x || 0,
            clientY: touchState.lastTouches[0]?.y || 0,
            button: 0,
            buttons: 0,
          });
          canvasElement.dispatchEvent(mouseUpEvent);
        }
        
        touchState.isPinching = true;
        touchState.initialPinchDistance = getTouchDistance(e.touches);
        touchState.lastPinchDistance = touchState.initialPinchDistance;
      } else if (e.touches.length === 1) {
        // Single touch - simulate mousedown for dragging
        touchState.isPinching = false;
        const mouseEvent = createMouseEvent("mousedown", e.touches[0], e);
        canvasElement.dispatchEvent(mouseEvent);
      }
    };

    // Handle touch move
    const handleTouchMove = (e: TouchEvent) => {
      if (!touchState.active) return;
      e.preventDefault();
      e.stopPropagation();
      
      if (e.touches.length === 2 && touchState.isPinching) {
        // Two finger move - handle pinch zoom directly
        const currentDistance = getTouchDistance(e.touches);
        const center = getTouchCenter(e.touches);
        
        // Calculate zoom based on pinch distance change
        const distanceDelta = currentDistance - touchState.lastPinchDistance;
        
        if (Math.abs(distanceDelta) > 1 && canvasInstanceRef.current) { // Lower threshold for smoother zoom
          const canvas = canvasInstanceRef.current;
          
          // Calculate zoom factor (pinch out = zoom in, pinch in = zoom out)
          const zoomFactor = currentDistance / touchState.lastPinchDistance;
          
          // Get canvas-relative coordinates for zoom center
          const rect = canvasElement.getBoundingClientRect();
          const canvasX = center.x - rect.left;
          const canvasY = center.y - rect.top;
          
          // Apply zoom directly to canvas scale
          const newScale = canvas.ds.scale * zoomFactor;
          
          // Clamp scale to reasonable bounds
          const clampedScale = Math.max(0.1, Math.min(10, newScale));
          
          if (clampedScale !== canvas.ds.scale) {
            // Calculate the point in graph space before zoom
            const graphX = (canvasX - canvas.ds.offset[0]) / canvas.ds.scale;
            const graphY = (canvasY - canvas.ds.offset[1]) / canvas.ds.scale;
            
            // Apply new scale
            canvas.ds.scale = clampedScale;
            
            // Adjust offset to keep zoom centered on pinch point
            canvas.ds.offset[0] = canvasX - graphX * clampedScale;
            canvas.ds.offset[1] = canvasY - graphY * clampedScale;
            
            canvas.dirty_canvas = true;
            canvas.dirty_bgcanvas = true;
          }
          
          touchState.lastPinchDistance = currentDistance;
        }
        
        // Also handle two-finger pan
        if (touchState.lastTouches.length >= 2) {
          const lastCenter = {
            x: (touchState.lastTouches[0].x + touchState.lastTouches[1].x) / 2,
            y: (touchState.lastTouches[0].y + touchState.lastTouches[1].y) / 2,
          };
          
          const panDeltaX = center.x - lastCenter.x;
          const panDeltaY = center.y - lastCenter.y;
          
          if ((Math.abs(panDeltaX) > 1 || Math.abs(panDeltaY) > 1) && canvasInstanceRef.current) {
            // Apply pan offset directly to canvas (in screen space, not graph space)
            canvasInstanceRef.current.ds.offset[0] += panDeltaX;
            canvasInstanceRef.current.ds.offset[1] += panDeltaY;
            canvasInstanceRef.current.dirty_canvas = true;
            canvasInstanceRef.current.dirty_bgcanvas = true;
          }
        }
        
        // Update last touches
        touchState.lastTouches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
        
        // Force redraw
        if (canvasInstanceRef.current) {
          canvasInstanceRef.current.draw(true, true);
        }
        
      } else if (e.touches.length === 1 && !touchState.isPinching) {
        // Single touch move - simulate mousemove for dragging
        const mouseEvent = createMouseEvent("mousemove", e.touches[0], e);
        canvasElement.dispatchEvent(mouseEvent);
        touchState.lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
      }
    };

    // Handle touch end
    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Track last touch end time to prevent double-tap from triggering dblclick
      touchState.lastTouchEnd = Date.now();
      
      if (e.touches.length === 0) {
        // All fingers lifted
        if (!touchState.isPinching && touchState.lastTouches.length > 0) {
          // Was single touch - simulate mouseup
          const lastTouch = touchState.lastTouches[0];
          const mouseEvent = new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: lastTouch.x,
            clientY: lastTouch.y,
            button: 0,
            buttons: 0,
          });
          canvasElement.dispatchEvent(mouseEvent);
        }
        
        // Reset state
        touchState.active = false;
        touchState.isPinching = false;
        touchState.lastTouches = [];
        touchState.initialPinchDistance = 0;
        touchState.lastPinchDistance = 0;
        
        // Re-enable search box after touch ends (for desktop users)
        setTimeout(() => {
          if (canvasInstanceRef.current && !touchState.isTouchDevice) {
            canvasInstanceRef.current.allow_searchbox = true;
          }
        }, 100);
      } else if (e.touches.length === 1 && touchState.isPinching) {
        // Went from 2 fingers to 1 - transition to drag mode
        touchState.isPinching = false;
        touchState.lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
        
        // Simulate mousedown to start fresh drag
        const mouseEvent = createMouseEvent("mousedown", e.touches[0], e);
        canvasElement.dispatchEvent(mouseEvent);
      }
    };

    // Handle touch cancel (e.g., system gesture interruption)
    const handleTouchCancel = (e: TouchEvent) => {
      e.preventDefault();
      touchState.active = false;
      touchState.isPinching = false;
      touchState.lastTouches = [];
      
      // Simulate mouseup to clean up any drag state
      const mouseEvent = new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: 0,
        clientY: 0,
        button: 0,
        buttons: 0,
      });
      canvasElement.dispatchEvent(mouseEvent);
    };

    // Add touch event listeners with passive: false to allow preventDefault
    canvasElement.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvasElement.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvasElement.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvasElement.addEventListener("touchcancel", handleTouchCancel, { passive: false });
    // ========== END MOBILE TOUCH SUPPORT ==========

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

    // Don't auto-save - user must click Save button manually
    // Expose function to manually serialize workflow (for Save button)
    (window as any).__obeliskSerializeWorkflow = () => {
      if (graphRef.current && onWorkflowChange) {
        try {
          const workflow = serializeGraph(graphRef.current);
          onWorkflowChange(workflow);
          return workflow;
        } catch (error) {
          console.error("Error serializing graph:", error);
          return null;
        }
      }
      return null;
    };

    // Expose function to manually load workflow (for Load button)
    (window as any).__obeliskLoadWorkflow = (workflow: WorkflowGraph) => {
      if (graphRef.current && graphCanvas) {
        try {
          // Clear any previous timeout to prevent mutations after unmount
          if (deserializingTimeoutRef.current) {
            clearTimeout(deserializingTimeoutRef.current);
            deserializingTimeoutRef.current = null;
          }
          
          // Clear existing graph
          graphRef.current.clear();
          // Reset loaded flag to allow deserialization
          initialWorkflowLoadedRef.current = false;
          // Deserialize new workflow
          isDeserializingRef.current = true;
          deserializeGraph(graphRef.current, workflow);
          initialWorkflowLoadedRef.current = true;
          // Force redraw
          graphCanvas.draw(true);
          // Allow change detection after deserialization
          // Store timeout ID in ref for cleanup
          deserializingTimeoutRef.current = setTimeout(() => {
            isDeserializingRef.current = false;
            deserializingTimeoutRef.current = null;
          }, 100);
        } catch (error) {
          console.error("Error loading workflow:", error);
        }
      }
    };

    // Start the graph
    graph.start();

    // Expose graph methods via global (for toolbar to use)
    // Update globals whenever graph/canvas instances are created
    (window as any).__obeliskGraph = graphRef.current;
    (window as any).__obeliskCanvas = canvasInstanceRef.current;

    // ResizeObserver handles window resize automatically

    // Cleanup
    return () => {
      // Clear timeouts to prevent mutations after unmount
      if (workflowLoadTimeout) {
        clearTimeout(workflowLoadTimeout);
      }
      if (deserializingTimeout) {
        clearTimeout(deserializingTimeout);
      }
      // Clear timeout from __obeliskLoadWorkflow if it exists
      if (deserializingTimeoutRef.current) {
        clearTimeout(deserializingTimeoutRef.current);
        deserializingTimeoutRef.current = null;
      }
      resizeObserver.disconnect();
      canvasElement.removeEventListener("contextmenu", handleCanvasRightClick);
      canvasElement.removeEventListener("dblclick", handleCanvasDoubleClick);
      // Remove touch event listeners
      canvasElement.removeEventListener("touchstart", handleTouchStart);
      canvasElement.removeEventListener("touchmove", handleTouchMove);
      canvasElement.removeEventListener("touchend", handleTouchEnd);
      canvasElement.removeEventListener("touchcancel", handleTouchCancel);
      graph.stop();
      // Clear global references when component unmounts
      (window as any).__obeliskGraph = undefined;
      (window as any).__obeliskCanvas = undefined;
      (window as any).__obeliskSerializeWorkflow = undefined;
      (window as any).__obeliskLoadWorkflow = undefined;
      // Reset refs on cleanup so workflow can reload on remount
      workflowLoadedRef.current = false;
      isDeserializingRef.current = false;
      initialWorkflowLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount - don't re-run when callbacks change

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
      <div 
        className="canvas-container hide-scrollbar" 
        style={{ 
          width: "100%", 
          height: "100%", 
          position: "relative",
          overflow: "hidden",
        }} 
        aria-label="Workflow canvas"
      >
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
