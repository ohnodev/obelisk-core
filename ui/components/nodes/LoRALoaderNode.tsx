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
    
    // Add LoRA path widget (string input)
    const defaultLoRAPath = "lora/default_lora";
    this.addProperty("lora_path", defaultLoRAPath, "string");
    this.addWidget("string", "lora_path", defaultLoRAPath, (value: string) => {
      this.setProperty("lora_path", value);
    }, {
      serialize: true
    });
    
    // Add auto load toggle widget (default: true)
    this.addProperty("auto_load", true, "boolean");
    this.addWidget("toggle", "auto_load", true, (value: boolean) => {
      this.setProperty("auto_load", value);
    }, {
      serialize: true
    });
    
    // Keep existing lora_enabled property for backward compatibility
    this.addProperty("lora_enabled", true, "boolean");
    
    this.size = [250, 120];
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
    const autoLoad = (this.properties as any)?.auto_load !== false; // Default to true
    const loraPath = (this.properties as any)?.lora_path || "lora/default_lora";
    const loraEnabled = (this.properties as any)?.lora_enabled ?? true;
    
    if (autoLoad && loraEnabled) {
      // Auto load logic - apply LoRA weights from path
      // In a real implementation, this would load and apply LoRA weights
      this.setOutputData(0, { 
        ...model, 
        lora_enabled: true,
        lora_path: loraPath,
        lora_loaded: true
      });
    } else {
      // Manual load or disabled - just pass through with path info
      this.setOutputData(0, { 
        ...model, 
        lora_enabled: loraEnabled,
        lora_path: loraPath,
        lora_loaded: false
      });
    }
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
