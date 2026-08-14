/**
 * Config loading. Resolution order: CLI flag -> env var -> ~/.trunk/config.json
 *
 * Keys are read from the environment or a gitignored file. They are never
 * committed, never written into MongoDB, and never echoed in tool responses
 * or logs.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULTS,
  type EmbeddingProviderName,
  KNOWN_DIMS,
  type LLMProviderName,
  type TrunkConfig,
} from "./providers.js";

export const CONFIG_PATH = join(homedir(), ".trunk", "config.json");

interface FileConfig {
  mongodb_uri?: string;
  mongodb_db?: string;
  embedding_provider?: string;
  embedding_model?: string;
  llm_provider?: string;
  llm_model?: string;
  port?: number;
}

function readFileConfig(path: string): FileConfig {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FileConfig;
  } catch {
    return {};
  }
}

export interface LoadConfigOptions {
  /** Parsed CLI flags, highest precedence. */
  flags?: Partial<Record<string, string>>;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(opts: LoadConfigOptions = {}): TrunkConfig {
  const env = opts.env ?? process.env;
  const flags = opts.flags ?? {};
  const file = readFileConfig(opts.configPath ?? CONFIG_PATH);

  const pick = (
    flagKey: string,
    envKey: string,
    fileValue: string | undefined,
    fallback: string | undefined,
  ): string | undefined => flags[flagKey] ?? env[envKey] ?? fileValue ?? fallback;

  const mongodbUri = pick(
    "mongodb-uri",
    "TRUNK_MONGODB_URI",
    file.mongodb_uri,
    undefined,
  );
  if (!mongodbUri) {
    throw new Error(
      `No MongoDB connection string. Set TRUNK_MONGODB_URI, pass --mongodb-uri, or run \`trunk init\` to write ${CONFIG_PATH}.`,
    );
  }

  const embeddingProvider = pick(
    "embedding-provider",
    "TRUNK_EMBEDDING_PROVIDER",
    file.embedding_provider,
    DEFAULTS.embedding.provider,
  ) as EmbeddingProviderName;

  const embeddingModel = pick(
    "embedding-model",
    "TRUNK_EMBEDDING_MODEL",
    file.embedding_model,
    DEFAULTS.embedding.model,
  ) as string;

  const llmProvider = pick(
    "llm-provider",
    "TRUNK_LLM_PROVIDER",
    file.llm_provider,
    DEFAULTS.llm.provider,
  ) as LLMProviderName;

  const llmModel = pick(
    "llm-model",
    "TRUNK_LLM_MODEL",
    file.llm_model,
    DEFAULTS.llm.model,
  ) as string;

  const portRaw =
    pick("port", "TRUNK_PORT", file.port?.toString(), String(DEFAULTS.port)) ??
    String(DEFAULTS.port);

  return {
    mongodbUri,
    mongodbDb:
      pick("mongodb-db", "TRUNK_MONGODB_DB", file.mongodb_db, DEFAULTS.mongodbDb) ??
      DEFAULTS.mongodbDb,
    embedding: {
      provider: embeddingProvider,
      model: embeddingModel,
      apiKey: apiKeyFor(embeddingProvider, env),
      endpoint: env.AZURE_OPENAI_ENDPOINT ?? env.OLLAMA_HOST,
    },
    llm: {
      provider: llmProvider,
      model: llmModel,
      apiKey: apiKeyFor(llmProvider, env),
      endpoint: env.AZURE_OPENAI_ENDPOINT ?? env.OLLAMA_HOST,
    },
    port: Number(portRaw),
  };
}

function apiKeyFor(
  provider: EmbeddingProviderName | LLMProviderName,
  env: NodeJS.ProcessEnv,
): string | undefined {
  switch (provider) {
    case "openai":
      return env.OPENAI_API_KEY;
    case "anthropic":
      return env.ANTHROPIC_API_KEY;
    case "voyage":
      return env.VOYAGE_API_KEY;
    case "azure":
      return env.AZURE_OPENAI_API_KEY;
    case "ollama":
      return undefined; // local, no key
    default:
      return undefined;
  }
}

/** Stable provider identity stored in `meta`, e.g. 'ollama:nomic-embed-text'. */
export function providerId(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/** Dimensions for a provider:model pair, when known ahead of a live call. */
export function knownDims(provider: string, model: string): number | undefined {
  return KNOWN_DIMS[providerId(provider, model)];
}
