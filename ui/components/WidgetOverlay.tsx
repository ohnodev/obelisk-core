"use client";

import { useEffect, useState, useRef } from "react";
import { LiteGraph } from "@/lib/litegraph-index";

interface WidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  nodeId: string | number;
  widgetName: string;
  widget: any;
  timestamp: number;
}

export default function WidgetOverlay() {
  const [widgetPositions, setWidgetPositions] = useState<Map<string, WidgetPosition>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Get canvas element
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return;
    canvasRef.current = canvas;

    // Get canvas instance
    const canvasInstance = (window as any).__obeliskCanvas;
    if (!canvasInstance) return;

    // Function to update widget positions
    const updatePositions = () => {
      const positions = new Map<string, WidgetPosition>();
      
      // Get widget positions from LiteGraph
      const reactWidgetPositions = (LiteGraph as any).reactWidgetPositions || {};
      
      for (const [key, pos] of Object.entries(reactWidgetPositions)) {
        const position = pos as any;
        if (position && position.nodeId && position.widgetName) {
          // Get node from graph
          const graph = (window as any).__obeliskGraph;
          if (!graph) continue;
          
          const node = graph.getNodeById(position.nodeId);
          if (!node) continue;

          // Transform canvas coordinates to screen coordinates
          // position.x and position.y are relative to node, so add node position
          const canvasX = node.pos[0] + position.x;
          const canvasY = node.pos[1] + position.y;
          
          // Convert canvas coordinates to client/screen coordinates
          const clientPos = canvasInstance.convertCanvasToOffset([canvasX, canvasY]);
          
          // Get canvas bounding rect for absolute positioning
          const rect = canvas.getBoundingClientRect();
          const absoluteX = rect.left + clientPos[0];
          const absoluteY = rect.top + clientPos[1];
          
          positions.set(key, {
            x: absoluteX,
            y: absoluteY,
            width: position.width || 200,
            height: position.height || 100,
            nodeId: position.nodeId,
            widgetName: position.widgetName,
            widget: position.widget,
            timestamp: position.timestamp || Date.now(),
          });
        }
      }
      
      setWidgetPositions(positions);
    };

    // Update positions on every animation frame (like ComfyUI does)
    const tick = () => {
      updatePositions();
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    
    animationFrameRef.current = requestAnimationFrame(tick);

    // Also update on canvas draw
    const originalDraw = canvasInstance.draw.bind(canvasInstance);
    canvasInstance.draw = function(forceFG?: boolean, forceBG?: boolean) {
      const result = originalDraw(forceFG, forceBG);
      updatePositions();
      return result;
    };

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      canvasInstance.draw = originalDraw;
    };
  }, []);

  return (
    <div className="widget-overlay" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 10 }}>
      {Array.from(widgetPositions.entries()).map(([key, pos]) => {
        if (pos.widget?.type !== "textarea") return null;
        
        const widget = pos.widget;
        const value = widget?.value || "";
        
        return (
          <textarea
            key={key}
            style={{
              position: "absolute",
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              width: `${pos.width}px`,
              height: `${pos.height}px`,
              pointerEvents: "auto",
              background: "#1a1a1a",
              color: "#FFFFFF",
              border: "1px solid #555555",
              borderRadius: "4px",
              padding: "4px",
              fontSize: "12px",
              fontFamily: "Arial, sans-serif",
              resize: "none",
              overflow: "auto",
            }}
            value={value}
            onChange={(e) => {
              // Update widget value
              if (widget) {
                widget.value = e.target.value;
                // Trigger callback if exists
                if (widget.callback) {
                  widget.callback(e.target.value, widget, null, [0, 0], null);
                }
                // Update node property
                const graph = (window as any).__obeliskGraph;
                if (graph) {
                  const node = graph.getNodeById(pos.nodeId);
                  if (node && widget.options?.property) {
                    node.setProperty(widget.options.property, e.target.value);
                  }
                }
                // Force canvas redraw
                const canvas = (window as any).__obeliskCanvas;
                if (canvas) {
                  canvas.dirty_canvas = true;
                  canvas.draw(true);
                }
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          />
        );
      })}
    </div>
  );
}
