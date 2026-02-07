/**
 * TextNode – flexible text input/output node.
 * Mirrors Python src/core/execution/nodes/text.py
 */
import { BaseNode, ExecutionContext } from "../nodeBase";

export class TextNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    // 1. Check connected input (skip boolean trigger values)
    let inputText = this.getInputValue("text", context, undefined);
    if (typeof inputText === "boolean") inputText = undefined;

    let textValue: string;

    if (inputText !== undefined && inputText !== null) {
      textValue = String(inputText);
    } else {
      // 2. Direct input value (skip boolean)
      const directInput = this.inputs.text;
      if (directInput !== undefined && typeof directInput !== "boolean") {
        textValue = String(
          this.resolveTemplateVariable(directInput, context)
        );
      }
      // 3. Metadata fallback (node.properties.text)
      else if (this.metadata.text !== undefined) {
        textValue = String(
          this.resolveTemplateVariable(this.metadata.text, context)
        );
      } else {
        textValue = "";
      }
    }

    return { text: textValue };
  }
}
