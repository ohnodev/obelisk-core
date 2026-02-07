/**
 * Utility for parsing Qwen3 thinking tokens.
 * Mirrors Python src/core/execution/nodes/inference/thinking_token_utils.py
 *
 * In the TS runtime the inference service returns the split already,
 * so this is mainly kept for parity / testing.
 */

const END_TOKEN = 151668; // </think> tag in Qwen3 tokenizer

/**
 * Split generated token IDs into thinking and content portions.
 *
 * @returns [thinkingTokens, contentTokens]
 */
export function splitThinkingTokens(
  generatedTokens: number[]
): [number[], number[]] {
  const lastIdx = generatedTokens.lastIndexOf(END_TOKEN);
  if (lastIdx === -1) {
    return [[], generatedTokens];
  }
  return [generatedTokens.slice(0, lastIdx), generatedTokens.slice(lastIdx + 1)];
}
