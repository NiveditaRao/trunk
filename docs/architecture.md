# Architecture

Trunk has one design goal: let a conversation branch without making useful knowledge branch with it.

## Data model

| Collection | Purpose |
|---|---|
| `branches` | Conversation lanes. `main` is created on first use. |
| `checkpoints` | One save point per turn. Each document has `parent_id`, forming the DAG. |
| `messages` | User/assistant text attached to a checkpoint. |
| `memories` | Facts and hypotheses stored outside the checkpoint tree. |
| `meta` | Embedding provider identity and dimensions for startup safety. |

A checkpoint document has a parent pointer:

```ts
{
  _id: "cp_...",
  branch_id: "br_...",
  parent_id: "cp_..." | null,
  label: string | null,
  summary: string,
  ts: Date
}
```

Forking creates a new `branches` document whose `root_checkpoint` points at an existing checkpoint. Resume resolves ancestry with MongoDB `$graphLookup`, then orders the path back to the root. The alternative was to copy transcript rows into each branch. That lost because it duplicates data, makes provenance harder, and turns branch history into a synchronization problem.

## Why memory lives outside the tree

Conversation history is branch-local. Knowledge is not always branch-local.

A fact like "prices are stored in cents" should be usable everywhere. A branch assumption like "try Redis for the rate limiter" should not leak into checkout debugging. Therefore `memories` is not embedded inside checkpoint documents. Each memory carries its own scope:

```ts
kind: "fact" | "hypothesis"
scope: "trunk" | BranchId
source_checkpoint: CheckpointId
```

Recall returns:

1. trunk facts, plus
2. hypotheses scoped to the requesting branch.

It must never return another branch's hypotheses. That scope rule is the thesis, not an implementation detail.

## MCP constraint: hosts own the transcript

An MCP server cannot delete, rewrite, summarize, or prune the host's context window. Copilot CLI, Claude Code, Cursor, Windsurf, and Zed own their own transcripts.

So Trunk does not pretend to mutate the old chat. Forking returns a `resume(id)` command for a fresh session. The fresh session asks Trunk for:

- a distilled brief from the checkpoint ancestry, and
- relevant trunk memories.

The new window is clean by construction. This works on any MCP host today and avoids host-specific transcript APIs.

## Turn data flow

```text
host turn
  -> checkpoint(summary, user_message, assistant_message)
  -> checkpoint + messages inserted
  -> MemoryEngine.extract(turn)
  -> classify each candidate as fact or hypothesis
  -> normalize scope: fact => trunk, hypothesis => active branch
  -> embed + write
  -> dedup/reinforce or supersede if applicable
  -> recall(query) later returns visible memories only
```

Manual `remember(text, kind)` follows the same write path. `promote(memory_id)` is the only path from branch hypothesis to trunk fact.

## Package split

| Package | Responsibility | Notes |
|---|---|---|
| `core` | Shared contracts: schemas, tools, config, provider interfaces, MongoDB accessors. | Changes require coordination. |
| `server` | MCP stdio transport, tool implementation, checkpoint DAG, branch creation, resume briefs. | Uses `StubMemoryEngine` unless wired with real memory. |
| `memory` | Extraction, fact/hypothesis classification, vector recall, dedup, supersession, scope checks. | Has heuristic fallback if no LLM is provided. |
| `providers` | Embedding/LLM adapters and `trunk init`. | Stores provider identity in `meta`. |
| `render` | ASCII graph for terminal tool responses. | Keeps terminal demo fast. |
| `web` | Static dashboard assets. | Designed to show provenance lines from memory to originating checkpoint. |
| `eval` | Scenario scoring. | Measures contamination and retention. |

## MongoDB and Atlas choices

MongoDB is not just storage here:

| Requirement | MongoDB feature |
|---|---|
| Branch ancestry | Parent-pointer documents plus `$graphLookup`. |
| Memory recall | Atlas Vector Search on `memories.embedding`. |
| Hybrid retrieval | Vector index plus text search index. |
| Dashboard updates | Change streams instead of polling. |
| Evolving sprint schema | Documents tolerate added memory fields without migration ceremony. |

Atlas M0 constraints shaped the design:

| Constraint | Design consequence |
|---|---|
| Max 3 search indexes | Budget: vector index, text index, one spare. |
| 512 MB storage cap | Prefer compact embeddings; 768 dims uses about half the storage of 1536 dims. |
| One free cluster per project | Each developer/demo should use its own Atlas project. |
| No backups on free tier | Seed demo data from fixtures and export anything important. |

Provider mismatch is guarded at startup. If the vector index was built with one embedding model and the server starts with another, recall would look plausible but be mathematically wrong. `meta` records the provider and dimensions so the server can refuse to start instead.

## Current implementation gaps

- The root `dev` script is not wired to the current server package name.
- Live end-to-end model/provider behavior has not been verified on this blocked machine.
- The dashboard is designed around fixtures and static assets first; live server integration should be verified in Codespaces.
- Hybrid vector+text retrieval is documented in the contract, but the current memory recall path shown in code uses vector search plus tag/scope filtering.
