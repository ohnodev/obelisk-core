/**
 * Dependency container – resolves storage backend based on mode.
 * Mirrors Python src/core/container.py
 */
import { StorageInterface } from "./types";
import { LocalJSONStorage } from "../storage/localJson";
import { SupabaseStorage } from "../storage/supabase";
import { Config } from "./config";
import { getLogger } from "../utils/logger";

const logger = getLogger("container");

export interface Container {
  storage: StorageInterface;
  mode: string;
}

export function buildContainer(mode?: string): Container {
  const resolvedMode = mode ?? Config.MODE;

  let storage: StorageInterface;

  if (resolvedMode === "prod") {
    if (!Config.SUPABASE_URL || !Config.SUPABASE_KEY) {
      throw new Error(
        "Prod mode requires SUPABASE_URL and SUPABASE_KEY env vars"
      );
    }
    logger.info("Building container in PROD mode (Supabase)");
    storage = new SupabaseStorage(Config.SUPABASE_URL, Config.SUPABASE_KEY);
  } else {
    logger.info(`Building container in SOLO mode (LocalJSON: ${Config.STORAGE_PATH})`);
    storage = new LocalJSONStorage(Config.STORAGE_PATH);
  }

  return { storage, mode: resolvedMode };
}
