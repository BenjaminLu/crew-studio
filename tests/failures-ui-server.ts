// A Studio runtime with one real failure card per class, served with the real card API (/api/scards, runtime/index.ts)
// and the shared card component, for tests/failures-ui.mjs. Prints "READY <port> <json cards>" once the cards exist.
//   bun tests/failures-ui-server.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, until, Y } from "./rt-harness";
import { FailureError } from "../src/runtime/failures";
import { createRuntime } from "../src/runtime/index";
import type { Engine } from "../src/runtime/engine";
const root = join(import.meta.dir, "..");
const flow = Y({ id: "fx", name: "failure fixture", roles: [{ id: "worker", label: "Worker", skill: "x" }], params: { mode: { default: "" }, want: { default: "fail", options: ["pass", "fail", "maybe"] } },
  nodes: [{ id: "act", kind: "hook", label: "Act", do: "act", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["act", "end", "ok"]] });
const act = (x: any) => {
  const m = x.run.params.mode, fa = x.rn.data.failureAnswer;
  if (m === "ask") { if (fa?.kind === "answer") return "ok"; x.rn.data.escalation = { reason: "The currency is a pricing choice only the captain sets." }; return { outcome: "ask", note: "Which currency does the total use?" }; }
  if (m === "env") throw new FailureError("env.test-command", "run_tests: no test command configured for this repository");
  if (m === "transient") throw new Error("fetch failed: ECONNRESET socket hang up");
  if (m === "det") return x.run.params.want === "pass" ? "ok" : { outcome: "fail", note: "totals.check: fail — 1235 JPY shows as $12.35" };
  if (m === "scope") throw new Error("src/fx.ts is outside the spec's scope");
  if (m === "params") { if (x.run.params.want === "pass") return "ok"; throw new Error("params: want must be pass or fail, not " + x.run.params.want); }
  if (m === "internal") throw new Error("kaboom: the act step met a state nobody planned for");
  return "ok";
};
const H = await harness([flow]);
H.engine.actions.act = act;
const modes = ["ask", "env", "transient", "det", "scope", "params", "internal"];
const runs = modes.map((mode) => H.engine.start({ workflow: "fx", text: `fixture ${mode}`, params: { mode, ...(mode === "params" ? { want: "maybe" } : {}) } }).id);
await until(() => runs.every((id) => !!H.engine.get(id)!.failureCard && !H.engine.busy(id)), 20000);
for (const id of runs) H.engine.runs.delete(id); // this engine steps aside: the runtime below owns the runs from here
const rt = createRuntime({ dataDir: H.data, agents: H.agents, provider: H.engine.deps.provider, defaultProvider: H.engine.deps.defaultProvider, log: H.engine.deps.log, send() {}, fmRoot: root, studioUrl: () => H.toolUrl,
  install: [(e: Engine) => { e.actions.act = act; e.failureBackoff = () => 60_000; }] } as any);
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${readFileSync(join(root, "public/styles.css"), "utf8")}</style>
<style>body{background:var(--bg);color:var(--text);margin:0;padding:16px;font:14px system-ui}</style></head><body><main id="c" style="max-width:860px"></main>
<script src="/scard.js"></script>
<script>(async()=>{const q=new URLSearchParams(location.search);document.documentElement.lang=q.get("lang")||"en";const c=await (await fetch("/api/scards/"+q.get("card"))).json();window.crewCard.mountCard(document.querySelector("#c"),c,{lang:document.documentElement.lang,inbox:true});window.mounted=true;})();</script></body></html>`;
const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  const url = new URL(req.url);
  if (url.pathname === "/scard.js") return new Response(readFileSync(join(root, "public/scard.js")), { headers: { "content-type": "text/javascript; charset=utf-8" } });
  if (url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname.startsWith("/api/scards"))
    return (await rt.handle(req, url, { kind: "desktop" }, req.method === "POST")) ?? new Response("not found", { status: 404 });
  return new Response("not found", { status: 404 });
} });
console.log(`READY ${srv.port} ${JSON.stringify(runs.map((id) => rt.engine.cards.view(rt.engine.cards.get(rt.engine.get(id)!.failureCard!)!)))}`);
process.on("SIGTERM", () => { srv.stop(true); H.stop(); process.exit(0); });
