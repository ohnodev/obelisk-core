/**
 * BlockchainConfigNode – resolves path to Clanker state JSON and optionally loads it.
 * Outputs state_path and state so downstream nodes (ClankerTokenStats, ClankerNewLaunches) can read.
 */
import path from "path";
import fs from "fs";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("blockchainConfig");

// Same as blockchain-service default: state lives in blockchain-service/data/
const DEFAULT_STATE_PATH = path.join(
  process.cwd(),
  "blockchain-service",
  "data",
  "clanker_state.json"
);

export class BlockchainConfigNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const overridePath = this.getInputValue(
      "state_file_path",
      context,
      undefined
    ) as string | undefined;
    const statePath = overridePath
      ? path.resolve(overridePath)
      : (this.metadata.state_file_path as string) || DEFAULT_STATE_PATH;

    let state: Record<string, unknown> = {
      lastUpdated: 0,
      tokens: {},
      recentLaunches: [],
    };
    try {
      if (fs.existsSync(statePath)) {
        const raw = fs.readFileSync(statePath, "utf-8");
        state = JSON.parse(raw) as Record<string, unknown>;
      }
    } catch (e) {
      logger.warn(`[BlockchainConfig] Failed to read state from ${statePath}: ${e}`);
    }

    return { state_path: statePath, state };
  }
}
