"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  calculateNodeBounds,
  enforceMinimumBounds,
  calculateMinimapScale,
  renderMinimap,
  SpatialBounds,
} from "@/lib/minimap-utils";

// ── Constants ──────────────────────────────────────────────────────────

const MAP_W = 253;
const MAP_H = 200;
const RENDER_INTERVAL_MS = 500;

// ── Component ──────────────────────────────────────────────────────────

export default function Minimap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Mutable state that doesn't need React re-renders
  const stateRef = useRef({
    isDragging: false,
    bounds: null as SpatialBounds | null,
    scale: 1,
    rafId: 0,
    lastRenderTime: 0,
    containerRect: null as DOMRect | null,
  });

  // ── Compute bounds + scale (reused by renderer & viewport) ─────────

  const computeLayout = useCallback((): {
    bounds: SpatialBounds;
    scale: number;
  } | null => {
    const graph = (window as any).__obeliskGraph;
    if (!graph) return null;
    const nodes: any[] = graph._nodes || [];
    const rawBounds = calculateNodeBounds(nodes);
    if (!rawBounds) return null;
    const bounds = enforceMinimumBounds(rawBounds);
    const scale = calculateMinimapScale(bounds, MAP_W, MAP_H);
    return { bounds, scale };
  }, []);

  // ── Render the minimap canvas (throttled) ──────────────────────────

  const renderCanvas = useCallback(() => {
    const graph = (window as any).__obeliskGraph;
    const cvs = canvasRef.current;
    if (!graph || !cvs) return;

    const layout = computeLayout();
    if (!layout) return;

    stateRef.current.bounds = layout.bounds;
    stateRef.current.scale = layout.scale;

    renderMinimap(cvs, graph, layout.bounds, layout.scale, MAP_W, MAP_H);
  }, [computeLayout]);

  // ── Update the viewport rectangle every frame ──────────────────────

  const updateViewport = useCallback(() => {
    const lgCanvas = (window as any).__obeliskCanvas;
    const vpEl = viewportRef.current;
    const { bounds, scale } = stateRef.current;
    if (!lgCanvas || !vpEl || !bounds) return;

    const ds = lgCanvas.ds;
    if (!ds) return;

    // World-space viewport
    const canvasEl = lgCanvas.canvas as HTMLCanvasElement | undefined;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const vpW = rect.width / ds.scale;
    const vpH = rect.height / ds.scale;
    const worldX = -ds.offset[0];
    const worldY = -ds.offset[1];

    // Center offset (same formula used in renderMinimap)
    const offX = (MAP_W - bounds.width * scale) / 2;
    const offY = (MAP_H - bounds.height * scale) / 2;

    // Transform to minimap coords
    const x = (worldX - bounds.minX) * scale + offX;
    const y = (worldY - bounds.minY) * scale + offY;
    const w = vpW * scale;
    const h = vpH * scale;

    vpEl.style.transform = `translate(${x}px, ${y}px)`;
    vpEl.style.width = `${w}px`;
    vpEl.style.height = `${h}px`;
  }, []);

  // ── RAF loop ───────────────────────────────────────────────────────

  useEffect(() => {
    const tick = (now: number) => {
      // Re-render canvas at throttled interval
      if (now - stateRef.current.lastRenderTime > RENDER_INTERVAL_MS) {
        renderCanvas();
        stateRef.current.lastRenderTime = now;
      }
      // Always update viewport rect (cheap)
      updateViewport();
      stateRef.current.rafId = requestAnimationFrame(tick);
    };
    stateRef.current.rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(stateRef.current.rafId);
  }, [renderCanvas, updateViewport]);

  // ── Drag → navigate ────────────────────────────────────────────────

  const minimapToWorld = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const { bounds, scale, containerRect } = stateRef.current;
      if (!bounds || !containerRect) return null;

      const mx = clientX - containerRect.left;
      const my = clientY - containerRect.top;

      const offX = (MAP_W - bounds.width * scale) / 2;
      const offY = (MAP_H - bounds.height * scale) / 2;

      const worldX = (mx - offX) / scale + bounds.minX;
      const worldY = (my - offY) / scale + bounds.minY;
      return [worldX, worldY];
    },
    []
  );

  const centerViewOn = useCallback((worldX: number, worldY: number) => {
    const lgCanvas = (window as any).__obeliskCanvas;
    if (!lgCanvas) return;
    const ds = lgCanvas.ds;
    if (!ds) return;

    const canvasEl = lgCanvas.canvas as HTMLCanvasElement | undefined;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const vpW = rect.width / ds.scale;
    const vpH = rect.height / ds.scale;

    ds.offset[0] = -(worldX - vpW / 2);
    ds.offset[1] = -(worldY - vpH / 2);

    lgCanvas.setDirty(true, true);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      stateRef.current.isDragging = true;
      stateRef.current.containerRect =
        containerRef.current?.getBoundingClientRect() ?? null;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const world = minimapToWorld(e.clientX, e.clientY);
      if (world) centerViewOn(world[0], world[1]);
    },
    [minimapToWorld, centerViewOn]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!stateRef.current.isDragging) return;
      const world = minimapToWorld(e.clientX, e.clientY);
      if (world) centerViewOn(world[0], world[1]);
    },
    [minimapToWorld, centerViewOn]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    stateRef.current.isDragging = false;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
  }, []);

  // ── Wheel → zoom ──────────────────────────────────────────────────

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const lgCanvas = (window as any).__obeliskCanvas;
      if (!lgCanvas) return;
      const ds = lgCanvas.ds;
      if (!ds) return;

      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = ds.scale * delta;
      if (newScale < 0.1 || newScale > 10) return;

      // Zoom toward cursor position on the minimap
      stateRef.current.containerRect =
        containerRef.current?.getBoundingClientRect() ?? null;
      const world = minimapToWorld(e.clientX, e.clientY);
      ds.scale = newScale;
      if (world) centerViewOn(world[0], world[1]);
    },
    [minimapToWorld, centerViewOn]
  );

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        width: MAP_W,
        height: MAP_H,
        zIndex: 50,
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(18, 18, 18, 0.85)",
        backdropFilter: "blur(6px)",
        overflow: "hidden",
        cursor: "crosshair",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        width={MAP_W}
        height={MAP_H}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
      <div
        ref={viewportRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          border: "2px solid rgba(255,255,255,0.7)",
          background: "rgba(255,255,255,0.08)",
          pointerEvents: "none",
          willChange: "transform",
          backfaceVisibility: "hidden",
        }}
      />
    </div>
  );
}
