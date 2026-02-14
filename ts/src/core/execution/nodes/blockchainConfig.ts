/**
 * BlockchainConfigNode – fetches Clanker state from the blockchain service HTTP API.
 * Outputs state only; downstream nodes get bags/actions paths from a storage node.
 */
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("blockchainConfig");

const DEFAULT_STATE: Record<string, unknown> = {
  lastUpdated: 0,
  tokens: {},
  recentLaunches: [],
};

const DEFAULT_BLOCKCHAIN_SERVICE_URL = "http://localhost:8888";

function getStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export class BlockchainConfigNode extends BaseNode {
  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const urlFromInput = this.getInputValue(
      "blockchain_service_url",
      context,
      undefined
    ) as string | undefined;
    const baseUrl =
      getStr(urlFromInput) ||
      getStr(this.metadata.blockchain_service_url) ||
      getStr(process.env.BLOCKCHAIN_SERVICE_URL) ||
      DEFAULT_BLOCKCHAIN_SERVICE_URL;
    const baseUrlNorm = baseUrl.replace(/\/$/, "");

    const apiKey =
      getStr(this.getInputValue("api_key", context, undefined)) ||
      getStr(this.resolveEnvVar(this.metadata.api_key)) ||
      getStr(process.env.BLOCKCHAIN_SERVICE_API_KEY);

    if (!baseUrlNorm) {
      logger.warn("[BlockchainConfig] No blockchain_service_url; returning empty state");
      return { state: DEFAULT_STATE };
    }

    const stateUrl = `${baseUrlNorm}/clanker/state`;
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["X-API-Key"] = apiKey;
    }
    try {
      const res = await fetch(stateUrl, { headers });
      if (!res.ok) {
        logger.warn(`[BlockchainConfig] GET ${stateUrl} returned ${res.status}`);
        return { state: DEFAULT_STATE };
      }
      const state = (await res.json()) as Record<string, unknown>;
      if (!state || typeof state !== "object") {
        return { state: DEFAULT_STATE };
      }
      return {
        state: {
          lastUpdated: state.lastUpdated ?? 0,
          tokens: state.tokens ?? {},
          recentLaunches: Array.isArray(state.recentLaunches) ? state.recentLaunches : [],
        },
      };
    } catch (e) {
      logger.warn(`[BlockchainConfig] Failed to fetch state from ${stateUrl}: ${e}`);
      return { state: DEFAULT_STATE };
    }
  }
}
