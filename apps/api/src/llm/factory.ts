import type { LlmProvider, SectorStore } from "./types";
import { MockProvider } from "./mock";
import { AnthropicProvider } from "./anthropic";
import { OpenRouterProvider } from "./openrouter";

export type ProviderName = "anthropic" | "openrouter" | "mock";

/** LLM_PROVIDER forces a choice. Otherwise: Anthropic if its key is set, then OpenRouter, else the mock. */
export function chooseProvider(env: NodeJS.ProcessEnv = process.env): ProviderName {
  const forced = env.LLM_PROVIDER as ProviderName | undefined;
  if (forced) {
    if (!["anthropic", "openrouter", "mock"].includes(forced)) throw new Error(`LLM_PROVIDER must be anthropic, openrouter or mock (got "${forced}").`);
    return forced;
  }
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  if (env.OPENROUTER_API_KEY) return "openrouter";
  return "mock";
}

export function makeProvider(sectors: SectorStore, env: NodeJS.ProcessEnv = process.env): { llm: LlmProvider; label: string } {
  const name = chooseProvider(env);
  if (name === "openrouter") {
    if (!env.OPENROUTER_API_KEY) throw new Error("LLM_PROVIDER=openrouter but OPENROUTER_API_KEY is not set.");
    const model = env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat";
    return { llm: new OpenRouterProvider({ sectors }), label: `openrouter, model: ${model}` };
  }
  if (name === "anthropic") {
    if (!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)) throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
    return { llm: new AnthropicProvider({ sectors }), label: `anthropic, model: ${env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5"}` };
  }
  return { llm: new MockProvider(), label: "mock" };
}
