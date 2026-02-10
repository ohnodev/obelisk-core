/**
 * Node type registry.
 * Mirrors Python src/core/execution/node_registry.py
 */
import { BaseNode, ExecutionContext } from "./nodeBase";
import { NodeData } from "../types";
import { getLogger } from "../../utils/logger";

// ── Node imports ────────────────────────────────────────────────────
import { InferenceConfigNode } from "./nodes/inferenceConfig";
import { InferenceNode } from "./nodes/inference/node";
import { BinaryIntentNode } from "./nodes/binaryIntent";
import { TextNode } from "./nodes/text";
import { MemoryStorageNode } from "./nodes/memoryStorage";
import { MemorySelectorNode } from "./nodes/memorySelector";
import { MemoryCreatorNode } from "./nodes/memoryCreator";
import { SchedulerNode } from "./nodes/scheduler";
import { TelegramBotNode } from "./nodes/telegramBot";
import { TelegramListenerNode } from "./nodes/telegramListener";
import { TelegramMemoryCreatorNode } from "./nodes/telegramMemoryCreator";
import { TelegramMemorySelectorNode } from "./nodes/telegramMemorySelector";
import { BooleanLogicNode } from "./nodes/booleanLogic";
import { RerouteNode } from "./nodes/reroute";

const logger = getLogger("nodeRegistry");

type NodeConstructor = new (nodeId: string, nodeData: NodeData) => BaseNode;

const NODE_REGISTRY: Record<string, NodeConstructor> = {};

export function registerNode(nodeType: string, ctor: NodeConstructor): void {
  NODE_REGISTRY[nodeType] = ctor;
  logger.debug(`Registered node type: ${nodeType}`);
}

export function getNodeClass(nodeType: string): NodeConstructor | undefined {
  return NODE_REGISTRY[nodeType];
}

export function getRegisteredTypes(): string[] {
  return Object.keys(NODE_REGISTRY);
}

// ── LoRA stub (backward compat) ─────────────────────────────────────

class LoRALoaderStub extends BaseNode {
  execute(_context: ExecutionContext): Record<string, unknown> {
    throw new Error(
      "LoRA loading is not supported via the inference service yet. " +
        "Please remove LoRALoaderNode from your workflow. " +
        "The InferenceConfigNode provides the primary model."
    );
  }
}

// ── Register all built-in nodes ─────────────────────────────────────

let _registered = false;

export function registerAllNodes(): void {
  if (_registered) return;
  _registered = true;

  registerNode("inference_config", InferenceConfigNode);
  registerNode("model_loader", InferenceConfigNode); // backward compat
  registerNode("inference", InferenceNode);
  registerNode("binary_intent", BinaryIntentNode);
  registerNode("text", TextNode);
  registerNode("memory_storage", MemoryStorageNode);
  registerNode("memory_selector", MemorySelectorNode);
  registerNode("memory_creator", MemoryCreatorNode);
  registerNode("scheduler", SchedulerNode);
  registerNode("telegram_bot", TelegramBotNode);
  registerNode("telegram_listener", TelegramListenerNode);
  registerNode("telegram_memory_creator", TelegramMemoryCreatorNode);
  registerNode("telegram_memory_selector", TelegramMemorySelectorNode);
  registerNode("boolean_logic", BooleanLogicNode);
  registerNode("reroute", RerouteNode);

  // LoRA stub for backward compatibility
  registerNode("lora_loader", LoRALoaderStub);

  logger.info(
    `Node registry initialised – ${Object.keys(NODE_REGISTRY).length} types`
  );
}

export { NODE_REGISTRY };
