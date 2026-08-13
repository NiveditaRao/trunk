/**
 * MemoryEngine — the Track A <-> Track B seam. Phase 0 contract.
 *
 * Track A codes against this interface and a stub (see `StubMemoryEngine`),
 * Track B implements it for real. Neither track waits on the other.
 */

import type {
  BranchId,
  CheckpointId,
  Memory,
  MemoryId,
  MemoryKind,
  MemoryScope,
} from "./schema.js";

/** A memory proposed by extraction, before it has been embedded or stored. */
export interface CandidateMemory {
  text: string;
  tags: string[];
  kind: MemoryKind;
  scope: MemoryScope;
  source_checkpoint: CheckpointId;
  /** Classifier's confidence in the kind assignment, 0..1. */
  confidence: number;
}

export interface Turn {
  checkpoint_id: CheckpointId;
  branch_id: BranchId;
  user: string;
  assistant: string;
}

export interface RecallOptions {
  /** Which branch is asking. Determines which hypotheses are visible. */
  branch_id: BranchId;
  k: number;
  tags?: string[];
}

export interface MemoryEngine {
  /**
   * Turn -> candidate memories, each classified as fact or hypothesis.
   * The classification is the intellectual core of the project.
   */
  extract(turn: Turn): Promise<CandidateMemory[]>;

  /**
   * Embed and store. Handles dedup (repeat observation raises confidence
   * rather than inserting a row) and supersession (a contradicting fact marks
   * the old one superseded rather than storing both).
   */
  write(candidate: CandidateMemory): Promise<MemoryId>;

  /**
   * Returns trunk facts PLUS the calling branch's own hypotheses.
   * Must never return another branch's hypotheses — that leak would
   * invalidate the whole thesis.
   */
  recall(query: string, opts: RecallOptions): Promise<Memory[]>;

  /** Move a branch-local hypothesis into the shared trunk. Explicit, never automatic. */
  promote(id: MemoryId): Promise<void>;
}

/**
 * No-op implementation so Track A can build before Track B lands.
 * Deliberately returns nothing rather than fake data — silent empty results
 * are easier to notice than plausible fabrications.
 */
export class StubMemoryEngine implements MemoryEngine {
  async extract(_turn: Turn): Promise<CandidateMemory[]> {
    return [];
  }
  async write(_candidate: CandidateMemory): Promise<MemoryId> {
    return "stub-memory-id";
  }
  async recall(_query: string, _opts: RecallOptions): Promise<Memory[]> {
    return [];
  }
  async promote(_id: MemoryId): Promise<void> {
    // no-op
  }
}
