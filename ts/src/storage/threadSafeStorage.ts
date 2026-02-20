/**
 * ThreadSafeStorage – wraps a StorageInterface to serialize writes while allowing concurrent reads.
 * Use when multiple nodes or subgraphs share the same storage (e.g. express stats + sell_bags + scheduler).
 */
import type {
  StorageInterface,
  SaveInteractionParams,
  ActivityLog,
  RewardScore,
  CreateRewardParams,
  NftUpgrade,
  InteractionRating,
  TopContributor,
  EvolutionCycleData,
  Interaction,
} from "../core/types";

export class ThreadSafeStorage implements StorageInterface {
  private readonly delegate: StorageInterface;
  private writeQueue: Promise<unknown> = Promise.resolve();

  /** Expose delegate's basePath when present (e.g. LocalJSONStorage) so nodes can use storage_instance.basePath. */
  get basePath(): string | undefined {
    const d = this.delegate as { basePath?: string };
    return typeof d.basePath === "string" ? d.basePath : undefined;
  }

  constructor(delegate: StorageInterface) {
    this.delegate = delegate;
  }

  /** Run a write operation after all prior writes complete; returns the operation result. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const wrapperPromise = this.writeQueue.then(() => fn());
    this.writeQueue = wrapperPromise.catch(() => undefined);
    return wrapperPromise;
  }

  // ─── Read-only: call delegate directly ─────────────────────────────────

  getInteractions(cycleId: string): Promise<Interaction[]> {
    return this.delegate.getInteractions(cycleId);
  }

  getUserInteractions(userId: string, limit?: number): Promise<Interaction[]> {
    return this.delegate.getUserInteractions(userId, limit);
  }

  getEvolutionCycle(cycleId: string): Promise<EvolutionCycleData | null> {
    return this.delegate.getEvolutionCycle(cycleId);
  }

  getCurrentEvolutionCycle(): Promise<string | null> {
    return this.delegate.getCurrentEvolutionCycle();
  }

  getActivityLogs(
    activityType?: string,
    limit?: number
  ): Promise<ActivityLog[]> {
    return this.delegate.getActivityLogs(activityType, limit);
  }

  calculateUserRewardScore(
    userId: string,
    cycleId: string
  ): Promise<RewardScore> {
    return this.delegate.calculateUserRewardScore(userId, cycleId);
  }

  checkNftUpgrades(userId: string): Promise<NftUpgrade[]> {
    return this.delegate.checkNftUpgrades(userId);
  }

  getLatestModelWeights(
    baseModel?: string
  ): Promise<Record<string, unknown> | null> {
    return this.delegate.getLatestModelWeights(baseModel);
  }

  saveLoRaWeights(
    cycleNumber: number,
    loraWeights: Buffer,
    evolutionScore: number,
    interactionsUsed: number,
    metadata?: Record<string, unknown>
  ): Promise<string | null> {
    return this.delegate.saveLoRaWeights(
      cycleNumber,
      loraWeights,
      evolutionScore,
      interactionsUsed,
      metadata
    );
  }

  deleteLoRaWeights(): Promise<boolean> {
    return this.delegate.deleteLoRaWeights();
  }

  // ─── Mutating: enqueue so only one write runs at a time ─────────────────

  saveInteraction(params: SaveInteractionParams): Promise<string> {
    return this.enqueue(() => this.delegate.saveInteraction(params));
  }

  getOrCreateUser(walletAddress: string): Promise<string> {
    return this.enqueue(() => this.delegate.getOrCreateUser(walletAddress));
  }

  createActivityLog(
    activityType: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<ActivityLog> {
    return this.enqueue(() =>
      this.delegate.createActivityLog(activityType, message, metadata)
    );
  }

  createReward(
    params: CreateRewardParams
  ): Promise<Record<string, unknown>> {
    return this.enqueue(() => this.delegate.createReward(params));
  }

  updateUserTokenBalance(
    userId: string,
    amount: number
  ): Promise<Record<string, unknown>> {
    return this.enqueue(() =>
      this.delegate.updateUserTokenBalance(userId, amount)
    );
  }

  saveInteractionRatings(
    ratings: InteractionRating[],
    cycleId: string
  ): Promise<number> {
    return this.enqueue(() =>
      this.delegate.saveInteractionRatings(ratings, cycleId)
    );
  }

  updateCycleStatus(
    cycleId: string,
    status: string,
    topContributors?: TopContributor[]
  ): Promise<Record<string, unknown>> {
    return this.enqueue(() =>
      this.delegate.updateCycleStatus(cycleId, status, topContributors)
    );
  }
}
