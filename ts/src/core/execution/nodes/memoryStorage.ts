/**
 * MemoryStorageNode – creates/accesses storage instances based on storage path.
 * Mirrors Python src/core/execution/nodes/memory_storage.py
 */
import path from "path";
import os from "os";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { LocalJSONStorage } from "../../../storage/localJson";
import { SupabaseStorage } from "../../../storage/supabase";
import { getLogger } from "../../../utils/logger";

const logger = getLogger("memoryStorage");

// Class-level cache (shared across all MemoryStorageNode instances)
const storageCache: Record<string, StorageInterface> = {};

export class MemoryStorageNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    let storagePath = this.getInputValue(
      "storage_path",
      context,
      undefined
    ) as string | undefined;
    let storageType = this.getInputValue(
      "storage_type",
      context,
      "local_json"
    ) as string;

    // Resolve template variables
    if (
      typeof storagePath === "string" &&
      storagePath.startsWith("{{") &&
      storagePath.endsWith("}}")
    ) {
      const varName = storagePath.slice(2, -2).trim();
      storagePath = (context.variables[varName] as string) ?? undefined;
    }
    if (
      typeof storageType === "string" &&
      storageType.startsWith("{{") &&
      storageType.endsWith("}}")
    ) {
      const varName = storageType.slice(2, -2).trim();
      storageType =
        (context.variables[varName] as string) ?? "local_json";
    }

    // Default storage path
    if (!storagePath) {
      storagePath = path.join(
        os.homedir(),
        ".obelisk-core",
        "data",
        "default"
      );
    } else if (!path.isAbsolute(storagePath)) {
      storagePath = path.join(
        os.homedir(),
        ".obelisk-core",
        "data",
        storagePath
      );
    }

    storagePath = path.resolve(storagePath);

    // Build cache key
    let cacheKey: string;
    if (storageType === "supabase") {
      const supabaseUrl = process.env.SUPABASE_URL ?? "";
      const supabaseKey = process.env.SUPABASE_KEY ?? "";
      if (!supabaseUrl || !supabaseKey) {
        throw new Error(
          "Supabase storage requires SUPABASE_URL and SUPABASE_KEY env vars"
        );
      }
      cacheKey = `${storageType}::${storagePath}::${supabaseUrl}`;
    } else {
      cacheKey = `${storageType}::${storagePath}`;
    }

    logger.debug(
      `[MemoryStorage] storage_path=${storagePath}, storage_type=${storageType}, cache_key=${cacheKey}`
    );

    // Check cache
    if (storageCache[cacheKey]) {
      logger.debug(`[MemoryStorage] Using cached storage for ${cacheKey}`);
      return { storage_instance: storageCache[cacheKey] };
    }

    // Create new storage instance
    let instance: StorageInterface;
    if (storageType === "local_json") {
      instance = new LocalJSONStorage(storagePath);
    } else if (storageType === "supabase") {
      const supabaseUrl = process.env.SUPABASE_URL!;
      const supabaseKey = process.env.SUPABASE_KEY!;
      instance = new SupabaseStorage(supabaseUrl, supabaseKey);
    } else {
      throw new Error(
        `Unknown storage_type: ${storageType}. Must be 'local_json' or 'supabase'`
      );
    }

    storageCache[cacheKey] = instance;
    return { storage_instance: instance };
  }
}
