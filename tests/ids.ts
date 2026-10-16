import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Unique identifiers (fix round 1, runtime class "ids", check-runtime#5): an id
// or a ledger seq comes from a counter under a lock, never from count + 1, so two
// writers at once (two checks of one node, two processes) never share one.
//   bun tests/ids.ts
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("ids");
const root = join(import.meta.dir, "..");
// two checks of one node at once write their evidence to two folders
const H = await harness([Y({ id: "twin", name: "twin", roles: [], nodes: [{ id: "k", kind: "check", label: "K", checks: [{ use: "t/ok", params: { n: 1 } }, { use: "t/ok", params: { n: 2 } }], x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["k", "e", "pass"]] })]);
const r = H.engine.start({ workflow: "twin", text: "x" }); await until(() => H.engine.get(r.id)!.status === "succeeded", 10000);
const L = H.engine.ledger(r.id).filter((e) => e.check === "t/ok");
const seen = L.map((e) => JSON.parse(readFileSync(join(e.dir!, "out", "seen.json"), "utf8")).n);
ok(L.length === 2 && L[0].dir !== L[1].dir && JSON.stringify(seen.sort()) === "[1,2]" && JSON.stringify(L.map((e) => e.params.n).sort()) === "[1,2]", "two runs of one check on one node keep separate evidence folders, each with its own output", JSON.stringify(L.map((e) => e.dir)));
H.stop();
// many writers in several processes
const dir = mkdtempSync(join(tmpdir(), "crew-ids-"));
const worker = (code: string) => new Promise<string>((res) => { const p = spawn("bun", ["-e", code], { cwd: root }); let o = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (o += d)); p.on("close", () => res(o)); });
const allocCode = `const { allocate } = await import("${root}/src/ids.ts"); for (let i = 0; i < 40; i++) console.log(allocate("${dir}", "X"));`;
const outs = await Promise.all([worker(allocCode), worker(allocCode), worker(allocCode)]);
const ids = outs.join("\n").split("\n").filter((l) => /^X-/.test(l));
ok(ids.length === 120 && new Set(ids).size === 120, "three processes allocating 40 ids each get 120 distinct ids", `${ids.length} ${new Set(ids).size} ${outs[0].slice(0, 200)}`);
const ledCode = `const { Ledger } = await import("${root}/src/runtime/checks.ts"); const L = new Ledger("${dir}", "R-777"); for (let i = 0; i < 30; i++) L.add({ run: "R-777", node: "n", edge: null, round: 1, head: null, check: "x", version: "1", kind: "deterministic", attempt: 0, verdict: "pass", score: 1, findings: [], evidence: [], proves: [], blocking: false, inputHash: "", params: {}, ms: 0, dir: null });`;
await Promise.all([worker(ledCode), worker(ledCode)]);
const { Ledger } = await import("../src/runtime/checks");
const led = new Ledger(dir, "R-777"); const all = led.all();
ok(all.length === 60 && new Set(all.map((e) => e.seq)).size === 60 && led.verify().length === 0, "two processes appending to one ledger get distinct seqs and an unbroken signed chain", `${all.length} ${new Set(all.map((e) => e.seq)).size} bad=${led.verify().length}`);
const cardCode = `const { Cards } = await import("${root}/src/runtime/cards.ts"); const C = new Cards("${dir}"); for (let i = 0; i < 25; i++) C.create({ run: "R-1", node: "n", visit: 1, kind: "question", title: { en: "t", "zh-TW": "標題" }, sections: {}, body: "", options: [{ id: "a", label: "A" }], confirmDoor: false, door: null, links: [], workflow: "w", runTitle: "r" });`;
await Promise.all([worker(cardCode), worker(cardCode)]);
const { Cards } = await import("../src/runtime/cards");
const cs = new Cards(dir).list();
ok(cs.length === 50 && new Set(cs.map((c) => c.id)).size === 50, "two processes raising cards get distinct card ids", `${cs.length}`);
const intentCode = `const { Store } = await import("${root}/src/store.ts"); const S = new Store("${dir}/st", []); for (let i = 0; i < 20; i++) S.capture({ goal: "g" + i });`;
await Promise.all([worker(intentCode), worker(intentCode)]);
const { Store } = await import("../src/store");
const its = new Store(join(dir, "st"), []).intents();
ok(its.length === 40 && new Set(its.map((i) => i.id)).size === 40, "two processes capturing intents get distinct intent ids", `${its.length} ${new Set(its.map((i) => i.id)).size}`);
ok(existsSync(join(dir, ".seq-X")), "the counter lives next to what it numbers");
end();
