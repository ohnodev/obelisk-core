/**
 * Supabase storage for prod mode.
 * Direct Supabase connection (no obelisk-service dependency).
 * Mirrors Python src/storage/supabase.py
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import {
  StorageInterface,
  Interaction,
  SaveInteractionParams,
  EvolutionCycleData,
  ActivityLog,
  RewardScore,
  CreateRewardParams,
  NftUpgrade,
  InteractionRating,
  TopContributor,
} from "../core/types";
import { getLogger } from "../utils/logger";

const logger = getLogger("supabase");

export class SupabaseStorage implements StorageInterface {
  private client: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.client = createClient(supabaseUrl, supabaseKey);
  }

  private sha256(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  async getInteractions(cycleId: string): Promise<Interaction[]> {
    try {
      const { data } = await this.client
        .from("interactions")
        .select("*")
        .eq("evolution_cycle_id", cycleId);
      return (data as Interaction[]) ?? [];
    } catch (e) {
      logger.error(`Error getting interactions for cycle ${cycleId}: ${e}`);
      return [];
    }
  }

  async saveInteraction(params: SaveInteractionParams): Promise<string> {
    try {
      const { data } = await this.client
        .from("interactions")
        .insert({
          user_id: params.userId,
          query: params.query,
          response: params.response,
          quantum_seed: params.quantumSeed ?? 0,
          reward_score: params.rewardScore ?? 0,
          evolution_cycle_id: params.cycleId,
        })
        .select();
      return data?.[0]?.id ?? "";
    } catch (e) {
      logger.error(`Error saving interaction: ${e}`);
      return "";
    }
  }

  async getUserInteractions(
    userId: string,
    limit?: number
  ): Promise<Interaction[]> {
    try {
      let query = this.client
        .from("interactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (limit) query = query.limit(limit);
      const { data } = await query;
      return (data as Interaction[]) ?? [];
    } catch (e) {
      logger.error(`Error getting user interactions: ${e}`);
      return [];
    }
  }

  async getEvolutionCycle(
    cycleId: string
  ): Promise<EvolutionCycleData | null> {
    try {
      const { data } = await this.client
        .from("evolution_cycles")
        .select("*")
        .eq("id", cycleId)
        .single();
      return data as EvolutionCycleData | null;
    } catch (e) {
      logger.error(`Error getting cycle ${cycleId}: ${e}`);
      return null;
    }
  }

  async getCurrentEvolutionCycle(): Promise<string | null> {
    try {
      const { data } = await this.client.rpc("get_current_evolution_cycle");
      return data as string | null;
    } catch (e) {
      logger.error(`Error getting current cycle: ${e}`);
      return null;
    }
  }

  async getOrCreateUser(walletAddress: string): Promise<string> {
    try {
      const { data } = await this.client.rpc("get_or_create_user", {
        p_wallet_address: walletAddress,
      });
      return data as string;
    } catch (e) {
      logger.error(`Error getting/creating user: ${e}`);
      return this.sha256(walletAddress).slice(0, 16);
    }
  }

  async createActivityLog(
    activityType: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<ActivityLog> {
    try {
      const { data } = await this.client
        .from("activities")
        .insert({ type: activityType, message, metadata: metadata ?? {} })
        .select();
      return (data?.[0] as ActivityLog) ?? ({} as ActivityLog);
    } catch (e) {
      logger.error(`Error creating activity log: ${e}`);
      return {} as ActivityLog;
    }
  }

  async getActivityLogs(
    activityType?: string,
    limit = 100
  ): Promise<ActivityLog[]> {
    try {
      let query = this.client.from("activities").select("*");
      if (activityType) query = query.eq("type", activityType);
      const { data } = await query
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data as ActivityLog[]) ?? [];
    } catch (e) {
      logger.error(`Error getting activity logs: ${e}`);
      return [];
    }
  }

  // ── LoRA weights (stub) ────────────────────────────────────────────
  async saveLorWeights(): Promise<string | null> {
    logger.warn("LoRA weight saving not supported in TS runtime");
    return null;
  }
  async getLatestModelWeights(): Promise<Record<string, unknown> | null> {
    return null;
  }
  async deleteLoraWeights(): Promise<boolean> {
    return true;
  }

  // ── Reward scoring ─────────────────────────────────────────────────
  async calculateUserRewardScore(
    userId: string,
    cycleId: string
  ): Promise<RewardScore> {
    try {
      const { data } = await this.client
        .from("interactions")
        .select("*")
        .eq("user_id", userId)
        .eq("evolution_cycle_id", cycleId);
      const interactions = (data as Interaction[]) ?? [];
      if (!interactions.length) {
        return {
          user_id: userId,
          interaction_count: 0,
          average_quality: 0,
          quantum_alignment: 0,
          total_score: 0,
        };
      }
      const count = interactions.length;
      const avgQuality =
        interactions.reduce((s, i) => s + (i.reward_score ?? 0), 0) / count;
      const quantum =
        interactions.reduce((s, i) => s + (i.quantum_seed ?? 0), 0) / count;
      const normalizedInt = Math.min(count / 100, 1);
      const totalScore =
        normalizedInt * 0.57 + avgQuality * 0.29 + quantum * 0.14;
      return {
        user_id: userId,
        interaction_count: count,
        average_quality: avgQuality,
        quantum_alignment: quantum,
        total_score: Math.min(Math.max(totalScore, 0), 1),
      };
    } catch (e) {
      logger.error(`Error calculating reward score: ${e}`);
      return {
        user_id: userId,
        interaction_count: 0,
        average_quality: 0,
        quantum_alignment: 0,
        total_score: 0,
      };
    }
  }

  async createReward(
    params: CreateRewardParams
  ): Promise<Record<string, unknown>> {
    try {
      const { data } = await this.client
        .from("rewards")
        .insert({
          user_id: params.userId,
          evolution_cycle_id: params.cycleId,
          rank: params.rank,
          tokens_awarded: params.tokensAwarded,
          interactions_count: params.interactionsCount,
          total_reward_score: params.totalScore,
          claimed: false,
        })
        .select();
      return (data?.[0] as Record<string, unknown>) ?? {};
    } catch (e) {
      logger.error(`Error creating reward: ${e}`);
      return {};
    }
  }

  async updateUserTokenBalance(
    userId: string,
    amount: number
  ): Promise<Record<string, unknown>> {
    try {
      const { data: current } = await this.client
        .from("users")
        .select("token_balance")
        .eq("id", userId)
        .single();
      const currentBalance = (current?.token_balance as number) ?? 0;
      const { data } = await this.client
        .from("users")
        .update({ token_balance: currentBalance + amount })
        .eq("id", userId)
        .select();
      return (data?.[0] as Record<string, unknown>) ?? {};
    } catch (e) {
      logger.error(`Error updating token balance: ${e}`);
      return {};
    }
  }

  async checkNftUpgrades(userId: string): Promise<NftUpgrade[]> {
    try {
      const { data } = await this.client
        .from("nfts")
        .select("*")
        .eq("user_id", userId);
      const nfts = (data ?? []) as Record<string, unknown>[];
      const thresholds: Record<string, number> = {
        dormant: 1.0,
        awakening: 5.0,
        active: 20.0,
      };
      const upgraded: NftUpgrade[] = [];
      for (const nft of nfts) {
        const energy = Number(nft.energy_contributed ?? 0);
        const stage = (nft.stage as string) ?? "dormant";
        let newStage: string | null = null;
        if (stage === "dormant" && energy >= thresholds.dormant)
          newStage = "awakening";
        else if (stage === "awakening" && energy >= thresholds.awakening)
          newStage = "active";
        else if (stage === "active" && energy >= thresholds.active)
          newStage = "transcendent";
        if (newStage) {
          await this.client
            .from("nfts")
            .update({ stage: newStage, last_upgraded_at: "now()" })
            .eq("id", nft.id);
          upgraded.push({
            token_id: nft.token_id as string,
            new_stage: newStage,
          });
        }
      }
      return upgraded;
    } catch (e) {
      logger.error(`Error checking NFT upgrades: ${e}`);
      return [];
    }
  }

  async saveInteractionRatings(
    ratings: InteractionRating[],
    _cycleId: string
  ): Promise<number> {
    try {
      let count = 0;
      for (const rating of ratings) {
        if (!rating.interaction_id) continue;
        const update: Record<string, unknown> = {};
        if (rating.ai_overall_score !== undefined)
          update.ai_overall_score = rating.ai_overall_score;
        if (rating.ai_recommend_for_training !== undefined)
          update.ai_recommend_for_training = rating.ai_recommend_for_training;
        if (rating.ai_reasoning !== undefined)
          update.ai_reasoning = rating.ai_reasoning;
        if (Object.keys(update).length) {
          await this.client
            .from("interactions")
            .update(update)
            .eq("id", rating.interaction_id);
          count++;
        }
      }
      return count;
    } catch (e) {
      logger.error(`Error saving interaction ratings: ${e}`);
      return 0;
    }
  }

  async updateCycleStatus(
    cycleId: string,
    status: string,
    topContributors?: TopContributor[]
  ): Promise<Record<string, unknown>> {
    try {
      const update: Record<string, unknown> = { status };
      if (topContributors) update.top_contributors = topContributors;
      const { data } = await this.client
        .from("evolution_cycles")
        .update(update)
        .eq("id", cycleId)
        .select();
      return (data?.[0] as Record<string, unknown>) ?? {};
    } catch (e) {
      logger.error(`Error updating cycle status: ${e}`);
      return {};
    }
  }
}
