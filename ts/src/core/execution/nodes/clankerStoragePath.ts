/**
 * Resolve the clanker storage base directory from node inputs.
 * Used for clanker_bags.json and clanker_actions.json (workflow-local).
 */
import path from "path";
import type { BaseNode } from "../nodeBase";
import type { ExecutionContext } from "../nodeBase";

const BAGS_FILE = "clanker_bags.json";
const ACTIONS_FILE = "clanker_actions.json";

export function resolveClankerStorageBase(
  node: BaseNode,
  context: ExecutionContext
): string {
  const clankerStoragePath = node.getInputValue("clanker_storage_path", context, undefined) as string | undefined;
  if (clankerStoragePath && typeof clankerStoragePath === "string" && clankerStoragePath.trim()) {
    return path.resolve(clankerStoragePath.trim());
  }
  const basePath = node.getInputValue("base_path", context, undefined) as string | undefined;
  if (basePath && typeof basePath === "string" && basePath.trim()) {
    return path.resolve(basePath.trim());
  }
  const storageInstance = node.getInputValue("storage_instance", context, undefined) as Record<string, unknown> | undefined;
  if (storageInstance?.basePath && typeof storageInstance.basePath === "string") {
    return path.resolve(String(storageInstance.basePath).trim());
  }
  return "";
}

export function resolveBagsPath(node: BaseNode, context: ExecutionContext): string {
  const base = resolveClankerStorageBase(node, context);
  return base ? path.join(base, BAGS_FILE) : "";
}

export function resolveActionsPath(node: BaseNode, context: ExecutionContext): string {
  const base = resolveClankerStorageBase(node, context);
  return base ? path.join(base, ACTIONS_FILE) : "";
}
