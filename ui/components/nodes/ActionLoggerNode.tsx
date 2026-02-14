"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

const DEFAULT_MAX_ACTIONS = 100;

class ActionLoggerNode extends LGraphNode {
  static title = "Action Logger";
  static desc = "Appends buy/sell results to clanker_actions.json (same dir as state or storage basePath). Keeps last N actions (default 100).";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Action Logger";

    this.addInput("buy_result", "object");
    this.addInput("sell_result", "object");
    this.addInput("state_path", "string");
    this.addInput("storage_instance", "object");
    this.addInput("max_actions", "number");

    this.addOutput("success", "boolean");
    this.addOutput("logged_count", "number");

    this.size = [260, 140];
    (this as any).type = "action_logger";
    (this as any).resizable = true;

    this.addProperty("max_actions", DEFAULT_MAX_ACTIONS, "number");
    this.addWidget(
      "number" as any,
      "Max actions (keep last N)",
      DEFAULT_MAX_ACTIONS,
      (value: number) => {
        const v = Math.max(1, Math.min(1000, Math.round(Number(value)) || DEFAULT_MAX_ACTIONS));
        this.setProperty("max_actions", v);
      },
      { min: 1, max: 1000, step: 1, serialize: true, property: "max_actions" } as any
    );
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) return;
    ctx.fillStyle = "rgba(80, 176, 80, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "max_actions") {
      const widgets = (this as any).widgets as any[];
      const w = widgets?.find((x: any) => x.name === "Max actions (keep last N)");
      if (w) w.value = value ?? DEFAULT_MAX_ACTIONS;
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("action_logger", ActionLoggerNode);
}

export default ActionLoggerNode;
