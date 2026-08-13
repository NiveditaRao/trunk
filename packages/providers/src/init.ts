import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cancel, confirm, intro, isCancel, outro, password, select, text } from "@clack/prompts";
import {
  CONFIG_PATH,
  connect,
  DEFAULTS,
  loadConfig,
  META_ID,
  TEXT_INDEX,
  VECTOR_INDEX,
  type Memory,
  type TrunkConfig,
  type TrunkDb,
} from "@trunk/core";
import { Command } from "commander";
import { createEmbeddingProvider } from "./embeddings.js";
import { providerId } from "./helpers.js";
import { createLLMProvider } from "./llm.js";

interface InitOptions {
  readonly mongodbUri?: string;
  readonly mongodbDb?: string;
  readonly embeddingProvider?: string;
  readonly embeddingModel?: string;
  readonly llmProvider?: string;
  readonly llmModel?: string;
  readonly nonInteractive?: boolean;
  readonly reembed?: boolean;
  readonly skipValidate?: boolean;
  readonly configPath?: string;
}

type SearchIndexDefinition = Record<string, unknown>;

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("trunk")
    .description("Trunk provider setup")
    .command("init")
    .option("--mongodb-uri <uri>")
    .option("--mongodb-db <db>")
    .option("--embedding-provider <provider>")
    .option("--embedding-model <model>")
    .option("--llm-provider <provider>")
    .option("--llm-model <model>")
    .option("--non-interactive")
    .option("--reembed")
    .option("--skip-validate", "author adapters without making provider validation calls")
    .action(async (options: InitOptions) => {
      await init(options);
    });
  await program.parseAsync(argv);
}

export async function init(options: InitOptions): Promise<void> {
  const selected = options.nonInteractive ? nonInteractiveOptions(options) : await interactiveOptions(options);
  const config = loadConfig({
    configPath: selected.configPath,
    flags: {
      "mongodb-uri": selected.mongodbUri,
      "mongodb-db": selected.mongodbDb,
      "embedding-provider": selected.embeddingProvider,
      "embedding-model": selected.embeddingModel,
      "llm-provider": selected.llmProvider,
      "llm-model": selected.llmModel,
    },
  });
  const embeddings = createEmbeddingProvider(config);
  createLLMProvider(config);

  if (!selected.skipValidate) {
    await validateEmbeddingProvider(embeddings);
  }

  const trunk = await connect(config);
  try {
    if (selected.reembed) {
      await rebuildForProviderChange(trunk, config, embeddings);
    } else {
      await createIndexesThenRecordMeta(trunk, config, embeddings.dims);
    }
    await writeConfig(selected.configPath ?? CONFIG_PATH, config);
  } finally {
    await trunk.close();
  }
}

async function interactiveOptions(options: InitOptions): Promise<InitOptions> {
  intro("Trunk init");
  const mongodbUri = await promptSecret("MongoDB URI", options.mongodbUri);
  const embeddingProvider = await promptSelect("Embedding provider", options.embeddingProvider, [
    "ollama",
    "openai",
    "voyage",
    "azure",
  ]);
  const embeddingModel = await promptText(
    "Embedding model",
    options.embeddingModel ?? (embeddingProvider === "ollama" ? DEFAULTS.embedding.model : undefined),
  );
  const llmProvider = await promptSelect("LLM provider", options.llmProvider, [
    "ollama",
    "openai",
    "anthropic",
    "azure",
  ]);
  const llmModel = await promptText(
    "LLM model",
    options.llmModel ?? (llmProvider === "ollama" ? DEFAULTS.llm.model : undefined),
  );
  const reembed = options.reembed ?? (await promptConfirm("Re-embed existing memories?", false));
  outro("Configuration selected.");
  return {
    ...options,
    mongodbUri,
    embeddingProvider,
    embeddingModel,
    llmProvider,
    llmModel,
    reembed,
  };
}

function nonInteractiveOptions(options: InitOptions): InitOptions {
  return {
    ...options,
    mongodbUri: options.mongodbUri ?? process.env.TRUNK_MONGODB_URI,
    mongodbDb: options.mongodbDb ?? process.env.TRUNK_MONGODB_DB,
    embeddingProvider: options.embeddingProvider ?? process.env.TRUNK_EMBEDDING_PROVIDER ?? DEFAULTS.embedding.provider,
    embeddingModel: options.embeddingModel ?? process.env.TRUNK_EMBEDDING_MODEL ?? DEFAULTS.embedding.model,
    llmProvider: options.llmProvider ?? process.env.TRUNK_LLM_PROVIDER ?? DEFAULTS.llm.provider,
    llmModel: options.llmModel ?? process.env.TRUNK_LLM_MODEL ?? DEFAULTS.llm.model,
  };
}

async function promptText(label: string, initialValue: string | undefined): Promise<string> {
  const value = await text({ message: label, initialValue });
  if (isCancel(value)) {
    cancel("Cancelled.");
    throw new Error("Cancelled.");
  }

  async function promptSecret(label: string, initialValue: string | undefined): Promise<string> {
    if (initialValue !== undefined) return initialValue;
    const value = await password({ message: label });
    if (isCancel(value)) {
      cancel("Cancelled.");
      throw new Error("Cancelled.");
    }
    if (value.length === 0) throw new Error(`${label} is required.`);
    return value;
  }
  if (value.length === 0) throw new Error(`${label} is required.`);
  return value;
}

async function promptSelect(label: string, initialValue: string | undefined, values: readonly string[]): Promise<string> {
  const value = await select({
    message: label,
    initialValue,
    options: values.map((item) => ({ value: item, label: item })),
  });
  if (isCancel(value)) {
    cancel("Cancelled.");
    throw new Error("Cancelled.");
  }
  return value;
}

async function promptConfirm(label: string, initialValue: boolean): Promise<boolean> {
  const value = await confirm({ message: label, initialValue });
  if (isCancel(value)) {
    cancel("Cancelled.");
    throw new Error("Cancelled.");
  }
  return value;
}

async function validateEmbeddingProvider(
  embeddings: { embed(texts: string[]): Promise<number[][]> },
): Promise<void> {
  await embeddings.embed(["trunk init validation"]);
}

async function createIndexesThenRecordMeta(trunk: TrunkDb, config: TrunkConfig, dims: number): Promise<void> {
  await createTextIndex(trunk);
  await createVectorIndex(trunk, dims);
  await recordMeta(trunk, config, dims);
}

async function rebuildForProviderChange(
  trunk: TrunkDb,
  config: TrunkConfig,
  embeddings: { readonly dims: number; embed(texts: string[]): Promise<number[][]> },
): Promise<void> {
  await dropSearchIndexIfExists(trunk, VECTOR_INDEX);
  await createVectorIndex(trunk, embeddings.dims);
  const cursor = trunk.memories.find({}, { projection: { _id: 1, text: 1 } });
  const batchSize = 32;
  let batch: Pick<Memory, "_id" | "text">[] = [];
  for await (const memory of cursor) {
    batch.push({ _id: memory._id, text: memory.text });
    if (batch.length >= batchSize) {
      await embedBatch(trunk, embeddings, batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await embedBatch(trunk, embeddings, batch);
  }
  await recordMeta(trunk, config, embeddings.dims);
}

async function embedBatch(
  trunk: TrunkDb,
  embeddings: { embed(texts: string[]): Promise<number[][]> },
  batch: readonly Pick<Memory, "_id" | "text">[],
): Promise<void> {
  const vectors = await embeddings.embed(batch.map((memory) => memory.text));
  if (vectors.length !== batch.length) {
    throw new Error("Embedding provider returned a different number of vectors than inputs.");
  }
  await Promise.all(
    batch.map(async (memory, index) => {
      const embedding = vectors[index];
      if (embedding === undefined) throw new Error("Missing embedding vector.");
      await trunk.memories.updateOne({ _id: memory._id }, { $set: { embedding } });
    }),
  );
}

async function createVectorIndex(trunk: TrunkDb, dims: number): Promise<void> {
  // This must run only after provider selection and validation: Atlas vector
  // indexes are fixed-width, and mixed embedding models silently corrupt recall.
  await trunk.memories.createSearchIndex({
    name: VECTOR_INDEX,
    definition: {
      type: "vectorSearch",
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: dims,
          similarity: "cosine",
        },
        { type: "filter", path: "kind" },
        { type: "filter", path: "scope" },
      ],
    } satisfies SearchIndexDefinition,
  });
}

async function createTextIndex(trunk: TrunkDb): Promise<void> {
  await trunk.memories.createSearchIndex({
    name: TEXT_INDEX,
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          text: { type: "string" },
          kind: { type: "string" },
          scope: { type: "string" },
        },
      },
    } satisfies SearchIndexDefinition,
  });
}

async function dropSearchIndexIfExists(trunk: TrunkDb, name: string): Promise<void> {
  try {
    await trunk.memories.dropSearchIndex(name);
  } catch (error) {
    if (!String(error).toLowerCase().includes("not found")) {
      throw error;
    }
  }
}

async function recordMeta(trunk: TrunkDb, config: TrunkConfig, dims: number): Promise<void> {
  await trunk.meta.updateOne(
    { _id: META_ID },
    {
      $set: {
        embedding_provider: providerId(config.embedding.provider, config.embedding.model),
        embedding_dims: dims,
        created_at: new Date(),
      },
    },
    { upsert: true },
  );
}

async function writeConfig(path: string, config: TrunkConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        mongodb_uri: config.mongodbUri,
        mongodb_db: config.mongodbDb,
        embedding_provider: config.embedding.provider,
        embedding_model: config.embedding.model,
        llm_provider: config.llm.provider,
        llm_model: config.llm.model,
        port: config.port,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}
