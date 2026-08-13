import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "packages", "web", "public");
const FIXTURES_DIR = path.join(ROOT, "fixtures");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_PORT = 3000;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

const events = new EventEmitter();
const clients = new Set();
const fixtures = await loadFixtures();
let state = buildInitialState(getArg("--scenario") === "timeline" ? "timeline" : "fixtures");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/graph") {
      return json(res, 200, { branches: state.branches, checkpoints: state.checkpoints });
    }
    if (req.method === "GET" && url.pathname === "/api/memories") {
      return json(res, 200, { memories: state.memories });
    }
    if (req.method === "POST" && url.pathname === "/api/branch") {
      return handleCreateBranch(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/demo/reset") {
      return handleDemoReset(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/demo/event") {
      return handleDemoEvent(req, res);
    }
    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    return json(res, 405, { error: "method_not_allowed" }, { Allow: "GET, POST" });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "internal_error" });
  }
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/api/stream") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || !req.headers.upgrade || req.headers.upgrade.toLowerCase() !== "websocket") {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n"));

  const client = { socket, buffer: Buffer.alloc(0) };
  clients.add(client);
  socket.on("data", (chunk) => handleClientFrames(client, chunk));
  socket.on("close", () => clients.delete(client));
  socket.on("error", () => clients.delete(client));
});

events.on("stream", (message) => {
  const payload = JSON.stringify(message);
  for (const client of [...clients]) {
    try {
      writeFrame(client.socket, 0x1, Buffer.from(payload, "utf8"));
    } catch {
      clients.delete(client);
      client.socket.destroy();
    }
  }
});

const port = Number(getArg("--port") ?? process.env.PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(1);
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Choose another port with --port <number> or PORT=<number>.`);
    process.exit(1);
  }
  console.error(error.message);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`Trunk fixture demo server listening on http://localhost:${port}`);
  console.log(`Data mode: ${state.mode}. No npm packages, no external network calls.`);
});

async function loadFixtures() {
  const [branches, checkpoints, memories] = await Promise.all([
    readJson(path.join(FIXTURES_DIR, "branches.json")),
    readJson(path.join(FIXTURES_DIR, "checkpoints.json")),
    readJson(path.join(FIXTURES_DIR, "memories.json")),
  ]);
  return { branches, checkpoints, memories };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function buildInitialState(mode) {
  if (mode === "timeline") {
    return {
      mode,
      branches: fixtures.branches.filter((branch) => branch._id === "br_main"),
      checkpoints: fixtures.checkpoints.filter((cp) => ["cp_001", "cp_002", "cp_003"].includes(cp._id)),
      memories: [],
    };
  }
  return {
    mode: "fixtures",
    branches: structuredClone(fixtures.branches),
    checkpoints: structuredClone(fixtures.checkpoints),
    memories: structuredClone(fixtures.memories),
  };
}

async function handleCreateBranch(req, res) {
  const body = await readBody(req);
  if (!body.ok) return json(res, 400, { error: body.error });

  const { checkpoint_id: checkpointId, topic } = body.value;
  if (typeof checkpointId !== "string" || checkpointId.trim() === "" || typeof topic !== "string" || topic.trim() === "") {
    return json(res, 400, { error: "expected { checkpoint_id, topic } strings" });
  }
  if (!state.checkpoints.some((cp) => cp._id === checkpointId)) {
    return json(res, 404, { error: `checkpoint not found: ${checkpointId}` });
  }

  const base = slug(topic, "branch");
  const branchId = uniqueBranchId(`br_${base}`);
  const branch = {
    _id: branchId,
    name: base,
    root_checkpoint: checkpointId,
    topic: topic.trim(),
    created_at: new Date().toISOString(),
  };
  upsert(state.branches, branch);

  return json(res, 200, {
    branch_id: branchId,
    name: branch.name,
    resume_command: `trunk resume ${branchId}`,
    branch,
  });
}

async function handleDemoReset(req, res) {
  const body = await readBody(req);
  if (!body.ok) return json(res, 400, { error: body.error });

  const scenario = body.value.scenario === "fixtures" ? "fixtures" : "timeline";
  state = buildInitialState(scenario);
  return json(res, 200, counts({ ok: true, scenario }));
}

async function handleDemoEvent(req, res) {
  const body = await readBody(req);
  if (!body.ok) return json(res, 400, { error: body.error });

  const { type, doc } = body.value;
  if ((type !== "checkpoint" && type !== "memory") || !isRecord(doc) || typeof doc._id !== "string") {
    return json(res, 400, { error: "expected { type: 'checkpoint' | 'memory', doc: { _id, ... } }" });
  }

  if (type === "checkpoint") {
    if (typeof doc.branch_id !== "string") return json(res, 400, { error: "checkpoint doc needs branch_id" });
    ensureBranchForCheckpoint(doc);
    upsert(state.checkpoints, doc);
  } else {
    upsert(state.memories, doc);
  }

  const message = { type, doc };
  events.emit("stream", message);
  return json(res, 200, counts({ ok: true, sent: message, clients: clients.size }));
}

function ensureBranchForCheckpoint(checkpoint) {
  if (state.branches.some((branch) => branch._id === checkpoint.branch_id)) return;
  const fixtureBranch = fixtures.branches.find((branch) => branch._id === checkpoint.branch_id);
  upsert(state.branches, fixtureBranch ?? {
    _id: checkpoint.branch_id,
    name: checkpoint.branch_id,
    root_checkpoint: checkpoint.parent_id ?? null,
    topic: "",
    created_at: checkpoint.ts ?? new Date().toISOString(),
  });
}

function counts(extra) {
  return { ...extra, counts: { branches: state.branches.length, checkpoints: state.checkpoints.length, memories: state.memories.length } };
}

async function serveStatic(requestPath, res) {
  const normalized = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const baseDir = normalized.startsWith("/fixtures/") ? ROOT : PUBLIC_DIR;
  const relative = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const filePath = path.resolve(baseDir, normalized.startsWith("/fixtures/") ? relative : relative.replace(/^public[\\/]/, ""));
  const allowedRoot = path.resolve(baseDir);

  if (filePath !== allowedRoot && !filePath.startsWith(allowedRoot + path.sep)) {
    return json(res, 404, { error: "not_found" });
  }

  try {
    const data = await readFile(filePath);
    const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") return json(res, 404, { error: "not_found" });
    throw error;
  }
}

async function readBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) return { ok: false, error: "request body too large" };
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return { ok: true, value: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, error: "invalid JSON body" };
  }
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function upsert(list, item) {
  const index = list.findIndex((existing) => existing._id === item._id);
  if (index === -1) list.push(structuredClone(item));
  else list[index] = { ...list[index], ...structuredClone(item) };
}

function uniqueBranchId(base) {
  let id = base;
  let n = 2;
  while (state.branches.some((branch) => branch._id === id)) id = `${base}_${n++}`;
  return id;
}

function slug(value, fallback) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || fallback;
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function handleClientFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) return;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) return;
      const bigLength = client.buffer.readBigUInt64BE(offset);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) return closeSocket(client, 1009);
      length = Number(bigLength);
      offset += 8;
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    if (client.buffer.length < offset + length) return;

    const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
    if (masked) {
      const mask = client.buffer.subarray(maskOffset, maskOffset + 4);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    client.buffer = client.buffer.subarray(offset + length);

    if (opcode === 0x8) return closeSocket(client);
    if (opcode === 0x9) writeFrame(client.socket, 0xA, payload); // ping -> pong
  }
}

function writeFrame(socket, opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function closeSocket(client, code = 1000) {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  try { writeFrame(client.socket, 0x8, payload); } catch { /* already gone */ }
  clients.delete(client);
  client.socket.end();
}