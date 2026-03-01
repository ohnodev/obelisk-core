"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketTradeOutcomeUpdaterNode extends LGraphNode {
  static title = "Polymarket Trade Outcome Updater";
  static desc =
    "After housekeeping, matches resolved positions to trades by token_id and updates outcome + pnl. Connect trigger + housekeeping_response from Polymarket Action, storage_instance from Storage.";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Trade Outcome Updater";

    this.addInput("trigger", "boolean");
    this.addInput("housekeeping_response", "object");
    this.addInput("response", "object");
    this.addInput("storage_instance", "object");

    this.addOutput("success", "boolean");
    this.addOutput("updated", "number");

    this.size = [280, 100];
    (this as any).type = "polymarket_trade_outcome_updater";
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
    ctx.fillStyle = "rgba(45, 127, 249, 0.08)";
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
  LiteGraph.registerNodeType("polymarket_trade_outcome_updater", PolymarketTradeOutcomeUpdaterNode);
}

export default PolymarketTradeOutcomeUpdaterNode;
