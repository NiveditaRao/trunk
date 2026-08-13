import type { Checkpoint, Memory } from "@trunk/core";

const MAX_BRIEF_LINES = 8;

export function orderCheckpoints(checkpoints: Checkpoint[]): Checkpoint[] {
  return [...checkpoints].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
}

export function distillBrief(params: {
  topic: string;
  checkpoints: Checkpoint[];
}): string {
  const ordered = orderCheckpoints(params.checkpoints);
  if (ordered.length === 0) {
    return `No checkpoints exist yet for "${params.topic}". Start by explaining the current goal, then call checkpoint after the first turn.`;
  }

  const recent = ordered.slice(Math.max(0, ordered.length - MAX_BRIEF_LINES));
  const lines = [
    `Branch topic: ${params.topic}`,
    "Relevant checkpoint path:",
    ...recent.map((checkpoint) => {
      const label = checkpoint.label ? ` [${checkpoint.label}]` : "";
      return `- ${checkpoint.summary}${label}`;
    }),
  ];

  if (ordered.length > recent.length) {
    lines.splice(
      2,
      0,
      `- Earlier path condensed from ${ordered.length - recent.length} checkpoint(s).`,
    );
  }

  return lines.join("\n");
}

export function formatResumeMemories(
  memories: Memory[],
): Array<{ text: string; kind: Memory["kind"]; confidence: number }> {
  return memories.map((memory) => ({
    text: memory.text,
    kind: memory.kind,
    confidence: memory.confidence,
  }));
}
