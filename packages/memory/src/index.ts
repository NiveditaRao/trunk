/**
 * TRACK B — Memory engine.
 *
 * Owns: extraction, fact/hypothesis classification, retrieval, dedup, supersession.
 * Implements the `MemoryEngine` interface from @trunk/core.
 *
 * Deliverables (see plan §8):
 *   B1  Extraction: turn -> candidate memories
 *   B2  FACT vs HYPOTHESIS classification   <- the intellectual core
 *   B3  Embeddings + Atlas Vector Search
 *   B3b Provider-mismatch startup guard      (see assertProviderMatches in @trunk/core)
 *   B4  Hybrid retrieval (vector + text, tag filters, recency)
 *   B5  Dedup + reinforcement (repeat observation raises confidence, no new row)
 *   B6  Supersession (contradiction marks the old fact superseded, not duplicated)
 *   B7  Scope enforcement                    <- hard test, not a nice-to-have
 *   B8  Eval harness (packages/eval)
 *
 * PRIORITY: B2 and B7 are the thesis. If a branch's hypothesis ever leaks into
 * another branch's recall, the idea is disproven and the rest is wasted effort.
 * Ship those before quality work (B4-B6).
 */

import type {
  CandidateMemory,
  CheckpointId,
  EmbeddingProvider,
  LLMProvider,
  Memory,
  MemoryEngine,
  MemoryId,
  RecallOptions,
  TrunkDb,
  Turn,
} from "@trunk/core";
import { randomUUID } from "node:crypto";
import {
  CLASSIFICATION_RUBRIC,
  clampConfidence,
  classifyMemoryText,
  extractHeuristicCandidates,
  inferTags,
} from "./classification.js";
import {
  decideDedup,
  type ExistingMemoryForDedup,
  reinforceConfidence,
} from "./dedup.js";
import { assertPromotable, promotionTags } from "./promotion.js";
import { isVisibleToBranch } from "./scope.js";

export { CLASSIFICATION_RUBRIC, classifyMemoryText } from "./classification.js";
export { decideDedup, inferContradiction, reinforceConfidence } from "./dedup.js";
export { InMemoryMemoryEngine } from "./in-memory.js";
export { assertPromotable, promotionTags } from "./promotion.js";
export { isVisibleToBranch } from "./scope.js";

const VECTOR_INDEX = "trunk_vector_index";

interface MongoMemoryEngineDeps {
  trunk: TrunkDb;
  embeddings: EmbeddingProvider;
  llm?: LLMProvider;
  now?: () => Date;
}

interface ExtractedMemoryJson {
  text: string;
  tags: string[];
  kind: "fact" | "hypothesis";
  confidence: number;
}

interface MemorySearchResult extends Memory {
  vector_score?: number;
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["memories"],
  properties: {
    memories: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "tags", "kind", "confidence"],
        properties: {
          text: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
            maxItems: 6,
          },
          kind: { enum: ["fact", "hypothesis"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

export class MongoMemoryEngine implements MemoryEngine {
  private readonly trunk?: TrunkDb;
  private readonly embeddings?: EmbeddingProvider;
  private readonly llm?: LLMProvider;
  private readonly now: () => Date;

  constructor(deps?: MongoMemoryEngineDeps) {
    this.trunk = deps?.trunk;
    this.embeddings = deps?.embeddings;
    this.llm = deps?.llm;
    this.now = deps?.now ?? (() => new Date());
  }

  async extract(turn: Turn): Promise<CandidateMemory[]> {
    if (!this.llm) return this.extractWithHeuristics(turn);

    const prompt = `${CLASSIFICATION_RUBRIC}

Turn:
checkpoint_id: ${turn.checkpoint_id}
branch_id: ${turn.branch_id}
user: ${JSON.stringify(turn.user)}
assistant: ${JSON.stringify(turn.assistant)}
`;
    const raw = await this.llm.complete(prompt, EXTRACTION_SCHEMA);
    const parsed = parseExtractionResponse(raw);
    return parsed.map((memory) => toCandidate(memory, turn.branch_id, turn.checkpoint_id));
  }

  async write(candidate: CandidateMemory): Promise<MemoryId> {
    const trunk = requireTrunk(this.trunk);
    const embeddings = requireEmbeddings(this.embeddings);
    const embedding = await embedOne(embeddings, candidate.text);
    const matches = await findNearMemories(trunk, embedding, 12);
    const effectiveCandidate = normalizeCandidateScope(candidate);
    const decision = decideDedup(effectiveCandidate, matches.map(toDedupMemory));

    if (decision.action === "reinforce") {
      await trunk.memories.updateOne(
        { _id: decision.id },
        {
          $set: { confidence: decision.confidence },
          $addToSet: { tags: { $each: effectiveCandidate.tags } },
        },
      );
      return decision.id;
    }

    const id = `mem_${randomUUID()}`;
    const memory: Memory = {
      _id: id,
      text: effectiveCandidate.text,
      embedding,
      tags: [...effectiveCandidate.tags, ...possibleConflictTags(decision)],
      kind: effectiveCandidate.kind,
      scope: effectiveCandidate.scope,
      source_checkpoint: candidate.source_checkpoint,
      confidence: clampConfidence(candidate.confidence),
      valid_from: this.now(),
      superseded_by: null,
    };
    await trunk.memories.insertOne(memory);

    if (decision.action === "supersede") {
      await trunk.memories.updateOne(
        { _id: decision.supersededId },
        { $set: { superseded_by: id } },
      );
    }

    return id;
  }

  async recall(query: string, opts: RecallOptions): Promise<Memory[]> {
    const trunk = requireTrunk(this.trunk);
    const embeddings = requireEmbeddings(this.embeddings);
    const embedding = await embedOne(embeddings, query);
    const limit = Math.max(opts.k * 4, opts.k, 10);
    const candidates = await findNearMemories(trunk, embedding, limit);
    return candidates
      .filter((memory) => isVisibleToBranch(memory, opts.branch_id))
      .filter((memory) => hasRequestedTags(memory.tags, opts.tags))
      .slice(0, opts.k);
  }

  async promote(id: MemoryId): Promise<void> {
    const trunk = requireTrunk(this.trunk);
    const memory = await trunk.memories.findOne({ _id: id });
    if (!memory) throw new Error(`Cannot promote missing memory: ${id}`);
    assertPromotable(memory, id);

    const promotedTags = promotionTags(memory);
    const candidate = {
      text: memory.text,
      tags: promotedTags,
      kind: "fact" as const,
      scope: "trunk",
      confidence: memory.confidence,
    };
    const matches = (await findNearMemories(trunk, memory.embedding, 12)).filter(
      (match) => match._id !== id,
    );
    const decision = decideDedup(candidate, matches.map(toDedupMemory));

    if (decision.action === "reinforce") {
      await trunk.memories.updateOne(
        { _id: decision.id },
        {
          $set: { confidence: decision.confidence },
          $addToSet: {
            tags: {
              $each: [
                ...promotedTags,
                `provenance:promoted-memory:${id}`,
                `provenance:source-branch:${memory.scope}`,
              ],
            },
          },
        },
      );
      await trunk.memories.updateOne(
        { _id: id },
        { $set: { superseded_by: decision.id } },
      );
      return;
    }

    await trunk.memories.updateOne(
      { _id: id },
      {
        $set: {
          kind: "fact",
          scope: "trunk",
          tags: [...promotedTags, ...possibleConflictTags(decision)],
        },
      },
    );

    if (decision.action === "supersede") {
      await trunk.memories.updateOne(
        { _id: decision.supersededId },
        { $set: { superseded_by: id } },
      );
    }
  }

  private extractWithHeuristics(turn: Turn): CandidateMemory[] {
    const text = `${turn.user}\n${turn.assistant}`;
    return extractHeuristicCandidates(text).map((candidateText) => {
      const decision = classifyMemoryText(candidateText);
      return {
        text: candidateText,
        tags: inferTags(candidateText),
        kind: decision.kind,
        scope: decision.kind === "fact" ? "trunk" : turn.branch_id,
        source_checkpoint: turn.checkpoint_id,
        confidence: decision.confidence,
      };
    });
  }
}

function requireTrunk(trunk: TrunkDb | undefined): TrunkDb {
  if (!trunk) {
    throw new Error("MongoMemoryEngine requires a TrunkDb for this operation.");
  }
  return trunk;
}

function requireEmbeddings(
  embeddings: EmbeddingProvider | undefined,
): EmbeddingProvider {
  if (!embeddings) {
    throw new Error("MongoMemoryEngine requires an EmbeddingProvider for this operation.");
  }
  return embeddings;
}

async function embedOne(
  embeddings: EmbeddingProvider,
  text: string,
): Promise<number[]> {
  const vectors = await embeddings.embed([text]);
  const first = vectors[0];
  if (!first) {
    throw new Error("Embedding provider returned no vector.");
  }
  return first;
}

async function findNearMemories(
  trunk: TrunkDb,
  embedding: number[],
  limit: number,
): Promise<MemorySearchResult[]> {
  const pipeline: Record<string, unknown>[] = [
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: "embedding",
        queryVector: embedding,
        numCandidates: Math.max(limit * 10, 50),
        limit,
      },
    },
    { $addFields: { vector_score: { $meta: "vectorSearchScore" } } },
    { $match: { superseded_by: null } },
  ];
  return trunk.memories.aggregate<MemorySearchResult>(pipeline).toArray();
}

function normalizeCandidateScope(candidate: CandidateMemory): {
  text: string;
  tags: string[];
  kind: "fact" | "hypothesis";
  scope: string;
  confidence: number;
} {
  const tags = [...new Set(candidate.tags.map((tag) => tag.trim()).filter(Boolean))];
  return {
    text: candidate.text.trim(),
    tags,
    kind: candidate.kind,
    scope: candidate.kind === "fact" ? "trunk" : candidate.scope,
    confidence: clampConfidence(candidate.confidence),
  };
}

function toDedupMemory(memory: MemorySearchResult): ExistingMemoryForDedup {
  return {
    _id: memory._id,
    text: memory.text,
    tags: memory.tags,
    kind: memory.kind,
    scope: memory.scope,
    confidence: memory.confidence,
    superseded_by: memory.superseded_by,
    similarity: typeof memory.vector_score === "number" ? memory.vector_score : 0,
  };
}

function possibleConflictTags(decision: ReturnType<typeof decideDedup>): string[] {
  if (decision.action !== "insert" || !decision.flaggedIds) return [];
  return decision.flaggedIds.map((flaggedId) => `possible-conflict:${flaggedId}`);
}

function hasRequestedTags(memoryTags: string[], requestedTags?: string[]): boolean {
  if (!requestedTags || requestedTags.length === 0) return true;
  const present = new Set(memoryTags);
  return requestedTags.every((tag) => present.has(tag));
}

function parseExtractionResponse(raw: string): ExtractedMemoryJson[] {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return [];
  const memories = parsed.memories;
  if (!Array.isArray(memories)) return [];
  return memories.flatMap((memory) => parseExtractedMemory(memory));
}

function parseExtractedMemory(value: unknown): ExtractedMemoryJson[] {
  if (!isRecord(value)) return [];
  const { text, tags, kind, confidence } = value;
  if (typeof text !== "string") return [];
  if (kind !== "fact" && kind !== "hypothesis") return [];
  if (!Array.isArray(tags)) return [];
  const cleanTags = tags.filter((tag): tag is string => typeof tag === "string");
  const cleanConfidence = typeof confidence === "number" ? confidence : 0.5;
  return [
    {
      text,
      tags: cleanTags,
      kind,
      confidence: clampConfidence(cleanConfidence),
    },
  ];
}

function toCandidate(
  memory: ExtractedMemoryJson,
  branchId: string,
  checkpointId: CheckpointId,
): CandidateMemory {
  return {
    text: memory.text.trim(),
    tags: [...new Set(memory.tags.map((tag) => tag.trim()).filter(Boolean))],
    kind: memory.kind,
    scope: memory.kind === "fact" ? "trunk" : branchId,
    source_checkpoint: checkpointId,
    confidence: clampConfidence(memory.confidence),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
