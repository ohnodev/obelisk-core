/**
 * OnSwapTriggerNode – reads the last-swap file written by the blockchain service on each swap.
 * When a new swap is detected (timestamp > last processed), outputs trigger and swap payload
 * so a downstream loop can check our bags and optionally sell.
 *
 * Inputs: trigger (from scheduler – run on tick), swap_file_path, state_path (dir used for last_swap.json + listener state)
 * Outputs: trigger (boolean), swap (object)
 */
import fs from "fs";
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";

const logger = getLogger("onSwapTrigger");

const LISTENER_STATE_FILENAME = "swap_listener_state.json";

function getNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class OnSwapTriggerNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    const swapFilePath = (this.getInputValue("swap_file_path", context, undefined) as string) ?? "";
    const statePathFromConfig = (this.getInputValue("state_path", context, undefined) as string) ?? "";

    const swapPath = swapFilePath
      ? swapFilePath
      : statePathFromConfig
        ? path.join(path.dirname(statePathFromConfig), "last_swap.json")
        : "";

    const dataDir = swapPath ? path.dirname(swapPath) : "";
    const listenerStatePath = dataDir ? path.join(dataDir, LISTENER_STATE_FILENAME) : "";

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
