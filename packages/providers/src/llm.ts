import type { LLMProvider, TrunkConfig } from "@trunk/core";
import { joinUrl, providerId } from "./helpers.js";
import { postJson, requireArray, requireRecord, requireString } from "./http.js";

interface LLMOptions {
  readonly provider: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly endpoint?: string;
}

abstract class BaseLLMProvider implements LLMProvider {
  readonly id: string;

  protected constructor(protected readonly options: LLMOptions) {
    this.id = providerId(options.provider, options.model);
  }

  abstract complete(prompt: string, jsonSchema?: unknown): Promise<string>;
}

export class OpenAILLMProvider extends BaseLLMProvider {
  constructor(options: Omit<LLMOptions, "provider">) {
    if (!options.apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI completions.");
    super({ ...options, provider: "openai" });
  }

  async complete(prompt: string, jsonSchema?: unknown): Promise<string> {
    const response = requireRecord(
      await postJson(
        "OpenAI chat",
        this.options.endpoint ?? "https://api.openai.com/v1/chat/completions",
        openAIChatBody(this.options.model, prompt, jsonSchema),
        { authorization: `Bearer ${this.options.apiKey}` },
      ),
      "OpenAI returned a non-object response.",
    );
    return parseChatContent(response, "OpenAI");
  }
}

export class AzureLLMProvider extends BaseLLMProvider {
  constructor(options: Omit<LLMOptions, "provider">) {
    if (!options.apiKey) throw new Error("AZURE_OPENAI_API_KEY is required for Azure completions.");
    if (!options.endpoint) throw new Error("AZURE_OPENAI_ENDPOINT is required for Azure completions.");
    super({ ...options, provider: "azure" });
  }

  async complete(prompt: string, jsonSchema?: unknown): Promise<string> {
    const response = requireRecord(
      await postJson(
        "Azure OpenAI chat",
        joinUrl(
          this.options.endpoint ?? "",
          `/openai/deployments/${encodeURIComponent(this.options.model)}/chat/completions?api-version=2024-10-21`,
        ),
        openAIChatBody(undefined, prompt, jsonSchema),
        { "api-key": this.options.apiKey ?? "" },
      ),
      "Azure returned a non-object response.",
    );
    return parseChatContent(response, "Azure");
  }
}

export class AnthropicLLMProvider extends BaseLLMProvider {
  constructor(options: Omit<LLMOptions, "provider">) {
    if (!options.apiKey) throw new Error("ANTHROPIC_API_KEY is required for Anthropic completions.");
    super({ ...options, provider: "anthropic" });
  }

  async complete(prompt: string, jsonSchema?: unknown): Promise<string> {
    const body =
      jsonSchema === undefined
        ? {
            model: this.options.model,
            max_tokens: 2048,
            messages: [{ role: "user", content: prompt }],
          }
        : {
            model: this.options.model,
            max_tokens: 2048,
            messages: [{ role: "user", content: prompt }],
            tools: [
              {
                name: "trunk_structured_output",
                description: "Return the requested structured JSON object.",
                input_schema: jsonSchema,
              },
            ],
            tool_choice: { type: "tool", name: "trunk_structured_output" },
          };
    const response = requireRecord(
      await postJson(
        "Anthropic messages",
        this.options.endpoint ?? "https://api.anthropic.com/v1/messages",
        body,
        {
          "x-api-key": this.options.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
      ),
      "Anthropic returned a non-object response.",
    );
    if (jsonSchema !== undefined) {
      const content = requireArray(response.content, "Anthropic returned no content.");
      for (const block of content) {
        const record = requireRecord(block, "Anthropic returned malformed content.");
        if (record.type === "tool_use" && record.name === "trunk_structured_output") {
          return JSON.stringify(record.input);
        }
      }
      throw new Error("Anthropic did not return structured tool output.");
    }
    return parseAnthropicText(response);
  }
}

export class OllamaLLMProvider extends BaseLLMProvider {
  constructor(options: Omit<LLMOptions, "provider">) {
    super({ ...options, provider: "ollama", endpoint: options.endpoint ?? "http://localhost:11434" });
  }

  async complete(prompt: string, jsonSchema?: unknown): Promise<string> {
    const response = requireRecord(
      await postJson(
        "Ollama chat",
        joinUrl(this.options.endpoint ?? "http://localhost:11434", "/api/chat"),
        {
          model: this.options.model,
          stream: false,
          messages: [{ role: "user", content: prompt }],
          ...(jsonSchema === undefined ? {} : { format: jsonSchema }),
        },
        {},
      ),
      "Ollama returned a non-object response.",
    );
    const message = requireRecord(response.message, "Ollama returned no message.");
    return requireString(message.content, "Ollama returned no text content.");
  }
}

function openAIChatBody(model: string | undefined, prompt: string, jsonSchema: unknown): Record<string, unknown> {
  return {
    ...(model === undefined ? {} : { model }),
    messages: [{ role: "user", content: prompt }],
    ...(jsonSchema === undefined
      ? {}
      : {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "trunk_structured_output",
              strict: true,
              schema: jsonSchema,
            },
          },
        }),
  };
}

function parseChatContent(response: Record<string, unknown>, provider: string): string {
  const choices = requireArray(response.choices, `${provider} returned no choices.`);
  const first = choices[0];
  const choice = requireRecord(first, `${provider} returned malformed choices.`);
  const message = requireRecord(choice.message, `${provider} returned no message.`);
  return requireString(message.content, `${provider} returned no text content.`);
}

function parseAnthropicText(response: Record<string, unknown>): string {
  const content = requireArray(response.content, "Anthropic returned no content.");
  const parts: string[] = [];
  for (const block of content) {
    const record = requireRecord(block, "Anthropic returned malformed content.");
    if (record.type === "text") {
      parts.push(requireString(record.text, "Anthropic returned malformed text."));
    }
  }
  if (parts.length === 0) throw new Error("Anthropic returned no text content.");
  return parts.join("");
}

export function createLLMProvider(config: TrunkConfig): LLMProvider {
  const common = {
    model: config.llm.model,
    apiKey: config.llm.apiKey,
    endpoint: config.llm.endpoint,
  };
  switch (config.llm.provider) {
    case "openai":
      return new OpenAILLMProvider(common);
    case "anthropic":
      return new AnthropicLLMProvider(common);
    case "azure":
      return new AzureLLMProvider(common);
    case "ollama":
      return new OllamaLLMProvider(common);
    default:
      throw new Error(`Unknown LLM provider: ${String(config.llm.provider)}`);
  }
}
