"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ClankerAutotraderStatsNode extends LGraphNode {
  static title = "Clanker Autotrader Stats";
  static desc = "Reads clanker_bags.json and actions from storage. Connect base_path from Storage, request_id from Autotrader Stats Listener; output to HTTP Response.";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Clanker Autotrader Stats";

    this.addInput("request_id", "string");
    this.addInput("storage_instance", "object");
    this.addInput("base_path", "string");
    this.addInput("actions_limit", "number");

    this.addOutput("stats", "string");
    this.addOutput("request_id", "string");

    this.size = [260, 120];
    (this as any).type = "clanker_autotrader_stats";
    (this as any).resizable = true;
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
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("clanker_autotrader_stats", ClankerAutotraderStatsNode);
}

export default ClankerAutotraderStatsNode;
