"use client";

import { LGraphNode, LiteGraph } from "@/lib/litegraph-index";

class IntNode extends LGraphNode {
  static title = "Int";
  static desc = "Integer value from env or literal; parses and trims, outputs number or error";
  static title_color = "#7cb342";

  constructor() {
    super();
    this.title = "Int";

    this.addInput("value", "string,number");
    this.addOutput("value", "number");
    this.addOutput("error", "string");

    this.addProperty("value", "0", "string");
    (this as any)._value_widget = this.addWidget("string", "value", "0", () => {}, { serialize: true });

    this.size = [300, 90];
    (this as any).type = "int";
    (this as any).resizable = true;
  }

  onPropertyChanged(name: string, value: unknown) {
    if (name === "value" && (this as any)._value_widget) {
      (this as any)._value_widget.value = value != null ? String(value) : "";
    }
  }
}

if (typeof window !== "undefined" && LiteGraph?.registerNodeType) {
  LiteGraph.registerNodeType("int", IntNode);
}

export default IntNode;
