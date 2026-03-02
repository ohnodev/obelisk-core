/**
 * IntNode – integer value from env or literal.
 * Resolves {{process.env.X}}, trims whitespace, parses to integer.
 * Outputs { value: number } on success, { value: undefined, error: string } on parse failure.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";

export class IntNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    // Resolve runtime inputs first (connected > inputs > metadata)
    const raw = this.getInputValue("value", context, undefined);

    const trimmed =
      raw !== undefined && raw !== null ? String(raw).trim() : "";

    if (trimmed === "") {
      return { value: undefined, error: `Int node ${this.nodeId}: empty value` };
    }

    if (!/^-?\d+$/.test(trimmed)) {
      return {
        value: undefined,
        error: `Int node ${this.nodeId}: failed to parse integer "${trimmed}"`,
      };
    }

    const parsed = parseInt(trimmed, 10);
    return { value: parsed, error: undefined };
  }
}
