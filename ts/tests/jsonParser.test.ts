/**
 * Comprehensive tests for the JSON parser.
 *
 * Tests extractJsonFromLlmResponse with:
 * - Clean JSON
 * - Markdown code blocks
 * - Thinking blocks (<think>…</think>)
 * - Extra prose around JSON
 * - Truncated JSON (mid-string, mid-key, nested objects)
 * - Braces inside string values
 * - Escaped quotes
 * - Empty / garbage input
 * - Simulated binary intent responses (clean + truncated at various positions)
 * - Repair brace-depth fix verification
 * - Randomized fuzzing
 */
import { describe, it, expect } from "vitest";
import { extractJsonFromLlmResponse } from "../src/utils/jsonParser";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBinaryResponse(
  result: boolean,
  confidence = "high",
  reasoning = "The message clearly matches the criteria"
): Record<string, unknown> {
  return { result, confidence, reasoning };
}

const SAMPLE_MESSAGES = [
  "Hey Overseer, help us launch a memecoin!",
  "What's the weather like today?",
  "Agent #001 we need you to analyze this market data",
  "lol nice meme bro",
  "Can you help me deploy a smart contract on Base?",
  "I just want to chat, nothing specific",
  "Overseer aka Agent #001 help us come up with a memecoin idea to send to millions",
  "gm gm gm",
  "Execute trade: buy 100 ETH",
  "Tell me a joke",
  "@overseer please respond to this thread",
  "When moon?",
  "Can the bot analyze sentiment for $PEPE?",
  "Random gibberish asdfghjkl",
  "Please classify this message as relevant to the agent's purpose",
  "🚀🌕 to the moon!",
  "a".repeat(5000), // very long
  'He said "hello" and then {walked away}', // special chars
];

const SAMPLE_CRITERIA = [
  "Does the message directly address or reference the bot/agent/overseer?",
  "Is the user requesting a specific action or task?",
  "Does the message contain crypto/trading related content?",
  "Is this a casual greeting or small talk?",
];

function simulateBinaryIntentResponse(
  message: string,
  criteria: string,
  truncateAt?: number,
  withThinking = false
): string {
  const isRelevant = ["agent", "overseer", "bot", "deploy", "trade", "classify", "analyze"].some(
    (kw) => message.toLowerCase().includes(kw)
  );

  const obj = {
    result: isRelevant,
    confidence: isRelevant ? "high" : "low",
    reasoning: `The message ${isRelevant ? "directly references the agent" : "is casual and does not reference the agent"}. Analysis of: ${message.slice(0, 80)}`,
  };

  let text = JSON.stringify(obj);

  if (withThinking) {
    const thinking = `<think>Let me analyze whether '${message.slice(0, 40)}' matches criteria '${criteria.slice(0, 40)}'... I think it ${isRelevant ? "does" : "does not"} match.</think>\n`;
    text = thinking + text;
  }

  if (truncateAt !== undefined && truncateAt < text.length) {
    text = text.slice(0, truncateAt);
  }

  return text;
}

// ---------------------------------------------------------------------------
// 1. Clean JSON
// ---------------------------------------------------------------------------

describe("Clean JSON", () => {
  it("simple object", () => {
    const r = extractJsonFromLlmResponse('{"a": 1, "b": "hello"}');
    expect(r).toEqual({ a: 1, b: "hello" });
  });

  it("nested object", () => {
    const obj = { outer: { inner: [1, 2, 3] }, flag: true };
    const r = extractJsonFromLlmResponse(JSON.stringify(obj));
    expect(r).toEqual(obj);
  });

  it("boolean values", () => {
    const r = extractJsonFromLlmResponse('{"yes": true, "no": false}');
    expect(r.yes).toBe(true);
    expect(r.no).toBe(false);
  });

  it("null value", () => {
    const r = extractJsonFromLlmResponse('{"key": null}');
    expect(r.key).toBeNull();
  });

  it("numeric values", () => {
    const r = extractJsonFromLlmResponse('{"int": 42, "float": 3.14, "neg": -7}');
    expect(r).toEqual({ int: 42, float: 3.14, neg: -7 });
  });
});

// ---------------------------------------------------------------------------
// 2. Markdown code blocks
// ---------------------------------------------------------------------------

describe("Markdown code blocks", () => {
  it("json fence", () => {
    const r = extractJsonFromLlmResponse('```json\n{"result": true}\n```');
    expect(r).toEqual({ result: true });
  });

  it("plain fence", () => {
    const r = extractJsonFromLlmResponse('```\n{"result": false}\n```');
    expect(r).toEqual({ result: false });
  });

  it("fence with extra whitespace", () => {
    const r = extractJsonFromLlmResponse('  ```json  \n  {"x": 1}  \n  ```  ');
    expect(r).toEqual({ x: 1 });
  });
});

// ---------------------------------------------------------------------------
// 3. Thinking blocks
// ---------------------------------------------------------------------------

describe("Thinking blocks", () => {
  it("thinking before JSON", () => {
    const raw =
      '<think>I need to classify this...</think>\n{"result": true, "confidence": "high", "reasoning": "yes"}';
    const r = extractJsonFromLlmResponse(raw);
    expect(r.result).toBe(true);
  });

  it("thinking with braces inside", () => {
    const raw = '<think>The user said { weird stuff } and I need to handle it.</think>{"a": 1}';
    const r = extractJsonFromLlmResponse(raw);
    expect(r).toEqual({ a: 1 });
  });

  it("multiline thinking", () => {
    const raw = "<think>\nLine 1\nLine 2\nLine 3\n</think>\n{\"ok\": true}";
    const r = extractJsonFromLlmResponse(raw);
    expect(r).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 4. Extra prose around JSON
// ---------------------------------------------------------------------------

describe("Extra prose around JSON", () => {
  it("prose before", () => {
    const raw = 'Here is my analysis:\n{"result": false, "confidence": "low", "reasoning": "nope"}';
    const r = extractJsonFromLlmResponse(raw);
    expect(r.result).toBe(false);
  });

  it("prose after", () => {
    const raw = '{"result": true, "confidence": "high", "reasoning": "yes"}\nHope that helps!';
    const r = extractJsonFromLlmResponse(raw);
    expect(r.result).toBe(true);
  });

  it("prose both sides", () => {
    const raw = 'Sure, here you go:\n{"key": "value"}\nLet me know if you need more.';
    const r = extractJsonFromLlmResponse(raw);
    expect(r).toEqual({ key: "value" });
  });
});

// ---------------------------------------------------------------------------
// 5. Braces inside string values
// ---------------------------------------------------------------------------

describe("Braces inside strings", () => {
  it("curly in value", () => {
    const raw = '{"msg": "use { and } carefully"}';
    const r = extractJsonFromLlmResponse(raw);
    expect(r.msg).toBe("use { and } carefully");
  });

  it("nested curly in value", () => {
    const raw = '{"msg": "obj is { \\"a\\": { \\"b\\": 1 } }"}';
    const r = extractJsonFromLlmResponse(raw);
    expect((r.msg as string).includes("{")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Escaped quotes
// ---------------------------------------------------------------------------

describe("Escaped quotes", () => {
  it("escaped double quote", () => {
    const raw = '{"msg": "He said \\"hello\\" to me"}';
    const r = extractJsonFromLlmResponse(raw);
    expect((r.msg as string).includes("hello")).toBe(true);
  });

  it("escaped single quote (LLM style)", () => {
    const raw = `{"msg": "it\\'s fine"}`;
    const r = extractJsonFromLlmResponse(raw);
    expect(r.msg).toBe("it's fine");
  });
});

// ---------------------------------------------------------------------------
// 7. Empty / garbage input
// ---------------------------------------------------------------------------

describe("Empty / garbage input", () => {
  it("empty string", () => {
    expect(() => extractJsonFromLlmResponse("")).toThrow();
  });

  it("whitespace only", () => {
    expect(() => extractJsonFromLlmResponse("   \n\t  ")).toThrow();
  });

  it("no JSON at all", () => {
    expect(() => extractJsonFromLlmResponse("Hello, how are you today?")).toThrow();
  });

  it("only opening brace", () => {
    // "{" repairs to "{}" which is an empty object — that is valid
    const r = extractJsonFromLlmResponse("{");
    expect(r).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 8. Truncated JSON
// ---------------------------------------------------------------------------

describe("Truncated JSON", () => {
  it("truncated mid-string", () => {
    const raw =
      '{"result": true, "confidence": "high", "reasoning": "Message directly addresses the bot by';
    const r = extractJsonFromLlmResponse(raw, "binary_intent");
    expect(r.result).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("truncated mid-key", () => {
    const raw = '{"result": true, "confidence": "high", "rea';
    const r = extractJsonFromLlmResponse(raw, "binary_intent");
    expect(r.result).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("truncated after colon", () => {
    const raw = '{"result": true, "confidence":';
    const r = extractJsonFromLlmResponse(raw, "binary_intent");
    expect(r.result).toBe(true);
  });

  it("truncated after comma", () => {
    const raw = '{"result": true,';
    const r = extractJsonFromLlmResponse(raw, "binary_intent");
    expect(r.result).toBe(true);
  });

  it("truncated nested object", () => {
    const raw = '{"result": true, "meta": {"nested_key": "trun';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r.result).toBe(true);
  });

  it("truncated deeply nested", () => {
    const raw = '{"a": 1, "b": {"c": {"d": "trun';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r.a).toBe(1);
  });

  it("truncated boolean value", () => {
    // "tru" is not valid JSON and there's no comma to fall back to
    expect(() => extractJsonFromLlmResponse('{"result": tru', "test")).toThrow();
  });

  it("truncated string ending with trailing backslash", () => {
    // Fragment ends ...\\  — naively appending " would produce \\" which
    // escapes the quote. Repair should strip the odd trailing backslash.
    const raw = '{"a": 1, "b": "hello\\';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r.a).toBe(1);
  });

  it("truncated string ending with even backslashes", () => {
    // Even trailing backslashes (\\\\) are fine — the quote closes normally.
    const raw = '{"a": 1, "b": "hello\\\\';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r.a).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Repair brace-depth fix
// ---------------------------------------------------------------------------

describe("Repair brace-depth fix", () => {
  // Note: Attempt 1 (close string + all braces) is tried first and succeeds
  // when the truncated value can be closed into valid JSON. Attempt 2 (strip
  // to last comma) is only used when Attempt 1 fails.

  it("Attempt 1 succeeds: nested truncated string recovers full data", () => {
    // Attempt 1: close string + 2 braces → {"a": 1, "b": {"c": "trun"}}
    // This is valid, so Attempt 1 succeeds (recovers MORE data).
    const raw = '{"a": 1, "b": {"c": "trun';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r).toEqual({ a: 1, b: { c: "trun" } });
  });

  it("Attempt 1 succeeds: deeply nested recovers full data", () => {
    // Attempt 1: close string + 3 braces → valid JSON with all keys
    const raw = '{"x": "ok", "y": {"z": {"w": "tr';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r).toEqual({ x: "ok", y: { z: { w: "tr" } } });
  });

  it("Attempt 1 succeeds: flat truncated string recovers full data", () => {
    const raw = '{"a": 1, "b": "trunc';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r).toEqual({ a: 1, b: "trunc" });
  });

  it("Attempt 1 succeeds: complete nested then truncated value", () => {
    const raw = '{"a": {"inner": 1}, "b": "tr';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r).toEqual({ a: { inner: 1 }, b: "tr" });
  });

  // --- Cases where Attempt 1 FAILS and Attempt 2 must use correct depth ---

  it("Attempt 2 needed: truncated after colon in nested object", () => {
    // {"a": 1, "b": {"c":  → Attempt 1 adds }} → {"a": 1, "b": {"c":}} INVALID
    // Attempt 2 slices to last comma (depth=1) → {"a": 1} with 1 closing brace
    const raw = '{"a": 1, "b": {"c":';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r).toEqual({ a: 1 });
  });

  it("Attempt 2 needed: truncated mid-key in nested object", () => {
    // {"a": 1, "b": {"c  → Attempt 1 adds "}} → {"a": 1, "b": {"c"}} INVALID
    // Attempt 2 slices to last comma (depth=1) → {"a": 1} with 1 brace
    const raw = '{"a": 1, "b": {"c';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r).toEqual({ a: 1 });
  });

  it("Attempt 2 with wrong depth would fail: deeply nested after colon", () => {
    // {"x": "ok", "y": {"z": {"w":
    // Attempt 1 → {"x": "ok", "y": {"z": {"w":}}} INVALID
    // Attempt 2 → slice to last comma (depth=1), close with 1 brace → {"x": "ok"}
    // If we used braceDepth(3) instead of lastTopCommaDepth(1), we'd get {"x": "ok"}}} INVALID
    const raw = '{"x": "ok", "y": {"z": {"w":';
    const r = extractJsonFromLlmResponse(raw, "test");
    expect(r).toEqual({ x: "ok" });
  });
});

// ---------------------------------------------------------------------------
// 10. Simulated binary intent e2e
// ---------------------------------------------------------------------------

describe("Binary intent mock e2e", () => {
  it("batch parsing of simulated responses", () => {
    const results: Array<Record<string, unknown>> = [];
    let total = 0;
    let passed = 0;
    let repaired = 0;
    let failed = 0;

    const variants = [
      "clean",
      "truncated_short",
      "truncated_mid",
      "truncated_long",
      "with_thinking",
      "thinking_truncated",
    ] as const;

    for (const msg of SAMPLE_MESSAGES) {
      for (const criteria of SAMPLE_CRITERIA) {
        for (const variant of variants) {
          total++;
          const entry: Record<string, unknown> = {
            message: msg.slice(0, 100),
            criteria: criteria.slice(0, 80),
            variant,
          };

          let raw: string;
          if (variant === "clean") {
            raw = simulateBinaryIntentResponse(msg, criteria);
          } else if (variant === "truncated_short") {
            raw = simulateBinaryIntentResponse(msg, criteria, 30);
          } else if (variant === "truncated_mid") {
            const full = simulateBinaryIntentResponse(msg, criteria);
            raw = simulateBinaryIntentResponse(msg, criteria, Math.floor((full.length * 2) / 3));
          } else if (variant === "truncated_long") {
            const full = simulateBinaryIntentResponse(msg, criteria);
            raw = simulateBinaryIntentResponse(msg, criteria, full.length - 5);
          } else if (variant === "with_thinking") {
            raw = simulateBinaryIntentResponse(msg, criteria, undefined, true);
          } else {
            // thinking_truncated
            const full = simulateBinaryIntentResponse(msg, criteria, undefined, true);
            raw = simulateBinaryIntentResponse(msg, criteria, full.length - 10, true);
          }

          entry.raw_response = raw.slice(0, 200);
          entry.raw_length = raw.length;

          try {
            const parsed = extractJsonFromLlmResponse(raw, "binary_intent_test");
            entry.parsed = true;
            entry.result = parsed.result;
            entry.confidence = parsed.confidence;
            entry.has_reasoning = "reasoning" in parsed;
            entry.keys = Object.keys(parsed);
            if (variant.startsWith("truncated")) repaired++;
            passed++;
          } catch (e) {
            entry.parsed = false;
            entry.error = String(e).slice(0, 200);
            if (variant === "truncated_short") {
              passed++; // short truncations may legitimately fail
            } else {
              failed++;
            }
          }

          results.push(entry);
        }
      }
    }

    // Write report
    const report = {
      summary: { total, passed, repaired, failed },
      results,
    };

    const reportPath = path.join(__dirname, "json_parser_test_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log("\n" + "=".repeat(60));
    console.log("Binary Intent Parser Report (TypeScript)");
    console.log("=".repeat(60));
    console.log(`Total test cases:  ${total}`);
    console.log(`Passed:            ${passed}`);
    console.log(`Repaired:          ${repaired}`);
    console.log(`Failed:            ${failed}`);
    console.log(`Report saved to:   ${reportPath}`);
    console.log("=".repeat(60));

    expect(failed).toBe(0);
  });

  it("exact production failure", () => {
    const raw =
      '{ "result": true, "confidence": "high", "reasoning": "Message directly addresses the bot by';
    const r = extractJsonFromLlmResponse(raw, "binary_intent");
    expect(r.result).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r).toHaveProperty("reasoning");
  });

  it("production failure with thinking", () => {
    const thinking = "<think>" + "x".repeat(2000) + "</think>\n";
    const jsonPart = '{"result": true, "confidence": "high", "reasoning": "The user asked the over';
    const r = extractJsonFromLlmResponse(thinking + jsonPart, "binary_intent");
    expect(r.result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Randomized fuzzing
// ---------------------------------------------------------------------------

describe("Randomized fuzzing", () => {
  it("truncate at every byte position", () => {
    const full = JSON.stringify({
      result: true,
      confidence: "high",
      reasoning: "The message is clearly directed at the bot and requests action",
    });

    let recovered = 0;
    let raised = 0;

    for (let pos = 1; pos < full.length; pos++) {
      const truncated = full.slice(0, pos);
      try {
        const r = extractJsonFromLlmResponse(truncated, "fuzz");
        recovered++;
        if ("result" in r) {
          expect(r.result).toBe(true);
        }
      } catch {
        raised++;
      }
    }

    console.log(`\n[Fuzz] Full length=${full.length}: recovered=${recovered}, raised=${raised}`);
    expect(recovered).toBeGreaterThan(0);
  });
});
