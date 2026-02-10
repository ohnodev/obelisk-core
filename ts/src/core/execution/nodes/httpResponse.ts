/**
 * HttpResponseNode – sends the workflow's response back to the waiting HTTP client.
 *
 * Works in tandem with HttpListenerNode: the listener queues incoming requests and
 * registers them in HttpRequestRegistry. This node resolves the pending request by
 * looking up the request_id and sending the response.
 *
 * Inputs:
 *   response:    string – the text to send back to the client
 *   request_id:  string – correlates with the request from HttpListenerNode
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
    const requestId = this.getInputValue("request_id", context, "") as string;
    const statusCode = Number(
      this.getInputValue("status_code", context, 200)
    );

    if (!response) {
      logger.debug(
        `[HttpResponse ${this.nodeId}] No response provided, skipping`
      );
      return { success: false };
    }

    if (!requestId) {
      logger.warn(
        `[HttpResponse ${this.nodeId}] No request_id provided — cannot route response`
      );
      return { success: false };
    }

    const code = Number.isFinite(statusCode) ? statusCode : 200;

    const resolved = HttpRequestRegistry.resolve(requestId, code, {
      response,
      request_id: requestId,
    });

    if (resolved) {
      logger.info(
        `[HttpResponse ${this.nodeId}] Sent ${code} response for request ${requestId} (${response.length} chars)`
      );
    } else {
      logger.warn(
        `[HttpResponse ${this.nodeId}] Request ${requestId} not found (may have timed out)`
      );
    }

    return { success: resolved };
  }
}
