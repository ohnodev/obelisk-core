/**
 * HTTP client that mirrors the ObeliskLLM.generate() interface.
 * Mirrors Python src/core/execution/nodes/inference/inference_client.py
 *
 * Nodes call model.generate() – they don't care whether 'model' is a local
 * LLM or this HTTP client. Same interface, same return dict.
 */
import { getLogger } from "../../../../utils/logger";
import { LLMGenerationResult, ConversationContext } from "../../../types";

const logger = getLogger("inferenceClient");

export interface InferenceClientOptions {
  endpointUrl?: string;
  timeout?: number;
}

export class InferenceClient {
  static readonly DEFAULT_ENDPOINT =
    process.env.INFERENCE_SERVICE_URL || "http://localhost:7780";

  readonly endpointUrl: string;
  private readonly timeout: number;

  constructor(opts?: InferenceClientOptions) {
    this.endpointUrl =
      opts?.endpointUrl || InferenceClient.DEFAULT_ENDPOINT;
    this.timeout = opts?.timeout || 120_000;
  }

  /**
   * Generate a response from the inference service.
   * Duck-typed to match ObeliskLLM.generate().
   */
  async generate(
    query: string,
    options?: {
      quantumInfluence?: number;
      maxLength?: number;
      conversationContext?: ConversationContext;
      enableThinking?: boolean;
    }
  ): Promise<LLMGenerationResult> {
    const url = `${this.endpointUrl}/inference`;

    const body: Record<string, unknown> = {
      prompt: query,
      enable_thinking: options?.enableThinking ?? true,
    };

    if (options?.maxLength) body.max_tokens = options.maxLength;
    if (options?.quantumInfluence !== undefined)
      body.temperature = options.quantumInfluence;
    if (options?.conversationContext) {
      body.conversation_context = options.conversationContext;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Inference service returned ${res.status}: ${errText}`);
      }

      const data = (await res.json()) as Record<string, unknown>;

      return {
        response: (data.response as string) ?? "",
        thinkingContent: (data.thinking_content as string) ?? undefined,
        source: "inference_service",
        tokensUsed: (data.tokens_used as number) ?? undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Inference request failed: ${msg}`);
      return {
        response: "",
        source: "inference_service",
        error: msg,
      };
    }
  }
}
