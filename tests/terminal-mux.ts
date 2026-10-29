import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Several terminals on one stream (src/terminals.ts attachMany, GET /api/terminals/mux; docs/units/web-terminal.md "Wire"),
// real PTYs, temporary data: each event names its terminal and the output carries its position; the route keeps only
// well-formed ids, once each and at most 64; a terminal that is not there is "gone"; closing the stream, or cutting it for
// backpressure, takes its views of every terminal (no dead view holds a slot); a reopened stream's replay ends where the
// output stands, so a page can skip what it has.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Terminals, terminalRoutes } from "../src/terminals";

let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { if (v) { pass++; console.log("  ok    " + n); } else { fail++; console.log(("  FAIL  " + n + " " + extra).trimEnd()); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => any, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(50); } return null; };
const d = mkdtempSync(join(tmpdir(), "crew-terminal-mux-")), pr = join(d, "proj"); mkdirSync(pr);
const svc = new Terminals({ dataDir: join(d, "data"), projects: () => [{ id: "p", name: "P", path: pr }], transcripts: false, shell: "/bin/sh", env: { PATH: "/usr/bin:/bin" } });
// a stream's events as they come: [event, data]
const reader = (res: Response) => { const r = res.body!.getReader(), dec = new TextDecoder(); let buf = ""; const evs: [string, any][] = [];
  const pump = (async () => { for (;;) { const { value, done } = await r.read(); if (done) return; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.*)$/m.exec(block)?.[1] ?? "", data = /^data: (.*)$/m.exec(block)?.[1] ?? "null"; evs.push([ev, JSON.parse(data)]); } } })().catch(() => {});
  return { evs, cancel: () => r.cancel(), pump }; };
try {
  const a = await svc.create({ project: "p", command: "while IFS= read -r l; do echo got:$l; done" });
  const b = await svc.create({ project: "p", command: "while IFS= read -r l; do echo got:$l; done" });
  await sleep(200);
  // ---------- one stream, each event naming its terminal, the output with its position ----------
  const s1 = reader(svc.attachMany([a.id, b.id], false));
  ok(await until(() => s1.evs.filter(([e]) => e === "replay").length === 2), "both terminals replay on the one stream");
  const rep = (id: string) => s1.evs.find(([e, x]) => e === "replay" && x.id === id)?.[1];
  ok(rep(a.id)?.id === a.id && rep(b.id)?.id === b.id && Number.isFinite(rep(a.id)?.end) && s1.evs.some(([e, x]) => e === "meta" && x.id === b.id), "each event names its terminal; a replay says where the output stands (end)", JSON.stringify(rep(a.id)));
  svc.input(a.id, "one\n");
  const out = await until(() => s1.evs.find(([e, x]) => e === "out" && x.id === a.id && Buffer.from(x.b64, "base64").toString().includes("got:one"))?.[1]);
  ok(out && out.end > rep(a.id).end && !s1.evs.some(([e, x]) => e === "out" && x.id === b.id && Buffer.from(x.b64, "base64").toString().includes("got:one")), "a's output goes out as a's, with its position after the replay's; b gets none of it");
  ok(svc.views(a.id) === 1 && svc.views(b.id) === 1, "one view of each");
  // ---------- a stream opened again replays up to where the output stands now ----------
  const s2 = reader(svc.attachMany([a.id], false));
  const rep2 = await until(() => s2.evs.find(([e, x]) => e === "replay" && x.id === a.id)?.[1]);
  ok(rep2?.end === out.end && Buffer.from(rep2.b64, "base64").length <= rep2.end, "the second stream's replay ends where the first stream's last output ended (a page skips what it has)", JSON.stringify({ end: rep2?.end, out: out.end }));
  await s2.cancel(); await sleep(50);
  // ---------- closing the stream takes all its views ----------
  await s1.cancel(); await sleep(50);
  ok(svc.views(a.id) === 0 && svc.views(b.id) === 0, "closing the stream ends its views of both terminals", `${svc.views(a.id)} ${svc.views(b.id)}`);
  // ---------- the route: well-formed ids only, once each, at most 64; unknown ones are gone ----------
  const route = async (ids: string) => { const url = new URL(`http://127.0.0.1:1/api/terminals/mux?ids=${encodeURIComponent(ids)}`);
    return reader((await terminalRoutes(svc, new Request(url), url, { kind: "desktop" }, false, true))!); };
  const r1 = await route(`${a.id},${a.id},../etc,${"x".repeat(65)},T-nope-1,${b.id}`);
  await until(() => r1.evs.filter(([e]) => e === "replay").length === 2);
  await sleep(100);
  const gone = r1.evs.filter(([e]) => e === "gone").map(([, x]) => x.id);
  ok(svc.views(a.id) === 1 && svc.views(b.id) === 1 && JSON.stringify(gone) === JSON.stringify(["T-nope-1"]), "a repeated id is one view; a malformed id is dropped unseen; an unknown one is gone", JSON.stringify({ a: svc.views(a.id), gone }));
  await r1.cancel(); await sleep(50);
  const many = Array.from({ length: 64 }, (_, i) => `T-none-${i}`).concat(a.id);
  const r2 = reader(svc.attachMany(many, false)); await until(() => r2.evs.filter(([e]) => e === "gone").length === 64); await sleep(100);
  ok(svc.views(a.id) === 0 && r2.evs.filter(([e]) => e === "gone").length === 64, "at most 64 terminals on one stream: the 65th is not attached", String(svc.views(a.id)));
  await r2.cancel();
  // ---------- backpressure: a shared stream that stopped reading is cut whole ----------
  const s3 = reader(svc.attachMany([a.id, b.id], false)); await until(() => s3.evs.filter(([e]) => e === "replay").length === 2);
  const subA = [...(svc as any).terms.get(a.id).subs][0]; Object.defineProperty(subA.ctl, "desiredSize", { get: () => -9 * 1024 * 1024 });
  svc.input(a.id, "two\n");
  // checked at once: b says nothing meanwhile, so a view of b left behind would only go when b next wrote
  await until(() => svc.views(a.id) === 0, 3000);
  ok(svc.views(a.id) === 0 && svc.views(b.id) === 0, "a stream past its backpressure limit loses its views of every terminal at once, not only the one that wrote", `${svc.views(a.id)} ${svc.views(b.id)}`);
  // the slots are free: four phones may watch again (one slot stays the Mac's)
  const phones = [0, 1, 2].map(() => reader(svc.attachMany([b.id], true)));
  await sleep(150);
  ok(phones.every((p) => p.evs.some(([e]) => e === "replay")) && svc.views(b.id) === 3, "with the dead views gone, three phones can watch b", String(svc.views(b.id)));
  for (const p of phones) await p.cancel();
} finally { try { svc.shutdown(); } catch {} await sleep(100); rmSync(d, { recursive: true, force: true }); }
console.log(`\nterminal-mux: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
