# Trunk

**Chats fork. Memory doesn't.**

You are debugging checkout. The agent learns useful facts: prices are stored in cents, and the database schema is `snake_case`. Ten minutes later a rate-limiter design question appears. Today you either keep both topics in one chat and checkout assumptions leak into the rate-limiter answer, or you open a new chat and explain the useful facts again.

Trunk separates the two things most tools weld together:

- **Conversation branches**: checkpoint any turn, then fork a new lane for a different topic.
- **Memory stays on the trunk**: durable knowledge is available to every lane without replaying the whole transcript.

Built for the MongoDB Persistent Context Sprint.

---

## The hard idea

Sharing every memory across every branch would just move context pollution into the vector store. Trunk classifies each memory before it is stored.

| Kind | Scope | Crosses branches? | Example |
|---|---|---:|---|
| **Fact** | `trunk` | Yes | "Prices are stored in cents." |
| **Fact** | `trunk` | Yes | "The schema uses `snake_case`." |
| **Hypothesis** | `<branch_id>` | No | "Assume this branch switches the rate limiter to Redis." |
| **Hypothesis** | `<branch_id>` | No | "The checkout 500 is probably a rounding bug." |

A hypothesis becomes shared only when the user explicitly calls `promote(memory_id)`. Getting this fact/hypothesis decision right is the project; the rest is plumbing.

---

## Current status

This repository is moving quickly. These docs describe what is authored today, not what we hope will exist later.

| Area | Status |
|---|---|
| Core contracts | Authored: schemas, tool names, provider interfaces, config loading, MongoDB typed collections. |
| MCP tool surface | Authored: stdio MCP server exposes `checkpoint`, `fork_from`, `resume`, `remember`, `promote`, `recall`, `list_branches`. |
| Checkpoint DAG | Authored: parent-pointer checkpoint documents; ancestry uses MongoDB `$graphLookup`. |
| Memory engine | Authored: heuristic/LLM extraction path, classification helpers, vector write/recall, dedup/supersession hooks, branch-scope enforcement. Not live-tested here. |
| Providers | Authored: OpenAI, Voyage, Azure, Ollama interfaces/adapters and `trunk init` entry points. Not verified against live services here. |
| Render/web/eval | Authored: ASCII graph renderer, fixture-driven dashboard assets, simple eval scorer. |
| Build/runtime verification | **Not verified on this machine** because npm registry access is blocked and no `node_modules`/lockfile is present. Several packages are authored but have not been compiled in this environment. |
| Known script gap | Root `npm run dev` currently points at workspace `@trunk/server`, but the server package is named `trunk-mcp` and has no `dev` script. Use the built server entrypoint until scripts are fixed. |

If a demo is running, prefer the committed fixtures first; they are synthetic, key-free, and designed to show scope behavior without depending on live model calls.

---

## Development environment

`registry.npmjs.org` is blocked by corporate policy on this machine. Do **not** run `npm install` here, and do not use mirrors, disabled TLS, or sideloaded dependencies.

**Sanctioned path: GitHub Codespaces on a personal account.** It is a GitHub product, npm is reachable there, nothing is installed on the corporate laptop, and this public hackathon repo should use personal identity anyway.

```text
GitHub repo -> Code -> Codespaces -> Create codespace on main
```

The devcontainer runs `npm install` automatically.

---

## Quick start in Codespaces

```bash
node --version          # Node 24 preferred; package.json currently says >=20
npm install             # Codespaces only; do not run on the blocked laptop
npm test                # Node's built-in test runner
npm run typecheck
npm run build
```

Testing standard: **`node --test`**. We deliberately do **not** use Vitest; it would require package installation in the blocked environment, and Node 24 can run TypeScript tests natively.

Configure MongoDB and providers with environment variables or a gitignored config file. Secrets never belong in this repository.

```bash
export TRUNK_MONGODB_URI='mongodb+srv://...'
export TRUNK_MONGODB_DB='trunk'
npx trunk init
node packages/server/dist/index.js
```

Register that stdio command with your MCP host. See [`docs/hosts.md`](docs/hosts.md) for host-specific config.

---

## MCP tools

| Tool | Purpose |
|---|---|
| `checkpoint(label?, summary, user_message, assistant_message)` | Save the current turn and extract candidate memories. |
| `fork_from(checkpoint_id, topic, name?)` | Create a branch rooted at a checkpoint and return a `resume(...)` command. |
| `resume(id)` | Return a distilled brief plus relevant trunk memories for a fresh session. |
| `remember(text, tags?, kind)` | Manually write a fact to the trunk or a hypothesis to the active branch. |
| `promote(memory_id)` | Promote a branch-local hypothesis into the trunk. Explicit only. |
| `recall(query, k?, tags?)` | Return trunk facts plus the active branch's own hypotheses. |
| `list_branches()` | List branches and render the checkpoint graph inline. |

An MCP server cannot prune the host's transcript. Isolation comes from opening a fresh host session and calling `resume(id)` there. The old transcript stays behind; the new window receives only a distilled brief and relevant trunk facts.

---

## Architecture in one picture

```text
MCP host ──stdio──> trunk-mcp server ──> MemoryEngine ──> MongoDB Atlas
 Copilot CLI          tools + DAG          classify/embed      checkpoints
 Claude Code          resume brief         recall/dedup        memories
 Cursor/Zed                                                   vector/text search
```

MongoDB is load-bearing here: parent-pointer checkpoint documents make the branch tree natural; `$graphLookup` resolves ancestry; Atlas Vector Search stores memory beside provenance; change streams can drive the dashboard without polling.

Atlas M0 shaped the design: three search indexes max (vector + text + one spare), 512 MB storage cap, and one free cluster per project. A 768-dimensional local embedding model is attractive because it uses about half the vector storage of a 1536-dimensional OpenAI embedding.

More detail: [`docs/architecture.md`](docs/architecture.md). Demo run sheet: [`docs/demo.md`](docs/demo.md).

---

## Packages

| Package | Owner track | Responsibility |
|---|---|---|
| `packages/core` | Shared | Frozen contracts: schema, MCP tool types, provider/config/db interfaces. |
| `packages/server` | A | MCP stdio server, checkpoint DAG, fork/resume, divergence hints. Package name: `trunk-mcp`. |
| `packages/memory` | B | Extraction, classification, vector recall, dedup, supersession, scope enforcement. |
| `packages/providers` | B | Embedding/LLM adapters and `trunk init`. |
| `packages/render` | C | Dependency-light ASCII branch graph. |
| `packages/web` | C | Static dashboard assets and graph/memory-pool UI. |
| `packages/eval` | B | Scenario scoring: contamination vs retention. |

---

## Evaluation

The eval harness compares three conditions:

| Condition | What happens | Expected result |
|---|---|---|
| Unforked | Both topics remain in one transcript. | Retains facts but contaminates topic B. |
| Fresh session | New transcript, no memory. | Clean but forgets useful facts. |
| Trunk | Fresh branch session plus shared trunk facts. | Clean and informed. |

Metrics are intentionally simple: contamination markers should go down; retention markers should stay up. If Trunk does not win, that is a real finding to report, not something to hide.

## License

MIT
