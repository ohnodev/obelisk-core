/**
 * Type definitions for Obelisk Core (TypeScript edition)
 *
 * Mirrors the Python src/core/types.py so both engines share the same
 * workflow JSON contract.
 */

// ─── Type Aliases ──────────────────────────────────────────────────────
export type UserID = string;
export type CycleID = string;
export type NodeID = string;
export type ConnectionID = string;
export type MessageRole = "user" | "assistant" | "system";

// ─── Core Interfaces ───────────────────────────────────────────────────

/** LLM generation interface – satisfied by both ObeliskLLM and InferenceClient */
export interface LLMInterface {
  generate(
    query: string,
    options?: {
      quantumInfluence?: number;
      maxLength?: number;
      conversationContext?: ConversationContext;
      enableThinking?: boolean;
    }
  ): Promise<LLMGenerationResult>;
}

/** Storage backend interface */
export interface StorageInterface {
  getInteractions(cycleId: string): Promise<Interaction[]>;
  saveInteraction(params: SaveInteractionParams): Promise<string>;
  getUserInteractions(userId: string, limit?: number): Promise<Interaction[]>;
  getEvolutionCycle(cycleId: string): Promise<EvolutionCycleData | null>;
  getCurrentEvolutionCycle(): Promise<string | null>;
  getOrCreateUser(walletAddress: string): Promise<string>;
  createActivityLog(
    activityType: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<ActivityLog>;
  getActivityLogs(
    activityType?: string,
    limit?: number
  ): Promise<ActivityLog[]>;
  saveLorWeights(
    cycleNumber: number,
    loraWeights: Buffer,
    evolutionScore: number,
    interactionsUsed: number,
    metadata?: Record<string, unknown>
  ): Promise<string | null>;
  getLatestModelWeights(
    baseModel?: string
  ): Promise<Record<string, unknown> | null>;
  deleteLoraWeights(): Promise<boolean>;
  calculateUserRewardScore(
    userId: string,
    cycleId: string
  ): Promise<RewardScore>;
  createReward(params: CreateRewardParams): Promise<Record<string, unknown>>;
  updateUserTokenBalance(
    userId: string,
    amount: number
  ): Promise<Record<string, unknown>>;
  checkNftUpgrades(userId: string): Promise<NftUpgrade[]>;
  saveInteractionRatings(
    ratings: InteractionRating[],
    cycleId: string
  ): Promise<number>;
  updateCycleStatus(
    cycleId: string,
    status: string,
    topContributors?: TopContributor[]
  ): Promise<Record<string, unknown>>;
}

// ─── Data Structures ───────────────────────────────────────────────────

export interface ConversationMessage {
  role: MessageRole;
  content: string;
}

export interface ConversationContext {
  messages: ConversationMessage[];
  memories: string;
}

export interface LLMGenerationResult {
  response: string;
  thinkingContent?: string;
  source: string;
  tokensUsed?: number;
  quantumInfluence?: number;
  error?: string;
}

export interface Interaction {
  id?: string;
  user_id: string;
  query: string;
  response: string;
  quantum_seed?: number;
  reward_score?: number;
  evolution_cycle_id?: string;
  created_at?: string;
}

export interface SaveInteractionParams {
  userId: string;
  query: string;
  response: string;
  cycleId?: string;
  quantumSeed?: number;
  rewardScore?: number;
}

export interface EvolutionCycleData {
  id: string;
  status?: string;
  interactions?: Interaction[];
  [key: string]: unknown;
}

export interface ActivityLog {
  id?: string;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface RewardScore {
  user_id: string;
  interaction_count: number;
  average_quality: number;
  quantum_alignment: number;
  total_score: number;
}

export interface CreateRewardParams {
  userId: string;
  cycleId: string;
  rank: number;
  tokensAwarded: number;
  interactionsCount: number;
  totalScore: number;
}

export interface NftUpgrade {
  token_id: string;
  new_stage: string;
}

export interface InteractionRating {
  interaction_id: string;
  ai_overall_score?: number;
  ai_recommend_for_training?: boolean;
  ai_reasoning?: string;
}

export interface TopContributor {
  user_id: string;
  score: number;
  [key: string]: unknown;
}

// ─── Workflow / Node Graph Types ───────────────────────────────────────

export interface NodeData {
  id: NodeID;
  type: string;
  position?: { x: number; y: number };
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ConnectionData {
  id?: ConnectionID;
  source_node: NodeID;
  source_output: string;
  target_node: NodeID;
  target_input: string;
  data_type?: string;
}

export interface WorkflowData {
  id?: string;
  name?: string;
  nodes: NodeData[];
  connections: ConnectionData[];
  metadata?: Record<string, unknown>;
}

export interface NodeExecutionResult {
  nodeId: NodeID;
  success: boolean;
  outputs: Record<string, unknown>;
  error?: string;
  executionTime?: number;
}

export interface GraphExecutionResult {
  graphId?: string;
  success: boolean;
  nodeResults: NodeExecutionResult[];
  finalOutputs: Record<string, unknown>;
  error?: string;
  totalExecutionTime?: number;
  executionOrder?: NodeID[];
}
