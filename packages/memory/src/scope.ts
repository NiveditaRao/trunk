export type RecallKind = "fact" | "hypothesis";

export interface RecallScopeMemory {
  kind: RecallKind;
  scope?: string | null;
  superseded_by?: string | null;
}

export function isVisibleToBranch(
  memory: RecallScopeMemory,
  branchId: string,
): boolean {
  if (memory.superseded_by !== null && memory.superseded_by !== undefined) {
    return false;
  }

  if (memory.kind === "fact") {
    return memory.scope === "trunk";
  }

  if (memory.kind === "hypothesis") {
    // "trunk" is the global fact scope, not a safe hypothesis scope. If a branch
    // is literally named "trunk", denying its hypotheses is safer than treating
    // trunk-scoped hypothesis rows as shareable or branch-local truth.
    return memory.scope === branchId && memory.scope !== "trunk";
  }

  return false;
}
