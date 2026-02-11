"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ActionRouterNode extends LGraphNode {
  static title = "Action Router";
  static desc = "Parses LLM response into a list of actions (abstract). Output: tg_actions for TG Action node.";
  static title_color = "#6b4c9a";

  constructor() {
    super();
    this.title = "Action Router";

    this.addInput("response", "string");

    this.addOutput("tg_actions", "array");

    this.size = [240, 100];
    (this as any).type = "action_router";
    (this as any).resizable = true;
  }

  onExecute() {
    // Backend parses and produces actions
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) return;
    ctx.fillStyle = "rgba(107, 76, 154, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
      ctx.strokeStyle = "#ffc800";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("action_router", ActionRouterNode);
}

export default ActionRouterNode;
