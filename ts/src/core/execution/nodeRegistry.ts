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
import { HttpListenerNode } from "./nodes/httpListener";
import { HttpResponseNode } from "./nodes/httpResponse";
import { ActionRouterNode } from "./nodes/actionRouter";
import { TelegramActionNode } from "./nodes/telegramAction";
import { BlockchainConfigNode } from "./nodes/blockchainConfig";
import { ClankerTokenStatsNode } from "./nodes/clankerTokenStats";
import { ClankerLaunchSummaryNode } from "./nodes/clankerLaunchSummary";
import { WalletNode } from "./nodes/wallet";
import { ClankerBuyNode } from "./nodes/clankerBuy";
import { ClankerSellNode } from "./nodes/clankerSell";
import { BuyNotifyNode } from "./nodes/buyNotify";
import { OnSwapTriggerNode } from "./nodes/onSwapTrigger";
import { BagCheckerNode } from "./nodes/bagChecker";
import { AddToBagsNode } from "./nodes/addToBags";
import { UpdateBagsOnSellNode } from "./nodes/updateBagsOnSell";

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
  registerNode("http_listener", HttpListenerNode);
  registerNode("http_response", HttpResponseNode);
  registerNode("action_router", ActionRouterNode);
  registerNode("telegram_action", TelegramActionNode);
  registerNode("blockchain_config", BlockchainConfigNode);
  registerNode("clanker_token_stats", ClankerTokenStatsNode);
  registerNode("clanker_launch_summary", ClankerLaunchSummaryNode);
  registerNode("wallet", WalletNode);
  registerNode("clanker_buy", ClankerBuyNode);
  registerNode("clanker_sell", ClankerSellNode);
  registerNode("buy_notify", BuyNotifyNode);
  registerNode("on_swap_trigger", OnSwapTriggerNode);
  registerNode("bag_checker", BagCheckerNode);
  registerNode("add_to_bags", AddToBagsNode);
  registerNode("update_bags_on_sell", UpdateBagsOnSellNode);

  // LoRA stub for backward compatibility
  registerNode("lora_loader", LoRALoaderStub);

  logger.info(
    `Node registry initialised – ${Object.keys(NODE_REGISTRY).length} types`
  );
}

export { NODE_REGISTRY };
