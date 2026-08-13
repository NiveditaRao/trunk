import type { Branch, Checkpoint, Memory } from "@trunk/core";

export interface GraphResponse {
  branches: Branch[];
  checkpoints: Checkpoint[];
}

export interface MemoriesResponse {
  memories: Memory[];
}

export interface BranchRequest {
  checkpoint_id: string;
  topic: string;
}

export interface BranchResponse {
  branch_id: string;
  name: string;
  resume_command: string;
}

export type StreamEvent =
  | { type: "checkpoint"; doc: Checkpoint }
  | { type: "memory"; doc: Memory };

type StreamKind = StreamEvent["type"];

export function graphResponse(params: GraphResponse): GraphResponse {
  return {
    branches: params.branches,
    checkpoints: params.checkpoints,
  };
}

export function memoriesResponse(memories: Memory[]): MemoriesResponse {
  return { memories };
}

export function parseBranchRequest(value: unknown): BranchRequest {
  if (!isRecord(value)) {
    throw new Error("Expected body { checkpoint_id, topic }");
  }
  return {
    checkpoint_id: requiredString(value.checkpoint_id, "checkpoint_id"),
    topic: requiredString(value.topic, "topic"),
  };
}

export function branchResponse(params: BranchResponse): BranchResponse {
  return {
    branch_id: params.branch_id,
    name: params.name,
    resume_command: params.resume_command,
  };
}

export function shapeStreamEvent<T extends Checkpoint | Memory>(
  type: StreamKind,
  doc: T | null | undefined,
): StreamEvent | null {
  if (!doc) return null;
  if (type === "checkpoint") {
    return { type, doc: doc as Checkpoint };
  }
  return { type, doc: doc as Memory };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw new Error(`Expected non-empty string for ${name}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
