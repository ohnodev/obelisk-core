"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class PolymarketStatusListenerNode extends LGraphNode {
  static title = "Polymarket Status Listener";
  static desc = "GET /polymarket/status, /trades, /pnl. Connect Express Service for shared server.";
  static title_color = "#2d7ff9";

  constructor() {
    super();
    this.title = "Polymarket Status Listener";

    this.addInput("express_service", "object");

    this.size = [300, 80];
    (this as any).type = "polymarket_status_listener";
    (this as any).resizable = true;
  }

  onExecute() {}
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("polymarket_status_listener", PolymarketStatusListenerNode);
}

export default PolymarketStatusListenerNode;
