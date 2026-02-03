"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class MemoryStorageNode extends LGraphNode {
  static title = "Memory Storage";
  static desc = "Creates/accesses storage instances based on storage path";
  static title_color = "#9d79d6";

  constructor() {
    super();
    this.title = "Memory Storage";
    this.addInput("storage_path", "string");
    this.addInput("storage_type", "string");
    this.addOutput("storage_instance", "object");
    this.size = [220, 100];
    (this as any).type = "memory_storage";
    (this as any).resizable = true;
    
    // Add properties for default values
    this.addProperty("storage_path", "", "string");
    this.addProperty("storage_type", "local_json", "string");
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
    // Storage instance is created by backend
    // Frontend just passes through the connection
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
