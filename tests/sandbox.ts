import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The check sandbox is an allow-list (fix round 1: runtime class "sandbox" and
// legacy class A2; docs/architecture.md §10, docs/check-contract.md "Sandbox").
// A check reads only the system, the interpreters, its own directory and its
// inputs; never Studio's ledger key or a secret folder, even when its input names
// one; it writes only out/; no network, no unix socket, no LaunchServices; at its
// time limit the whole process group dies and the call returns even if a
// grandchild holds the pipe. A legacy `run` gate goes through the same executor.
// Off macOS a check is refused and the Doctor says so.     bun tests/sandbox.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { harness, sleep, suite, Y } from "./rt-harness";
const { ok, end } = suite("sandbox");
const tmp = mkdtempSync(join(tmpdir(), "crew-sbx-"));
// a run that stays live (it waits on a card) lends its context to the checks below
const H = await harness([Y({ id: "one", name: "one", roles: [], nodes: [{ id: "a", kind: "card", label: "A", card: { title: "Wait", options: [{ id: "go", label: "Go" }] }, x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["a", "e", "go"]] })]);
const E = H.engine;
const run = E.start({ workflow: "one", text: "x" });
const x = E.x(run, run.def.nodes[0], run.nodes.a);
// a secret Studio holds, an unrelated file, an input file, a unix socket
writeFileSync(join(H.data, "ledger.key"), "SECRET-LEDGER-KEY");
writeFileSync(join(tmp, "other.txt"), "OTHER");
const inputDir = join(tmp, "input"); mkdirSync(inputDir); writeFileSync(join(inputDir, "in.txt"), "INPUT");
const sock = join(tmp, "s.sock"); const srv = createServer((c) => c.end()); await new Promise<void>((r) => srv.listen(sock, () => r()));
const target = join(inputDir, "written.txt");
// the runtime materializes the input file for the check (a need), while the params name a path too
const named = join(tmp, "named-only-in-params.txt"); writeFileSync(named, "PARAM");
x.ctx.fixtureInput = join(inputDir, "in.txt");
const e = await E.runCheck(x, { use: "t/escape", params: { target, key: join(H.data, "ledger.key"), other: join(tmp, "other"), input: named, sock, open: true } }, null);
const d: any = (e as any).data ?? {};
ok(e.verdict === "pass" && d.input === "INPUT", "a check reads the input the runtime put in for it", JSON.stringify(e.error ?? d));
ok(d.paramPath === null, "a path named only in a check's params is not readable");
ok(d.key === null, "a check cannot read Studio's ledger key, even when its input names it");
ok(d.other === null, "a check cannot read a file its input does not name");
ok(d.wrote === false && !existsSync(target) && d.out === true, "a check writes only to its out/ folder");
ok(d.net === false && d.sock === false, "a check reaches neither the network nor a unix socket");
ok(d.open === false, "a check cannot launch an app through LaunchServices");
const t0 = Date.now();
const f = await E.runCheck(x, { use: "t/forks" }, null); await sleep(300);
ok(f.verdict === "error" && /timeout/.test(f.error ?? "") && Date.now() - t0 < 6000, "at its time limit a check returns even if a grandchild holds the pipe", `${f.error} ${Date.now() - t0} ms`);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pids = JSON.parse(readFileSync(join(f.dir!, "out", "pids.json"), "utf8"));
ok(pids.self > 0 && pids.child > 0 && !alive(pids.self) && !alive(pids.child), "and the whole process group is gone (the check and its grandchild, by pid)", JSON.stringify(pids));
// legacy run gates go through the same executor
const { runGate } = await import("../src/gates");
const wt = join(tmp, "wt"); mkdirSync(wt);
const ctx: any = { dir: wt, paths: [], added: [], messages: "", tier: "two-way" };
const w = await runGate({ id: "w", run: ["/bin/sh", "-c", "echo x > touched.txt"] } as any, "n", ctx);
ok(!existsSync(join(wt, "touched.txt")) && w.state === "fail", "a run gate cannot write the worktree", JSON.stringify(w));
const n = await runGate({ id: "net", run: ["node", "-e", "fetch('http://example.com',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0)).catch(()=>process.exit(3))"], timeout_s: 20 } as any, "n", ctx);
ok(n.state === "fail", "a run gate cannot reach the network", JSON.stringify(n));
const hm = await runGate({ id: "home", run: ["/bin/sh", "-c", `test "$HOME" != "${homedir()}" && test -z "$GITHUB_TOKEN"`] } as any, "n", ctx);
ok(hm.state === "pass", "a run gate gets a scrubbed HOME", JSON.stringify(hm));
const t1 = Date.now();
const g = await runGate({ id: "fork", run: ["/bin/sh", "-c", "sleep 37 & echo CHILD=$!; echo SELF=$$; sleep 36"], timeout_s: 1 } as any, "n", ctx); await sleep(300);
const gp = [...String(g.detail).matchAll(/(CHILD|SELF)=(\d+)/g)].map((m) => Number(m[2]));
ok(g.state === "fail" && Date.now() - t1 < 6000 && gp.length === 2 && gp.every((pid) => !alive(pid)), "a timed-out run gate leaves no process behind (by pid)", JSON.stringify([g.detail, gp]));
// off macOS: refused, and the Doctor says so
process.env.CREW_FORCE_NO_SANDBOX = "1";
const off = await E.runCheck(x, { use: "t/ok" }, null);
const { diagnose } = await import("../src/doctor");
const item = diagnose({ state: tmp, board: { writable: false } as any, gh: {} as any, keys: {} as any, chatProvider: "stub", lanIp: null, tailscale: {} as any, compiled: false, render: { canFilm: false, canCrop: false } as any } as any).find((i) => i.id === "sandbox");
ok(off.verdict === "error" && /refused/.test(off.error ?? ""), "without an OS sandbox a check is refused, never run unconfined", off.error ?? "");
ok(item?.status === "missing" && /refused/.test(item.detail), "the Doctor shows the sandbox status", JSON.stringify(item));
delete process.env.CREW_FORCE_NO_SANDBOX;
ok(diagnose({ state: tmp, board: { writable: false } as any, gh: {} as any, keys: {} as any, chatProvider: "stub", lanIp: null, tailscale: {} as any, compiled: false, render: { canFilm: false, canCrop: false } as any } as any).find((i) => i.id === "sandbox")?.status === "ok", "on macOS the Doctor shows the sandbox as ok");
srv.close(); H.stop();
end();
