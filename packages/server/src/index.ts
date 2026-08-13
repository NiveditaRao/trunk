#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  assertProviderMatches,
  connect,
  loadConfig,
  type LoadConfigOptions,
  type MemoryEngine,
  StubMemoryEngine,
  type TrunkDb,
} from "@trunk/core";
import { startDashboardServer } from "./http.js";
import { startMcpServer } from "./mcp.js";
import { TrunkTools } from "./tools-impl.js";

export interface ServerOptions {
  memory?: MemoryEngine;
  config?: LoadConfigOptions;
  trunk?: TrunkDb;
  dashboard?: boolean;
  port?: number;
}

export function createServer(opts: ServerOptions = {}) {
  const memory = opts.memory ?? new StubMemoryEngine();
  return {
    memory,
    async start(): Promise<void> {
      const shouldStartDashboard = opts.dashboard ?? !opts.trunk;
      const config =
        !opts.trunk || shouldStartDashboard ? loadConfig(opts.config) : undefined;
      const owned = opts.trunk ? null : await connectOrExplain(requireConfig(config));
      const trunk = opts.trunk ?? owned;
      if (!trunk) {
        throw new Error("Internal error: no Trunk database connection.");
      }
      let dashboard: { close(): Promise<void> } | null = null;
      try {
        if (!opts.trunk && config) {
          await assertProviderMatches(trunk, config);
        }
        if (shouldStartDashboard) {
          dashboard = await startDashboardServer({
            trunk,
            port: opts.port ?? config?.port ?? 3768,
          });
        }
        const tools = new TrunkTools(trunk, memory);
        await tools.initialize();
        await startMcpServer(tools);
      } finally {
        if (dashboard) {
          await dashboard.close();
        }
        if (owned) {
          await owned.close();
        }
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer({ config: { flags: parseCliFlags(process.argv.slice(2)) } })
    .start()
    .catch((error: unknown) => {
      const message = formatStartupError(error);
      console.error(message);
      process.exitCode = 1;
    });
}

async function connectOrExplain(config: ReturnType<typeof loadConfig>): Promise<TrunkDb> {
  try {
    return await connect(config);
  } catch {
    throw new Error(
      "Could not connect to MongoDB. Verify TRUNK_MONGODB_URI, network access, and Atlas IP allowlist; the URI was not logged.",
    );
  }
}

function requireConfig(
  config: ReturnType<typeof loadConfig> | undefined,
): ReturnType<typeof loadConfig> {
  if (config) return config;
  throw new Error("Internal error: missing Trunk configuration.");
}

function formatStartupError(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown startup error";
  return error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[redacted-mongodb-uri]");
}

function parseCliFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current?.startsWith("--")) continue;
    const withoutPrefix = current.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      const key = withoutPrefix.slice(0, equalsIndex);
      const value = withoutPrefix.slice(equalsIndex + 1);
      if (key.length > 0) flags[key] = value;
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[withoutPrefix] = next;
      index += 1;
    }
  }
  return flags;
}
