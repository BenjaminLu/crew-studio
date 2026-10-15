// Direct-HTTP chat providers: no vendor CLI, no SDK, fetch only. Each runs the
// same tool loop: ask the model, run the tools it asks for against Studio's own
// tool route (the same per-question token and limits as the CLI providers), send
// the results back, until it answers in text.
//   anthropic          Anthropic Messages API            (ANTHROPIC_API_KEY or a key saved in Studio)
//   openai             OpenAI Responses API              (OPENAI_API_KEY or a key saved in Studio)
//   openai-compatible  any /chat/completions endpoint    (a base URL such as http://127.0.0.1:1234/v1 for LM Studio
//                                                         or http://127.0.0.1:11434/v1 for Ollama; key optional)
//   CREW_ANTHROPIC_BASE, CREW_OPENAI_BASE  API bases (tests point them at a mock)
import { keys } from "../keys";
import { toolParts, type ToolResultParts } from "../tool-content";
import { httpNeeds } from "./needs";
import { errorOf, rowsOf, type NEvent, type Provider, type ProviderCtx, type Session, type ToolSpec } from "./types";

const MAX_ROUNDS = 12;
type Call = { id: string; name: string; args: any };
type Step = { text: string; calls: Call[] };
type Api = {
  /** One model request with the conversation so far; returns its text and tool calls. */
  ask(signal: AbortSignal): Promise<Step>;
  /** Record the model's step and the tool results for the next request. */
  /** each result's text (with a note where a picture was) and its picture apart (src/tool-content.ts): a provider maps the picture to its own image input, or keeps the text only */
  remember(step: Step, results: { call: Call; output: string; parts: ToolResultParts }[]): void;
};
class HttpError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, proxy?: string | null) {
  // in a sandboxed round the request goes through Studio's egress proxy, with the round's credential, to this provider's host only
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal, ...(proxy ? { proxy } : {}) } as any);
  const text = await r.text();
  if (!r.ok) { let msg = text.slice(0, 300); try { const o = JSON.parse(text); msg = o?.error?.message ?? o?.message ?? msg; } catch {} throw new HttpError(r.status, msg); }
  return JSON.parse(text);
}

async function callTool(ctx: ProviderCtx, name: string, args: unknown, signal: AbortSignal): Promise<string> {
  try {
    const r = await fetch(`${ctx.studioUrl}/api/tools/${encodeURIComponent(name)}`, { method: "POST", signal,
      headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args ?? {}) });
    return await r.text();
  } catch (e: any) { return JSON.stringify({ error: String(e?.message ?? e) }); }
}

function loopSession(make: () => Api, ctx: ProviderCtx, needs: () => string | null): Session {
  let ctl: AbortController | null = null;
  return {
    interrupt() { ctl?.abort(); },
    async *send(): AsyncIterable<NEvent> {
      const missing = needs();
      if (missing) { yield { type: "turnEnd", status: "error", code: "notLoggedIn", message: missing }; return; }
      ctl = new AbortController();
      const api = make();
      const rounds = Number(ctx.env?.CREW_HTTP_MAX_ROUNDS ?? MAX_ROUNDS); // work runs (M3) need more rounds than a status question
      try {
        for (let round = 0; round < rounds; round++) {
          const step = await api.ask(ctl.signal);
          if (!step.calls.length) {
            if (step.text) { yield { type: "delta", text: step.text }; yield { type: "message", text: step.text }; }
            yield { type: "turnEnd", status: "ok" };
            return;
          }
          const results: { call: Call; output: string; parts: ToolResultParts }[] = [];
          for (const c of step.calls) {
            yield { type: "toolStart", id: c.id, name: c.name, args: c.args ?? {} };
            const output = await callTool(ctx, c.name, c.args, ctl.signal);
            if (ctl.signal.aborted) throw new DOMException("aborted", "AbortError");
            const err = errorOf(output);
            const parts = toolParts(output); // a picture never reaches the events, the logs or the UI
            yield { type: "toolEnd", id: c.id, rows: err ? null : rowsOf(parts.text), error: err, result: parts.text };
            results.push({ call: c, output: parts.text, parts });
          }
          api.remember(step, results);
        }
        yield { type: "turnEnd", status: "error", code: "cliError", message: `no answer after ${rounds} model rounds` };
      } catch (e: any) {
        if (ctl.signal.aborted || e?.name === "AbortError") { yield { type: "turnEnd", status: "interrupted" }; return; }
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) { yield { type: "turnEnd", status: "error", code: "notLoggedIn", message: `the API refused the key (${e.status}): ${e.message}` }; return; }
        const unreachable = !(e instanceof HttpError);
        yield { type: "turnEnd", status: "error", code: unreachable ? "cliUnavailable" : "cliError", message: unreachable ? `the API is not reachable: ${e?.message ?? e}` : `HTTP ${e.status}: ${e.message}` };
      }
    },
  };
}

const parseArgs = (s: unknown) => { if (typeof s !== "string") return s ?? {}; try { return JSON.parse(s || "{}"); } catch { return {}; } };

export function anthropicProvider(model = process.env.CREW_ANTHROPIC_MODEL ?? "claude-sonnet-5-5"): Provider {
  const base = (process.env.CREW_ANTHROPIC_BASE ?? "https://api.anthropic.com").replace(/\/$/, "");
  return {
    id: "anthropic", model, sandboxNeeds: () => httpNeeds(() => base),
    start(system: string, tools: ToolSpec[], ctx: ProviderCtx) {
      const messages: any[] = [];
      const s = loopSession(() => ({
        async ask(signal) {
          const o = await post(`${base}/v1/messages`, { "x-api-key": keys().anthropic ?? "", "anthropic-version": "2023-06-01" },
            { model, max_tokens: 2000, system, messages, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }, signal, ctx.proxy);
          const content = Array.isArray(o.content) ? o.content : [];
          const step: Step & { raw?: any } = { text: content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(""),
            calls: content.filter((c: any) => c.type === "tool_use").map((c: any) => ({ id: String(c.id), name: String(c.name), args: c.input ?? {} })) };
          step.raw = content;
          return step;
        },
        remember(step: any, results) {
          messages.push({ role: "assistant", content: step.raw });
          messages.push({ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.call.id, content: r.parts.image ? [{ type: "image", source: { type: "base64", media_type: r.parts.image.mimeType, data: r.parts.image.data } }, { type: "text", text: r.parts.text }] : r.parts.text })) }); // Anthropic takes images: the picture as an image block
        },
      }), ctx, () => (keys().anthropic ? null : "no Anthropic API key: add one in the chat settings, or set ANTHROPIC_API_KEY"));
      return { interrupt: () => s.interrupt(), send: (text: string) => { messages.push({ role: "user", content: text }); return s.send(text); } };
    },
  };
}

export function openaiProvider(model = process.env.CREW_OPENAI_MODEL ?? "gpt-5"): Provider {
  const base = (process.env.CREW_OPENAI_BASE ?? "https://api.openai.com").replace(/\/$/, "");
  return {
    id: "openai", model, sandboxNeeds: () => httpNeeds(() => base),
    start(system: string, tools: ToolSpec[], ctx: ProviderCtx) {
      let input: any[] = [];
      const s = loopSession(() => ({
        async ask(signal) {
          const o = await post(`${base}/v1/responses`, { authorization: `Bearer ${keys().openai ?? ""}` },
            { model, instructions: system, input, store: false, tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema })) }, signal, ctx.proxy);
          const out: any[] = Array.isArray(o.output) ? o.output : [];
          const text = out.filter((x) => x.type === "message").flatMap((x) => x.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
          const calls = out.filter((x) => x.type === "function_call").map((x) => ({ id: String(x.call_id), name: String(x.name), args: parseArgs(x.arguments) }));
          return Object.assign({ text: text || String(o.output_text ?? ""), calls }, { raw: out });
        },
        remember(step: any, results) {
          input.push(...step.raw);
          for (const r of results) input.push({ type: "function_call_output", call_id: r.call.id, output: r.parts.text }); // the text with a note: no picture through a function output
        },
      }), ctx, () => (keys().openai ? null : "no OpenAI API key: add one in the chat settings, or set OPENAI_API_KEY"));
      return { interrupt: () => s.interrupt(), send: (text: string) => { input.push({ role: "user", content: text }); return s.send(text); } };
    },
  };
}

export function compatProvider(model = process.env.CREW_COMPAT_MODEL ?? ""): Provider {
  return {
    id: "openai-compatible", model: model || "(server default)", sandboxNeeds: () => httpNeeds(() => keys().compatBaseUrl ?? ""),
    start(system: string, tools: ToolSpec[], ctx: ProviderCtx) {
      const messages: any[] = [{ role: "system", content: system }];
      const s = loopSession(() => ({
        async ask(signal) {
          const k = keys();
          const o = await post(`${(k.compatBaseUrl ?? "").replace(/\/$/, "")}/chat/completions`, k.compatKey ? { authorization: `Bearer ${k.compatKey}` } : {},
            { ...(model ? { model } : {}), messages, tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }, signal, ctx.proxy);
          const m = o?.choices?.[0]?.message ?? {};
          const calls = (m.tool_calls ?? []).map((c: any) => ({ id: String(c.id), name: String(c.function?.name), args: parseArgs(c.function?.arguments) }));
          return Object.assign({ text: String(m.content ?? ""), calls }, { raw: m });
        },
        remember(step: any, results) {
          messages.push({ role: "assistant", content: step.raw.content ?? null, tool_calls: step.raw.tool_calls });
          for (const r of results) messages.push({ role: "tool", tool_call_id: r.call.id, content: r.parts.text }); // the text with a note: no picture through a tool message
        },
      }), ctx, () => (keys().compatBaseUrl ? null : "no endpoint: set the base URL of an OpenAI-compatible server (e.g. http://127.0.0.1:11434/v1) in the chat settings"));
      return { interrupt: () => s.interrupt(), send: (text: string) => { messages.push({ role: "user", content: text }); return s.send(text); } };
    },
  };
}
