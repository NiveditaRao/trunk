export interface DedupCandidate {
  text: string;
  tags: string[];
  kind: "fact" | "hypothesis";
  scope: string;
  confidence: number;
}

export interface ExistingMemoryForDedup {
  _id: string;
  text: string;
  tags: string[];
  kind: "fact" | "hypothesis";
  scope: string;
  confidence: number;
  superseded_by: string | null;
  similarity: number;
  contradiction?: ContradictionVerdict;
}

export type ContradictionVerdict = "contradicts" | "compatible" | "unknown";

export type DedupDecision =
  | { action: "insert"; flaggedIds?: string[] }
  | { action: "reinforce"; id: string; confidence: number }
  | { action: "supersede"; supersededId: string };

// 0.92 is high enough that a neighbour should be a paraphrase, not merely the
// same topic; reinforcement also requires lexical overlap to avoid collapsing
// compatible refinements. 0.78 is lower because contradiction checks are gated:
// we would rather inspect a few extra candidates than miss a trunk conflict.
export const REINFORCE_SIMILARITY_THRESHOLD = 0.92;
export const SUPERSESSION_PREFILTER_THRESHOLD = 0.78;

const POSSIBLE_CONTRADICTION_THRESHOLD = 0.72;
const MIN_LEXICAL_OVERLAP_FOR_REINFORCEMENT = 0.72;
const REINFORCEMENT_LEARNING_RATE = 0.25;

export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function lexicalSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeForComparison(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeForComparison(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

export function inferContradiction(
  left: string,
  right: string,
): ContradictionVerdict {
  const l = normalizeForComparison(left);
  const r = normalizeForComparison(right);
  if (l.length === 0 || r.length === 0) return "unknown";
  if (l === r) return "compatible";

  const shared = lexicalSimilarity(l, r);
  if (shared < 0.3) return "unknown";

  const negationPattern = /\b(no|not|never|without|isn t|aren t|doesn t|don t)\b/;
  if (negationPattern.test(l) !== negationPattern.test(r)) return "contradicts";

  const conflictingGroups = [
    ["cent", "cents", "penny", "pennies", "dollar", "dollars", "usd"],
    ["true", "false"],
    ["enabled", "disabled"],
    ["sync", "async", "synchronous", "asynchronous"],
    ["before", "after"],
  ];
  for (const group of conflictingGroups) {
    const leftTerms = group.filter((term) => hasToken(l, term));
    const rightTerms = group.filter((term) => hasToken(r, term));
    if (leftTerms.length === 0 || rightTerms.length === 0) continue;
    if (!leftTerms.some((term) => rightTerms.includes(term))) return "contradicts";
  }

  return "compatible";
}

export function decideDedup(
  candidate: DedupCandidate,
  matches: ExistingMemoryForDedup[],
): DedupDecision {
  const activeMatches = matches
    .filter((match) => match.superseded_by === null)
    .filter((match) => match.kind === candidate.kind && match.scope === candidate.scope)
    .sort((left, right) => right.similarity - left.similarity);

  const flaggedIds: string[] = [];
  for (const match of activeMatches) {
    const contradiction = match.contradiction ?? inferContradiction(candidate.text, match.text);

    // Embedding similarity is only a prefilter for supersession. It catches
    // pairs worth judging, but the destructive action requires an explicit
    // contradiction verdict because similar facts can be compatible refinements.
    if (
      candidate.kind === "fact" &&
      match.similarity >= SUPERSESSION_PREFILTER_THRESHOLD &&
      contradiction === "contradicts"
    ) {
      return { action: "supersede", supersededId: match._id };
    }

    if (
      candidate.kind === "fact" &&
      match.similarity >= POSSIBLE_CONTRADICTION_THRESHOLD &&
      contradiction === "unknown"
    ) {
      flaggedIds.push(match._id);
    }
  }

  for (const match of activeMatches) {
    const contradiction = match.contradiction ?? inferContradiction(candidate.text, match.text);
    const lexical = lexicalSimilarity(candidate.text, match.text);
    const isExactDuplicate =
      normalizeForComparison(candidate.text) === normalizeForComparison(match.text);
    const isSafeNearDuplicate =
      match.similarity >= REINFORCE_SIMILARITY_THRESHOLD &&
      lexical >= MIN_LEXICAL_OVERLAP_FOR_REINFORCEMENT &&
      contradiction === "compatible";

    // Reinforcement is intentionally stricter than vector proximity alone:
    // embeddings often place "prices are in cents" near "prices are in dollars".
    // Require exact text or strong lexical overlap plus compatibility, then use a
    // damped confidence update so repeated sightings approach 1 without runaway.
    if (isExactDuplicate || isSafeNearDuplicate) {
      return {
        action: "reinforce",
        id: match._id,
        confidence: reinforceConfidence(match.confidence, candidate.confidence),
      };
    }
  }

  return flaggedIds.length > 0 ? { action: "insert", flaggedIds } : { action: "insert" };
}

export function reinforceConfidence(current: number, observed: number): number {
  const safeCurrent = clamp01(current);
  const safeObserved = clamp01(observed);
  const updated = safeCurrent + (1 - safeCurrent) * safeObserved * REINFORCEMENT_LEARNING_RATE;
  return clamp01(Math.round(updated * 1_000_000_000_000) / 1_000_000_000_000);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function hasToken(text: string, token: string): boolean {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`).test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function appearsContradictory(left: string, right: string): boolean {
  return inferContradiction(left, right) === "contradicts";
}
