/**
 * MongoDB collection schemas — Phase 0 contract.
 *
 * FROZEN after Phase 0. A change here can break two other tracks at once,
 * so it requires agreement from all three owners.
 *
 * The central idea: conversations branch, memory does not.
 *   - checkpoints form a DAG (parent-pointer documents)
 *   - memories live OUTSIDE that tree, in a shared trunk
 *   - but only FACTS are shared; HYPOTHESES stay scoped to their branch
 */

/** Branded id aliases. Cosmetic, but they make signatures self-documenting. */
export type BranchId = string;
export type CheckpointId = string;
export type MessageId = string;
export type MemoryId = string;

export const COLLECTIONS = {
  branches: "branches",
  checkpoints: "checkpoints",
  messages: "messages",
  memories: "memories",
  meta: "meta",
} as const;

/** A conversation lane. `main` is created on first use. */
export interface Branch {
  _id: BranchId;
  name: string;
  /** Checkpoint this branch was forked from. Null only for the root branch. */
  root_checkpoint: CheckpointId | null;
  /** What this branch is about — used to keep resume() briefs focused. */
  topic: string;
  created_at: Date;
}

/**
 * A save point. One per turn. The DAG is formed by `parent_id`.
 * Ancestry is resolved with $graphLookup — natural in Mongo, painful in SQL.
 */
export interface Checkpoint {
  _id: CheckpointId;
  branch_id: BranchId;
  /** Previous checkpoint. Null for the first checkpoint of the root branch. */
  parent_id: CheckpointId | null;
  /** Optional human label, e.g. "before refactor". */
  label: string | null;
  /** Short summary of the turn, used when distilling a resume() brief. */
  summary: string;
  ts: Date;
}

export interface Message {
  _id: MessageId;
  checkpoint_id: CheckpointId;
  branch_id: BranchId;
  role: "user" | "assistant";
  content: string;
  ts: Date;
}

/**
 * FACT      — true regardless of which branch found it. Shared by every branch.
 * HYPOTHESIS — true only inside one branch's exploration. Never auto-shared.
 *
 * This distinction is the entire project. Sharing everything would re-create
 * context pollution one layer down.
 */
export type MemoryKind = "fact" | "hypothesis";

/** 'trunk' = globally shared. Otherwise the memory is private to that branch. */
export type MemoryScope = "trunk" | BranchId;

export interface Memory {
  _id: MemoryId;
  text: string;
  embedding: number[];
  tags: string[];
  kind: MemoryKind;
  scope: MemoryScope;
  /** Checkpoint that produced this memory — drives provenance lines in the UI. */
  source_checkpoint: CheckpointId;
  /** Raised on repeat observation instead of inserting a duplicate row. */
  confidence: number;
  valid_from: Date;
  /** Set when a contradicting fact supersedes this one. Keeps the trunk coherent. */
  superseded_by: MemoryId | null;
}

/**
 * Single meta document (_id: 'config'), written by `trunk init`.
 *
 * Guards against restarting with a different embedding provider: vectors from
 * different models occupy different semantic spaces, so comparing them yields
 * silently wrong recall — the worst failure mode in a memory system.
 */
export interface Meta {
  _id: "config";
  /** e.g. 'openai:text-embedding-3-small' */
  embedding_provider: string;
  embedding_dims: number;
  created_at: Date;
}

export const META_ID = "config" as const;

/** Name of the Atlas Vector Search index on `memories.embedding`. */
export const VECTOR_INDEX = "trunk_vector_index";
/** Name of the Atlas Search text index on `memories.text` (hybrid retrieval). */
export const TEXT_INDEX = "trunk_text_index";
