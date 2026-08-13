import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { PUBLIC_DIR } from "@trunk/web";
import type { Checkpoint, Memory, TrunkDb } from "@trunk/core";
import {
  branchResponse,
  graphResponse,
  memoriesResponse,
  parseBranchRequest,
  shapeStreamEvent,
  type StreamEvent,
} from "./api-contract.js";
import { loadGraph } from "./branches.js";
import { createForkBranch } from "./dag.js";

interface DashboardOptions {
  trunk: TrunkDb;
  port: number;
}

interface ClientSocket {
  send(data: string): void;
  on(event: "close" | "error", listener: () => void): void;
}

interface ChangeStream<T> extends AsyncIterable<ChangeRecord<T>> {
  close(): Promise<void>;
}

interface WatchableCollection<T> {
  watch(
    pipeline?: readonly object[],
    options?: { fullDocument?: "updateLookup"; resumeAfter?: unknown },
  ): ChangeStream<T>;
}

interface ChangeRecord<T> {
  _id?: unknown;
  fullDocument?: T;
}

type StreamType = StreamEvent["type"];

export async function startDashboardServer(
  options: DashboardOptions,
): Promise<{ close(): Promise<void> }> {
  const app = fastify({ logger: false });
  const hub = new ChangeStreamHub(options.trunk);

  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    prefix: "/",
  });

  app.get("/api/graph", async () => {
    const graph = await loadGraph(options.trunk);
    return graphResponse({
      branches: graph.branches,
      checkpoints: graph.checkpoints,
    });
  });

  app.get("/api/memories", async () => {
    const memories = await options.trunk.memories
      .find({})
      .sort({ valid_from: 1 })
      .toArray();
    return memoriesResponse(memories);
  });

  app.post("/api/branch", async (request, reply) => {
    try {
      const body = parseBranchRequest(request.body);
      const branch = await createForkBranch({
        trunk: options.trunk,
        checkpointId: body.checkpoint_id,
        topic: body.topic,
      });
      return branchResponse({
        branch_id: branch._id,
        name: branch.name,
        resume_command: `resume(${JSON.stringify(branch._id)})`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid branch request";
      return reply.code(400).send({ error: message });
    }
  });

  app.get("/api/stream", { websocket: true }, (connection) => {
    hub.addClient(connection);
  });

  app.addHook("onClose", async () => {
    await hub.close();
  });

  await hub.start();
  try {
    await app.listen({ port: options.port, host: "127.0.0.1" });
  } catch (error) {
    await hub.close();
    throw error;
  }

  return {
    close: () => app.close(),
  };
}

class ChangeStreamHub {
  private readonly clients = new Set<ClientSocket>();
  private streams: Array<ChangeStream<Checkpoint | Memory>> = [];
  private closed = false;
  private checkpointResumeToken: unknown;
  private memoryResumeToken: unknown;

  constructor(private readonly trunk: TrunkDb) {}

  async start(): Promise<void> {
    this.startCollection(
      "checkpoint",
      this.trunk.checkpoints as WatchableCollection<Checkpoint>,
      this.checkpointResumeToken,
    );
    this.startCollection(
      "memory",
      this.trunk.memories as WatchableCollection<Memory>,
      this.memoryResumeToken,
    );
  }

  addClient(client: ClientSocket): void {
    this.clients.add(client);
    const remove = () => {
      this.clients.delete(client);
    };
    client.on("close", remove);
    client.on("error", remove);
  }

  async close(): Promise<void> {
    this.closed = true;
    const streams = this.streams;
    this.streams = [];
    await Promise.all(streams.map((stream) => stream.close()));
  }

  private startCollection<T extends Checkpoint | Memory>(
    type: StreamType,
    collection: WatchableCollection<T>,
    resumeToken: unknown,
  ): void {
    const options =
      resumeToken === undefined
        ? { fullDocument: "updateLookup" as const }
        : { fullDocument: "updateLookup" as const, resumeAfter: resumeToken };
    const stream = collection.watch(
      [{ $match: { operationType: { $in: ["insert", "replace", "update"] } } }],
      options,
    );
    this.streams.push(stream as ChangeStream<Checkpoint | Memory>);
    void this.consume(type, collection, stream);
  }

  private async consume<T extends Checkpoint | Memory>(
    type: StreamType,
    collection: WatchableCollection<T>,
    stream: ChangeStream<T>,
  ): Promise<void> {
    try {
      for await (const change of stream) {
        this.rememberResumeToken(type, change._id);
        const event = shapeStreamEvent(type, change.fullDocument);
        if (event) this.broadcast(event);
      }
    } catch {
      if (!this.closed) {
        const token =
          type === "checkpoint" ? this.checkpointResumeToken : this.memoryResumeToken;
        setTimeout(() => {
          if (!this.closed) this.startCollection(type, collection, token);
        }, 500);
      }
    }
  }

  private rememberResumeToken(type: StreamType, token: unknown): void {
    if (token === undefined) return;
    if (type === "checkpoint") {
      this.checkpointResumeToken = token;
    } else {
      this.memoryResumeToken = token;
    }
  }

  private broadcast(event: StreamEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      try {
        client.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
