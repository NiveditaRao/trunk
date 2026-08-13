import type { Checkpoint, CheckpointId } from "@trunk/core";

export function buildAncestryPath(
  checkpoints: Checkpoint[],
  leafId: CheckpointId,
): Checkpoint[] {
  const byId = new Map(checkpoints.map((checkpoint) => [checkpoint._id, checkpoint]));
  const path: Checkpoint[] = [];
  const seen = new Set<CheckpointId>();
  let cursor: CheckpointId | null = leafId;

  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error(`Checkpoint ancestry cycle detected at ${cursor}`);
    }
    seen.add(cursor);
    const checkpoint = byId.get(cursor);
    if (!checkpoint) {
      throw new Error(`Missing checkpoint in ancestry path: ${cursor}`);
    }
    path.unshift(checkpoint);
    cursor = checkpoint.parent_id;
  }

  return path;
}
