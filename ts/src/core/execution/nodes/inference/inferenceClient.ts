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

  // Quantum influence → sampling parameter mapping (mirrors Python)
  private static readonly TEMPERATURE_BASE = 0.6;
  private static readonly TOP_P_BASE = 0.95;
  private static readonly TOP_K = 20;
  private static readonly REPETITION_PENALTY = 1.2;
  private static readonly QUANTUM_TEMP_RANGE = 0.1;
  private static readonly QUANTUM_TOP_P_RANGE = 0.05;

  constructor(opts?: InferenceClientOptions) {
    this.endpointUrl =
      opts?.endpointUrl || InferenceClient.DEFAULT_ENDPOINT;
    this.timeout = opts?.timeout || 120_000;
  }

  /** Convert quantum_influence to sampling parameters (mirrors Python) */
  private quantumToSamplingParams(quantumInfluence: number): {
    quantumInfluence: number;
    temperature: number;
    topP: number;
  } {
    // Python clamps to [0, 0.1] — the "quantum_influence" UI slider range
    const qi = Math.max(0.0, Math.min(0.1, quantumInfluence));
    let temperature = InferenceClient.TEMPERATURE_BASE + qi * InferenceClient.QUANTUM_TEMP_RANGE;
    let topP = InferenceClient.TOP_P_BASE + qi * InferenceClient.QUANTUM_TOP_P_RANGE;
    temperature = Math.max(0.1, Math.min(0.9, temperature));
    topP = Math.max(0.01, Math.min(1.0, topP));
    return { quantumInfluence: qi, temperature, topP };
  }

  /**
   * Generate a response from the inference service.
   * Same signature as Python InferenceClient.generate() so nodes work unchanged.
   */
  async generate(
    query: string,
    systemPrompt: string = "",
    quantumInfluence: number = 0.7,
    maxLength: number = 1024,
    conversationHistory?: Array<Record<string, string>> | null,
    enableThinking: boolean = true
  ): Promise<LLMGenerationResult> {
    const url = `${this.endpointUrl}/v1/inference`;
    const sampling = this.quantumToSamplingParams(quantumInfluence);

    const body: Record<string, unknown> = {
      query,
      system_prompt: systemPrompt,
      enable_thinking: enableThinking,
      max_tokens: maxLength,
      temperature: sampling.temperature,
      top_p: sampling.topP,
      top_k: InferenceClient.TOP_K,
      repetition_penalty: InferenceClient.REPETITION_PENALTY,
    };

    if (conversationHistory) {
      body.conversation_history = conversationHistory;
    }

    logger.info(
      `Calling inference service: ${url} (query=${query.length} chars, system_prompt=${systemPrompt.length} chars, temp=${sampling.temperature.toFixed(2)}, thinking=${enableThinking})`
    );

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      controller = new AbortController();
      timer = setTimeout(() => controller!.abort(), this.timeout);

      const startTime = Date.now();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Inference service returned ${res.status}: ${errText}`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      const elapsed = Date.now() - startTime;
      const genParams = (data.generation_params as Record<string, unknown>) ?? {};

      const responseText = (data.response as string) ?? "";
      const tokensUsed =
        ((data.input_tokens as number) ?? 0) +
        ((data.output_tokens as number) ?? 0);

      logger.info(
        `Inference response: ${elapsed}ms, ${tokensUsed} tokens, response=${responseText.length} chars`
      );

      return {
        response: responseText,
        thinkingContent: (data.thinking_content as string) ?? undefined,
        source: (data.source as string) ?? "inference_service",
        tokensUsed,
        temperature: (genParams.temperature as number) ?? sampling.temperature,
        topP: (genParams.top_p as number) ?? sampling.topP,
        quantumInfluence: sampling.quantumInfluence,
        error: (data.error as string) ?? undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Inference request failed: ${msg}`);
      return {
        response: "",
        source: "inference_service",
        error: msg,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
