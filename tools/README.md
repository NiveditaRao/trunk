# Trunk fixture demo harness

This is a zero-dependency, fixture-driven demo harness for the hackathon dashboard. It is **not the real product server**. The real server lives in `packages/server` and still needs npm dependencies plus MongoDB.

## Run

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","User") + ";" + [Environment]::GetEnvironmentVariable("Path","Machine")
node tools\demo-server.mjs --port 3000
```

Open <http://localhost:3000/>.

For a presenter-controlled live story, start the server in timeline mode and drive the beats:

```powershell
node tools\demo-server.mjs --port 3000 --scenario timeline
node tools\demo-timeline.mjs --port 3000 --manual
```

Use `--delay 3500` (milliseconds) instead of `--manual` for automatic pacing.

## What it proves

- The vanilla dashboard can run today without `npm install`.
- Facts use `scope: "trunk"` and are shared across lanes.
- Hypotheses stay scoped to their branch and visibly do not become trunk facts.
- The Redis 7 fact is born in the rate-limiter lane and then reused by `main`.

## API surface

- `GET /api/graph` -> `{ branches, checkpoints }`
- `GET /api/memories` -> `{ memories }`
- `POST /api/branch` with `{ checkpoint_id, topic }`
- `WS /api/stream` broadcasts `{ type: "checkpoint" | "memory", doc }`

The `/api/demo/*` endpoints are only for driving the fixture timeline.