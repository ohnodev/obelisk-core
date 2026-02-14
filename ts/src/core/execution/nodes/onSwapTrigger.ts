/**
 * OnSwapTriggerNode – reads last_swap.json; when a new swap is detected, outputs trigger and swap payload.
 * Uses clanker_storage_path / base_path / storage_instance for last_swap.json and listener state.
 * Optional swap_file_path overrides the path to last_swap.json.
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";
import { resolveClankerStorageBase } from "./clankerStoragePath";

const logger = getLogger("onSwapTrigger");

const LISTENER_STATE_FILENAME = "swap_listener_state.json";
const LAST_SWAP_FILENAME = "last_swap.json";

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class OnSwapTriggerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const swapFilePath = (this.getInputValue("swap_file_path", context, undefined) as string) ?? "";
    const storageBase = resolveClankerStorageBase(this, context);

    const swapPath = swapFilePath.trim()
      ? path.resolve(swapFilePath.trim())
      : storageBase
        ? path.join(storageBase, LAST_SWAP_FILENAME)
        : "";
    const dataDir = swapPath ? path.dirname(swapPath) : "";
    const listenerStatePath = storageBase ? path.join(storageBase, LISTENER_STATE_FILENAME) : (dataDir ? path.join(dataDir, LISTENER_STATE_FILENAME) : "");

    if (!swapPath || !fs.existsSync(swapPath)) {
      return { trigger: false, swap: null };
    }

    type SwapPayload = { poolId?: string; tokenAddress?: string; side?: string; volumeEth?: number; priceEth?: number; timestamp?: number };
    let swapPayload: SwapPayload | null = null;
    try {
      const raw = fs.readFileSync(swapPath, "utf-8");
      swapPayload = JSON.parse(raw) as SwapPayload;
    } catch (e) {
      logger.warn(`[OnSwapTrigger] Failed to read swap file ${abbrevPathForLog(swapPath)}: ${e}`);
      return { trigger: false, swap: null };
    }

    const swapTimestamp = getNum(swapPayload?.timestamp);
    if (!swapTimestamp) return { trigger: false, swap: swapPayload };

    let lastProcessed = 0;
    if (listenerStatePath && fs.existsSync(listenerStatePath)) {
      try {
        const stateRaw = fs.readFileSync(listenerStatePath, "utf-8");
        const state = JSON.parse(stateRaw) as { lastProcessedTimestamp?: number };
        lastProcessed = getNum(state.lastProcessedTimestamp);
      } catch (_) {}
    }

    const isNew = swapTimestamp > lastProcessed;
    if (isNew && listenerStatePath) {
      try {
        const dir = path.dirname(listenerStatePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          listenerStatePath,
          JSON.stringify({ lastProcessedTimestamp: swapTimestamp }, null, 2),
          "utf-8"
        );
      } catch (e) {
        logger.warn(`[OnSwapTrigger] Failed to write listener state: ${e}`);
      }
    }

    return {
      trigger: isNew,
      swap: isNew ? swapPayload : null,
    };
  }
}
