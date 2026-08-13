# Fixtures

Seeded data for the canonical scenario, committed in Phase 0 so **Track C can build the
graph and memory pool from hour one** without waiting on Track A or B.

Everything here is **key-free and synthetic**, which is also what makes the repo safe to
publish.

## The scenario

```
* cp_001  main          investigating checkout 500s
* cp_002  main          prices stored in cents          -> fact  mem_001 (supersedes mem_000)
* cp_003  main          schema is snake_case            -> fact  mem_002
├─● cp_005  rate-limiter  token bucket sketch           -> hyp   mem_003 (branch-local)
│ * cp_006  rate-limiter  Redis 7 cluster mode          -> fact  mem_004 -> TRUNK
* cp_004  main          applied the rounding fix        -> hyp   mem_005 (branch-local)
* cp_007  main          chose Redis, recalling mem_004  <- the money shot
```

## What each fixture demonstrates

| Item | Demonstrates |
|---|---|
| `mem_001`, `mem_002` | Facts learned on `main`, shared globally |
| `mem_004` | A fact born in `rate-limiter` that `main` later uses at `cp_007` — **memory crossing the fork** |
| `mem_003`, `mem_005` | Branch-local hypotheses that must **never** appear in the other branch |
| `mem_000` | Supersession — an early wrong belief replaced by `mem_001` |

`mem_003` and `mem_005` are the control. A UI or retrieval implementation that surfaces
either one outside its own branch has broken the core thesis, and the fixtures are
constructed so that failure is visible immediately.

## Note on embeddings

`embedding` is `[]` in every fixture. These exist for rendering and scope-enforcement work,
not retrieval quality. Real vectors are produced by the configured provider at runtime;
committing 768-float arrays would make these files unreadable for no benefit.
