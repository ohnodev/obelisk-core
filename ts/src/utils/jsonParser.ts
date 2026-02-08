/**
 * JSON parsing utilities for extracting JSON from LLM responses.
 * Handles markdown code blocks, thinking blocks, truncated JSON, and
 * common LLM mistakes.
 * Mirrors Python src/utils/json_parser.py
 */
import { getLogger } from "./logger";

const logger = getLogger("jsonParser");

/**
 * Extract JSON from an LLM response string.
 *
 * Handles:
 * - Markdown code blocks (```json ... ``` or ``` ... ```)
 * - Thinking blocks (<think>...</think>)
 * - Extra text before/after JSON
 * - Truncated JSON (from token limit cuts)
 */
export function extractJsonFromLlmResponse(
  response: string,
  context = "response"
): Record<string, unknown> {
  if (!response || !response.trim()) {
    throw new Error(`Cannot extract JSON from empty ${context} response`);
  }

  let text = response.trim();

  // Remove thinking content if present (Qwen3 format)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip markdown code blocks
  text = text.replace(/^```(?:json)?\s*\n?/gim, "");
  text = text.replace(/\n?```\s*$/gim, "");
  text = text.trim();

  // Strategy 1: Find complete JSON object by matching braces.
  // Track whether we're inside a JSON string to avoid miscounting
  // braces that appear as string values (e.g. {"key": "a { b }"}).
  const jsonStart = text.indexOf("{");
  if (jsonStart >= 0) {
    let braceCount = 0;
    let jsonEnd = jsonStart;
    let inString = false;
    let escaped = false;

    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];

      if (escaped) {
        // Previous char was a backslash inside a string — skip this char
        escaped = false;
        continue;
      }

      if (inString) {
        if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      // Outside a string
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        braceCount++;
      } else if (ch === "}") {
        braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }

    if (jsonEnd > jsonStart) {
      const jsonStr = sanitizeJsonString(text.slice(jsonStart, jsonEnd));
      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        logger.error(
          `Failed to parse JSON from ${context} (extracted from braces): ${jsonStr.slice(0, 200)}`
        );
        throw new Error(`Invalid JSON in ${context} response: ${e}`);
      }
    }
  }

  // Strategy 2: Try parsing the whole cleaned response
  try {
    return JSON.parse(sanitizeJsonString(text));
  } catch {
    // fall through to repair
  }

  // Strategy 3: Try to repair truncated JSON (token limit may have cut off the response)
  const repaired = tryRepairTruncatedJson(text);
  if (repaired !== null) {
    logger.warning(
      `Repaired truncated JSON from ${context} — response was likely cut off by token limit. ` +
        `Recovered keys: ${Object.keys(repaired).join(", ")}`
    );
    return repaired;
  }

  // All strategies failed
  logger.error(
    `Failed to parse JSON from ${context} (full text): ${text.slice(0, 200)}`
  );
  throw new Error(
    `Cannot extract valid JSON from ${context} response (text was ${text.length} chars)`
  );
}

/**
 * Attempt to repair truncated JSON that was cut off by token limits.
 *
 * When thinking mode uses most of the token budget, the actual JSON response
 * can be truncated mid-string, e.g.:
 *   {"result": true, "confidence": "high", "reasoning": "Message directly addresses the bot by
 *
 * This function tries to close unterminated strings and missing braces to
 * recover as much data as possible.
 *
 * @returns Parsed object if repair succeeds, null otherwise
 */
function tryRepairTruncatedJson(
  text: string
): Record<string, unknown> | null {
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return null;

  const fragment = text.slice(jsonStart);

  // Walk through tracking parser state
  let inString = false;
  let escaped = false;
  let braceDepth = 0;

  for (const ch of fragment) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      braceDepth++;
    } else if (ch === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        return null; // JSON looks complete — repair won't help
      }
    }
  }

  // JSON is truncated (braceDepth > 0). Try multiple repair strategies.

  // Attempt 1: Close unterminated string + close all open braces
  let repair = fragment;
  if (inString) {
    repair += '"';
  }
  repair += "}".repeat(braceDepth);

  try {
    return JSON.parse(sanitizeJsonString(repair)) as Record<string, unknown>;
  } catch {
    // fall through
  }

  // Attempt 2: The truncation may have left an incomplete key-value pair.
  // Strip back to the last top-level comma and close the object.
  repair = fragment;
  if (inString) {
    repair += '"';
  }

  // Find the last comma at brace depth 1 (top-level of the object)
  let scanInString = false;
  let scanEscaped = false;
  let scanDepth = 0;
  let lastTopComma = -1;
  for (let i = 0; i < repair.length; i++) {
    const ch = repair[i];
    if (scanEscaped) {
      scanEscaped = false;
      continue;
    }
    if (scanInString) {
      if (ch === "\\") {
        scanEscaped = true;
      } else if (ch === '"') {
        scanInString = false;
      }
      continue;
    }
    if (ch === '"') {
      scanInString = true;
    } else if (ch === "{") {
      scanDepth++;
    } else if (ch === "}") {
      scanDepth--;
    } else if (ch === "," && scanDepth === 1) {
      lastTopComma = i;
    }
  }

  if (lastTopComma > 0) {
    repair = repair.slice(0, lastTopComma) + "}".repeat(braceDepth);
    try {
      return JSON.parse(sanitizeJsonString(repair)) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Fix common LLM JSON mistakes before parsing.
 * - Escaped single quotes \' (invalid in JSON, should be just ')
 */
function sanitizeJsonString(jsonStr: string): string {
  // Fix escaped single quotes – LLMs often write \' but JSON doesn't escape them
  return jsonStr.replace(/(?<!\\)\\'/g, "'");
}
