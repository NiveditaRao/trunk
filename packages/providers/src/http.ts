import { isRetryableStatus, retryDelays } from "./helpers.js";

export interface JsonObject {
  readonly [key: string]: unknown;
}

export class ProviderHttpError extends Error {
  constructor(
    provider: string,
    status: number,
    body: string,
  ) {
    super(`${provider} request failed with HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "ProviderHttpError";
  }
}

const DEFAULT_DELAYS = retryDelays(3, 500, 4_000);

function redactHeaders(headers: HeadersInit): HeadersInit {
  return headers;
}

export async function postJson(
  provider: string,
  url: string,
  body: JsonObject,
  headers: HeadersInit,
  retryMs: readonly number[] = DEFAULT_DELAYS,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryMs.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...redactHeaders(headers),
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) {
        return text.length === 0 ? {} : (JSON.parse(text) as unknown);
      }
      if (!isRetryableStatus(response.status) || attempt === retryMs.length) {
        throw new ProviderHttpError(provider, response.status, text);
      }
      lastError = new ProviderHttpError(provider, response.status, text);
    } catch (error) {
      if (attempt === retryMs.length) {
        throw error;
      }
      lastError = error;
    }
    const delay = retryMs[attempt];
    if (delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`${provider} request failed after retries: ${String(lastError)}`);
}

export function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

export function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

export function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

export function requireNumberArray(value: unknown, message: string): number[] {
  const array = requireArray(value, message);
  return array.map((item) => {
    if (typeof item !== "number") {
      throw new Error(message);
    }
    return item;
  });
}
