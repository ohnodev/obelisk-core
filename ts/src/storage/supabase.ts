/**
 * Supabase storage for prod mode.
 * Direct Supabase connection (no obelisk-service dependency).
 * Mirrors Python src/storage/supabase.py
 *
 * All .from() / .rpc() calls destructure { data, error } and check error
 * first (supabase-js v2 returns errors in the response, it does NOT throw).
 * try/catch is kept only for truly unexpected exceptions.
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

  // ── Interactions ──────────────────────────────────────────────────

  async getInteractions(cycleId: string): Promise<Interaction[]> {
    const { data, error } = await this.client
      .from("interactions")
      .select("*")
      .eq("evolution_cycle_id", cycleId);

    if (error) {
      logger.error(
        `getInteractions(cycle=${cycleId}): ${error.message} [code=${error.code}]`
      );
      return [];
    }
    return (data as Interaction[]) ?? [];
  }

  async saveInteraction(params: SaveInteractionParams): Promise<string> {
    const { data, error } = await this.client
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

    if (error) {
      logger.error(
        `saveInteraction(user=${params.userId}): ${error.message} [code=${error.code}]`
      );
      return "";
    }
    return data?.[0]?.id ?? "";
  }

  async getUserInteractions(
    userId: string,
    limit?: number
  ): Promise<Interaction[]> {
    let query = this.client
      .from("interactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (limit) query = query.limit(limit);

    const { data, error } = await query;

    if (error) {
      logger.error(
        `getUserInteractions(user=${userId}): ${error.message} [code=${error.code}]`
      );
      return [];
    }
    return (data as Interaction[]) ?? [];
  }

  // ── Evolution cycles ──────────────────────────────────────────────

  async getEvolutionCycle(
    cycleId: string
  ): Promise<EvolutionCycleData | null> {
    const { data, error } = await this.client
      .from("evolution_cycles")
      .select("*")
      .eq("id", cycleId)
      .single();

    if (error) {
      logger.error(
        `getEvolutionCycle(cycle=${cycleId}): ${error.message} [code=${error.code}]`
      );
      return null;
    }
    return data as EvolutionCycleData | null;
  }

  async getCurrentEvolutionCycle(): Promise<string | null> {
    const { data, error } = await this.client.rpc(
      "get_current_evolution_cycle"
    );

    if (error) {
      logger.error(
        `getCurrentEvolutionCycle: ${error.message} [code=${error.code}]`
      );
      return null;
    }
    return data as string | null;
  }

  // ── Users ─────────────────────────────────────────────────────────

  async getOrCreateUser(walletAddress: string): Promise<string> {
    const { data, error } = await this.client.rpc("get_or_create_user", {
      p_wallet_address: walletAddress,
    });

    if (error) {
      logger.error(
        `getOrCreateUser(wallet=${walletAddress}): ${error.message} [code=${error.code}]`
      );
      // Deterministic fallback so the caller still gets a stable ID
      return this.sha256(walletAddress).slice(0, 16);
    }
    return data as string;
  }

  // ── Activity logs ─────────────────────────────────────────────────

  async createActivityLog(
    activityType: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<ActivityLog> {
    const { data, error } = await this.client
      .from("activities")
      .insert({ type: activityType, message, metadata: metadata ?? {} })
      .select();

    if (error) {
      logger.error(
        `createActivityLog(type=${activityType}): ${error.message} [code=${error.code}]`
      );
      return {} as ActivityLog;
    }
    return (data?.[0] as ActivityLog) ?? ({} as ActivityLog);
  }

  async getActivityLogs(
    activityType?: string,
    limit = 100
  ): Promise<ActivityLog[]> {
    let query = this.client.from("activities").select("*");
    if (activityType) query = query.eq("type", activityType);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        `getActivityLogs(type=${activityType ?? "all"}): ${error.message} [code=${error.code}]`
      );
      return [];
    }
    return (data as ActivityLog[]) ?? [];
  }

  // ── Reward scoring ─────────────────────────────────────────────────

  async calculateUserRewardScore(
    userId: string,
    cycleId: string
  ): Promise<RewardScore> {
    const emptyScore: RewardScore = {
      user_id: userId,
      interaction_count: 0,
      average_quality: 0,
      quantum_alignment: 0,
      total_score: 0,
    };

    const { data, error } = await this.client
      .from("interactions")
      .select("*")
      .eq("user_id", userId)
      .eq("evolution_cycle_id", cycleId);

    if (error) {
      logger.error(
        `calculateUserRewardScore(user=${userId}, cycle=${cycleId}): ${error.message} [code=${error.code}]`
      );
      return emptyScore;
    }

    const interactions = (data as Interaction[]) ?? [];
    if (!interactions.length) return emptyScore;

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
  }

  async createReward(
    params: CreateRewardParams
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.client
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

    if (error) {
      logger.error(
        `createReward(user=${params.userId}, cycle=${params.cycleId}): ${error.message} [code=${error.code}]`
      );
      return {};
    }
    return (data?.[0] as Record<string, unknown>) ?? {};
  }

  async updateUserTokenBalance(
    userId: string,
    amount: number
  ): Promise<Record<string, unknown>> {
    // Atomic server-side increment via Postgres RPC to avoid lost updates.
    // Expects a Postgres function:
    //   CREATE OR REPLACE FUNCTION increment_user_token_balance(p_user_id uuid, p_delta int)
    //   RETURNS SETOF users AS $$
    //     UPDATE users
    //     SET token_balance = token_balance + p_delta
    //     WHERE id = p_user_id
    //     RETURNING *;
    //   $$ LANGUAGE sql;
    const { data, error } = await this.client.rpc(
      "increment_user_token_balance",
      { p_user_id: userId, p_delta: amount }
    );

    if (error) {
      logger.error(
        `updateUserTokenBalance(user=${userId}, amount=${amount}): ${error.message} [code=${error.code}]`
      );
      return {};
    }

    // RPC with RETURNS SETOF returns an array; take the first row.
    if (Array.isArray(data)) {
      return (data[0] as Record<string, unknown>) ?? {};
    }
    return (data as Record<string, unknown>) ?? {};
  }

  async checkNftUpgrades(userId: string): Promise<NftUpgrade[]> {
    const { data, error } = await this.client
      .from("nfts")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      logger.error(
        `checkNftUpgrades(user=${userId}): ${error.message} [code=${error.code}]`
      );
      return [];
    }

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
        const { error: upgradeError } = await this.client
          .from("nfts")
          .update({ stage: newStage, last_upgraded_at: new Date().toISOString() })
          .eq("id", nft.id);

        if (upgradeError) {
          logger.error(
            `checkNftUpgrades: upgrade nft=${nft.id} to ${newStage} failed: ${upgradeError.message} [code=${upgradeError.code}]`
          );
          continue;
        }
        upgraded.push({
          token_id: nft.token_id as string,
          new_stage: newStage,
        });
      }
    }
    return upgraded;
  }

  async saveInteractionRatings(
    ratings: InteractionRating[],
    _cycleId: string
  ): Promise<number> {
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
        const { error } = await this.client
          .from("interactions")
          .update(update)
          .eq("id", rating.interaction_id);

        if (error) {
          logger.error(
            `saveInteractionRatings: update interaction=${rating.interaction_id} failed: ${error.message} [code=${error.code}]`
          );
          continue;
        }
        count++;
      }
    }
    return count;
  }

  async updateCycleStatus(
    cycleId: string,
    status: string,
    topContributors?: TopContributor[]
  ): Promise<Record<string, unknown>> {
    const update: Record<string, unknown> = { status };
    if (topContributors) update.top_contributors = topContributors;

    const { data, error } = await this.client
      .from("evolution_cycles")
      .update(update)
      .eq("id", cycleId)
      .select();

    if (error) {
      logger.error(
        `updateCycleStatus(cycle=${cycleId}, status=${status}): ${error.message} [code=${error.code}]`
      );
      return {};
    }
    return (data?.[0] as Record<string, unknown>) ?? {};
  }
}
