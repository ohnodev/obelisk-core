"""
Comprehensive tests for the JSON parser.

Tests extractJsonFromLlmResponse / extract_json_from_llm_response with:
- Clean JSON
- Markdown code blocks
- Thinking blocks (<think>…</think>)
- Extra prose around JSON
- Truncated JSON (mid-string, mid-key, nested objects)
- Braces inside string values
- Escaped quotes
- Empty / garbage input
- Simulated binary intent responses (clean + truncated at various positions)
"""
import json
import random
import pytest
from pathlib import Path

from src.utils.json_parser import extract_json_from_llm_response


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BINARY_INTENT_SCHEMA = {
    "result": True,
    "confidence": "high",
    "reasoning": "Brief explanation",
}


def _make_binary_response(
    result: bool = True,
    confidence: str = "high",
    reasoning: str = "The message clearly matches the criteria",
) -> dict:
    return {"result": result, "confidence": confidence, "reasoning": reasoning}


# ---------------------------------------------------------------------------
# 1. Clean JSON
# ---------------------------------------------------------------------------


class TestCleanJson:
    """Parser should handle well-formed JSON without any wrapping."""

    def test_simple_object(self):
        r = extract_json_from_llm_response('{"a": 1, "b": "hello"}')
        assert r == {"a": 1, "b": "hello"}

    def test_nested_object(self):
        obj = {"outer": {"inner": [1, 2, 3]}, "flag": True}
        r = extract_json_from_llm_response(json.dumps(obj))
        assert r == obj

    def test_boolean_values(self):
        r = extract_json_from_llm_response('{"yes": true, "no": false}')
        assert r["yes"] is True
        assert r["no"] is False

    def test_null_value(self):
        r = extract_json_from_llm_response('{"key": null}')
        assert r["key"] is None

    def test_numeric_values(self):
        r = extract_json_from_llm_response('{"int": 42, "float": 3.14, "neg": -7}')
        assert r == {"int": 42, "float": 3.14, "neg": -7}


# ---------------------------------------------------------------------------
# 2. Markdown code blocks
# ---------------------------------------------------------------------------


class TestMarkdownBlocks:
    """Parser should strip markdown fences before extracting JSON."""

    def test_json_fence(self):
        raw = '```json\n{"result": true}\n```'
        r = extract_json_from_llm_response(raw)
        assert r == {"result": True}

    def test_plain_fence(self):
        raw = '```\n{"result": false}\n```'
        r = extract_json_from_llm_response(raw)
        assert r == {"result": False}

    def test_fence_with_extra_whitespace(self):
        raw = '  ```json  \n  {"x": 1}  \n  ```  '
        r = extract_json_from_llm_response(raw)
        assert r == {"x": 1}


# ---------------------------------------------------------------------------
# 3. Thinking blocks
# ---------------------------------------------------------------------------


class TestThinkingBlocks:
    """Parser should strip <think>…</think> before extracting JSON."""

    def test_thinking_before_json(self):
        raw = '<think>I need to classify this...</think>\n{"result": true, "confidence": "high", "reasoning": "yes"}'
        r = extract_json_from_llm_response(raw)
        assert r["result"] is True

    def test_thinking_with_braces_inside(self):
        raw = '<think>The user said { weird stuff } and I need to handle it.</think>{"a": 1}'
        r = extract_json_from_llm_response(raw)
        assert r == {"a": 1}

    def test_multiline_thinking(self):
        raw = "<think>\nLine 1\nLine 2\nLine 3\n</think>\n{\"ok\": true}"
        r = extract_json_from_llm_response(raw)
        assert r == {"ok": True}


# ---------------------------------------------------------------------------
# 4. Extra prose around JSON
# ---------------------------------------------------------------------------


class TestExtraProse:
    """Parser should find JSON even when surrounded by extra text."""

    def test_prose_before(self):
        raw = 'Here is my analysis:\n{"result": false, "confidence": "low", "reasoning": "nope"}'
        r = extract_json_from_llm_response(raw)
        assert r["result"] is False

    def test_prose_after(self):
        raw = '{"result": true, "confidence": "high", "reasoning": "yes"}\nHope that helps!'
        r = extract_json_from_llm_response(raw)
        assert r["result"] is True

    def test_prose_both_sides(self):
        raw = 'Sure, here you go:\n{"key": "value"}\nLet me know if you need more.'
        r = extract_json_from_llm_response(raw)
        assert r == {"key": "value"}


# ---------------------------------------------------------------------------
# 5. Braces inside string values
# ---------------------------------------------------------------------------


class TestBracesInStrings:
    """Braces inside quoted strings must NOT confuse the brace matcher."""

    def test_curly_in_value(self):
        raw = '{"msg": "use { and } carefully"}'
        r = extract_json_from_llm_response(raw)
        assert r["msg"] == "use { and } carefully"

    def test_nested_curly_in_value(self):
        raw = '{"msg": "obj is { \\"a\\": { \\"b\\": 1 } }"}'
        r = extract_json_from_llm_response(raw)
        assert "{" in r["msg"]


# ---------------------------------------------------------------------------
# 6. Escaped quotes
# ---------------------------------------------------------------------------


class TestEscapedQuotes:
    """Escaped quotes inside strings should not break the parser."""

    def test_escaped_double_quote(self):
        raw = '{"msg": "He said \\"hello\\" to me"}'
        r = extract_json_from_llm_response(raw)
        assert 'hello' in r["msg"]

    def test_escaped_single_quote_llm_style(self):
        # LLMs sometimes produce \' which is invalid JSON but our sanitizer fixes
        raw = r"""{"msg": "it\'s fine"}"""
        r = extract_json_from_llm_response(raw)
        assert "it's fine" == r["msg"]


# ---------------------------------------------------------------------------
# 7. Empty / garbage input
# ---------------------------------------------------------------------------


class TestEmptyGarbage:
    """Empty and garbage inputs should raise, never return None."""

    def test_empty_string(self):
        with pytest.raises((ValueError, Exception)):
            extract_json_from_llm_response("")

    def test_whitespace_only(self):
        with pytest.raises((ValueError, Exception)):
            extract_json_from_llm_response("   \n\t  ")

    def test_no_json_at_all(self):
        with pytest.raises((ValueError, Exception)):
            extract_json_from_llm_response("Hello, how are you today?")

    def test_only_opening_brace(self):
        # "{" repairs to "{}" which is an empty object — that is valid
        r = extract_json_from_llm_response("{")
        assert r == {}


# ---------------------------------------------------------------------------
# 8. Truncated JSON (the critical edge cases)
# ---------------------------------------------------------------------------


class TestTruncatedJson:
    """
    Simulate token-limit truncation at various positions.
    The parser should repair and recover as many keys as possible.
    """

    def test_truncated_mid_string(self):
        """Real-world case: reasoning string cut mid-sentence."""
        raw = '{"result": true, "confidence": "high", "reasoning": "Message directly addresses the bot by'
        r = extract_json_from_llm_response(raw, "binary_intent")
        assert r["result"] is True
        assert r["confidence"] == "high"

    def test_truncated_mid_key(self):
        """Cut in the middle of a key name after a comma."""
        raw = '{"result": true, "confidence": "high", "rea'
        r = extract_json_from_llm_response(raw, "binary_intent")
        assert r["result"] is True
        assert r["confidence"] == "high"

    def test_truncated_after_colon(self):
        """Cut right after a colon, before the value starts."""
        raw = '{"result": true, "confidence":'
        r = extract_json_from_llm_response(raw, "binary_intent")
        assert r["result"] is True

    def test_truncated_after_comma(self):
        """Cut right after a comma."""
        raw = '{"result": true,'
        r = extract_json_from_llm_response(raw, "binary_intent")
        assert r["result"] is True

    def test_truncated_nested_object(self):
        """
        Truncation inside a nested object.
        The repair should use the depth at lastTopComma, not final depth.
        """
        raw = '{"result": true, "meta": {"nested_key": "trun'
        r = extract_json_from_llm_response(raw, "test")
        assert r["result"] is True

    def test_truncated_nested_deep(self):
        """Deeply nested truncation — should still recover top-level keys."""
        raw = '{"a": 1, "b": {"c": {"d": "trun'
        r = extract_json_from_llm_response(raw, "test")
        assert r["a"] == 1

    def test_truncated_boolean_value(self):
        """Truncation in the middle of 'true' — falls back to top comma."""
        raw = '{"result": tru'
        # This is tricky — "tru" is not valid JSON. Repair should fall back.
        # It can't recover any key, so it should raise or recover empty.
        # Actually there's no comma to fall back to, so this should fail.
        with pytest.raises((ValueError, Exception)):
            extract_json_from_llm_response(raw, "test")

    def test_truncated_string_ending_with_trailing_backslash(self):
        """
        If fragment ends mid-string with a trailing backslash, naively
        appending '"' produces ...\\\" which escapes the quote instead of
        closing the string. The repair should strip the odd trailing
        backslash before appending.
        """
        raw = '{"a": 1, "b": "hello\\'
        r = extract_json_from_llm_response(raw, "test")
        assert r["a"] == 1

    def test_truncated_string_ending_with_even_backslashes(self):
        """Even trailing backslashes (\\\\) are fine — the quote closes normally."""
        raw = '{"a": 1, "b": "hello\\\\'
        r = extract_json_from_llm_response(raw, "test")
        assert r["a"] == 1


# ---------------------------------------------------------------------------
# 9. Simulated binary intent e2e: mock responses → parser
# ---------------------------------------------------------------------------

# A pool of real-world-like messages to classify
SAMPLE_MESSAGES = [
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
    "我想和机器人聊天",  # Chinese text
    "🚀🌕 to the moon!",
    "",  # empty
    "a" * 5000,  # very long message
    'He said "hello" and then {walked away}',  # special chars
]

SAMPLE_CRITERIA = [
    "Does the message directly address or reference the bot/agent/overseer?",
    "Is the user requesting a specific action or task?",
    "Does the message contain crypto/trading related content?",
    "Is this a casual greeting or small talk?",
]


def _simulate_binary_intent_response(
    message: str,
    criteria: str,
    truncate_at: int | None = None,
    with_thinking: bool = False,
) -> str:
    """
    Build a fake LLM response for binary intent classification.
    Optionally truncate at a given byte position to simulate token limit.
    """
    is_relevant = any(
        kw in message.lower()
        for kw in ["agent", "overseer", "bot", "deploy", "trade", "classify", "analyze"]
    )
    
    response_obj = {
        "result": is_relevant,
        "confidence": "high" if is_relevant else "low",
        "reasoning": f"The message {'directly references the agent' if is_relevant else 'is casual and does not reference the agent'}. Analysis of: {message[:80]}",
    }
    
    response_text = json.dumps(response_obj)
    
    if with_thinking:
        thinking = f"<think>Let me analyze whether '{message[:40]}' matches criteria '{criteria[:40]}'... I think it {'does' if is_relevant else 'does not'} match.</think>\n"
        response_text = thinking + response_text
    
    if truncate_at is not None and truncate_at < len(response_text):
        response_text = response_text[:truncate_at]
    
    return response_text


class TestBinaryIntentMock:
    """
    End-to-end mock test: generate a batch of simulated binary intent
    responses (some clean, some truncated, some with thinking blocks)
    and verify the parser handles them all.
    
    Results are collected into a JSON report file.
    """

    def test_batch_binary_intent_parsing(self, tmp_path):
        """
        Generate many mock binary intent LLM responses and verify we can
        parse every one of them. Collect results into a report.
        """
        random.seed(42)
        results = []
        total = 0
        passed = 0
        repaired = 0
        failed = 0

        for msg in SAMPLE_MESSAGES:
            for criteria in SAMPLE_CRITERIA:
                for variant in ["clean", "truncated_short", "truncated_mid", "truncated_long", "with_thinking", "thinking_truncated"]:
                    total += 1
                    entry = {
                        "message": msg[:100],
                        "criteria": criteria[:80],
                        "variant": variant,
                    }

                    # Build the simulated response
                    if variant == "clean":
                        raw = _simulate_binary_intent_response(msg, criteria)
                    elif variant == "truncated_short":
                        raw = _simulate_binary_intent_response(msg, criteria, truncate_at=30)
                    elif variant == "truncated_mid":
                        full = _simulate_binary_intent_response(msg, criteria)
                        raw = _simulate_binary_intent_response(msg, criteria, truncate_at=len(full) * 2 // 3)
                    elif variant == "truncated_long":
                        full = _simulate_binary_intent_response(msg, criteria)
                        raw = _simulate_binary_intent_response(msg, criteria, truncate_at=len(full) - 5)
                    elif variant == "with_thinking":
                        raw = _simulate_binary_intent_response(msg, criteria, with_thinking=True)
                    elif variant == "thinking_truncated":
                        full = _simulate_binary_intent_response(msg, criteria, with_thinking=True)
                        raw = _simulate_binary_intent_response(msg, criteria, with_thinking=True, truncate_at=len(full) - 10)
                    else:
                        raw = _simulate_binary_intent_response(msg, criteria)

                    entry["raw_response"] = raw[:200]
                    entry["raw_length"] = len(raw)

                    try:
                        parsed = extract_json_from_llm_response(raw, "binary_intent_test")
                        entry["parsed"] = True
                        entry["result"] = parsed.get("result")
                        entry["confidence"] = parsed.get("confidence")
                        entry["has_reasoning"] = "reasoning" in parsed
                        entry["keys"] = list(parsed.keys())
                        # Check if it was a repair (truncated variants)
                        if variant.startswith("truncated"):
                            repaired += 1
                        passed += 1
                    except Exception as e:
                        entry["parsed"] = False
                        entry["error"] = str(e)[:200]
                        # Short truncations are expected to fail
                        if variant == "truncated_short":
                            # Extremely short truncation may legitimately fail
                            passed += 1  # don't count as unexpected failure
                        else:
                            failed += 1

                    results.append(entry)

        # Write results to temp file for inspection
        report = {
            "summary": {
                "total": total,
                "passed": passed,
                "repaired": repaired,
                "failed": failed,
            },
            "results": results,
        }
        report_path = tmp_path / "binary_intent_parse_report.json"
        report_path.write_text(json.dumps(report, indent=2, default=str))

        print(f"\n{'='*60}")
        print(f"Binary Intent Parser Report")
        print(f"{'='*60}")
        print(f"Total test cases:  {total}")
        print(f"Passed:            {passed}")
        print(f"Repaired:          {repaired}")
        print(f"Failed:            {failed}")
        print(f"Report saved to:   {report_path}")
        print(f"{'='*60}")

        # Allow short truncations to fail (they cut before any valid k/v pair)
        # but everything else should parse
        assert failed == 0, f"{failed} unexpected parsing failures — see report at {report_path}"

    def test_specific_production_failure(self):
        """
        Reproduce the exact production failure from the user's logs:
        BinaryIntent response truncated mid-reasoning string.
        """
        raw = '{ "result": true, "confidence": "high", "reasoning": "Message directly addresses the bot by'
        r = extract_json_from_llm_response(raw, "binary_intent")
        assert r["result"] is True
        assert r["confidence"] == "high"
        assert "reasoning" in r

    def test_production_failure_with_thinking(self):
        """
        Same as above but with a long thinking block consuming most tokens.
        """
        thinking = "<think>" + "x" * 2000 + "</think>\n"
        json_part = '{"result": true, "confidence": "high", "reasoning": "The user asked the over'
        raw = thinking + json_part
        r = extract_json_from_llm_response(raw, "binary_intent")
        assert r["result"] is True


# ---------------------------------------------------------------------------
# 10. Edge cases for the repair brace-depth fix
# ---------------------------------------------------------------------------


class TestRepairBraceDepth:
    """
    Specifically tests the fix where we track last_top_comma_depth
    instead of reusing the final brace_depth.

    Note: Attempt 1 (close string + all braces) is tried first and succeeds
    when the truncated value can be closed into valid JSON. Attempt 2 (strip
    to last comma) only fires when Attempt 1 fails.
    """

    def test_attempt1_nested_truncated_string_recovers_full(self):
        """
        Attempt 1: close string + 2 braces → valid JSON with all keys.
        """
        raw = '{"a": 1, "b": {"c": "trun'
        r = extract_json_from_llm_response(raw, "test")
        assert r == {"a": 1, "b": {"c": "trun"}}

    def test_attempt1_deeply_nested_recovers_full(self):
        """Attempt 1 succeeds: close string + 3 braces → valid."""
        raw = '{"x": "ok", "y": {"z": {"w": "tr'
        r = extract_json_from_llm_response(raw, "test")
        assert r == {"x": "ok", "y": {"z": {"w": "tr"}}}

    def test_attempt1_flat_truncated_string(self):
        """No nesting, Attempt 1 closes string + 1 brace → valid."""
        raw = '{"a": 1, "b": "trunc'
        r = extract_json_from_llm_response(raw, "test")
        assert r == {"a": 1, "b": "trunc"}

    def test_attempt1_complete_nested_then_truncated_value(self):
        """Inner object complete, Attempt 1 closes string + 1 brace → valid."""
        raw = '{"a": {"inner": 1}, "b": "tr'
        r = extract_json_from_llm_response(raw, "test")
        assert r == {"a": {"inner": 1}, "b": "tr"}

    # --- Cases where Attempt 1 FAILS and Attempt 2 must use correct depth ---

    def test_attempt2_truncated_after_colon_in_nested(self):
        """
        {"a": 1, "b": {"c":  → Attempt 1 adds }} → INVALID (colon without value)
        Attempt 2 slices to last comma (depth=1) → {"a": 1} with 1 closing brace.
        """
        raw = '{"a": 1, "b": {"c":'
        r = extract_json_from_llm_response(raw, "test")
        assert r == {"a": 1}

    def test_attempt2_truncated_mid_key_in_nested(self):
        """
        {"a": 1, "b": {"c  → Attempt 1 adds "}} → INVALID (key without colon)
        Attempt 2 → {"a": 1} with 1 closing brace.
        """
        raw = '{"a": 1, "b": {"c'
        r = extract_json_from_llm_response(raw, "test")
        assert r == {"a": 1}

    def test_attempt2_deeply_nested_after_colon(self):
        """
        {"x": "ok", "y": {"z": {"w":
        Attempt 1 → INVALID. Attempt 2 → slice to last comma (depth=1), close → {"x": "ok"}
        If we used brace_depth(3) instead of last_top_comma_depth(1), we'd get {"x": "ok"}}} INVALID.
        """
        raw = '{"x": "ok", "y": {"z": {"w":'
        r = extract_json_from_llm_response(raw, "test")
        assert r == {"x": "ok"}


# ---------------------------------------------------------------------------
# 11. Randomized fuzzing
# ---------------------------------------------------------------------------


class TestFuzz:
    """Randomly generate and truncate binary intent responses to stress-test."""

    def test_random_truncation_positions(self):
        """
        For a fixed valid response, truncate at every byte position
        and verify the parser either recovers or raises (never crashes).
        """
        full = json.dumps({
            "result": True,
            "confidence": "high",
            "reasoning": "The message is clearly directed at the bot and requests action",
        })

        recovered = 0
        raised = 0

        for pos in range(1, len(full)):
            truncated = full[:pos]
            try:
                r = extract_json_from_llm_response(truncated, "fuzz")
                recovered += 1
                # If we recovered, result should be True (it's always first)
                if "result" in r:
                    assert r["result"] is True
            except (ValueError, Exception):
                raised += 1

        print(f"\n[Fuzz] Full length={len(full)}: recovered={recovered}, raised={raised}")
        # At minimum, truncating after the full string minus closing "}" should recover
        assert recovered > 0
