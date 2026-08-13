import type { EmbeddingProvider, TrunkConfig } from "@trunk/core";
import { chunkByCount, joinUrl, providerId, requireKnownEmbeddingDims } from "./helpers.js";
import { postJson, requireArray, requireNumberArray, requireRecord } from "./http.js";

interface EmbeddingOptions {
  readonly provider: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly endpoint?: string;
}

abstract class BatchedEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dims: number;
  protected readonly model: string;

  protected constructor(
    protected readonly options: EmbeddingOptions,
    private readonly batchSize: number,
  ) {
    this.id = providerId(options.provider, options.model);
    this.dims = requireKnownEmbeddingDims(options.provider, options.model);
    this.model = options.model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const vectors: number[][] = [];
    for (const batch of chunkByCount(texts, this.batchSize)) {
      vectors.push(...(await this.embedBatch(batch)));
    }
    return vectors;
  }

  protected abstract embedBatch(texts: readonly string[]): Promise<number[][]>;
}

export class OpenAIEmbeddingProvider extends BatchedEmbeddingProvider {
  constructor(options: Omit<EmbeddingOptions, "provider">) {
    if (!options.apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI embeddings.");
    super({ ...options, provider: "openai" }, 128);
  }

  protected async embedBatch(texts: readonly string[]): Promise<number[][]> {
    const response = requireRecord(
      await postJson(
        "OpenAI embeddings",
        this.options.endpoint ?? "https://api.openai.com/v1/embeddings",
        { model: this.model, input: texts },
        { authorization: `Bearer ${this.options.apiKey}` },
      ),
      "OpenAI embeddings returned a non-object response.",
    );
    return parseOpenAIEmbeddingData(response.data, "OpenAI embeddings");
  }
}

export class AzureEmbeddingProvider extends BatchedEmbeddingProvider {
  constructor(options: Omit<EmbeddingOptions, "provider">) {
    if (!options.apiKey) throw new Error("AZURE_OPENAI_API_KEY is required for Azure embeddings.");
    if (!options.endpoint) throw new Error("AZURE_OPENAI_ENDPOINT is required for Azure embeddings.");
    super({ ...options, provider: "azure" }, 128);
  }

  protected async embedBatch(texts: readonly string[]): Promise<number[][]> {
    const response = requireRecord(
      await postJson(
        "Azure OpenAI embeddings",
        joinUrl(
          this.options.endpoint ?? "",
          `/openai/deployments/${encodeURIComponent(this.model)}/embeddings?api-version=2024-10-21`,
        ),
        { input: texts },
        { "api-key": this.options.apiKey ?? "" },
      ),
      "Azure embeddings returned a non-object response.",
    );
    return parseOpenAIEmbeddingData(response.data, "Azure embeddings");
  }
}

export class VoyageEmbeddingProvider extends BatchedEmbeddingProvider {
  constructor(options: Omit<EmbeddingOptions, "provider">) {
    if (!options.apiKey) throw new Error("VOYAGE_API_KEY is required for Voyage embeddings.");
    super({ ...options, provider: "voyage" }, 128);
  }

  protected async embedBatch(texts: readonly string[]): Promise<number[][]> {
    const response = requireRecord(
      await postJson(
        "Voyage embeddings",
        this.options.endpoint ?? "https://api.voyageai.com/v1/embeddings",
        { model: this.model, input: texts },
        { authorization: `Bearer ${this.options.apiKey}` },
      ),
      "Voyage embeddings returned a non-object response.",
    );
    return parseOpenAIEmbeddingData(response.data, "Voyage embeddings");
  }
}

export class OllamaEmbeddingProvider extends BatchedEmbeddingProvider {
  constructor(options: Omit<EmbeddingOptions, "provider">) {
    super({ ...options, provider: "ollama", endpoint: options.endpoint ?? "http://localhost:11434" }, 32);
  }

  protected async embedBatch(texts: readonly string[]): Promise<number[][]> {
    const response = requireRecord(
      await postJson(
        "Ollama embeddings",
        joinUrl(this.options.endpoint ?? "http://localhost:11434", "/api/embed"),
        { model: this.model, input: texts },
        {},
      ),
      "Ollama embeddings returned a non-object response.",
    );
    if (Array.isArray(response.embeddings)) {
      return response.embeddings.map((embedding) =>
        requireNumberArray(embedding, "Ollama returned a malformed embedding."),
      );
    }
    return parseOpenAIEmbeddingData(response.data, "Ollama embeddings");
  }
}

function parseOpenAIEmbeddingData(value: unknown, provider: string): number[][] {
  return requireArray(value, `${provider} returned no embedding data.`).map((item) => {
    const record = requireRecord(item, `${provider} returned malformed embedding data.`);
    return requireNumberArray(record.embedding, `${provider} returned malformed embedding data.`);
  });
}

export function createEmbeddingProvider(config: TrunkConfig): EmbeddingProvider {
  const common = {
    model: config.embedding.model,
    apiKey: config.embedding.apiKey,
    endpoint: config.embedding.endpoint,
  };
  switch (config.embedding.provider) {
    case "openai":
      return new OpenAIEmbeddingProvider(common);
    case "voyage":
      return new VoyageEmbeddingProvider(common);
    case "azure":
      return new AzureEmbeddingProvider(common);
    case "ollama":
      return new OllamaEmbeddingProvider(common);
    default:
      throw new Error(`Unknown embedding provider: ${String(config.embedding.provider)}`);
  }
}
