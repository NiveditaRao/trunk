/**
 * Git-style ASCII graph renderer.
 *
 * Pure function: graph data -> string. Imported by Track A so MCP tool
 * responses can print the branch graph inline, keeping the terminal the
 * fast path. Also used as the reference layout for the web graph.
 *
 * No dependencies beyond @trunk/core types.
 */

import type { Branch, Checkpoint, Memory } from "@trunk/core";

export interface RenderInput {
  branches: Branch[];
  checkpoints: Checkpoint[];
  /** Optional. When supplied, memories are annotated under their source checkpoint. */
  memories?: Memory[];
  /** Highlight one checkpoint, e.g. the one just created. */
  highlight?: string;
  /** Max width for summaries before truncation. */
  width?: number;
}

const GLYPH = {
  node: "*",
  forkNode: "●",
  vertical: "│",
  forkArm: "├─",
  fact: "fact",
  hypothesis: "hyp ",
} as const;

/** Short display id, like a git short sha. */
function shortId(id: string): string {
  const cleaned = id.replace(/^(cp_|br_|mem_)/, "");
  return cleaned.slice(0, 6).padEnd(6, " ");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Assign each branch a lane. Lane order follows the earliest checkpoint in
 * each branch, so `main` lands in lane 0 and forks appear to its right.
 */
function assignLanes(branches: Branch[], ordered: Checkpoint[]): Map<string, number> {
  const lanes = new Map<string, number>();
  let next = 0;
  for (const cp of ordered) {
    if (!lanes.has(cp.branch_id)) {
      lanes.set(cp.branch_id, next);
      next += 1;
    }
  }
  // Branches with no checkpoints still deserve a lane, for completeness.
  for (const b of branches) {
    if (!lanes.has(b._id)) {
      lanes.set(b._id, next);
      next += 1;
    }
  }
  return lanes;
}

export function renderGraph(input: RenderInput): string {
  const width = input.width ?? 52;
  const ordered = [...input.checkpoints].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  if (ordered.length === 0) return "(no checkpoints yet)";

  const lanes = assignLanes(input.branches, ordered);
  const branchName = new Map(input.branches.map((b) => [b._id, b.name]));
  const laneCount = Math.max(...Array.from(lanes.values())) + 1;

  // A lane is "open" from its first checkpoint onward, so we know when to draw │.
  const firstSeen = new Map<string, number>();
  ordered.forEach((cp, i) => {
    if (!firstSeen.has(cp.branch_id)) firstSeen.set(cp.branch_id, i);
  });

  const memsBySource = new Map<string, Memory[]>();
  for (const m of input.memories ?? []) {
    const list = memsBySource.get(m.source_checkpoint);
    if (list) list.push(m);
    else memsBySource.set(m.source_checkpoint, [m]);
  }

  const nameWidth = Math.max(
    4,
    ...Array.from(branchName.values()).map((n) => n.length),
  );

  const lines: string[] = [];

  ordered.forEach((cp, index) => {
    const lane = lanes.get(cp.branch_id) ?? 0;
    const isFork = firstSeen.get(cp.branch_id) === index && cp.parent_id !== null;

    // Build the lane gutter for this row.
    const cells: string[] = [];
    for (let l = 0; l < laneCount; l += 1) {
      const seen = Array.from(firstSeen.entries()).some(
        ([bid, idx]) => lanes.get(bid) === l && idx <= index,
      );
      if (l === lane) {
        cells.push(isFork ? GLYPH.forkNode : GLYPH.node);
      } else if (seen) {
        cells.push(GLYPH.vertical);
      } else {
        cells.push(" ");
      }
    }

    let gutter = cells.join(" ");
    if (isFork && lane > 0) {
      // Draw the fork arm from the parent lane into this one.
      const armStart = (lane - 1) * 2 + 1;
      gutter = `${gutter.slice(0, armStart)}${GLYPH.forkArm}${gutter.slice(armStart + 2)}`;
    }

    const marker = input.highlight === cp._id ? " <-- here" : "";
    const name = (branchName.get(cp.branch_id) ?? cp.branch_id).padEnd(nameWidth);
    lines.push(
      `${gutter}  ${shortId(cp._id)}  ${name}  ${truncate(cp.summary, width)}${marker}`,
    );

    // Annotate memories produced at this checkpoint.
    const mems = memsBySource.get(cp._id) ?? [];
    for (const m of mems) {
      const idle = cells
        .map((_, l) => {
          const seen = Array.from(firstSeen.entries()).some(
            ([bid, idx]) => lanes.get(bid) === l && idx <= index,
          );
          return seen ? GLYPH.vertical : " ";
        })
        .join(" ");
      const kind = m.kind === "fact" ? GLYPH.fact : GLYPH.hypothesis;
      const scope = m.scope === "trunk" ? "trunk" : "branch";
      const struck = m.superseded_by ? " (superseded)" : "";
      lines.push(
        `${idle}  ${" ".repeat(8)}${" ".repeat(nameWidth)}  └ ${kind} [${scope}] ${truncate(m.text, width - 8)}${struck}`,
      );
    }
  });

  return lines.join("\n");
}

/** Compact one-line-per-branch summary, for `list_branches` headers. */
export function renderBranchList(
  branches: Branch[],
  checkpoints: Checkpoint[],
): string {
  const counts = new Map<string, number>();
  for (const cp of checkpoints) {
    counts.set(cp.branch_id, (counts.get(cp.branch_id) ?? 0) + 1);
  }
  return branches
    .map((b) => {
      const n = counts.get(b._id) ?? 0;
      return `${b.name.padEnd(16)} ${String(n).padStart(3)} checkpoints  ${b.topic}`;
    })
    .join("\n");
}
