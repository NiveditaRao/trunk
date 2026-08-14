/**
 * MongoDB client + typed collection accessors, and the provider-mismatch guard.
 */

import { type Collection, type Db, MongoClient } from "mongodb";
import {
  type Branch,
  type Checkpoint,
  COLLECTIONS,
  type Memory,
  type Message,
  type Meta,
  META_ID,
} from "./schema.js";
import type { TrunkConfig } from "./providers.js";
import { providerId } from "./config.js";

export interface TrunkDb {
  client: MongoClient;
  db: Db;
  branches: Collection<Branch>;
  checkpoints: Collection<Checkpoint>;
  messages: Collection<Message>;
  memories: Collection<Memory>;
  meta: Collection<Meta>;
  close(): Promise<void>;
}

export async function connect(config: TrunkConfig): Promise<TrunkDb> {
  const client = new MongoClient(config.mongodbUri);
  await client.connect();
  const db = client.db(config.mongodbDb);

  return {
    client,
    db,
    branches: db.collection<Branch>(COLLECTIONS.branches),
    checkpoints: db.collection<Checkpoint>(COLLECTIONS.checkpoints),
    messages: db.collection<Message>(COLLECTIONS.messages),
    memories: db.collection<Memory>(COLLECTIONS.memories),
    meta: db.collection<Meta>(COLLECTIONS.meta),
    close: () => client.close(),
  };
}

export class ProviderMismatchError extends Error {
  constructor(stored: string, storedDims: number, configured: string) {
    super(
      `Embedding provider mismatch.
  Index built with: ${stored} (${storedDims}d)
  Configured now:   ${configured}

Vectors from different models occupy different semantic spaces, so comparing them produces silently wrong recall.
Run \`trunk init --reembed\` to rebuild, or restore the previous provider.`,
    );
    this.name = "ProviderMismatchError";
  }
}

/**
 * Refuse to start if the configured embedding provider differs from the one
 * that built the index. Cheap check, prevents the worst failure mode in a
 * memory system: retrieval that looks fine but is meaningless.
 *
 * Returns the stored meta document, or null on a fresh database.
 */
export async function assertProviderMatches(
  trunk: TrunkDb,
  config: TrunkConfig,
): Promise<Meta | null> {
  const meta = await trunk.meta.findOne({ _id: META_ID });
  if (!meta) return null;

  const configured = providerId(config.embedding.provider, config.embedding.model);
  if (meta.embedding_provider !== configured) {
    throw new ProviderMismatchError(
      meta.embedding_provider,
      meta.embedding_dims,
      configured,
    );
  }
  return meta;
}
