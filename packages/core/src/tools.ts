/**
 * MCP tool surface — Phase 0 contract.
 *
 * Track A implements these; Tracks B and C read them.
 * We implement the MCP spec and nothing beyond it: no host-specific APIs,
 * no assumptions about transcript format, no vendor-only features.
 * Must work on Copilot CLI, Claude Code, Cursor, Windsurf, Zed.
 */

import type { BranchId, CheckpointId, MemoryId, MemoryKind } from "./schema.js";

export const TOOL_NAMES = {
  checkpoint: "checkpoint",
  fork_from: "fork_from",
  resume: "resume",
  remember: "remember",
  promote: "promote",
  recall: "recall",
  list_branches: "list_branches",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

export interface CheckpointInput {
  label?: string;
  summary: string;
  user_message: string;
  assistant_message: string;
}
export interface CheckpointResult {
  checkpoint_id: CheckpointId;
  branch_id: BranchId;
  /** Memories extracted from this turn, for transparency in the tool response. */
  extracted: Array<{ text: string; kind: MemoryKind }>;
}

export interface ForkFromInput {
  checkpoint_id: CheckpointId;
  topic: string;
  name?: string;
}
export interface ForkFromResult {
  branch_id: BranchId;
  name: string;
  /** Paste into a FRESH session — an MCP server cannot prune the host's context window,
   *  so isolation comes from starting a new window, not from editing the old one. */
  resume_command: string;
  /** ASCII graph, rendered inline so the terminal stays the fast path. */
  graph: string;
}

export interface ResumeInput {
  id: BranchId | CheckpointId;
}
export interface ResumeResult {
  branch_id: BranchId;
  topic: string;
  /** Distilled brief — not a literal transcript replay. */
  brief: string;
  /** Trunk facts relevant to this branch's topic, so nothing is re-explained. */
  memories: Array<{ text: string; kind: MemoryKind; confidence: number }>;
}

export interface RememberInput {
  text: string;
  tags?: string[];
  /** 'fact' -> shared trunk. 'hypothesis' -> scoped to the current branch. */
  kind: MemoryKind;
}
export interface RememberResult {
  memory_id: MemoryId;
  kind: MemoryKind;
  scope: string;
  /** True when this reinforced an existing memory instead of inserting a new one. */
  deduped: boolean;
}

export interface PromoteInput {
  memory_id: MemoryId;
}
export interface PromoteResult {
  memory_id: MemoryId;
  promoted: boolean;
}

export interface RecallInput {
  query: string;
  k?: number;
  tags?: string[];
}
export interface RecallResult {
  memories: Array<{
    text: string;
    kind: MemoryKind;
    confidence: number;
    source_checkpoint: CheckpointId;
  }>;
}

export interface ListBranchesResult {
  branches: Array<{
    branch_id: BranchId;
    name: string;
    topic: string;
    checkpoint_count: number;
  }>;
  /** ASCII graph for inline display. */
  graph: string;
}

export const DEFAULT_RECALL_K = 6;
