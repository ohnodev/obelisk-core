"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

const DEFAULT_BLOCKCHAIN_SERVICE_URL = "http://localhost:8888";

class BlockchainConfigNode extends LGraphNode {
  static title = "Blockchain Config";
  static desc = "Blockchain service URL; fetches Clanker state from GET /clanker/state";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Blockchain Config";
    this.addInput("blockchain_service_url", "string");
    this.addInput("api_key", "string");
    this.addOutput("state", "object");

    this.addProperty("blockchain_service_url", DEFAULT_BLOCKCHAIN_SERVICE_URL, "string");
    this.addProperty("api_key", "", "string");
    this.addWidget("string", "blockchain_service_url", DEFAULT_BLOCKCHAIN_SERVICE_URL, (value: string) => {
      this.setProperty("blockchain_service_url", value);
    }, { serialize: true });
    this.addWidget("string", "api_key", "", (value: string) => {
      this.setProperty("api_key", value);
    }, { serialize: true });

    this.size = [340, 120];
    (this as any).type = "blockchain_config";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    const widgets = (this as any).widgets as any[];
    if (!widgets) return;
    if (name === "blockchain_service_url") {
      const w = widgets.find((x: any) => x.name === "blockchain_service_url");
      if (w) w.value = value;
    }
    if (name === "api_key") {
      const w = widgets.find((x: any) => x.name === "api_key");
      if (w) w.value = value ?? "";
    }
  }

  onExecute() {
    // state object is resolved by backend from GET {url}/clanker/state
    this.setOutputData(0, null);
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
  LiteGraph?.registerNodeType("blockchain_config", BlockchainConfigNode);
}

export default BlockchainConfigNode;
