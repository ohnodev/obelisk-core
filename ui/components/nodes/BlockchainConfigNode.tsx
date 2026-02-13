"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

const DEFAULT_STATE_PATH = "blockchain-service/data/clanker_state.json";

class BlockchainConfigNode extends LGraphNode {
  static title = "Blockchain Config";
  static desc = "Path to Clanker state JSON; outputs state_path and state for downstream nodes";
  static title_color = "#50b050";

  constructor() {
    super();
    this.title = "Blockchain Config";
    this.addOutput("state_path", "string");
    this.addOutput("state", "object");

    this.addProperty("state_file_path", DEFAULT_STATE_PATH, "string");
    this.addWidget("string", "state_file_path", DEFAULT_STATE_PATH, (value: string) => {
      this.setProperty("state_file_path", value);
    }, { serialize: true });

    this.size = [280, 80];
    (this as any).type = "blockchain_config";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    if (name === "state_file_path") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const w = widgets.find((x: any) => x.name === "state_file_path");
        if (w) w.value = value;
      }
    }
  }

  onExecute() {
    const path = (this.properties as any)?.state_file_path || DEFAULT_STATE_PATH;
    this.setOutputData(0, path);
    // state object is resolved by backend when reading the file
    this.setOutputData(1, { state_file_path: path });
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
