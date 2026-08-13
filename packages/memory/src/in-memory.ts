import type {
  CandidateMemory,
  CheckpointId,
  Memory,
  MemoryEngine,
  MemoryId,
  RecallOptions,
  Turn,
} from "@trunk/core";
import {
  CLASSIFICATION_RUBRIC,
  clampConfidence,
  classifyMemoryText,
  extractHeuristicCandidates,
  inferTags,
} from "./classification.ts";
import {
  decideDedup,
  type ExistingMemoryForDedup,
} from "./dedup.ts";
import { assertPromotable, promotionTags } from "./promotion.ts";
import { isVisibleToBranch } from "./scope.ts";

interface InMemoryMemoryEngineDeps {
  now?: () => Date;
  dimensions?: number;
}

interface ScoredMemory extends Memory {
  similarity: number;
}

interface ExtractedMemoryJson {
  text: string;
  tags: string[];
  kind: "fact" | "hypothesis";
  confidence: number;
}

export class InMemoryMemoryEngine implements MemoryEngine {
  private readonly now: () => Date;
  private readonly dimensions: number;
  private readonly memories: Memory[] = [];
  private nextId = 1;

  constructor(deps?: InMemoryMemoryEngineDeps) {
    this.now = deps?.now ?? (() => new Date());
    this.dimensions = deps?.dimensions ?? 64;
  }

  async extract(turn: Turn): Promise<CandidateMemory[]> {
    const text = `${turn.user}\n${turn.assistant}`;
    return extractHeuristicCandidates(text).map((candidateText) => {
      const decision = classifyMemoryText(candidateText);
      return toCandidate(
        {
          text: candidateText,
          tags: inferTags(candidateText),
          kind: decision.kind,
          confidence: decision.confidence,
        },
        turn.branch_id,
        turn.checkpoint_id,
      );
    });
  }

  async write(candidate: CandidateMemory): Promise<MemoryId> {
    const effectiveCandidate = normalizeCandidateScope(candidate);
    const embedding = this.embed(effectiveCandidate.text);
    const matches = this.scoredMemories(embedding);
    const decision = decideDedup(effectiveCandidate, matches.map(toDedupMemory));

    if (decision.action === "reinforce") {
      const existing = this.requireMemory(decision.id);
      existing.confidence = decision.confidence;
      existing.tags = mergeTags(existing.tags, effectiveCandidate.tags);
      return decision.id;
    }

    const id = `mem_inmemory_${String(this.nextId++).padStart(4, "0")}`;
    const memory: Memory = {
      _id: id,
      text: effectiveCandidate.text,
      embedding,
      tags: mergeTags(effectiveCandidate.tags, possibleConflictTags(decision)),
      kind: effectiveCandidate.kind,
      scope: effectiveCandidate.scope,
      source_checkpoint: candidate.source_checkpoint,
      confidence: clampConfidence(candidate.confidence),
      valid_from: this.now(),
      superseded_by: null,
    };
    this.memories.push(memory);

    if (decision.action === "supersede") {
      this.requireMemory(decision.supersededId).superseded_by = id;
    }

    return id;
  }

  async recall(query: string, opts: RecallOptions): Promise<Memory[]> {
    return this.retrievalMemories(query)
      .filter((memory) => memory.similarity > 0)
      .filter((memory) => isVisibleToBranch(memory, opts.branch_id))
      .filter((memory) => hasRequestedTags(memory.tags, opts.tags))
      .slice(0, opts.k)
      .map(({ similarity: _similarity, ...memory }) => ({ ...memory }));
  }

  async promote(id: MemoryId): Promise<void> {
    const memory = this.requireMemory(id);
    assertPromotable(memory, id);

    const promotedTags = promotionTags(memory);
    const candidate = {
      text: memory.text,
      tags: promotedTags,
      kind: "fact" as const,
      scope: "trunk",
      confidence: memory.confidence,
    };
    const matches = this.scoredMemories(memory.embedding).filter(
      (match) => match._id !== id,
    );
    const decision = decideDedup(candidate, matches.map(toDedupMemory));

    if (decision.action === "reinforce") {
      const reinforced = this.requireMemory(decision.id);
      reinforced.confidence = decision.confidence;
      reinforced.tags = mergeTags(reinforced.tags, [
        ...promotedTags,
        `provenance:promoted-memory:${id}`,
        `provenance:source-branch:${memory.scope}`,
      ]);
      memory.superseded_by = decision.id;
      return;
    }

    memory.kind = "fact";
    memory.scope = "trunk";
    memory.tags = mergeTags(promotedTags, possibleConflictTags(decision));

    if (decision.action === "supersede") {
      this.requireMemory(decision.supersededId).superseded_by = id;
    }
  }

  snapshot(): Memory[] {
    return this.memories.map((memory) => ({ ...memory, tags: [...memory.tags] }));
  }

  private scoredMemories(embedding: number[]): ScoredMemory[] {
    return this.memories
      .map((memory) => ({
        ...memory,
        similarity: cosine(embedding, memory.embedding),
      }))
      .sort(
        (left, right) =>
          right.similarity - left.similarity ||
          right.confidence - left.confidence ||
          left._id.localeCompare(right._id),
      );
  }

  private retrievalMemories(query: string): ScoredMemory[] {
    const queryTokens = new Set(tokens(query));
    return this.memories
      .map((memory) => ({
        ...memory,
        similarity: jaccard(queryTokens, new Set(tokens(memory.text))),
      }))
      .sort(
        (left, right) =>
          right.similarity - left.similarity ||
          right.confidence - left.confidence ||
          left._id.localeCompare(right._id),
      );
  }

  private embed(text: string): number[] {
    const vector = new Array(this.dimensions).fill(0) as number[];
    for (const token of tokens(text)) {
      vector[hashToken(token, this.dimensions)] += 1;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (magnitude === 0) return vector;
    return vector.map((value) => value / magnitude);
  }

  private requireMemory(id: MemoryId): Memory {
    const memory = this.memories.find((item) => item._id === id);
    if (!memory) throw new Error(`Cannot find memory: ${id}`);
    return memory;
  }
}

export const IN_MEMORY_EXTRACTION_RUBRIC = CLASSIFICATION_RUBRIC;

function normalizeCandidateScope(candidate: CandidateMemory): {
  text: string;
  tags: string[];
  kind: "fact" | "hypothesis";
  scope: string;
  confidence: number;
} {
  return {
    text: candidate.text.trim(),
    tags: mergeTags(candidate.tags, []),
    kind: candidate.kind,
    scope: candidate.kind === "fact" ? "trunk" : candidate.scope,
    confidence: clampConfidence(candidate.confidence),
  };
}

function toDedupMemory(memory: ScoredMemory): ExistingMemoryForDedup {
  return {
    _id: memory._id,
    text: memory.text,
    tags: memory.tags,
    kind: memory.kind,
    scope: memory.scope,
    confidence: memory.confidence,
    superseded_by: memory.superseded_by,
    similarity: memory.similarity,
  };
}

function toCandidate(
  memory: ExtractedMemoryJson,
  branchId: string,
  checkpointId: CheckpointId,
): CandidateMemory {
  return {
    text: memory.text.trim(),
    tags: mergeTags(memory.tags, []),
    kind: memory.kind,
    scope: memory.kind === "fact" ? "trunk" : branchId,
    source_checkpoint: checkpointId,
    confidence: clampConfidence(memory.confidence),
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

function mergeTags(left: string[], right: string[]): string[] {
  return [
    ...new Set(
      [...left, ...right]
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  ];
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return Math.round((intersection / union) * 1_000_000_000_000) / 1_000_000_000_000;
}

function hashToken(token: string, dimensions: number): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dimensions;
}

function cosine(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return Math.round(dot * 1_000_000_000_000) / 1_000_000_000_000;
}
