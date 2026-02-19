/**
 * Tests for individual node implementations.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { registerAllNodes } from "../src/core/execution/nodeRegistry";
import { ExecutionContext } from "../src/core/execution/nodeBase";
import { TextNode } from "../src/core/execution/nodes/text";
import { SchedulerNode } from "../src/core/execution/nodes/scheduler";
import { InferenceConfigNode } from "../src/core/execution/nodes/inferenceConfig";
import { InferenceClient } from "../src/core/execution/nodes/inference/inferenceClient";
import { splitThinkingTokens } from "../src/core/execution/nodes/inference/thinkingTokenUtils";

beforeAll(() => {
  registerAllNodes();
});

function makeContext(
  variables: Record<string, unknown> = {},
  nodeOutputs: Record<string, Record<string, unknown>> = {}
): ExecutionContext {
  return { variables, nodeOutputs };
}

describe("TextNode", () => {
  it("should output direct text input", () => {
    const node = new TextNode("t1", {
      id: "t1",
      type: "text",
      inputs: { text: "hello" },
    });
    const result = node.execute(makeContext());
    expect(result.text).toBe("hello");
  });

  it("should output text from metadata", () => {
    const node = new TextNode("t2", {
      id: "t2",
      type: "text",
      inputs: {},
      metadata: { text: "from metadata" },
    });
    const result = node.execute(makeContext());
    expect(result.text).toBe("from metadata");
  });

  it("should resolve template variables", () => {
    const node = new TextNode("t3", {
      id: "t3",
      type: "text",
      inputs: { text: "{{name}}" },
    });
    const result = node.execute(makeContext({ name: "Obelisk" }));
    expect(result.text).toBe("Obelisk");
  });

  it("should prefer connected input over direct", () => {
    const node = new TextNode("t4", {
      id: "t4",
      type: "text",
      inputs: { text: "fallback" },
    });
    // Wire a connection
    node.inputConnections = {
      text: [{ nodeId: "upstream", outputName: "text" }],
    };
    const ctx = makeContext({}, { upstream: { text: "connected" } });
    const result = node.execute(ctx);
    expect(result.text).toBe("connected");
  });

  it("should return empty string when no input", () => {
    const node = new TextNode("t5", {
      id: "t5",
      type: "text",
      inputs: {},
    });
    const result = node.execute(makeContext());
    expect(result.text).toBe("");
  });
});

describe("SchedulerNode", () => {
  beforeEach(() => {
    SchedulerNode.resetAll();
  });

  it("should seed timing on first execute (trigger=false)", () => {
    const node = new SchedulerNode("s1", {
      id: "s1",
      type: "scheduler",
      inputs: {},
      metadata: { interval_seconds: 60 },
    });
    // execute() seeds timing — actual triggering is via onTick()
    const result = node.execute(makeContext());
    expect(result.trigger).toBe(false);
    expect(result.tick_count).toBe(0);
  });

  it("should fire on onTick when interval has elapsed", () => {
    const node = new SchedulerNode("s1b", {
      id: "s1b",
      type: "scheduler",
      inputs: {},
      metadata: { min_seconds: 0, max_seconds: 0 }, // fire immediately
    });
    // Seed timing via execute
    node.execute(makeContext());
    // onTick should fire (interval is 0)
    const tick = node.onTick(makeContext());
    expect(tick).not.toBeNull();
    expect(tick!.trigger).toBe(true);
  });

  it("should not fire again immediately", () => {
    const node = new SchedulerNode("s2", {
      id: "s2",
      type: "scheduler",
      inputs: {},
      metadata: { interval_seconds: 9999 },
    });
    node.execute(makeContext()); // first fire
    const result = node.execute(makeContext()); // should not fire again
    expect(result.trigger).toBe(false);
  });
});

describe("InferenceConfigNode", () => {
  it("should create an InferenceClient with default endpoint", () => {
    const node = new InferenceConfigNode("ic1", {
      id: "ic1",
      type: "inference_config",
      inputs: {},
      metadata: { use_default: true },
    });
    const result = node.execute(makeContext());
    expect(result.model).toBeDefined();
    const out = result.model as { model?: InferenceClient; agent_id?: string };
    const client = out?.model ?? result.model;
    expect(client).toBeInstanceOf(InferenceClient);
    expect((client as InferenceClient).endpointUrl).toContain("7780");
  });

  it("should create an InferenceClient with custom endpoint and optional agent_id", () => {
    const node = new InferenceConfigNode("ic2", {
      id: "ic2",
      type: "inference_config",
      inputs: {},
      metadata: {
        use_default: false,
        endpoint_url: "http://my-inference:8000",
        agent_id: "clawballs",
      },
    });
    const result = node.execute(makeContext());
    const out = result.model as { model?: InferenceClient; agent_id?: string };
    const client = out?.model ?? result.model;
    expect(client).toBeInstanceOf(InferenceClient);
    expect((client as InferenceClient).endpointUrl).toBe("http://my-inference:8000");
    expect(out?.agent_id).toBe("clawballs");
  });
});

describe("splitThinkingTokens", () => {
  const END_TOKEN = 151668;

  it("should split on end token", () => {
    const tokens = [1, 2, 3, END_TOKEN, 4, 5];
    const [thinking, content] = splitThinkingTokens(tokens);
    expect(thinking).toEqual([1, 2, 3]);
    expect(content).toEqual([4, 5]);
  });

  it("should return all as content when no end token", () => {
    const tokens = [1, 2, 3];
    const [thinking, content] = splitThinkingTokens(tokens);
    expect(thinking).toEqual([]);
    expect(content).toEqual([1, 2, 3]);
  });

  it("should handle empty array", () => {
    const [thinking, content] = splitThinkingTokens([]);
    expect(thinking).toEqual([]);
    expect(content).toEqual([]);
  });

  it("should handle end token at the beginning", () => {
    const tokens = [END_TOKEN, 1, 2];
    const [thinking, content] = splitThinkingTokens(tokens);
    expect(thinking).toEqual([]);
    expect(content).toEqual([1, 2]);
  });
});
