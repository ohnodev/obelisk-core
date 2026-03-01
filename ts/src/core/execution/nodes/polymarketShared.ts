import { BaseNode, ExecutionContext } from "../nodeBase";

export const DEFAULT_POLYMARKET_SERVICE_URL = "https://polymarket.theobelisk.ai";
const REQUEST_TIMEOUT_MS = 20_000;

export interface PolymarketRequestResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  error?: string;
}

export function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Valid hex private key: 64 hex chars or 66 with 0x prefix (32 bytes). */
export function isValidHexPrivateKey(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length !== 64 && trimmed.length !== 66) return false;
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return /^[a-fA-F0-9]{64}$/.test(hex);
}

function resolveNodeEnvVar(node: BaseNode, value: unknown): unknown {
  const resolver = (node as unknown as { resolveEnvVar?: (input: unknown) => unknown }).resolveEnvVar;
  return typeof resolver === "function" ? resolver.call(node, value) : value;
}

export function resolvePolymarketBaseUrl(
  node: BaseNode,
  context: ExecutionContext,
  fallback = DEFAULT_POLYMARKET_SERVICE_URL
): string {
  const input = asString(node.getInputValue("base_url", context, ""));
  const metadata = asString(resolveNodeEnvVar(node, node.metadata.base_url ?? ""));
  const env = asString(process.env.POLYMARKET_SERVICE_URL);
  return (input || metadata || env || fallback).replace(/\/$/, "");
}

export async function callPolymarket(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<PolymarketRequestResult> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const apiKey = process.env.POLYMARKET_TRADING_API_KEY;
  const baseHeaders =
    init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
      ? (init.headers as Record<string, string>)
      : {};
  const headers = { ...baseHeaders, ...(apiKey ? { "x-api-key": apiKey } : {}) };
  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const ok = response.ok;
    const status = response.status;

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    let data: Record<string, unknown> = {};
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch (_) {
        data = { raw: text };
      }
    } else {
      data = { raw: text };
    }

    return {
      ok,
      status,
      data,
      error: ok ? undefined : `HTTP ${status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      data: {},
      error: message,
    };
  }
}
