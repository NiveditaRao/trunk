export type ClassifiedKind = "fact" | "hypothesis";

export interface ClassificationDecision {
  kind: ClassifiedKind;
  confidence: number;
  rationale: string;
}

export const CLASSIFICATION_RUBRIC = `
You extract durable project memories from one conversation turn.

Return JSON only: {"memories":[{"text":string,"tags":string[],"kind":"fact"|"hypothesis","confidence":number}]}

Extraction bar:
- Extract only information likely to help a future agent. Prefer zero or one memory over noisy memories.
- Do not store generic advice, temporary narration, greetings, or restatements of the user's question.
- Write memories as standalone sentences without "the user said" framing.

Classification is asymmetric because the cost of mistakes is asymmetric:
- A wrongly branch-scoped fact is merely hidden until rediscovered or promoted.
- A wrongly trunk-scoped hypothesis poisons every branch and disproves Trunk's premise.
Therefore ambiguous memories MUST be classified as "hypothesis".

Classify as FACT only when the memory describes something true independent of this branch:
- observed or verified properties of the codebase, schema, infrastructure, or runtime
- explicit constraints, conventions, deployed versions, current behavior, or resolved findings
- examples: "Prices are stored in cents", "The schema uses snake_case", "Redis 7 is deployed"

Classify as HYPOTHESIS when the memory depends on this branch's exploration:
- assumptions, proposals, trials, plans, alternatives, design sketches, unverified theories
- markers: "let's assume", "assume", "what if", "suppose", "for now", "try", "maybe",
  "consider", "could", "would", "might", "proposal", "option", conditional/subjunctive language
- examples: "Assume checkout migrates to the pricing service", "Try token bucket at 100 req/min"

If fact and hypothesis signals both appear, choose HYPOTHESIS unless the speculative text is only
context and the memory itself is a verified durable property.
`.trim();

const HYPOTHESIS_PATTERNS: RegExp[] = [
  /\blet'?s assume\b/i,
  /\bassume\b/i,
  /\bwhat if\b/i,
  /\bsuppose\b/i,
  /\bfor now\b/i,
  /\btry\b/i,
  /\bmaybe\b/i,
  /\bconsider\b/i,
  /\bcould\b/i,
  /\bwould\b/i,
  /\bmight\b/i,
  /\bproposal\b/i,
  /\boption\b/i,
  /\bexperiment\b/i,
  /\bexplor(e|ing|ation)\b/i,
  /\bif we\b/i,
];

const FACT_PATTERNS: RegExp[] = [
  /\b(is|are|uses|use|stores|stored|runs|running|deployed|requires|required|must|never|always)\b/i,
  /\bfound\b/i,
  /\bverified\b/i,
  /\bconfirmed\b/i,
  /\bobserved\b/i,
  /\bschema\b/i,
  /\bcurrent(ly)?\b/i,
];

export function classifyMemoryText(text: string): ClassificationDecision {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return {
      kind: "hypothesis",
      confidence: 0,
      rationale: "Empty memories are not durable facts.",
    };
  }

  const hasHypothesisSignal = HYPOTHESIS_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  if (hasHypothesisSignal) {
    return {
      kind: "hypothesis",
      confidence: 0.72,
      rationale:
        "Speculative or branch-local language is present; defaulting to branch scope avoids trunk poisoning.",
    };
  }

  const hasFactSignal = FACT_PATTERNS.some((pattern) => pattern.test(normalized));
  if (hasFactSignal) {
    return {
      kind: "fact",
      confidence: 0.64,
      rationale:
        "The memory describes an observed constraint or property without speculative markers.",
    };
  }

  return {
    kind: "hypothesis",
    confidence: 0.45,
    rationale:
      "No strong durability signal; ambiguous memories stay branch-scoped by design.",
  };
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function inferTags(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
  return [...new Set(words)].slice(0, 4);
}

export function extractHeuristicCandidates(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24)
    .filter((sentence) => !sentence.endsWith("?"))
    .filter((sentence) => !/^where should i|^what should i|^how do i/i.test(sentence))
    .slice(0, 3);
}
