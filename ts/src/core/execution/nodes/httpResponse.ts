/**
 * HttpResponseNode – sends the workflow's response back to the waiting HTTP client.
 *
 * Works in tandem with HttpListenerNode / stats listener / sell_bags_listener: the listener
 * queues incoming requests and registers them in HttpRequestRegistry. This node resolves
 * the pending request by looking up the request_id and sending the response.
 *
 * Inputs:
 *   response:    string – optional text (used when body is not provided)
 *   body:        object – optional; when provided, sent as JSON body (e.g. from sell_all_bags)
 *   request_id:  string – correlates with the request
 *   status_code: number – HTTP status code (default: 200)
 *
 * Outputs:
 *   success: boolean – whether the response was sent
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { HttpRequestRegistry } from "./httpListener";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("httpResponse");

export class HttpResponseNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const response = this.getInputValue("response", context, "") as string;
    const bodyInput = this.getInputValue("body", context, undefined) as Record<string, unknown> | undefined;
    const requestId = this.getInputValue("request_id", context, "") as string;
    const statusCode = Number(
      this.getInputValue("status_code", context, 200)
    );

    if (!requestId) {
      logger.warn(
        `[HttpResponse ${this.nodeId}] No request_id provided — cannot route response`
      );
      return { success: false };
    }

    const code = Number.isFinite(statusCode) ? statusCode : 200;
    const body =
      bodyInput != null && typeof bodyInput === "object" && !Array.isArray(bodyInput)
        ? bodyInput
        : { response: response ?? "", request_id: requestId };

    const resolved = HttpRequestRegistry.resolve(requestId, code, body);

    if (resolved) {
      logger.info(
        `[HttpResponse ${this.nodeId}] Sent ${code} for request ${requestId}`
      );
    } else {
      logger.warn(
        `[HttpResponse ${this.nodeId}] Request ${requestId} not found (may have timed out)`
      );
    }

    return { success: resolved };
  }
}
