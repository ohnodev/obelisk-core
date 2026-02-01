"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class ModelLoaderNode extends LGraphNode {
  static title = "Model Loader";
  static desc = "Loads the LLM model";
  static title_color = "#7aa2f7";

  constructor() {
    super();
    this.title = "Model Loader";
    this.addOutput("model", "object");
    
    // Add model path widget (string input)
    const defaultModelPath = "models/default_model";
    this.addProperty("model_path", defaultModelPath, "string");
    this.addWidget("string", "model_path", defaultModelPath, (value: string) => {
      this.setProperty("model_path", value);
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
    
    this.size = [250, 120];
    (this as any).type = "model_loader";
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
    const autoLoad = (this.properties as any)?.auto_load !== false; // Default to true
    const modelPath = (this.properties as any)?.model_path || "models/default_model";
    
    if (autoLoad) {
      // Auto load logic - follow current model loading logic
      // In a real implementation, this would load the model from the path
      // For now, we pass through a model reference with the path
      this.setOutputData(0, { 
        type: "model", 
        path: modelPath,
        loaded: true 
      });
    } else {
      // Manual load - just pass the path, don't load yet
      this.setOutputData(0, { 
        type: "model", 
        path: modelPath,
        loaded: false 
      });
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(122, 162, 247, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("model_loader", ModelLoaderNode);
}

export default ModelLoaderNode;
