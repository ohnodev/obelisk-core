"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ClankerTokenStatsNode extends LGraphNode {
  static title = "Clanker Token Stats";
  static desc = "Look up token stats (swaps, buys, sells, volume) from Clanker state";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Clanker Token Stats";
    this.addInput("token_address", "string");
    this.addInput("state", "object");
    this.addInput("state_path", "string");
    this.addOutput("stats", "object");

    this.addProperty("token_address", "", "string");
    this.addWidget("string", "token_address", "", (value: string) => {
      this.setProperty("token_address", value);
    }, { serialize: true });

    this.size = [280, 100];
    (this as any).type = "clanker_token_stats";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "token_address") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const w = widgets.find((x: any) => x.name === "token_address");
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
  LiteGraph?.registerNodeType("clanker_token_stats", ClankerTokenStatsNode);
}

export default ClankerTokenStatsNode;
