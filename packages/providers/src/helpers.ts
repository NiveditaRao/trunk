export type ProviderName = "openai" | "voyage" | "azure" | "ollama" | "anthropic";

const DIMENSIONS: Readonly<Record<string, number>> = {
  "openai:text-embedding-3-small": 1536,
  "openai:text-embedding-3-large": 3072,
  "azure:text-embedding-3-small": 1536,
  "azure:text-embedding-3-large": 3072,
  "voyage:voyage-3": 1024,
  "voyage:voyage-3-lite": 512,
  "ollama:nomic-embed-text": 768,
  "ollama:mxbai-embed-large": 1024,
};

export function providerId(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export function parseProviderId(id: string): { provider: string; model: string } {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) {
    throw new Error(`Invalid provider id "${id}". Expected "provider:model".`);
  }
  return {
    provider: id.slice(0, separator),
    model: id.slice(separator + 1),
  };
}

export function knownEmbeddingDims(provider: string, model: string): number | undefined {
  return DIMENSIONS[providerId(provider, model)];
}

export function requireKnownEmbeddingDims(provider: string, model: string): number {
  const dims = knownEmbeddingDims(provider, model);
  if (dims === undefined) {
    throw new Error(
      `Unknown embedding dimensions for ${provider}:${model}. Use a known model or add its dimensions before running trunk init, because Atlas vector indexes are fixed-width.`,
    );
  }
  return dims;
}

export function chunkByCount<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("Batch size must be a positive integer.");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function retryDelays(maxRetries: number, baseMs: number, maxMs: number): number[] {
  if (maxRetries < 0 || baseMs < 1 || maxMs < 1) {
    throw new Error("Retry values must be positive.");
  }
  const delays: number[] = [];
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    delays.push(Math.min(maxMs, baseMs * 2 ** attempt));
  }
  return delays;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
