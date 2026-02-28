import { BaseNode, ExecutionContext } from "../nodeBase";
import { Wallet } from "ethers";

export const DEFAULT_BASEMARKET_API = "http://127.0.0.1:2110";
const REQUEST_TIMEOUT_MS = 20_000;

export interface BasemarketRequestResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  error?: string;
}

export function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function resolveBaseUrl(
  node: BaseNode,
  context: ExecutionContext,
  fallback = DEFAULT_BASEMARKET_API
): string {
  const input = asString(node.getInputValue("base_url", context, ""));
  const metadata = asString(node.metadata.base_url);
  const env = asString(process.env.BASEMARKET_API_URL);
  return (input || metadata || env || fallback).replace(/\/$/, "");
}

export function resolveUserAddress(node: BaseNode, context: ExecutionContext): string {
  const input = asString(node.getInputValue("user_address", context, ""));
  const metadata = asString(node.metadata.user_address);
  const env = asString(process.env.BASEMARKET_USER_ADDRESS);
  if (input || metadata || env) {
    return input || metadata || env;
  }

  const privateKey = resolvePrivateKey(node, context);
  if (!privateKey) return "";
  try {
    return new Wallet(privateKey).address;
  } catch {
    return "";
  }
}

export function resolvePrivateKey(node: BaseNode, context: ExecutionContext): string {
  const input = asString(node.getInputValue("private_key", context, ""));
  const metadata = asString(node.metadata.private_key);
  const env = asString(process.env.SWAP_PRIVATE_KEY);
  return input || metadata || env;
}

export async function callBasemarket(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<BasemarketRequestResult> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const contentType = response.headers.get("content-type") ?? "";
    let data: Record<string, unknown> = {};
    if (contentType.includes("application/json")) {
      data = (await response.json()) as Record<string, unknown>;
    } else {
      const text = await response.text();
      data = { raw: text };
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : `HTTP ${response.status}`,
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
