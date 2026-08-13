const CHECKPOINT_X = 120;
const CHECKPOINT_Y = 54;
const LANE_GAP = 190;
const ROW_GAP = 86;
const GRAPH_PAD_X = 80;
const GRAPH_PAD_Y = 48;

function timeOf(value) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function byTimeThenId(a, b) {
  return timeOf(a.ts ?? a.created_at) - timeOf(b.ts ?? b.created_at) || String(a._id).localeCompare(String(b._id));
}

function branchSortKey(branch, ordered, byId) {
  if (branch.name === "main" || branch._id === "br_main") return [-1, 0, branch._id];
  const first = ordered.find((cp) => cp.branch_id === branch._id);
  const root = branch.root_checkpoint ? byId.get(branch.root_checkpoint) : null;
  return [timeOf(first?.ts ?? branch.created_at), timeOf(root?.ts ?? branch.created_at), branch._id];
}

export function computeLayout({ branches = [], checkpoints = [] } = {}) {
  const ordered = [...checkpoints].sort(byTimeThenId);
  const byId = new Map(ordered.map((cp) => [cp._id, cp]));
  const branchById = new Map(branches.map((branch) => [branch._id, branch]));

  const branchIds = new Set(branches.map((branch) => branch._id));
  for (const cp of ordered) branchIds.add(cp.branch_id);

  const sortedBranches = [...branchIds]
    .map((id) => branchById.get(id) ?? { _id: id, name: id, root_checkpoint: null, created_at: ordered.find((cp) => cp.branch_id === id)?.ts ?? 0 })
    .sort((a, b) => {
      const ak = branchSortKey(a, ordered, byId);
      const bk = branchSortKey(b, ordered, byId);
      return ak[0] - bk[0] || ak[1] - bk[1] || String(ak[2]).localeCompare(String(bk[2]));
    });

  const lanes = new Map(sortedBranches.map((branch, index) => [branch._id, index]));
  const laneMeta = sortedBranches.map((branch, index) => ({
    id: branch._id,
    name: branch.name ?? branch._id,
    topic: branch.topic ?? "",
    lane: index,
    x: GRAPH_PAD_X + CHECKPOINT_X + index * LANE_GAP,
  }));

  const nodes = ordered.map((cp, index) => {
    const lane = lanes.get(cp.branch_id) ?? 0;
    return {
      ...cp,
      index,
      lane,
      x: GRAPH_PAD_X + CHECKPOINT_X + lane * LANE_GAP,
      y: GRAPH_PAD_Y + CHECKPOINT_Y + index * ROW_GAP,
      branchName: branchById.get(cp.branch_id)?.name ?? cp.branch_id,
      isFork: cp.parent_id !== null && byId.get(cp.parent_id)?.branch_id !== cp.branch_id,
    };
  });

  const nodeById = new Map(nodes.map((node) => [node._id, node]));
  const edges = nodes
    .filter((node) => node.parent_id && nodeById.has(node.parent_id))
    .map((node) => {
      const parent = nodeById.get(node.parent_id);
      return {
        from: parent._id,
        to: node._id,
        fromLane: parent.lane,
        toLane: node.lane,
        path: edgePath(parent, node),
        isFork: parent.lane !== node.lane,
      };
    });

  const width = Math.max(760, GRAPH_PAD_X * 2 + CHECKPOINT_X * 2 + Math.max(0, sortedBranches.length - 1) * LANE_GAP + 360);
  const height = ordered.length === 0 ? 260 : GRAPH_PAD_Y * 2 + CHECKPOINT_Y * 2 + Math.max(0, ordered.length - 1) * ROW_GAP;

  return { lanes, laneMeta, nodes, edges, nodeById, width, height, ordered };
}

function edgePath(parent, node) {
  const midY = parent.y + (node.y - parent.y) * 0.55;
  if (parent.lane === node.lane) return `M ${parent.x} ${parent.y + 14} L ${node.x} ${node.y - 14}`;
  return `M ${parent.x} ${parent.y + 14} L ${parent.x} ${midY} C ${parent.x} ${node.y - 26}, ${node.x} ${midY}, ${node.x} ${node.y - 14}`;
}

export function classifyMemories(memories = [], checkpoints = []) {
  const checkpointBranch = new Map(checkpoints.map((cp) => [cp._id, cp.branch_id]));
  const sharedFacts = [];
  const branchHypotheses = [];
  const other = [];

  for (const memory of memories) {
    const sourceBranch = checkpointBranch.get(memory.source_checkpoint) ?? null;
    const enriched = {
      ...memory,
      sourceBranch,
      isSuperseded: Boolean(memory.superseded_by),
      isSharedFact: memory.kind === "fact" && memory.scope === "trunk",
      isBranchHypothesis: memory.kind === "hypothesis" && memory.scope !== "trunk",
    };

    if (enriched.isSharedFact) sharedFacts.push(enriched);
    else if (enriched.isBranchHypothesis) branchHypotheses.push(enriched);
    else other.push(enriched);
  }

  return { sharedFacts, branchHypotheses, other, all: [...sharedFacts, ...branchHypotheses, ...other] };
}

export function findCrossBranchUses(memory, checkpoints = []) {
  if (!(memory.kind === "fact" && memory.scope === "trunk")) return [];
  const source = checkpoints.find((cp) => cp._id === memory.source_checkpoint);
  if (!source) return [];
  const sourceTime = timeOf(source.ts);
  const tokens = new Set([
    ...(memory.tags ?? []),
    ...String(memory.text).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 5),
  ]);
  const weak = new Set(["stored", "throughout", "running", "cluster", "mode", "never", "floats", "schema"]);
  for (const token of weak) tokens.delete(token);

  return checkpoints
    .filter((cp) => cp.branch_id !== source.branch_id && timeOf(cp.ts) > sourceTime)
    .filter((cp) => {
      const summary = String(cp.summary ?? "").toLowerCase();
      return [...tokens].some((token) => summary.includes(token));
    })
    .sort(byTimeThenId);
}

export function applyStreamMessage(current, message) {
  if (!isRecord(message) || !isRecord(message.doc)) {
    return unchanged(current, "malformed");
  }

  if (message.type === "checkpoint") {
    return mergeCheckpoint(current, message.doc);
  }
  if (message.type === "memory") {
    return mergeMemory(current, message.doc);
  }

  return unchanged(current, "unknown-type");
}

export function mergeBranch(current, doc) {
  const branch = normalizeBranchDoc(doc);
  if (!branch) return unchanged(current, "invalid-branch");
  const branches = upsertById(current.branches ?? [], branch);
  const changed = branches !== (current.branches ?? []);
  return { state: { ...current, branches }, changed, kind: "branch", id: branch._id, addedIds: changed ? [branch._id] : [] };
}

export function mergeCheckpoint(current, doc) {
  const checkpoint = normalizeCheckpointDoc(doc);
  if (!checkpoint) return unchanged(current, "invalid-checkpoint");

  const branches = ensureBranch(current.branches ?? [], checkpoint);
  const checkpoints = upsertById(current.checkpoints ?? [], checkpoint);
  const changed = branches !== (current.branches ?? []) || checkpoints !== (current.checkpoints ?? []);

  return {
    state: { ...current, branches, checkpoints },
    changed,
    kind: "checkpoint",
    id: checkpoint._id,
    addedIds: changed ? [checkpoint._id] : [],
  };
}

export function mergeMemory(current, doc) {
  const memory = normalizeMemoryDoc(doc);
  if (!memory) return unchanged(current, "invalid-memory");

  const memories = upsertById(current.memories ?? [], memory);
  const changed = memories !== (current.memories ?? []);
  return { state: { ...current, memories }, changed, kind: "memory", id: memory._id, addedIds: changed ? [memory._id] : [] };
}

function normalizeBranchDoc(doc) {
  if (!isRecord(doc) || !isNonEmptyString(doc._id)) return null;
  return {
    _id: doc._id,
    name: isNonEmptyString(doc.name) ? doc.name : doc._id,
    root_checkpoint: doc.root_checkpoint ?? null,
    topic: String(doc.topic ?? ""),
    created_at: doc.created_at ?? new Date().toISOString(),
  };
}

function normalizeCheckpointDoc(doc) {
  if (!isRecord(doc) || !isNonEmptyString(doc._id) || !isNonEmptyString(doc.branch_id)) return null;
  return {
    _id: doc._id,
    branch_id: doc.branch_id,
    parent_id: doc.parent_id ?? null,
    label: doc.label ?? null,
    summary: String(doc.summary ?? "Checkpoint saved"),
    ts: doc.ts ?? doc.created_at ?? new Date().toISOString(),
  };
}

function normalizeMemoryDoc(doc) {
  if (
    !isRecord(doc) ||
    !isNonEmptyString(doc._id) ||
    !isNonEmptyString(doc.text) ||
    !["fact", "hypothesis"].includes(doc.kind) ||
    !isNonEmptyString(doc.source_checkpoint)
  ) {
    return null;
  }

  return {
    _id: doc._id,
    text: doc.text,
    embedding: Array.isArray(doc.embedding) ? doc.embedding : [],
    tags: Array.isArray(doc.tags) ? doc.tags.filter((tag) => typeof tag === "string") : [],
    kind: doc.kind,
    scope: isNonEmptyString(doc.scope) ? doc.scope : (doc.kind === "fact" ? "trunk" : "unknown"),
    source_checkpoint: doc.source_checkpoint,
    confidence: typeof doc.confidence === "number" ? doc.confidence : 0,
    valid_from: doc.valid_from ?? doc.created_at ?? new Date().toISOString(),
    superseded_by: doc.superseded_by ?? null,
  };
}

function ensureBranch(branches, checkpoint) {
  if (branches.some((branch) => branch._id === checkpoint.branch_id)) return branches;
  return [
    ...branches,
    {
      _id: checkpoint.branch_id,
      name: checkpoint.branch_id,
      root_checkpoint: checkpoint.parent_id ?? null,
      topic: "",
      created_at: checkpoint.ts,
    },
  ];
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate?._id === item._id);
  if (index === -1) return [...items, item];
  if (JSON.stringify(items[index]) === JSON.stringify(item)) return items;
  return [...items.slice(0, index), { ...items[index], ...item }, ...items.slice(index + 1)];
}

function unchanged(current, reason) {
  return { state: current, changed: false, kind: null, id: null, addedIds: [], reason };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export const GRAPH_CONSTANTS = { CHECKPOINT_X, CHECKPOINT_Y, LANE_GAP, ROW_GAP, GRAPH_PAD_X, GRAPH_PAD_Y };
