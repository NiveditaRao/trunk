export interface DivergenceInput {
  branchTopic: string;
  recentTurns: string[];
}

export interface DivergenceSuggestion {
  shouldSuggest: boolean;
  confidence: number;
  reason?: string;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "but",
  "can",
  "could",
  "for",
  "from",
  "have",
  "how",
  "into",
  "let",
  "need",
  "now",
  "our",
  "please",
  "should",
  "that",
  "the",
  "then",
  "this",
  "use",
  "with",
  "would",
  "you",
  "your",
]);

const MIN_TOPIC_TOKENS = 2;
const MIN_RECENT_TOKENS = 6;
const LOW_OVERLAP_THRESHOLD = 0.18;
const MIN_CONFIDENCE = 0.78;

export function suggestDivergence(input: DivergenceInput): DivergenceSuggestion {
  const topicTokens = tokenize(input.branchTopic);
  const recentTokens = tokenize(input.recentTurns.join(" "));
  if (topicTokens.size < MIN_TOPIC_TOKENS || recentTokens.size < MIN_RECENT_TOKENS) {
    return { shouldSuggest: false, confidence: 0 };
  }

  const overlap = overlapRatio(topicTokens, recentTokens);
  const confidence = clamp((LOW_OVERLAP_THRESHOLD - overlap) / LOW_OVERLAP_THRESHOLD);
  if (confidence < MIN_CONFIDENCE) {
    return { shouldSuggest: false, confidence };
  }

  return {
    shouldSuggest: true,
    confidence,
    reason:
      "Recent conversation shares very few topic tokens with this branch. Consider forking if you are intentionally changing topics.",
  };
}

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z0-9][a-z0-9-]{2,}/g)) {
    const token = match[0];
    if (!token) continue;
    if (!STOP_WORDS.has(token)) tokens.add(token);
  }
  return tokens;
}

function overlapRatio(topicTokens: Set<string>, recentTokens: Set<string>): number {
  let overlap = 0;
  for (const token of topicTokens) {
    if (recentTokens.has(token)) overlap += 1;
  }
  return overlap / topicTokens.size;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
