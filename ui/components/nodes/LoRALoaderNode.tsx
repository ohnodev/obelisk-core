"use client";

import { LGraphNode, LiteGraph } from "litegraph.js";

class LoRALoaderNode extends LGraphNode {
  static title = "LoRA Loader";
  static desc = "Applies LoRA weights to model";
  static title_color = "#d4af37";

  constructor() {
    super();
    this.addInput("model", "object");
    this.addOutput("model", "object");
    this.addProperty("lora_enabled", true, "boolean");
    this.size = [200, 60];
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
    ctx.fillStyle = "rgba(212, 175, 55, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

LiteGraph.registerNodeType("lora_loader", LoRALoaderNode);

export default LoRALoaderNode;
