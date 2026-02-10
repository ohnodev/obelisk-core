/**
 * BooleanLogicNode – pure logic gate with value passthrough (no LLM).
 *
 * Performs boolean operations (OR, AND, NOT) on inputs and routes a
 * passthrough value to either the `pass` or `reject` output based on
 * the boolean result.
 *
 * Inputs:
 *   a:     First boolean operand (required)
 *   b:     Second boolean operand (optional, unused for NOT)
 *   value: Any value to pass through based on the result (optional)
 *
 * Outputs:
 *   result: Boolean result of the operation
 *   pass:   Value when result is true, null when false
 *   reject: Value when result is false, null when true
 *
 * Operations: OR, AND, NOT (inverts `a` only)
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("booleanLogic");

type Operation = "OR" | "AND" | "NOT";

export class BooleanLogicNode extends BaseNode {
  private operation: Operation;

  constructor(
    nodeId: string,
    nodeData: Record<string, unknown> | import("../../types").NodeData
  ) {
    super(nodeId, nodeData as import("../../types").NodeData);
    const raw = (this.metadata.operation as string) ?? "OR";
    this.operation = (["OR", "AND", "NOT"].includes(raw) ? raw : "OR") as Operation;
  }

  execute(context: ExecutionContext): Record<string, unknown> {
    const rawA = this.getInputValue("a", context, false);
    const rawB = this.getInputValue("b", context, false);
    const value = this.getInputValue("value", context, null);

    const a = Boolean(rawA);
    const b = Boolean(rawB);

    let result: boolean;
    switch (this.operation) {
      case "OR":
        result = a || b;
        break;
      case "AND":
        result = a && b;
        break;
      case "NOT":
        result = !a;
        break;
      default:
        result = a || b;
    }

    logger.debug(
      `[BooleanLogic ${this.nodeId}] ${this.operation}(a=${a}, b=${b}) → ${result}` +
        (value !== null ? ` | value passes to ${result ? "pass" : "reject"}` : "")
    );

    return {
      result,
      pass: result ? value : null,
      reject: result ? null : value,
    };
  }
}
