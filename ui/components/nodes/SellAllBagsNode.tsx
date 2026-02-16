"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class SellAllBagsNode extends LGraphNode {
  static title = "Sell All Bags";
  static desc = "Sell every position in clanker_bags.json. Inputs: request_id from Sell Bags Listener; storage_instance/base_path from Storage; state from Blockchain Config; private_key from Wallet. Outputs to HTTP Response (body, request_id, status_code).";
  static title_color = "#c0392b";

  constructor() {
    super();
    this.title = "Sell All Bags";

    this.addInput("request_id", "string");
    this.addInput("trigger", "boolean");
    this.addInput("storage_instance", "object");
    this.addInput("base_path", "string");
    this.addInput("state", "object");
    this.addInput("private_key", "string");

    this.addOutput("success", "boolean");
    this.addOutput("sold_count", "number");
    this.addOutput("errors", "object");
    this.addOutput("response_body", "object");
    this.addOutput("request_id", "string");
    this.addOutput("status_code", "number");

    this.size = [280, 180];
    (this as any).type = "sell_all_bags";
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
    ctx.fillStyle = "rgba(192, 57, 43, 0.08)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("sell_all_bags", SellAllBagsNode);
}

export default SellAllBagsNode;
