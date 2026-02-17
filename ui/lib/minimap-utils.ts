/**
 * Minimap utility functions — ported from ComfyUI's boundsCalculator.ts
 * and minimapCanvasRenderer.ts, adapted for direct LiteGraph access.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface SpatialBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

// ── Bounds helpers ─────────────────────────────────────────────────────

export function calculateNodeBounds(nodes: any[]): SpatialBounds | null {
  if (!nodes || nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    if (!node) continue;
    const x = node.pos[0];
    const y = node.pos[1];
    const w = node.size[0];
    const h = node.size[1];

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  if (!Number.isFinite(minX)) return null;

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function enforceMinimumBounds(
  bounds: SpatialBounds,
  minWidth = 2500,
  minHeight = 2000
): SpatialBounds {
  let { minX, minY, maxX, maxY, width, height } = bounds;

  if (width < minWidth) {
    const pad = (minWidth - width) / 2;
    minX -= pad;
    maxX += pad;
    width = minWidth;
  }
  if (height < minHeight) {
    const pad = (minHeight - height) / 2;
    minY -= pad;
    maxY += pad;
    height = minHeight;
  }

  return { minX, minY, maxX, maxY, width, height };
}

export function calculateMinimapScale(
  bounds: SpatialBounds,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0.9
): number {
  if (bounds.width === 0 || bounds.height === 0) return 1;
  const sx = viewportWidth / bounds.width;
  const sy = viewportHeight / bounds.height;
  return Math.min(sx, sy) * padding;
}

// ── Dark-theme colors (our app is dark-only) ──────────────────────────

const COLORS = {
  node: "#0B8CE999",
  nodeDefault: "#353535",
  link: "#B3B3B3",
  slot: "#B3B3B3",
  group: "#1F547A",
};

// ── Rendering ──────────────────────────────────────────────────────────

function renderGroups(
  ctx: CanvasRenderingContext2D,
  groups: any[],
  offsetX: number,
  offsetY: number,
  bounds: SpatialBounds,
  scale: number
) {
  for (const g of groups) {
    if (!g) continue;
    const x = (g.pos[0] - bounds.minX) * scale + offsetX;
    const y = (g.pos[1] - bounds.minY) * scale + offsetY;
    const w = g.size[0] * scale;
    const h = g.size[1] * scale;
    ctx.fillStyle = g.color ?? COLORS.group;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }
}

function renderLinks(
  ctx: CanvasRenderingContext2D,
  graph: any,
  nodes: any[],
  offsetX: number,
  offsetY: number,
  bounds: SpatialBounds,
  scale: number
) {
  const nodeById = new Map<number, any>();
  for (const n of nodes) {
    if (n) nodeById.set(n.id, n);
  }

  ctx.strokeStyle = COLORS.link;
  ctx.lineWidth = 0.3;

  const slotRadius = Math.max(scale, 0.5);
  const endpoints: Array<{ x1: number; y1: number; x2: number; y2: number }> =
    [];

  // LiteGraph stores links in graph.links as an object keyed by link id
  const links = graph.links;
  if (!links) return;

  const linkList = links instanceof Map ? Array.from(links.values()) : Object.values(links);

  for (const link of linkList) {
    if (!link) continue;
    const src = nodeById.get((link as any).origin_id);
    const tgt = nodeById.get((link as any).target_id);
    if (!src || !tgt) continue;

    const sx = (src.pos[0] - bounds.minX) * scale + offsetX;
    const sy = (src.pos[1] - bounds.minY) * scale + offsetY;
    const tx = (tgt.pos[0] - bounds.minX) * scale + offsetX;
    const ty = (tgt.pos[1] - bounds.minY) * scale + offsetY;

    const outX = sx + src.size[0] * scale;
    const outY = sy + src.size[1] * scale * 0.2;
    const inX = tx;
    const inY = ty + tgt.size[1] * scale * 0.2;

    ctx.beginPath();
    ctx.moveTo(outX, outY);
    ctx.lineTo(inX, inY);
    ctx.stroke();

    endpoints.push({ x1: outX, y1: outY, x2: inX, y2: inY });
  }

  // Render slot dots
  ctx.fillStyle = COLORS.slot;
  for (const ep of endpoints) {
    ctx.beginPath();
    ctx.arc(ep.x1, ep.y1, slotRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ep.x2, ep.y2, slotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderNodes(
  ctx: CanvasRenderingContext2D,
  nodes: any[],
  offsetX: number,
  offsetY: number,
  bounds: SpatialBounds,
  scale: number
) {
  // Batch by color for fewer state changes
  const byColor = new Map<string, Array<{ x: number; y: number; w: number; h: number }>>();

  for (const node of nodes) {
    if (!node) continue;
    const x = (node.pos[0] - bounds.minX) * scale + offsetX;
    const y = (node.pos[1] - bounds.minY) * scale + offsetY;
    const w = node.size[0] * scale;
    const h = node.size[1] * scale;

    const color: string = node.bgcolor ?? COLORS.nodeDefault;
    let bucket = byColor.get(color);
    if (!bucket) {
      bucket = [];
      byColor.set(color, bucket);
    }
    bucket.push({ x, y, w, h });
  }

  for (const [color, rects] of byColor) {
    ctx.fillStyle = color;
    for (const r of rects) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }
}

// ── Public entry point ─────────────────────────────────────────────────

export function renderMinimap(
  canvas: HTMLCanvasElement,
  graph: any,
  bounds: SpatialBounds,
  scale: number,
  width: number,
  height: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);

  const nodes: any[] = graph._nodes || [];
  if (nodes.length === 0) return;

  const offsetX = (width - bounds.width * scale) / 2;
  const offsetY = (height - bounds.height * scale) / 2;

  // Draw order: groups -> links -> nodes (matching ComfyUI)
  const groups: any[] = graph._groups || [];
  if (groups.length > 0) {
    renderGroups(ctx, groups, offsetX, offsetY, bounds, scale);
  }

  renderLinks(ctx, graph, nodes, offsetX, offsetY, bounds, scale);
  renderNodes(ctx, nodes, offsetX, offsetY, bounds, scale);
}
