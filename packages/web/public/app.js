import { applyStreamMessage, classifyMemories, computeLayout, findCrossBranchUses, mergeBranch } from "./graph.js";

// Swap point for Track A: the dashboard tries these live API endpoints first,
// then falls back to committed fixtures so Track C works before the server lands.
const DATA_SOURCE = {
  graphApi: "/api/graph",
  memoriesApi: "/api/memories",
  streamApi: "/api/stream",
  branchApi: "/api/branch",
  fixtureRoots: ["/fixtures", "../../../fixtures", "../../fixtures"],
};

const state = {
  branches: [],
  checkpoints: [],
  memories: [],
  layout: null,
  activeMemory: null,
  source: "fixtures",
  stream: { socket: null, attempts: 0, timer: null },
};

const graphEl = document.getElementById("graph");
const memoriesEl = document.getElementById("memories");
const laneLegendEl = document.getElementById("laneLegend");
const overlayEl = document.getElementById("provenance");
const vizEl = document.getElementById("viz");
const branchDialogEl = document.getElementById("branchDialog");
const branchMessageEl = document.getElementById("branchMessage");
const resumeCommandEl = document.getElementById("resumeCommand");
const copyResumeEl = document.getElementById("copyResume");
const closeBranchEl = document.getElementById("closeBranch");

async function fetchJson(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function loadData() {
  const errors = [];
  try {
    const graph = normalizeGraph(await fetchJson(DATA_SOURCE.graphApi));
    const memories = normalizeMemories(await fetchJson(DATA_SOURCE.memoriesApi));
    return { ...graph, memories, source: "live API" };
  } catch (error) {
    errors.push(`API: ${error.message}`);
  }

  for (const root of DATA_SOURCE.fixtureRoots) {
    try {
      const [branches, checkpoints, memories] = await Promise.all([
        fetchJson(`${root}/branches.json`),
        fetchJson(`${root}/checkpoints.json`),
        fetchJson(`${root}/memories.json`),
      ]);
      return { branches, checkpoints, memories, source: `fixtures at ${root}` };
    } catch (error) {
      errors.push(`${root}: ${error.message}`);
    }
  }

  throw new Error(errors.join("; "));
}

function normalizeGraph(payload) {
  const graph = payload?.graph ?? payload?.data ?? payload;
  if (!Array.isArray(graph?.branches) || !Array.isArray(graph?.checkpoints)) {
    throw new Error("/api/graph did not return { branches, checkpoints }");
  }
  return { branches: graph.branches, checkpoints: graph.checkpoints };
}

function normalizeMemories(payload) {
  const memories = payload?.memories ?? payload?.data?.memories ?? payload;
  if (!Array.isArray(memories)) throw new Error("/api/memories did not return a memory array");
  return memories;
}

async function boot() {
  try {
    const data = await loadData();
    state.branches = data.branches;
    state.checkpoints = data.checkpoints;
    state.memories = data.memories;
    state.source = data.source;
    render();
    connectStream();
  } catch (error) {
    renderLoadError(error);
  }
}

function renderLoadError(error) {
  laneLegendEl.innerHTML = "";
  overlayEl.innerHTML = "";
  graphEl.innerHTML = `
    <div class="load-error" role="alert">
      <h3>Couldn't load graph data</h3>
      <p>The dashboard tried the live API first, then fixture fallbacks. None returned usable JSON.</p>
      <pre>${escapeHtml(error.message)}</pre>
    </div>`;
  memoriesEl.innerHTML = `
    <div class="load-error" role="alert">
      <h3>Couldn't load memories</h3>
      <p>No data was rendered, but the page is alive. Check /api/graph, /api/memories, or fixture serving.</p>
    </div>`;
}

function render() {
  state.layout = computeLayout(state);
  renderLegend(state.layout);
  renderGraph(state.layout);
  renderMemories();
  queueDrawLines();
}

function renderLegend(layout) {
  if (layout.laneMeta.length === 0) {
    laneLegendEl.innerHTML = "<span class=\"empty-inline\">No branch lanes yet</span>";
    return;
  }
  laneLegendEl.innerHTML = layout.laneMeta.map((lane) => `
    <span class="lane-chip lane-${lane.lane}">
      <span class="lane-dot"></span>${escapeHtml(lane.name)} <small>lane ${lane.lane}</small>
    </span>`).join("");
}

function renderGraph(layout, liveCheckpointIds = new Set()) {
  if (layout.nodes.length === 0) {
    graphEl.innerHTML = '<p class="empty">No checkpoints yet. The trunk is ready for the first branch.</p>';
    return;
  }

  const checkpointMemories = groupBy(state.memories, "source_checkpoint");
  graphEl.innerHTML = `
    <svg class="dag" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Checkpoint DAG rendered as branch lanes">
      <defs>
        <filter id="nodeGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      ${layout.laneMeta.map(renderLaneGuide).join("")}
      ${layout.edges.map(renderEdge).join("")}
      ${layout.nodes.map((node) => renderNode(node, checkpointMemories.get(node._id) ?? [], liveCheckpointIds.has(node._id))).join("")}
    </svg>`;
  bindCheckpointActions(graphEl);
}

function renderLaneGuide(lane) {
  return `
    <g class="lane-guide lane-${lane.lane}">
      <line x1="${lane.x}" y1="24" x2="${lane.x}" y2="100%" />
      <text x="${lane.x}" y="24" text-anchor="middle">${escapeSvg(lane.name)}</text>
    </g>`;
}

function renderEdge(edge) {
  return `<path class="edge ${edge.isFork ? "fork" : ""} lane-${edge.toLane}" d="${edge.path}" />`;
}

function renderNode(node, memories, streamIn = false) {
  const memMarks = memories.map((memory, index) => {
    const x = node.x + 28 + index * 16;
    const cls = memory.kind === "fact" ? "fact-mark" : "hypothesis-mark";
    return `<circle class="${cls}" cx="${x}" cy="${node.y - 23}" r="5"><title>${escapeSvg(memory.kind)}: ${escapeSvg(memory.text)}</title></circle>`;
  }).join("");
  const branchAction = `Fork a new branch at checkpoint ${node._id}`;
  return `
    <g class="checkpoint branchable lane-${node.lane} ${node.isFork ? "fork-node" : ""} ${streamIn ? "stream-in" : ""}" data-checkpoint-id="${escapeHtml(node._id)}" role="button" tabindex="0" aria-label="${escapeHtml(branchAction)}" transform="translate(${node.x} ${node.y})">
      <circle r="16" />
      <text class="cp-id" x="0" y="5" text-anchor="middle">${escapeSvg(node._id.replace("cp_", ""))}</text>
      <text class="cp-label" x="30" y="-8">${escapeSvg(node.label ?? node.branchName)}</text>
      <text class="cp-summary" x="30" y="13">${escapeSvg(node.summary)}</text>
    </g>
    ${memMarks}`;
}

function renderMemories() {
  const groups = classifyMemories(state.memories, state.checkpoints);
  if (groups.all.length === 0) {
    memoriesEl.innerHTML = '<p class="empty">No memories yet. Facts will enter the shared trunk; hypotheses will stay branch-local.</p>';
    return;
  }

  const cards = [
    `<div class="pool-column shared" data-memory-column="shared"><h3>Trunk facts <span>shared across every lane</span></h3>${groups.sharedFacts.map((memory) => renderMemoryCard(memory)).join("")}</div>`,
    `<div class="pool-column trapped" data-memory-column="trapped"><h3>Branch hypotheses <span>trapped where born</span></h3>${groups.branchHypotheses.map((memory) => renderMemoryCard(memory)).join("")}</div>`,
  ];
  if (groups.other.length) cards.push(`<div class="pool-column" data-memory-column="other"><h3>Needs classification</h3>${groups.other.map((memory) => renderMemoryCard(memory)).join("")}</div>`);
  memoriesEl.innerHTML = cards.join("");

  bindMemoryCards(memoriesEl);
}

function renderMemoryCard(memory, streamIn = false) {
  const sourceBranch = branchName(memory.sourceBranch);
  const sourceCheckpoint = state.checkpoints.find((cp) => cp._id === memory.source_checkpoint);
  const originLane = state.layout?.lanes.get(memory.sourceBranch) ?? 0;
  const uses = findCrossBranchUses(memory, state.checkpoints);
  const isMoneyShot = memory._id === "mem_004" || uses.length > 0;
  const scopeText = memory.scope === "trunk" ? "scope: trunk — all branches" : `scope: ${branchName(memory.scope)} only`;
  const stateClasses = ["memory-card", memory.kind, memory.isSuperseded ? "superseded" : "", isMoneyShot ? "money-shot" : "", streamIn ? "stream-in" : ""].filter(Boolean).join(" ");
  return `
    <article class="${stateClasses}" tabindex="0" data-memory-id="${escapeHtml(memory._id)}" data-source-checkpoint="${escapeHtml(memory.source_checkpoint)}" data-use-checkpoints="${uses.map((cp) => escapeHtml(cp._id)).join(" ")}">
      <div class="memory-topline">
        <span class="kind-pill">${memory.kind === "fact" ? "FACT" : "HYPOTHESIS"}</span>
        <span class="scope-pill">${escapeHtml(scopeText)}</span>
      </div>
      <p class="memory-text">${escapeHtml(memory.text)}</p>
      <p class="memory-meta">born at <strong>${escapeHtml(memory.source_checkpoint)}</strong> in <strong class="lane-name lane-${originLane}">${escapeHtml(sourceBranch)}</strong>${sourceCheckpoint?.label ? ` · ${escapeHtml(sourceCheckpoint.label)}` : ""}</p>
      ${memory.isSuperseded ? `<p class="superseded-note">superseded by ${escapeHtml(memory.superseded_by)}</p>` : ""}
      ${uses.length ? `<p class="reuse-note">↳ reused from ${uses.map((cp) => `${escapeHtml(branchName(cp.branch_id))} / ${escapeHtml(cp._id)}`).join(", ")}</p>` : ""}
    </article>`;
}

function bindMemoryCards(root) {
  root.querySelectorAll(".memory-card").forEach((card) => {
    if (card.dataset.bound === "true") return;
    card.dataset.bound = "true";
    card.addEventListener("mouseenter", () => setActiveMemory(card.dataset.memoryId));
    card.addEventListener("focus", () => setActiveMemory(card.dataset.memoryId));
    card.addEventListener("mouseleave", () => setActiveMemory(null));
    card.addEventListener("blur", () => setActiveMemory(null));
  });
}

function bindCheckpointActions(root) {
  root.querySelectorAll(".checkpoint.branchable").forEach((node) => {
    if (node.dataset.bound === "true") return;
    node.dataset.bound = "true";
    node.addEventListener("click", () => createBranchFromCheckpoint(node.dataset.checkpointId));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        createBranchFromCheckpoint(node.dataset.checkpointId);
      }
    });
  });
}

function connectStream() {
  if (state.source !== "live API" || !("WebSocket" in window)) return;
  clearTimeout(state.stream.timer);

  const socket = new WebSocket(socketUrl(DATA_SOURCE.streamApi));
  state.stream.socket = socket;

  socket.addEventListener("open", () => {
    state.stream.attempts = 0;
  });
  socket.addEventListener("message", (event) => {
    try {
      applyLiveMessage(JSON.parse(event.data));
    } catch {
      // Malformed stream payloads should never break the demo.
    }
  });
  socket.addEventListener("close", scheduleReconnect);
  socket.addEventListener("error", () => socket.close());
}

function scheduleReconnect() {
  if (state.source !== "live API") return;
  const delay = Math.min(15_000, 400 * 2 ** state.stream.attempts);
  state.stream.attempts += 1;
  clearTimeout(state.stream.timer);
  state.stream.timer = setTimeout(connectStream, delay);
}

function applyLiveMessage(message) {
  const before = {
    branches: new Set(state.branches.map((branch) => branch._id)),
    checkpoints: new Set(state.checkpoints.map((cp) => cp._id)),
    memories: new Set(state.memories.map((memory) => memory._id)),
  };
  const result = applyStreamMessage(state, message);
  if (!result.changed) return;

  Object.assign(state, result.state);
  if (result.kind === "checkpoint") {
    updateGraphForState(difference(state.checkpoints.map((cp) => cp._id), before.checkpoints));
    updateMemoryCardsForCheckpoint(result.id);
  } else if (result.kind === "memory") {
    state.layout = computeLayout(state);
    upsertMemoryCard(result.id, !before.memories.has(result.id));
  }
  queueDrawLines();
}

function updateGraphForState(liveCheckpointIds = []) {
  const previous = state.layout;
  const next = computeLayout(state);
  state.layout = next;
  renderLegend(next);

  if (!patchGraph(previous, next, new Set(liveCheckpointIds))) {
    renderGraph(next, new Set(liveCheckpointIds));
  }
}

function patchGraph(previous, next, liveCheckpointIds) {
  const svg = graphEl.querySelector("svg.dag");
  if (!svg || !previous) return false;

  for (const oldNode of previous.nodes) {
    const newNode = next.nodeById.get(oldNode._id);
    if (!newNode || oldNode.x !== newNode.x || oldNode.y !== newNode.y || oldNode.lane !== newNode.lane) {
      return false;
    }
  }

  svg.setAttribute("viewBox", `0 0 ${next.width} ${next.height}`);
  for (const lane of next.laneMeta.filter((lane) => !previous.lanes.has(lane.id))) {
    svg.insertAdjacentHTML("beforeend", renderLaneGuide(lane).replace('class="lane-guide', 'class="lane-guide stream-in'));
  }

  const existingEdges = new Set(previous.edges.map((edge) => `${edge.from}->${edge.to}`));
  const checkpointMemories = groupBy(state.memories, "source_checkpoint");
  for (const edge of next.edges.filter((edge) => !existingEdges.has(`${edge.from}->${edge.to}`))) {
    svg.insertAdjacentHTML("beforeend", renderEdge(edge));
  }
  for (const node of next.nodes.filter((node) => !previous.nodeById.has(node._id))) {
    svg.insertAdjacentHTML("beforeend", renderNode(node, checkpointMemories.get(node._id) ?? [], liveCheckpointIds.has(node._id)));
  }
  bindCheckpointActions(svg);
  return true;
}

function updateMemoryCardsForCheckpoint(checkpointId) {
  for (const memory of state.memories) {
    const card = memoriesEl.querySelector(`[data-memory-id="${cssEscape(memory._id)}"]`);
    if (!card) continue;
    const uses = findCrossBranchUses(memory, state.checkpoints).map((cp) => cp._id).join(" ");
    if (memory.source_checkpoint === checkpointId || card.dataset.useCheckpoints !== uses) {
      upsertMemoryCard(memory._id, false);
    }
  }
}

function upsertMemoryCard(memoryId, streamIn) {
  const groups = classifyMemories(state.memories, state.checkpoints);
  const memory = groups.all.find((candidate) => candidate._id === memoryId);
  if (!memory) return;

  ensureMemoryColumns(groups);
  const column = memoriesEl.querySelector(`[data-memory-column="${memoryColumn(memory)}"]`);
  const existing = memoriesEl.querySelector(`[data-memory-id="${cssEscape(memoryId)}"]`);
  const html = renderMemoryCard(memory, streamIn);
  if (existing) {
    existing.outerHTML = html;
    bindMemoryCards(memoriesEl);
    return;
  }

  column?.insertAdjacentHTML("beforeend", html);
  bindMemoryCards(memoriesEl);
}

function ensureMemoryColumns(groups) {
  if (!memoriesEl.querySelector("[data-memory-column]")) {
    if (groups.all.length === 0) return;
    memoriesEl.innerHTML = [
      '<div class="pool-column shared" data-memory-column="shared"><h3>Trunk facts <span>shared across every lane</span></h3></div>',
      '<div class="pool-column trapped" data-memory-column="trapped"><h3>Branch hypotheses <span>trapped where born</span></h3></div>',
    ].join("");
  }
  if (!memoriesEl.querySelector('[data-memory-column="other"]')) {
    memoriesEl.insertAdjacentHTML("beforeend", '<div class="pool-column" data-memory-column="other"><h3>Needs classification</h3></div>');
  }
}

function memoryColumn(memory) {
  if (memory.isSharedFact) return "shared";
  if (memory.isBranchHypothesis) return "trapped";
  return "other";
}

async function createBranchFromCheckpoint(checkpointId) {
  if (state.source !== "live API") {
    showBranchMessage("Fixtures mode: click-to-branch needs the live API. Start the server, then click this checkpoint again.", "");
    return;
  }

  const checkpoint = state.checkpoints.find((cp) => cp._id === checkpointId);
  const fallbackTopic = checkpoint?.summary ? `Fork from ${checkpoint.summary.slice(0, 56)}` : `Fork from ${checkpointId}`;
  const prompted = window.prompt("Topic for the new branch?", fallbackTopic);
  const topic = (prompted ?? fallbackTopic).trim() || fallbackTopic;

  try {
    const response = await fetch(DATA_SOURCE.branchApi, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ checkpoint_id: checkpointId, topic }),
    });
    if (!response.ok) throw new Error(`/api/branch returned ${response.status}`);
    const result = await response.json();
    const branchId = result.branch_id ?? result.branch?._id;
    if (!branchId) throw new Error("/api/branch did not return branch_id");

    const branch = result.branch ?? {
      _id: branchId,
      name: result.name ?? branchId,
      root_checkpoint: checkpointId,
      topic,
      created_at: new Date().toISOString(),
    };
    Object.assign(state, mergeBranch(state, branch).state);
    updateGraphForState();
    showBranchMessage(`New lane ready: ${branch.name ?? branchId}`, result.resume_command ?? `trunk resume ${branchId}`);
  } catch (error) {
    showBranchMessage(`Could not create a branch: ${error.message}`, "");
  }
}

function showBranchMessage(message, command) {
  branchMessageEl.textContent = message;
  resumeCommandEl.textContent = command;
  branchDialogEl.hidden = false;
  branchDialogEl.classList.toggle("has-command", Boolean(command));
  if (command) copyResumeEl.focus();
}

function difference(ids, before) {
  return ids.filter((id) => !before.has(id));
}

function socketUrl(path) {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function setActiveMemory(memoryId) {
  state.activeMemory = memoryId;
  document.querySelectorAll(".memory-card, .checkpoint").forEach((el) => el.classList.remove("active", "use-active"));
  if (memoryId) {
    const card = document.querySelector(`[data-memory-id="${cssEscape(memoryId)}"]`);
    card?.classList.add("active");
    const source = card?.dataset.sourceCheckpoint;
    if (source) document.querySelector(`[data-checkpoint-id="${cssEscape(source)}"]`)?.classList.add("active");
    for (const id of (card?.dataset.useCheckpoints ?? "").split(" ").filter(Boolean)) {
      document.querySelector(`[data-checkpoint-id="${cssEscape(id)}"]`)?.classList.add("use-active");
    }
  }
  drawProvenanceLines();
}

function queueDrawLines() {
  requestAnimationFrame(drawProvenanceLines);
}

function drawProvenanceLines() {
  const vizRect = vizEl.getBoundingClientRect();
  overlayEl.setAttribute("viewBox", `0 0 ${vizRect.width} ${vizRect.height}`);
  overlayEl.setAttribute("width", String(vizRect.width));
  overlayEl.setAttribute("height", String(vizRect.height));

  const paths = [];
  document.querySelectorAll(".memory-card").forEach((card) => {
    const source = document.querySelector(`[data-checkpoint-id="${cssEscape(card.dataset.sourceCheckpoint)}"]`);
    if (!source) return;
    paths.push(lineFor(card, source, "origin-line", card.dataset.memoryId));
    for (const id of (card.dataset.useCheckpoints ?? "").split(" ").filter(Boolean)) {
      const use = document.querySelector(`[data-checkpoint-id="${cssEscape(id)}"]`);
      if (use) paths.push(lineFor(card, use, "use-line", card.dataset.memoryId));
    }
  });
  overlayEl.innerHTML = paths.join("");
}

function lineFor(card, node, cls, memoryId) {
  const vizRect = vizEl.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const n = node.getBoundingClientRect();
  const x1 = c.left - vizRect.left + c.width / 2;
  const y1 = c.top - vizRect.top;
  const x2 = n.left - vizRect.left + 16;
  const y2 = n.top - vizRect.top + 16;
  const midY = y1 - Math.max(50, (y1 - y2) * 0.42);
  const active = !state.activeMemory || state.activeMemory === memoryId ? "visible" : "muted";
  return `<path class="${cls} ${active}" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${midY.toFixed(1)}, ${x2.toFixed(1)} ${midY.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" />`;
}

function branchName(branchId) {
  return state.branches.find((branch) => branch._id === branchId)?.name ?? branchId ?? "unknown branch";
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const value = item[key];
    map.set(value, [...(map.get(value) ?? []), item]);
  }
  return map;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function escapeSvg(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

closeBranchEl.addEventListener("click", () => {
  branchDialogEl.hidden = true;
});
copyResumeEl.addEventListener("click", async () => {
  const command = resumeCommandEl.textContent.trim();
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    copyResumeEl.textContent = "Copied";
    setTimeout(() => {
      copyResumeEl.textContent = "Copy command";
    }, 1400);
  } catch {
    window.getSelection()?.selectAllChildren(resumeCommandEl);
  }
});
window.addEventListener("resize", queueDrawLines);
boot();
