/**
 * User ID utilities for throttling and session tracking
 */

const STORAGE_KEY = "obelisk_user_id";

/**
 * Generate or retrieve a unique user ID for throttling purposes.
 * Uses localStorage to persist the ID across page reloads.
 * Each browser/session gets a unique quota.
 */
export function getUserId(): string {
  if (typeof window === "undefined") return "server_render";
  
  let userId = localStorage.getItem(STORAGE_KEY);
  
  if (!userId) {
    // Generate a UUID v4
    userId = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, userId);
  }
  
  return userId;
}
