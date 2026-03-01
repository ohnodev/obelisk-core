import { BaseNode, ExecutionContext } from "../nodeBase";
import { Wallet } from "ethers";

export const DEFAULT_BASEMARKET_API = "http://127.0.0.1:2110";
const REQUEST_TIMEOUT_MS = 20_000;

function mergeAbortSignals(userSignal?: AbortSignal | null, timeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  if (userSignal.aborted || timeoutSignal.aborted) {
    controller.abort(userSignal.aborted ? userSignal.reason : timeoutSignal.reason);
    return controller.signal;
  }
  const cleanup = () => {
    userSignal.removeEventListener("abort", onUserAbort);
    timeoutSignal.removeEventListener("abort", onTimeoutAbort);
  };
  const doAbort = (reason?: unknown) => {
    cleanup();
    controller.abort(reason);
  };
  const onUserAbort = () => doAbort(userSignal.reason);
  const onTimeoutAbort = () => doAbort(timeoutSignal.reason);
  userSignal.addEventListener("abort", onUserAbort);
  timeoutSignal.addEventListener("abort", onTimeoutAbort);
  return controller.signal;
}

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

function resolveNodeEnvVar(node: BaseNode, value: unknown): unknown {
  const resolver = (node as unknown as { resolveEnvVar?: (input: unknown) => unknown }).resolveEnvVar;
  return typeof resolver === "function" ? resolver.call(node, value) : value;
}

export function resolveBaseUrl(
  node: BaseNode,
  context: ExecutionContext,
  fallback = DEFAULT_BASEMARKET_API
): string {
  const input = asString(node.getInputValue("base_url", context, ""));
  const metadata = asString(resolveNodeEnvVar(node, node.metadata.base_url ?? ""));
  const env = asString(process.env.BASEMARKET_API_URL);
  return (input || metadata || env || fallback).replace(/\/$/, "");
}

export function resolveUserAddress(node: BaseNode, context: ExecutionContext): string {
  const input = asString(node.getInputValue("user_address", context, ""));
  const metadata = asString(resolveNodeEnvVar(node, node.metadata.user_address ?? ""));
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
  const metadata = asString(resolveNodeEnvVar(node, node.metadata.private_key ?? ""));
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
      signal: mergeAbortSignals(init.signal, REQUEST_TIMEOUT_MS),
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
