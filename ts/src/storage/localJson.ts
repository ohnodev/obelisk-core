/**
 * Local JSON storage for solo mode.
 * Stores data in ~/.obelisk-core/data/ as JSON files.
 * Mirrors Python src/storage/local_json.py
 */
import fs from "fs";
import path from "path";
import os from "os";
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

const logger = getLogger("localJson");

export class LocalJSONStorage implements StorageInterface {
  readonly basePath: string;
  readonly memoryPath: string;
  readonly interactionsPath: string;
  private readonly cyclesPath: string;
  private readonly weightsPath: string;
  private readonly usersPath: string;

  constructor(storagePath?: string) {
    if (storagePath) {
      this.basePath = storagePath;
    } else {
      this.basePath = path.join(os.homedir(), ".obelisk-core", "data");
    }

    this.memoryPath = path.join(this.basePath, "memory");
    this.interactionsPath = path.join(this.memoryPath, "interactions");
    this.cyclesPath = path.join(this.basePath, "cycles");
    this.weightsPath = path.join(this.basePath, "weights");
    this.usersPath = path.join(this.basePath, "users");

    // Create directory structure
    for (const dir of [
      this.memoryPath,
      this.interactionsPath,
      this.cyclesPath,
      this.weightsPath,
      this.usersPath,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Set permissions (user only)
    try {
      fs.chmodSync(this.basePath, 0o700);
    } catch {
      // ignore permission errors on some platforms
    }
  }

  // ── helpers ────────────────────────────────────────────────────────
  private userFile(userId: string): string {
    return path.join(this.interactionsPath, `${userId}.json`);
  }
  private cycleFile(cycleId: string): string {
    return path.join(this.cyclesPath, `${cycleId}.json`);
  }
  private readJson<T>(filePath: string, fallback: T): T {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
      return fallback;
    }
  }
  private writeJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // ignore
    }
  }
  private sha256(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  // ── StorageInterface ───────────────────────────────────────────────

  async getInteractions(cycleId: string): Promise<Interaction[]> {
    const data = this.readJson<EvolutionCycleData | null>(
      this.cycleFile(cycleId),
      null
    );
    return (data?.interactions as Interaction[]) ?? [];
  }

  async saveInteraction(params: SaveInteractionParams): Promise<string> {
    const {
      userId,
      query,
      response,
      cycleId,
      quantumSeed = 0,
      rewardScore = 0,
    } = params;
    const interactionId = this.sha256(
      `${userId}${query}${new Date().toISOString()}`
    ).slice(0, 16);

    const interaction: Interaction = {
      id: interactionId,
      user_id: userId,
      query,
      response,
      quantum_seed: quantumSeed,
      reward_score: rewardScore,
      evolution_cycle_id: cycleId,
      created_at: new Date().toISOString(),
    };

    // Save to user file
    const uf = this.userFile(userId);
    const interactions = this.readJson<Interaction[]>(uf, []);
    interactions.push(interaction);
    logger.debug(
      `[LocalJSON] Saving interaction to ${uf}: user_id=${userId}, total=${interactions.length}`
    );
    this.writeJson(uf, interactions);

    // Also save to cycle file if cycleId provided
    if (cycleId) {
      const cf = this.cycleFile(cycleId);
      const cycleData = this.readJson<Record<string, unknown>>(cf, {
        id: cycleId,
        interactions: [],
      });
      const cycleInteractions = (cycleData.interactions ??
        []) as Interaction[];
      cycleInteractions.push(interaction);
      cycleData.interactions = cycleInteractions;
      this.writeJson(cf, cycleData);
    }

    return interactionId;
  }

  async getUserInteractions(
    userId: string,
    limit?: number
  ): Promise<Interaction[]> {
    const uf = this.userFile(userId);
    logger.debug(
      `[LocalJSON] Loading interactions for user_id=${userId}, file=${uf}`
    );
    const interactions = this.readJson<Interaction[]>(uf, []);
    if (limit && limit > 0) {
      return interactions.slice(-limit);
    }
    return interactions;
  }

  async getEvolutionCycle(
    cycleId: string
  ): Promise<EvolutionCycleData | null> {
    return this.readJson<EvolutionCycleData | null>(
      this.cycleFile(cycleId),
      null
    );
  }

  async getCurrentEvolutionCycle(): Promise<string | null> {
    const files = fs.readdirSync(this.cyclesPath).filter((f) =>
      f.endsWith(".json")
    );
    const active: [string, string][] = [];
    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(this.cyclesPath, file), "utf-8")
        );
        if (data.status === "active") {
          active.push([data.created_at ?? "", data.id]);
        }
      } catch {
        continue;
      }
    }
    if (active.length) {
      active.sort((a, b) => b[0].localeCompare(a[0]));
      return active[0][1];
    }
    return null;
  }

  async getOrCreateUser(walletAddress: string): Promise<string> {
    const userId = this.sha256(walletAddress).slice(0, 16);
    const userFile = path.join(this.usersPath, `${userId}.json`);
    if (!fs.existsSync(userFile)) {
      this.writeJson(userFile, {
        id: userId,
        wallet_address: walletAddress,
        token_balance: 0,
        created_at: new Date().toISOString(),
      });
    }
    return userId;
  }

  async createActivityLog(
    activityType: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<ActivityLog> {
    const activity: ActivityLog = {
      id: this.sha256(
        `${activityType}${message}${new Date().toISOString()}`
      ).slice(0, 16),
      type: activityType,
      message,
      metadata: metadata ?? {},
      created_at: new Date().toISOString(),
    };

    const file = path.join(this.memoryPath, "activities.json");
    const activities = this.readJson<ActivityLog[]>(file, []);
    activities.push(activity);
    this.writeJson(file, activities);
    return activity;
  }

  async getActivityLogs(
    activityType?: string,
    limit = 100
  ): Promise<ActivityLog[]> {
    const file = path.join(this.memoryPath, "activities.json");
    let activities = this.readJson<ActivityLog[]>(file, []);
    if (activityType) {
      activities = activities.filter((a) => a.type === activityType);
    }
    activities.sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? "")
    );
    return activities.slice(0, limit);
  }

  // ── LoRA / Weights (stub – LoRA not supported via inference service) ─
  async saveLorWeights(): Promise<string | null> {
    logger.warn("LoRA weight saving is not supported in the TS runtime");
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
    const interactions = await this.getInteractions(cycleId);
    const userInts = interactions.filter((i) => i.user_id === userId);
    if (!userInts.length) {
      return {
        user_id: userId,
        interaction_count: 0,
        average_quality: 0,
        quantum_alignment: 0,
        total_score: 0,
      };
    }
    const count = userInts.length;
    const avgQuality =
      userInts.reduce((s, i) => s + (i.reward_score ?? 0), 0) / count;
    const quantum =
      userInts.reduce((s, i) => s + (i.quantum_seed ?? 0), 0) / count;
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
    const reward = {
      id: this.sha256(
        `${params.userId}${params.cycleId}${params.rank}`
      ).slice(0, 16),
      user_id: params.userId,
      evolution_cycle_id: params.cycleId,
      rank: params.rank,
      tokens_awarded: params.tokensAwarded,
      interactions_count: params.interactionsCount,
      total_reward_score: params.totalScore,
      claimed: false,
      created_at: new Date().toISOString(),
    };

    const cf = this.cycleFile(params.cycleId);
    const cycleData = this.readJson<Record<string, unknown>>(cf, {
      id: params.cycleId,
      rewards: [],
    });
    const rewards = (cycleData.rewards ?? []) as Record<string, unknown>[];
    rewards.push(reward);
    cycleData.rewards = rewards;
    this.writeJson(cf, cycleData);
    return reward;
  }

  async updateUserTokenBalance(
    userId: string,
    amount: number
  ): Promise<Record<string, unknown>> {
    const userFile = path.join(this.usersPath, `${userId}.json`);
    const userData = this.readJson<Record<string, unknown>>(userFile, {
      id: userId,
      token_balance: 0,
    });
    const current = (userData.token_balance as number) ?? 0;
    userData.token_balance = current + amount;
    userData.updated_at = new Date().toISOString();
    this.writeJson(userFile, userData);
    return userData;
  }

  async checkNftUpgrades(): Promise<NftUpgrade[]> {
    // Solo mode: NFT upgrades handled by obelisk-service
    return [];
  }

  async saveInteractionRatings(
    ratings: InteractionRating[],
    cycleId: string
  ): Promise<number> {
    const cf = this.cycleFile(cycleId);
    const cycleData = this.readJson<Record<string, unknown>>(cf, {
      id: cycleId,
      interactions: [],
      ratings: [],
    });
    const existing = (cycleData.ratings ?? []) as InteractionRating[];
    existing.push(...ratings);
    cycleData.ratings = existing;
    this.writeJson(cf, cycleData);
    return ratings.length;
  }

  async updateCycleStatus(
    cycleId: string,
    status: string,
    topContributors?: TopContributor[]
  ): Promise<Record<string, unknown>> {
    const cf = this.cycleFile(cycleId);
    const cycleData = this.readJson<Record<string, unknown>>(cf, {
      id: cycleId,
    });
    cycleData.status = status;
    if (topContributors) cycleData.top_contributors = topContributors;
    cycleData.updated_at = new Date().toISOString();
    this.writeJson(cf, cycleData);
    return cycleData;
  }
}
