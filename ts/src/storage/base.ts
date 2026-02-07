/**
 * Abstract storage interface for Obelisk Core.
 * Mirrors Python src/storage/base.py
 *
 * Concrete backends: LocalJSONStorage (solo mode), SupabaseStorage (prod mode)
 */
export {
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
