import path from "path";
import type { BaseNode } from "../nodeBase";
import type { ExecutionContext } from "../nodeBase";

const TRADES_FILE = "polymarket_trades.json";
const ACTIONS_FILE = "polymarket_actions.json";

/** Resolve polymarket storage base from storage_instance.basePath or polymarket_storage_path or env. */
export function resolvePolymarketStorageBase(
  node: BaseNode,
  context: ExecutionContext
): string {
  const storageInstance = node.getInputValue("storage_instance", context, undefined) as Record<string, unknown> | undefined;
  if (storageInstance?.basePath && typeof storageInstance.basePath === "string") {
    return path.resolve(String(storageInstance.basePath).trim());
  }
  const polymarketStoragePath = node.getInputValue("polymarket_storage_path", context, undefined) as string | undefined;
  if (polymarketStoragePath && typeof polymarketStoragePath === "string" && polymarketStoragePath.trim()) {
    return path.resolve(polymarketStoragePath.trim());
  }
  const envPath = process.env.POLYMARKET_STORAGE_PATH;
  if (envPath && typeof envPath === "string" && envPath.trim()) {
    return path.resolve(envPath.trim());
  }
  return path.resolve(path.join(process.cwd(), "data", "polymarket"));
}

export function resolvePolymarketTradesPath(node: BaseNode, context: ExecutionContext): string {
  const base = resolvePolymarketStorageBase(node, context);
  return base ? path.join(base, TRADES_FILE) : "";
}

export function resolvePolymarketActionsPath(node: BaseNode, context: ExecutionContext): string {
  const base = resolvePolymarketStorageBase(node, context);
  return base ? path.join(base, ACTIONS_FILE) : "";
}
