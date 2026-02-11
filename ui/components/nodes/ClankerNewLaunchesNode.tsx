"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ClankerNewLaunchesNode extends LGraphNode {
  static title = "Clanker New Launches";
  static desc = "List recent Clanker token launches from state (for scheduler-driven workflows)";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Clanker New Launches";
    this.addInput("trigger", "boolean");
    this.addInput("state", "object");
    this.addInput("state_path", "string");
    this.addInput("limit", "number");
    this.addOutput("recent_launches", "object");
    this.addOutput("count", "number");

    this.addProperty("limit", 20, "number");
    this.addWidget("number", "limit", 20, (value: number) => {
      this.setProperty("limit", value);
    }, { serialize: true });

    this.size = [280, 100];
    (this as any).type = "clanker_new_launches";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "limit") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const w = widgets.find((x: any) => x.name === "limit");
        if (w) w.value = value;
      }
    }
  }

  onExecute() {
    // Backend resolves from state / state_path
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
  LiteGraph?.registerNodeType("clanker_new_launches", ClankerNewLaunchesNode);
}

export default ClankerNewLaunchesNode;
