"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class LoRALoaderNode extends LGraphNode {
  static title = "LoRA Loader";
  static desc = "Applies LoRA weights to model";
  static title_color = "#9ece6a";

  constructor() {
    super();
    this.title = "LoRA Loader";
    this.addInput("model", "object");
    this.addOutput("model", "object");
    this.addProperty("lora_enabled", true, "boolean");
    this.size = [200, 60];
    (this as any).type = "lora_loader";
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

  onExecute() {
    const model = this.getInputData(0);
    const loraEnabled = (this.properties as any)?.lora_enabled ?? true;
    // In a real implementation, this would apply LoRA weights
    this.setOutputData(0, { ...model, lora_enabled: loraEnabled });
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(158, 206, 106, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph) {
  LiteGraph.registerNodeType("lora_loader", LoRALoaderNode);
}

export default LoRALoaderNode;
