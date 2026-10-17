// A provider with no model, for tests and offline demos. It really calls
// Studio's tools through the same token route a model's MCP server uses, and
// answers from what they return. The message picks the behaviour:
// STUB_TIMEOUT (never answers), STUB_LOGIN (a logged-out error), STUB_INTENT
// (captures an intent), STUB_MANY (ten lookups), otherwise a cited status answer.
import { toolParts } from "../tool-content";
import { errorOf, rowsOf, type NEvent, type Provider, type ProviderCtx, type Session, type ToolSpec } from "./types";
import { staticAnswer } from "../evals";
import { stubAgent } from "./stub-agent";

export type StubRequest = (url: string, init: RequestInit) => Promise<Response>;
/** Test-only transport injection; production defaults to the authenticated HTTP tool route. */
export function stubProvider(request: StubRequest = fetch): Provider {
  // runs in Studio's own process and spawns nothing: the one provider declared sandbox-free
  return { id: "stub", model: "no model", sandboxFree: true, start: (sys: string, _tools: ToolSpec[], ctx: ProviderCtx) => stubSession(ctx, sys, request) };
}

function stubSession(ctx: ProviderCtx, sys = "", request: StubRequest = fetch): Session {
  let stop: (() => void) | null = null, interrupted = false;
  return {
    interrupt() { interrupted = true; stop?.(); },
    async *send(text: string): AsyncIterable<NEvent> {
      let n = 0;
      const halt = new Promise<"halt">((r) => { stop = () => r("halt"); });
      const wait = async (ms: number) => (await Promise.race([Bun.sleep(ms).then(() => "ok" as const), halt])) === "ok";
      const call = async function* (name: string, args: any): AsyncGenerator<NEvent, any> {
        const id = `stub_${++n}`;
        yield { type: "toolStart", id, name, args };
        const r = await request(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) });
        const raw = await r.text(); const body = toolParts(raw).text; // the stub takes no image input: the text with a note
        const err = errorOf(body) ?? (r.ok ? null : body.slice(0, 200));
        yield { type: "toolEnd", id, rows: err ? null : rowsOf(body), error: err, result: body };
        try { return JSON.parse(body); } catch { return null; }
      };
      const say = async function* (s: string): AsyncGenerator<NEvent, boolean> {
        for (const part of s.match(/.{1,24}/gs) ?? []) { if (!(await wait(15))) return false; yield { type: "delta", text: part }; }
        yield { type: "message", text: s };
        return true;
      };
      if (text.startsWith("EVAL CASE")) {
        // replay eval: answer with the skill's own lines on the key terms (deterministic)
        const skill = /<<<SKILL\n([\s\S]*?)\nSKILL>>>/.exec(sys)?.[1] ?? "";
        const terms = (/^Key terms: (.*)$/m.exec(text)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        const ans = staticAnswer(skill, terms) || "No instruction covers this; I would ask firstmate.";
        if (!(yield* say(ans))) { yield { type: "turnEnd", status: "interrupted" }; return; }
        yield { type: "turnEnd", status: "ok", usage: { usd: 0, inTokens: 5, outTokens: 5 } }; return;
      }
      if (/^(NATIVE PACK|SKILL EDIT REQUEST|PACK GENESIS|GATE FIX|GATE REVIEW|DOC DRAFT|SPEC DRAFT|PLAN ROUND|PLAN DECISION|BUILD ROUND|FIX BRIEF|CODE REVIEW|DESIGN DRAFT|JUDGE|ROOT CAUSE|FILM FIX|TEST AGENT)/.test(text) || (/^DELIVER /.test(text) && /STUB_LINGER/.test(text))) {
        for await (const e of stubAgent(text, call, say)) { if (e === "interrupted") { yield { type: "turnEnd", status: "interrupted" }; return; } yield e; }
        yield { type: "turnEnd", status: "ok", usage: { usd: 0, inTokens: 20, outTokens: 10 } }; return;
      }
      if (text.includes("Captain's notes:")) {
        // work mode (M3): list, read the entry file, make one marked edit per run, report every note as addressed
        const ids = [...text.matchAll(/^- ([PR]\d+):/gm)].map((m) => m[1]);
        const files = ((yield* call("work_list", {})) ?? []) as any[];
        const doc = text.includes("Revise the document");
        const f = files.find((x) => x.editable && (doc ? /\.md$/ : /\.html?$/).test(x.path));
        if (!f) { yield { type: "turnEnd", status: "error", code: "cliError", message: "no html file in the work folder" }; return; }
        yield* call("work_read", { path: f.path, start: 1, lines: 50 });
        if (text.includes("STUB_NOCHANGE")) { yield* call("work_report", { notes: ids.map((id) => ({ id, addressed: false, how: "left as is" })), summary: "no change" }); }
        else {
          const hd = doc ? (((yield* call("work_search", { text: "## ", path: f.path })) ?? []) as any[]).find((x) => /^## /.test(x.text)) : null;
          const r = doc ? (hd ? yield* call("work_replace", { path: f.path, old: hd.text, new: `> Revised for ${ids.join(", ")}.\n\n${hd.text}` }) : { error: "no heading" })
            : yield* call("work_replace", { path: f.path, old: "</body>", new: `<!-- revised by the stub for ${ids.join(", ")} -->\n</body>` });
          if (r?.error) yield* call("work_write", { path: f.path, content: `<!-- revised by the stub for ${ids.join(", ")} -->\n` });
          yield* call("work_report", { notes: ids.map((id) => ({ id, addressed: true, how: `marked in ${f.path}` })), summary: `stub revision for ${ids.join(", ")}` });
        }
        if (text.includes("STUB_ESCAPE")) yield* call("work_write", { path: "../../escape.html", content: "x" });
        if (!(yield* say(`Revised ${f.path} for ${ids.join(", ")}.`))) { yield { type: "turnEnd", status: "interrupted" }; return; }
        yield { type: "turnEnd", status: "ok", usage: { usd: 0, inTokens: 10, outTokens: 5 } };
        return;
      }
      if (text.includes("STUB_LOGIN")) { yield { type: "turnEnd", status: "error", code: "notLoggedIn", message: "the provider is not logged in" }; return; }
      if (text.includes("STUB_TIMEOUT")) { await wait(600_000); yield { type: "turnEnd", status: "interrupted" }; return; }
      if (text.includes("STUB_MANY")) { for (let i = 0; i < 10 && !interrupted; i++) yield* call("runs_list", {}); }
      else if (text.includes("STUB_PACK")) {
        const d = yield* call("pack_draft", { description: "A weekly review of open support mail: sort it, answer the easy ones, escalate the rest" });
        if (!(yield* say(d?.id ? `Drafting the pack [${d.id}](${d.link}).` : `Could not: ${d?.error}`))) { yield { type: "turnEnd", status: "interrupted" }; return; }
      }
      else if (text.includes("STUB_SKILL")) {
        const e = yield* call("skill_edit", { workflow: "code", role: "worker", request: "Push a checkpoint before the round cap" });
        if (!(yield* say(e?.id ? `Asked the skill editor: [${e.id}](${e.link}). It will be offered on the Improve page after its evals.` : `Could not: ${e?.error}`))) { yield { type: "turnEnd", status: "interrupted" }; return; }
      }
      else if (text.includes("STUB_INTENT")) {
        const i = yield* call("intent_capture", { goal: "Add a dark mode to the docs site", details: "from the stub", deadline: "Friday" });
        if (!(yield* say(`Recorded as intent [${i?.id}](#/intents/${i?.id}). firstmate will draft a spec and raise a dispatch card.`))) { yield { type: "turnEnd", status: "interrupted" }; return; }
      } else {
        const runs = (yield* call("runs_list", {})) ?? [];
        if (interrupted) { yield { type: "turnEnd", status: "interrupted" }; return; }
        const t = runs.find?.((x: any) => x.status === "done") ?? runs[0];
        if (!t) { yield* say("not in the log"); yield { type: "turnEnd", status: "ok" }; return; }
        const d = yield* call("task_get", { id: t.id });
        const ev = d?.merged?.link ?? d?.lastEvents?.[0]?.link ?? `#/task/${t.id}`;
        if (!(yield* say(`[${t.id}](#/task/${t.id}) is ${t.status}. Last step: [event](${ev}). Not linked: [elsewhere](https://example.com/x).`))) { yield { type: "turnEnd", status: "interrupted" }; return; }
      }
      yield { type: "turnEnd", status: interrupted ? "interrupted" : "ok" };
    },
  };
}
