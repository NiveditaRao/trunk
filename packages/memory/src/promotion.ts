export interface PromotableMemory {
  _id: string;
  kind: "fact" | "hypothesis";
  scope: string;
  tags: string[];
  source_checkpoint: string;
  superseded_by: string | null;
}

export const PROMOTED_FROM_HYPOTHESIS_TAG = "provenance:promoted-from-hypothesis";

export function assertPromotable(memory: PromotableMemory, id: string): void {
  if (memory.superseded_by !== null) {
    throw new Error(`Cannot promote superseded memory: ${id}`);
  }
  if (memory.scope === "trunk" || memory.kind === "fact") {
    throw new Error(`Cannot promote memory that is already trunk-scoped: ${id}`);
  }
}

export function promotionTags(memory: PromotableMemory): string[] {
  return [
    ...new Set([
      ...memory.tags.map((tag) => tag.trim()).filter(Boolean),
      PROMOTED_FROM_HYPOTHESIS_TAG,
      `provenance:source-branch:${memory.scope}`,
      `provenance:source-checkpoint:${memory.source_checkpoint}`,
    ]),
  ];
}
