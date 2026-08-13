/**
 * Provider interfaces — the pluggability seam. Phase 0 contract.
 *
 * Every model call in the project goes through these two interfaces.
 * A grep for a hardcoded provider name outside packages/providers/
 * should return nothing.
 *
 * Keys are supplied ONCE, at setup (`trunk init`) or startup — never swapped
 * at runtime.
 */

export interface EmbeddingProvider {
  /** Stable identity, e.g. 'openai:text-embedding-3-small'. Stored in `meta`. */
  readonly id: string;
  /**
   * Vector dimensions. The Atlas vector index is created with this value at
   * `trunk init`, which is why the index must be created AFTER the model is
   * known — that ordering keeps dimensions correct by construction.
   */
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface LLMProvider {
  readonly id: string;
  /**
   * `jsonSchema` requests structured output. Used for fact/hypothesis
   * classification, where free-form text would be unreliable.
   */
  complete(prompt: string, jsonSchema?: unknown): Promise<string>;
}

export type EmbeddingProviderName = "openai" | "voyage" | "azure" | "ollama";
export type LLMProviderName = "openai" | "anthropic" | "azure" | "ollama";

export interface TrunkConfig {
  mongodbUri: string;
  mongodbDb: string;

  embedding: {
    provider: EmbeddingProviderName;
    model: string;
    apiKey?: string;
    endpoint?: string;
  };

  llm: {
    provider: LLMProviderName;
    model: string;
    apiKey?: string;
    endpoint?: string;
  };

  /** Port for the dashboard + read API. */
  port: number;
}

/** Defaults: local Ollama. No key, offline, reproducible for eval, and 768 dims
 *  is half the storage of OpenAI's 1536 on a 512 MB M0 cluster. */
export const DEFAULTS = {
  embedding: { provider: "ollama" as const, model: "nomic-embed-text" },
  llm: { provider: "ollama" as const, model: "llama3.1" },
  mongodbDb: "trunk",
  port: 3000,
} as const;

/** Known embedding dimensions, used to create the index and to sanity-check config. */
export const KNOWN_DIMS: Record<string, number> = {
  "openai:text-embedding-3-small": 1536,
  "openai:text-embedding-3-large": 3072,
  "voyage:voyage-3": 1024,
  "voyage:voyage-3-lite": 512,
  "ollama:nomic-embed-text": 768,
  "ollama:mxbai-embed-large": 1024,
};
