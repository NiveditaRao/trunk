# Demo run sheet

Close with: **"Branches fork. The trunk remembers."**

## Before the demo

- Use the seeded fixture scenario when possible. It is key-free, deterministic, and built for this story.
- Have the dashboard open if available; otherwise use `list_branches()` output.
- Keep a backup terminal with the expected graph and eval table copied from fixtures.

## Storyboard

### 1. Start on `main`: checkout debugging

Narration: "We are chasing checkout 500s. The agent learns real reusable facts."

Create or show checkpoints where `main` learns:

- `prices are stored in cents` -> **fact**, `scope: trunk`
- `schema is snake_case` -> **fact**, `scope: trunk`

Expected point: these are not checkout-only assumptions. Every future branch should know them.

### 2. A second topic appears

Prompt: "Also, should we redesign the rate limiter?"

This is the moment the work splits. Do not skip it; the whole demo depends on making the split visible.

### 3. Without Trunk: show the bad answer

Stay in the same chat and ask for the rate-limiter design.

Bad answer to show:

```text
For the rate limiter, keep keys in snake_case and store counters in cents-compatible integer units so it matches checkout pricing. Since the checkout 500s point to rounding, avoid token refill logic that introduces fractional values.
```

Why it is bad: `snake_case` may be broadly useful, but `prices in cents` and checkout rounding are dragging checkout context into a rate-limiter design. The model is not stupid; the transcript is contaminated.

**Do not skip this contrast.** If the audience does not see the failure mode, Trunk looks like a nicer session manager instead of a solution to a concrete problem.

### 4. With Trunk: fork from the checkpoint

Click the checkpoint before the rate-limiter topic, or call:

```text
fork_from(checkpoint_id: "cp_003", topic: "redesign rate limiter", name: "rate-limiter")
```

Open a fresh MCP host session and paste the returned command:

```text
resume("br_rate_limiter")
```

Expected answer shape:

```text
Brief: We are starting a rate-limiter design branch from the checkout-debugging work.
Relevant trunk facts: prices are stored in cents; schema is snake_case.
No checkout-specific rounding hypothesis is included.
```

Point to make: the new window is focused because it has no old transcript, but it is not ignorant because facts came from the trunk.

### 5. The money shot: fact crosses lanes

On branch B, teach:

```text
remember("Production Redis is Redis 7 in cluster mode", kind: "fact", tags: ["redis", "infra"])
```

Return to `main` and ask what infrastructure facts matter before choosing a cache-backed fix.

Expected result:

```text
Recall: Production Redis is Redis 7 in cluster mode.
Source: checkpoint on rate-limiter branch.
```

In the dashboard, draw attention to the provenance line from the trunk memory to the other lane. That line is the project: a fact born on branch B helps `main` with zero re-explaining.

### 6. The control: hypothesis does not cross

On branch B, add a local hypothesis:

```text
remember("Assume rate limiting will move to Redis token buckets", kind: "hypothesis")
```

Back on `main`, recall Redis/rate-limiter assumptions.

Expected result: the Redis 7 cluster-mode fact may appear; the token-bucket hypothesis must not. If it appears, the demo has found a real bug.

This control separates Trunk from "dump everything in a vector store."

### 7. Eval numbers

Show the three-condition table:

| Condition | Contamination | Retention | Readout |
|---|---:|---:|---|
| Unforked | High | High | Knows facts, polluted by old topic. |
| Fresh session | Low | Low | Clean, but forgets useful facts. |
| Trunk | Low | High | Clean and informed. |

Explain that the scorer is simple on purpose: it looks for contamination markers and retention markers. A fancier judge would be harder to trust on stage.

### 8. Close

Say exactly:

```text
Branches fork. The trunk remembers.
```

## Failure recovery

| Failure | What to do |
|---|---|
| Network dies | Switch to fixtures and static dashboard. The core scope/provenance story is deterministic. |
| Live model call hangs | Use manual `remember(...)` calls and the heuristic extraction path. The classification contract is still visible. |
| MongoDB is unreachable | Use the fixture graph and explain where writes would land: `branches`, `checkpoints`, `messages`, `memories`. Do not burn demo time debugging Atlas. |
| MCP host cannot start server | Run `node packages/server/dist/index.js` directly in a terminal to surface config errors, then fall back to screenshots/fixtures. |
| Wrong memory appears on wrong branch | Treat it as a high-value bug. Say the control caught a scope leak; do not pretend it is expected. |
| `npm install` fails on corporate laptop | Expected. Move to Codespaces; do not use mirrors or TLS workarounds. |

## Exact fixture beats

The committed fixture README defines the canonical path:

```text
cp_001 main          investigating checkout 500s
cp_002 main          prices stored in cents       -> fact
cp_003 main          schema is snake_case         -> fact
cp_005 rate-limiter  token bucket sketch          -> branch hypothesis
cp_006 rate-limiter  Redis 7 cluster mode         -> trunk fact
cp_004 main          applied rounding fix         -> branch hypothesis
cp_007 main          chose Redis, recalling cp_006 fact
```

Use those IDs/names if live data is unavailable.
