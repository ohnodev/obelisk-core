"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class MemoryStorageNode extends LGraphNode {
  static title = "Memory Storage";
  static desc = "Creates/accesses storage instances based on storage path";
  static title_color = "#9d79d6";

  constructor() {
    super();
    this.title = "Memory Storage";
    
    // Optional input endpoint for storage_path (can be connected or use inline widget)
    this.addInput("storage_path", "string");
    
    // Storage type selector - no input endpoint, only widget
    this.addOutput("storage_instance", "object");
    this.size = [280, 150];
    (this as any).type = "memory_storage";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("storage_path", "", "string");
    this.addProperty("storage_type", "local_json", "string");
    
    // Add inline text input widget for storage_path
    const initialPath = (this.properties as any)?.storage_path || "";
    this.addWidget(
      "text" as any,
      "Storage Path",
      initialPath,
      (value: string) => {
        this.setProperty("storage_path", value);
      },
      {
        serialize: true,
      } as any
    );
    
    // Add combo/selector widget for storage_type
    this.addWidget(
      "combo" as any,
      "Storage Type",
      "local_json",
      (value: string) => {
        this.setProperty("storage_type", value);
      },
      {
        serialize: true,
        values: ["local_json", "supabase"],
      } as any
    );
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
    // Check if storage_path input is connected
    const inputPath = this.getInputData(0);
    const widgetPath = (this.properties as any)?.storage_path || "";
    
    // Use input if connected, otherwise use widget value
    if (inputPath !== null && inputPath !== undefined && inputPath !== "") {
      this.setProperty("storage_path", String(inputPath));
      // Update widget value
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "Storage Path");
        if (widget) {
          widget.value = String(inputPath);
        }
      }
    }
    
    // Storage instance is created by backend
    // Frontend just passes through the connection
  }
  
  onPropertyChanged(name: string, value: any) {
    // Sync widget value when property changes
    if (name === "storage_path") {
      const widgets = (this as any).widgets as any[];
      if (widgets) {
        const widget = widgets.find((w: any) => w.name === "Storage Path");
        if (widget) {
          widget.value = value || "";
        }
      }
    }
  }

  onDrawBackground(ctx: CanvasRenderingContext2D) {
    if (this.flags.collapsed) {
      return;
    }
    ctx.fillStyle = "rgba(157, 121, 214, 0.1)";
    ctx.fillRect(0, 0, this.size[0], this.size[1]);
  }
}

// Only register on client side
if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph?.registerNodeType("memory_storage", MemoryStorageNode);
}

export default MemoryStorageNode;
