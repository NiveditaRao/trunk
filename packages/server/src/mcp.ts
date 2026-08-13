import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_NAMES, type ToolName } from "@trunk/core";
import { assertMemoryKind, type TrunkTools } from "./tools-impl.js";

type JsonObject = Record<string, unknown>;

const tools: Tool[] = [
  {
    name: TOOL_NAMES.checkpoint,
    description: "Commit the current turn as a checkpoint on the active branch.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string" },
        summary: { type: "string" },
        user_message: { type: "string" },
        assistant_message: { type: "string" },
      },
      required: ["summary", "user_message", "assistant_message"],
    },
  },
  {
    name: TOOL_NAMES.fork_from,
    description: "Create a new branch rooted at a checkpoint and return a resume command.",
    inputSchema: {
      type: "object",
      properties: {
        checkpoint_id: { type: "string" },
        topic: { type: "string" },
        name: { type: "string" },
      },
      required: ["checkpoint_id", "topic"],
    },
  },
  {
    name: TOOL_NAMES.resume,
    description: "Return a distilled brief and relevant trunk memories for a branch or checkpoint.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: TOOL_NAMES.remember,
    description: "Write a fact to the trunk or a hypothesis to the active branch.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        kind: { type: "string", enum: ["fact", "hypothesis"] },
      },
      required: ["text", "kind"],
    },
  },
  {
    name: TOOL_NAMES.promote,
    description: "Promote a branch-local hypothesis into the shared trunk.",
    inputSchema: {
      type: "object",
      properties: { memory_id: { type: "string" } },
      required: ["memory_id"],
    },
  },
  {
    name: TOOL_NAMES.recall,
    description: "Recall trunk facts and active-branch hypotheses.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        k: { type: "number" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["query"],
    },
  },
  {
    name: TOOL_NAMES.list_branches,
    description: "List branches and render the checkpoint graph inline.",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function startMcpServer(api: TrunkTools): Promise<void> {
  const server = new Server(
    { name: "trunk", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!isToolName(name)) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const args = objectArgs(request.params.arguments);
    const result = await callTool(api, name, args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  await server.connect(new StdioServerTransport());
}

async function callTool(
  api: TrunkTools,
  name: ToolName,
  args: JsonObject,
): Promise<unknown> {
  switch (name) {
    case TOOL_NAMES.checkpoint:
      return api.checkpoint({
        label: optionalString(args.label),
        summary: requiredString(args.summary, "summary"),
        user_message: requiredString(args.user_message, "user_message"),
        assistant_message: requiredString(args.assistant_message, "assistant_message"),
      });
    case TOOL_NAMES.fork_from:
      return api.forkFrom({
        checkpoint_id: requiredString(args.checkpoint_id, "checkpoint_id"),
        topic: requiredString(args.topic, "topic"),
        name: optionalString(args.name),
      });
    case TOOL_NAMES.resume:
      return api.resume({ id: requiredString(args.id, "id") });
    case TOOL_NAMES.remember:
      return api.remember({
        text: requiredString(args.text, "text"),
        tags: optionalStringArray(args.tags, "tags"),
        kind: assertMemoryKind(requiredString(args.kind, "kind")),
      });
    case TOOL_NAMES.promote:
      return api.promote({
        memory_id: requiredString(args.memory_id, "memory_id"),
      });
    case TOOL_NAMES.recall:
      return api.recall({
        query: requiredString(args.query, "query"),
        k: optionalNumber(args.k, "k"),
        tags: optionalStringArray(args.tags, "tags"),
      });
    case TOOL_NAMES.list_branches:
      return api.listBranches();
  }
}

function objectArgs(value: unknown): JsonObject {
  if (isJsonObject(value)) return value;
  return {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Expected non-empty string for ${name}`);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  throw new Error("Expected optional string");
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`Expected optional number for ${name}`);
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Expected optional string array for ${name}`);
  }
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`Expected optional string array for ${name}`);
    }
    strings.push(item);
  }
  return strings;
}

function isToolName(value: string): value is ToolName {
  return Object.values(TOOL_NAMES).includes(value as ToolName);
}
