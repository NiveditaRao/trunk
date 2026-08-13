import type {
  Branch,
  BranchId,
  Checkpoint,
  CheckpointId,
  Message,
  TrunkDb,
} from "@trunk/core";
import { buildAncestryPath } from "./ancestry.js";
import { branchNameFromTopic, newId } from "./ids.js";

export const MAIN_BRANCH_ID = "br_main";
export const MAIN_BRANCH_NAME = "main";
export const MAIN_BRANCH_TOPIC = "General trunk conversation";

export interface CheckpointTurn {
  label?: string;
  summary: string;
  userMessage: string;
  assistantMessage: string;
}

interface GraphLookupCheckpoint extends Checkpoint {
  ancestors: Checkpoint[];
}

export async function ensureMainBranch(trunk: TrunkDb): Promise<Branch> {
  const existing = await trunk.branches.findOne({ _id: MAIN_BRANCH_ID });
  if (existing) return existing;

  const branch: Branch = {
    _id: MAIN_BRANCH_ID,
    name: MAIN_BRANCH_NAME,
    root_checkpoint: null,
    topic: MAIN_BRANCH_TOPIC,
    created_at: new Date(),
  };
  await trunk.branches.insertOne(branch);
  return branch;
}

export async function getBranchOrThrow(
  trunk: TrunkDb,
  branchId: BranchId,
): Promise<Branch> {
  const branch = await trunk.branches.findOne({ _id: branchId });
  if (!branch) {
    throw new Error(`Unknown branch: ${branchId}`);
  }
  return branch;
}

export async function latestCheckpointForBranch(
  trunk: TrunkDb,
  branchId: BranchId,
): Promise<Checkpoint | null> {
  return trunk.checkpoints.findOne({ branch_id: branchId }, { sort: { ts: -1 } });
}

export async function createCheckpoint(
  trunk: TrunkDb,
  branchId: BranchId,
  turn: CheckpointTurn,
): Promise<Checkpoint> {
  const branch = await getBranchOrThrow(trunk, branchId);
  const previous = await latestCheckpointForBranch(trunk, branchId);
  const parentId = previous?._id ?? branch.root_checkpoint;
  const now = new Date();
  const checkpoint: Checkpoint = {
    _id: newId("cp"),
    branch_id: branchId,
    parent_id: parentId,
    label: turn.label ?? null,
    summary: turn.summary,
    ts: now,
  };
  const messages: Message[] = [
    {
      _id: newId("msg"),
      checkpoint_id: checkpoint._id,
      branch_id: branchId,
      role: "user",
      content: turn.userMessage,
      ts: now,
    },
    {
      _id: newId("msg"),
      checkpoint_id: checkpoint._id,
      branch_id: branchId,
      role: "assistant",
      content: turn.assistantMessage,
      ts: now,
    },
  ];

  await trunk.checkpoints.insertOne(checkpoint);
  await trunk.messages.insertMany(messages);
  return checkpoint;
}

export async function createImplicitMemoryCheckpoint(
  trunk: TrunkDb,
  branchId: BranchId,
  text: string,
): Promise<Checkpoint> {
  return createCheckpoint(trunk, branchId, {
    label: "manual memory",
    summary: `Manual memory captured: ${text.slice(0, 80)}`,
    userMessage: `remember: ${text}`,
    assistantMessage: "Captured as a memory.",
  });
}

export async function checkpointById(
  trunk: TrunkDb,
  checkpointId: CheckpointId,
): Promise<Checkpoint | null> {
  return trunk.checkpoints.findOne({ _id: checkpointId });
}

export async function checkpointOrThrow(
  trunk: TrunkDb,
  checkpointId: CheckpointId,
): Promise<Checkpoint> {
  const checkpoint = await checkpointById(trunk, checkpointId);
  if (!checkpoint) {
    throw new Error(`Unknown checkpoint: ${checkpointId}`);
  }
  return checkpoint;
}

export async function ancestryForCheckpoint(
  trunk: TrunkDb,
  checkpointId: CheckpointId,
): Promise<Checkpoint[]> {
  const rows = await trunk.checkpoints
    .aggregate<GraphLookupCheckpoint>([
      { $match: { _id: checkpointId } },
      {
        $graphLookup: {
          from: "checkpoints",
          startWith: "$parent_id",
          connectFromField: "parent_id",
          connectToField: "_id",
          as: "ancestors",
        },
      },
    ])
    .toArray();
  const first = rows[0];
  if (!first) {
    throw new Error(`Unknown checkpoint: ${checkpointId}`);
  }
  const leaf = withoutAncestors(first);
  return buildAncestryPath([...first.ancestors, leaf], leaf._id);
}

export async function ancestryForBranch(
  trunk: TrunkDb,
  branch: Branch,
): Promise<Checkpoint[]> {
  const latest = await latestCheckpointForBranch(trunk, branch._id);
  const target = latest?._id ?? branch.root_checkpoint;
  if (!target) return [];
  return ancestryForCheckpoint(trunk, target);
}

export async function createForkBranch(params: {
  trunk: TrunkDb;
  checkpointId: CheckpointId;
  topic: string;
  name?: string;
}): Promise<Branch> {
  await checkpointOrThrow(params.trunk, params.checkpointId);
  // Resolve ancestry with $graphLookup at fork time to validate that the root
  // belongs to the persisted DAG MongoDB will continue traversing on resume().
  await ancestryForCheckpoint(params.trunk, params.checkpointId);

  const branch: Branch = {
    _id: newId("br"),
    name: params.name ?? branchNameFromTopic(params.topic),
    root_checkpoint: params.checkpointId,
    topic: params.topic,
    created_at: new Date(),
  };
  await params.trunk.branches.insertOne(branch);
  return branch;
}

function withoutAncestors(row: GraphLookupCheckpoint): Checkpoint {
  return {
    _id: row._id,
    branch_id: row.branch_id,
    parent_id: row.parent_id,
    label: row.label,
    summary: row.summary,
    ts: row.ts,
  };
}
