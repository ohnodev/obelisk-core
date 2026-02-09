"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

/**
 * Reroute node – a tiny visual helper that passes a single connection through.
 * Inspired by ComfyUI's Reroute: wildcard input → wildcard output, no title bar,
 * minimal footprint.  Purely cosmetic – the backend simply forwards the value.
 */
class RerouteNode extends LGraphNode {
  static title = "Reroute";
  static desc = "Pass-through node for cleaner wire routing";

  constructor() {
    super();
    this.title = "Reroute";

    this.addInput("in", "*");
    this.addOutput("out", "*");

    this.size = [75, 26];
    (this as any).type = "reroute";
    (this as any).resizable = false;

    // Properties
    this.addProperty("showType", false, "boolean");
  }

  computeSize(): [number, number] {
    return [75, 26];
  }

  onExecute() {
    // Pass through the input to the output
    this.setOutputData(0, this.getInputData(0));
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) return;

    // Subtle background
    ctx.fillStyle = "rgba(100, 100, 100, 0.2)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);

    // Execution highlighting
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.1)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }

  onDrawForeground(_ctx: CanvasRenderingContext2D) {
    // No foreground drawing – keep it minimal
  }
}

// Register with LiteGraph
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType(
    "reroute",
    Object.assign(RerouteNode, {
      title_mode: (LiteGraph as any).NO_TITLE ?? 1,
      collapsable: false,
    })
  );
}

export default RerouteNode;
