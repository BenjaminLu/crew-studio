// The firstmate chat, vendor-neutral: one provider session per question, with
// Studio's tools only. Guardrails live here, the same for every provider: a
// time limit, at most 8 tool calls, and a clean error when the provider's CLI
// is missing or logged out. Provider events become the chat events the browser
// renders.   CREW_CHAT_TIMEOUT_MS  per-question limit (default 120000)
import { withSafetyRules } from "./skills";
import { OperatingRules, withOperatingRules, type RulesSection } from "./operating-rules";
import { roundEnv } from "./secure";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NEvent, Provider } from "./providers";
import { TOOLS } from "./tools";
import { helperCommand } from "./self";

export const MAX_TOOL_CALLS = 8;
export type ChatEvent =
  | { type: "start"; provider: string; model: string; operatingRules?: string }
  | { type: "tool"; id: string; name: string; args: unknown }
  | { type: "toolResult"; id: string; rows: number | null; error: string | null }
  | { type: "text"; delta: string }
  | { type: "intent"; intent: any }
  | { type: "done"; text: string; tools: number; ms: number }
  | { type: "error"; code: string; message: string };
export type Turn = { role: "captain" | "firstmate"; text: string };

// Plain text, the same for every provider.
export const SYSTEM = `You are firstmate's status voice inside Crew Studio, answering the captain (the human who owns this crew).
Rules:
- Answer ONLY from your tool results. Never guess. If the log does not say, answer "not in the log" (zh-TW: 「紀錄裡沒有」).
- Cite every fact with a markdown link to the source the tool gave you: a task link like [T-305](#/task/T-305), an event link like [event](#/event/1234), an inbox link, a crew link, or a GitHub PR link. One or two citations per sentence.
- Language: reply in the language of the captain's message; if that is unclear, use the UI language given in the message (zh-TW = Traditional Chinese, colleague register; keep technical terms like PR, CI, gate, worker, round in English).
- Conclusion first, then at most a few short lines or bullets. No preamble.
- You cannot dispatch work, answer cards, merge, push or start crew. Never claim you did. Cards are answered by the captain on the board.
- Times: the message gives the current time; use the captain's time zone (Asia/Taipei) when you mention a clock time.
- When the captain states NEW work to be done (a feature, fix, video, page…), call intent_capture once with a one-sentence goal and the details, then say it was recorded as an intent and that firstmate will draft a spec and raise a dispatch card. Do not call it for questions.
- When the captain asks to change how a crew role works (its skill: "the worker should…", "tell the reviewer to…"), call skill_edit with the workflow, role and request instead, and say the edit will be offered on the Improve page after its replay evals.
- When the captain describes a NEW way of working (a process with steps, roles and checks, e.g. "a weekly way to triage support mail"), call pack_draft with that description and link its native Task. The captain answers one interview batch, labels real samples, reviews measured checks and shadow outcomes, and explicitly promotes and publishes.`;

const label = (n: string) => TOOLS.find((t) => t.name === n)?.label ?? n;

export function buildPrompt(history: Turn[], message: string, lang: string, now = new Date()) {
  const past = history.slice(-8).map((t) => `${t.role === "captain" ? "Captain" : "firstmate"}: ${t.text.slice(0, 2000)}`).join("\n");
  return `${past ? `Conversation so far:\n${past}\n\n` : ""}Captain's new message: ${message}\n\nUI language: ${lang}. Current time: ${now.toISOString()} (UTC).`;
}

/** One provider turn under the guardrails, as normalized events. Used by the chat and by the contract test. */
export async function* guardedTurn(provider: Provider, text: string, ctx: Parameters<Provider["start"]>[2],
  o: { timeoutMs: number; maxTools?: number; signal?: AbortSignal; system?: string; rules?: RulesSection }): AsyncGenerator<NEvent & { guard?: string }> {
  const session = provider.start(o.rules ? withOperatingRules(withSafetyRules(o.system ?? SYSTEM), o.rules) : withSafetyRules(o.system ?? SYSTEM), TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })), ctx);
  let why: string | null = null;
  const stop = (reason: string) => { if (!why) { why = reason; session.interrupt(); } };
  const timer = setTimeout(() => stop("timeout"), o.timeoutMs);
  o.signal?.addEventListener("abort", () => stop("cancelled"));
  let tools = 0;
  try {
    for await (const e of session.send(text)) {
      if (e.type === "toolStart" && ++tools > (o.maxTools ?? MAX_TOOL_CALLS)) { stop("tooManyTools"); continue; }
      if (e.type === "turnEnd") { yield why && e.status !== "error" ? { ...e, status: "interrupted", guard: why } : e; return; }
      if (!why) yield e;
    }
  } finally { clearTimeout(timer); }
}

export async function runChat(o: { provider: Provider; message: string; history: Turn[]; lang: string; studioUrl: string; token: string; dataDir: string;
  onEvent: (e: ChatEvent) => void; signal?: AbortSignal }) {
  const cwd = join(o.dataDir, "chat-cwd"); mkdirSync(cwd, { recursive: true }); // empty: no project instructions or settings
  // nothing from firstmate, the board or the crew reaches the model's process
  // the token in a 0600 file, so a real CLI never carries it on its argv or env, where KERN_PROCARGS2 would expose it (src/mcp.ts prefers the file)
  const tokenFile = join(cwd, ".crew-tool-token"); writeFileSync(tokenFile, o.token, { mode: 0o600 });
  const env = roundEnv(o.provider.envKeys ?? [], { CREW_STUDIO_URL: o.studioUrl, CREW_TOOL_TOKEN_FILE: tokenFile });
  const ctx = { studioUrl: o.studioUrl, token: o.token, tokenFile, cwd, env, mcpCommand: helperCommand("mcp") };
  const timeoutMs = Number(process.env.CREW_CHAT_TIMEOUT_MS ?? 120_000);
  const started = Date.now();
  let text = "", tools = 0;
  const rules = new OperatingRules(o.dataDir).section(null); // the status chat belongs to no project: the Studio-wide rules
  o.onEvent({ type: "start", provider: o.provider.id, model: o.provider.model, operatingRules: rules.hash });
  try {
    for await (const e of guardedTurn(o.provider, buildPrompt(o.history, o.message, o.lang), ctx, { timeoutMs, signal: o.signal, rules })) {
      if (e.type === "delta") { text += e.text; o.onEvent({ type: "text", delta: e.text }); }
      else if (e.type === "toolStart") { tools++; o.onEvent({ type: "tool", id: e.id, name: label(e.name), args: e.args }); }
      else if (e.type === "toolEnd") {
        o.onEvent({ type: "toolResult", id: e.id, rows: e.rows, error: e.error });
        try { const p = JSON.parse(e.result); if (p?.id && /^I-\d+$/.test(p.id) && p.status === "received") o.onEvent({ type: "intent", intent: p }); } catch {}
      } else if (e.type === "turnEnd") {
        if (e.status === "ok") o.onEvent(text.trim() ? { type: "done", text, tools, ms: Date.now() - started } : { type: "error", code: "empty", message: "the answer ended without text" });
        else if (e.guard === "timeout") o.onEvent({ type: "error", code: "timeout", message: `no answer within ${Math.round(timeoutMs / 1000)} s` });
        else if (e.guard === "tooManyTools") o.onEvent({ type: "error", code: "tooManyTools", message: `stopped after ${MAX_TOOL_CALLS} lookups` });
        else if (e.guard === "cancelled" || e.status === "interrupted") o.onEvent({ type: "error", code: "cancelled", message: "cancelled" });
        else o.onEvent({ type: "error", code: e.code ?? "cliError", message: e.message ?? "the model run failed" });
      }
    }
  } catch (err: any) { o.onEvent({ type: "error", code: "cliError", message: String(err?.message ?? err) }); }
}
