/**
 * FloatNode – float value from env or literal.
 * Resolves {{process.env.X}}, trims whitespace, parses to float.
 * Outputs { value: number } on success, { value: undefined, error: string } on parse failure.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";

export class FloatNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    let raw = this.getInputValue("value", context, undefined);
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      raw = this.resolveEnvVar(this.metadata.value) ?? this.metadata.value ?? "";
    }

    const trimmed =
      raw !== undefined && raw !== null ? String(raw).trim() : "";

    if (trimmed === "") {
      return { value: undefined, error: `Float node ${this.nodeId}: empty value` };
    }

    const parsed = parseFloat(trimmed);
    if (!Number.isFinite(parsed)) {
      return {
        value: undefined,
        error: `Float node ${this.nodeId}: failed to parse float "${trimmed}"`,
      };
    }

    return { value: parsed, error: undefined };
  }
}
