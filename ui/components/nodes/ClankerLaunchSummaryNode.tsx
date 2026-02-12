"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ClankerLaunchSummaryNode extends LGraphNode {
  static title = "Clanker Launch Summary";
  static desc = "Reads state from Blockchain Config; recent launches in past 1h with full stats (volume 5m/15m/30m/1h, total makers, price change) for LLM.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Clanker Launch Summary";
    this.addInput("trigger", "boolean");
    this.addInput("state", "object");
    this.addInput("state_path", "string");
    this.addInput("storage_instance", "object");
    this.addInput("limit", "number");
    this.addInput("window_hours", "number");
    this.addOutput("recent_launches", "object");
    this.addOutput("summary", "string");
    this.addOutput("text", "string");
    this.addOutput("count", "number");

    this.addProperty("window_hours", 1, "number");
    this.addProperty("limit", 20, "number");
    this.addWidget("number", "window_hours", 1, (value: number) => {
      this.setProperty("window_hours", value);
    }, { serialize: true });
    this.addWidget("number", "limit", 20, (value: number) => {
      this.setProperty("limit", value);
    }, { serialize: true });

    this.size = [320, 120];
    (this as any).type = "clanker_launch_summary";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (!widgets) return;
    if (name === "window_hours") {
      const w = widgets.find((x: any) => x.name === "window_hours");
      if (w) w.value = value;
    }
    if (name === "limit") {
      const w = widgets.find((x: any) => x.name === "limit");
      if (w) w.value = value;
    }
  }

  onExecute() {
    // Backend reads state and builds summary
  }

  onDrawForeground(ctx: CanvasRenderingContext2D) {
    const isSelected = (this as any).is_selected || (this as any).isSelected;
    if (isSelected) {
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("clanker_launch_summary", ClankerLaunchSummaryNode);
}

export default ClankerLaunchSummaryNode;
