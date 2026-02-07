/**
 * JSON parsing utilities for extracting JSON from LLM responses.
 * Handles markdown code blocks, thinking blocks, and common LLM mistakes.
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
  } catch (e) {
    logger.error(
      `Failed to parse JSON from ${context} (full text): ${text.slice(0, 200)}`
    );
    throw new Error(`Invalid JSON in ${context} response: ${e}`);
  }
}

/**
 * Fix common LLM JSON mistakes before parsing.
 * - Escaped single quotes \' (invalid in JSON, should be just ')
 */
function sanitizeJsonString(jsonStr: string): string {
  // Fix escaped single quotes – LLMs often write \' but JSON doesn't escape them
  return jsonStr.replace(/(?<!\\)\\'/g, "'");
}
