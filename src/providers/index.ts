// Which model provider the chat uses: CREW_CHAT_PROVIDER, or the choice saved
// from Studio's settings. CLI providers (claude, codex) need their CLI installed;
// the direct-HTTP providers (anthropic, openai, openai-compatible) need only a key
// or an endpoint, so the status chat works with nothing installed.
import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import { cursorProvider } from "./cursor";
import { anthropicProvider, compatProvider, openaiProvider } from "./http";
import { stubProvider } from "./stub";
import type { Provider } from "./types";

export const PROVIDERS = ["claude", "codex", "cursor", "anthropic", "openai", "openai-compatible", "stub"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const CLI_PROVIDERS = new Set(["claude", "codex", "cursor"]);
export function makeProvider(id: string, model?: string): Provider {
  if (model !== undefined && typeof model !== "string") throw new Error("provider model must be a string");
  if (id === "codex") return codexProvider(model ?? process.env.CREW_CODEX_MODEL ?? "");
  if (id === "cursor") return cursorProvider(model ?? process.env.CREW_CURSOR_MODEL ?? "");
  if (id === "stub") return stubProvider();
  if (id === "anthropic") return anthropicProvider(model || undefined);
  if (id === "openai") return openaiProvider(model || undefined);
  if (id === "openai-compatible") return compatProvider(model || undefined);
  if (id === "claude") return claudeProvider(model ?? process.env.CREW_CLAUDE_MODEL ?? "claude-sonnet-5-5");
  throw new Error(`unknown provider identity: ${id}`);
}
export * from "./types";
