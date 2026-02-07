"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class InferenceConfigNode extends LGraphNode {
  static title = "Inference Config";
  static desc = "Configures inference service endpoint";
  static title_color = "#7aa2f7";

  constructor() {
    super();
    this.title = "Inference Config";
    this.addOutput("model", "object");
    
    // Endpoint URL widget
    const defaultEndpoint = "http://localhost:7780";
    this.addProperty("endpoint_url", defaultEndpoint, "string");
    this.addWidget("string", "endpoint_url", defaultEndpoint, (value: string) => {
      this.setProperty("endpoint_url", value);
    }, {
      serialize: true
    });
    
    // Use default toggle (when on, ignores endpoint_url and uses localhost:7780)
    this.addProperty("use_default", true, "boolean");
    this.addWidget("toggle", "use_default", true, (value: boolean) => {
      this.setProperty("use_default", value);
    }, {
      serialize: true
    });
    
    this.size = [280, 120];
    (this as any).type = "inference_config";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: any) {
    // Sync widget value when property changes (e.g., during deserialization)
    if (name === "endpoint_url" || name === "use_default") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === name);
        if (widget) {
          widget.value = value;
        }
      }
    }
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
    const useDefault = (this.properties as any)?.use_default !== false;
    const endpointUrl = (this.properties as any)?.endpoint_url || "http://localhost:7780";
    
    const resolvedEndpoint = useDefault ? "http://localhost:7780" : endpointUrl;
    
    this.setOutputData(0, { 
      type: "inference_config", 
      endpoint_url: resolvedEndpoint,
      use_default: useDefault,
    });
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(122, 162, 247, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);

    // Execution highlighting
    if ((this as any).executing) {
      ctx.fillStyle = "rgba(255, 200, 0, 0.3)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
      ctx.strokeStyle = "#ffc800";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
    } else if ((this as any).executed) {
      ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
      ctx.fillRect(0, 0, this.size[0], this.size[1]);
    }
  }
}

// Register as both "inference_config" (new) and "model_loader" (backward compat)
// so existing workflow JSON files with "model_loader" nodes still work.
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("inference_config", InferenceConfigNode);
  LiteGraph?.registerNodeType("model_loader", InferenceConfigNode);
}

export default InferenceConfigNode;
