/**
 * MemoryStorageNode – creates/accesses storage instances based on storage path.
 * Mirrors Python src/core/execution/nodes/memory_storage.py
 */
import path from "path";
import { BaseNode, ExecutionContext } from "../nodeBase";
import { StorageInterface } from "../../types";
import { LocalJSONStorage } from "../../../storage/localJson";
import { SupabaseStorage } from "../../../storage/supabase";
import { getLogger, abbrevPathForLog } from "../../../utils/logger";

const logger = getLogger("memoryStorage");

// Class-level cache (shared across all MemoryStorageNode instances)
const storageCache: Record<string, StorageInterface> = {};

export class MemoryStorageNode extends BaseNode {
  execute(context: ExecutionContext): Record<string, unknown> {
    // Resolve inputs (template variables handled by inherited resolveTemplateVariable)
    let storagePath = this.getInputValue(
      "storage_path",
      context,
      undefined
    ) as string | undefined;
    let storageType = (this.getInputValue(
      "storage_type",
      context,
      "local_json"
    ) as string | undefined) ?? "local_json";

    // Default storage path (in project folder)
    if (!storagePath) {
      storagePath = path.join(process.cwd(), "data", "default");
    } else if (!path.isAbsolute(storagePath)) {
      storagePath = path.join(process.cwd(), "data", storagePath);
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
      `[MemoryStorage] storage_path=${abbrevPathForLog(storagePath)}, storage_type=${storageType}, cache_key=${abbrevPathForLog(cacheKey)}`
    );

    // Check cache
    if (storageCache[cacheKey]) {
      logger.debug(`[MemoryStorage] Using cached storage for ${abbrevPathForLog(cacheKey)}`);
      const instance = storageCache[cacheKey];
      const basePath =
        storageType === "local_json" && "basePath" in instance
          ? (instance as { basePath: string }).basePath
          : storagePath;
      return { storage_instance: instance, base_path: basePath };
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
    const basePath =
      storageType === "local_json" && "basePath" in instance
        ? (instance as { basePath: string }).basePath
        : storagePath;
    return { storage_instance: instance, base_path: basePath };
  }
}
