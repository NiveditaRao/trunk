import type { Branch, Checkpoint, TrunkDb } from "@trunk/core";
import { renderGraph } from "@trunk/render";

export async function loadGraph(trunk: TrunkDb): Promise<{
  branches: Branch[];
  checkpoints: Checkpoint[];
  graph: string;
}> {
  const [branches, checkpoints, memories] = await Promise.all([
    trunk.branches.find({}).sort({ created_at: 1 }).toArray(),
    trunk.checkpoints.find({}).sort({ ts: 1 }).toArray(),
    trunk.memories.find({}).sort({ valid_from: 1 }).toArray(),
  ]);

  return {
    branches,
    checkpoints,
    graph: renderGraph({ branches, checkpoints, memories }),
  };
}

export function summarizeBranches(
  branches: Branch[],
  checkpoints: Checkpoint[],
): Array<{
  branch_id: string;
  name: string;
  topic: string;
  checkpoint_count: number;
}> {
  const counts = new Map<string, number>();
  for (const checkpoint of checkpoints) {
    counts.set(checkpoint.branch_id, (counts.get(checkpoint.branch_id) ?? 0) + 1);
  }
  return branches.map((branch) => ({
    branch_id: branch._id,
    name: branch.name,
    topic: branch.topic,
    checkpoint_count: counts.get(branch._id) ?? 0,
  }));
}
