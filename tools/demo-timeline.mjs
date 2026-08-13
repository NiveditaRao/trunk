import { request } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "fixtures");
const baseUrl = new URL(getArg("--url") ?? `http://localhost:${getArg("--port") ?? process.env.PORT ?? 3000}`);
const delayMs = Number(getArg("--delay") ?? 3500);
const manual = process.argv.includes("--manual");

const fixtures = {
  checkpoints: await readJson("checkpoints.json"),
  memories: await readJson("memories.json"),
};

const cp = idMap(fixtures.checkpoints);
const mem = idMap(fixtures.memories);
const beats = [
  { label: "Reset to main only: cp_001..cp_003, empty memory pool", reset: true },
  { label: "FACT -> trunk: prices are stored in cents", event: { type: "memory", doc: mem.cp("mem_001") } },
  { label: "FACT -> trunk: schema is snake_case", event: { type: "memory", doc: mem.cp("mem_002") } },
  { label: "Fork rate-limiter lane from cp_003", event: { type: "checkpoint", doc: cp.cp("cp_005") } },
  { label: "HYPOTHESIS -> br_ratelimit only: token bucket sketch", event: { type: "memory", doc: mem.cp("mem_003") } },
  { label: "Rate-limiter records the Redis decision checkpoint", event: { type: "checkpoint", doc: cp.cp("cp_006") } },
  { label: "FACT -> trunk from rate-limiter: Redis 7 cluster mode", event: { type: "memory", doc: mem.cp("mem_004") } },
  { label: "Main continues checkout fix", event: { type: "checkpoint", doc: cp.cp("cp_004") } },
  { label: "Money shot: main checkpoint recalls Redis fact born in rate-limiter", event: { type: "checkpoint", doc: cp.cp("cp_007") } },
];

if (!Number.isFinite(delayMs) || delayMs < 0) {
  console.error("--delay must be a non-negative millisecond value");
  process.exit(1);
}

console.log(`Driving timeline at ${baseUrl.href}`);
console.log(manual ? "Manual mode: press any key for each beat, q to quit." : `Auto mode: ${delayMs}ms between beats.`);

if (manual && process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

for (const [index, beat] of beats.entries()) {
  if (index > 0) await waitForAdvance();
  console.log(`\n[${index + 1}/${beats.length}] ${beat.label}`);
  const result = beat.reset
    ? await postJson("/api/demo/reset", { scenario: "timeline" })
    : await postJson("/api/demo/event", beat.event);
  console.log(JSON.stringify(result));
}

if (manual && process.stdin.isTTY) process.stdin.setRawMode(false);
console.log("\nTimeline complete. Branches fork. The trunk remembers.");

async function waitForAdvance() {
  if (!manual) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }
  await new Promise((resolve) => {
    const onData = (chunk) => {
      if (String(chunk).toLowerCase() === "q") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.exit(0);
      }
      process.stdin.off("data", onData);
      resolve();
    };
    process.stdin.on("data", onData);
  });
}

function postJson(pathname, payload) {
  const url = new URL(pathname, baseUrl);
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Content-Length": String(body.length),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url.pathname} returned ${res.statusCode}: ${text}`));
          return;
        }
        resolve(text ? JSON.parse(text) : {});
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(path.join(FIXTURES_DIR, file), "utf8"));
}

function idMap(items) {
  const map = new Map(items.map((item) => [item._id, item]));
  map.cp = (id) => structuredClone(map.get(id));
  return map;
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}