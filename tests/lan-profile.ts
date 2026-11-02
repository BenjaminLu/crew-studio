import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Board-to-board work, in process (docs/units/lan-relay.md): the restricted profile on the runtime engine, each rule
// against a control without it (a LAN-marked Task cannot reach a pushing hook, gets no egress beyond its provider and no
// run_tests / run_command / skill_run, runs no test-run check, stops at its dollar cap), the relay between two Lan
// instances (a spoofed mDNS answer is never contacted, a chain that does not join freezes its author, a revoked key
// stays out), and the Keychain path through a stand-in `security` (the private key never on an argv).    bun tests/lan-profile.ts
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installLanProfile, workflowRefusals } from "../src/lan/profile";
import { Lan, type LanRunner } from "../src/lan/relay";
import { Discovery } from "../src/lan/mdns";
import { keychainSpawn, keychainWanted, loadIdentity } from "../src/lan/identity";
import { b64u, randomBytes } from "../src/lan/crypto";
import { makeEnvelope, type Body } from "../src/lan/protocol";
import { call } from "../src/lan/wire";
import { harness, sleep, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("lan-profile");

// ---------- the restricted profile on the engine ----------
const checkRoot = mkdtempSync(join(tmpdir(), "crew-lan-checks-")); mkdirSync(join(checkRoot, "l", "checks", "tr"), { recursive: true });
writeFileSync(join(checkRoot, "l", "checks", "tr", "check.yaml"), readFileSync(join(import.meta.dir, "fixture/checks/t/checks/ok/check.yaml"), "utf8").replace("id: ok", "id: tr") + "test_run: true\n");
copyFileSync(join(import.meta.dir, "fixture/checks/t/checks/ok/run"), join(checkRoot, "l", "checks", "tr", "run")); chmodSync(join(checkRoot, "l", "checks", "tr", "run"), 0o755);
const H = await harness([
  Y({ id: "lanwf", name: "lanwf", roles: [{ id: "w", label: "W", skill: "x" }], policies: { egress: { allow: ["registry.example.test"] } }, nodes: [
    { id: "s", kind: "hook", label: "S", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 },
    { id: "a", kind: "agent", label: "A", role: "w", mode: "test", x: 1, y: 0 },
    { id: "c", kind: "check", label: "C", checks: [{ use: "l/tr" }], x: 2, y: 0 },
    { id: "e", kind: "hook", label: "E", x: 3, y: 0 }], edges: [["s", "a"], ["a", "c"], ["c", "e", "ok"], ["c", "e", "fail"], ["c", "e", "error"]] }),
  Y({ id: "pushwf", name: "pushwf", roles: [], nodes: [{ id: "s", kind: "hook", label: "S", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 }, { id: "push", kind: "hook", label: "Push", do: "push-sim", x: 1, y: 0 }, { id: "e", kind: "hook", label: "E", x: 2, y: 0 }], edges: [["s", "push"], ["push", "e"]] }),
  Y({ id: "costly", name: "costly", roles: [{ id: "w", label: "W", skill: "x" }], nodes: ["a1", "a2", "a3"].map((id, i) => ({ id, kind: "agent", label: id, role: "w", mode: "test", x: i, y: 0 })).concat([{ id: "e", kind: "hook", label: "E", x: 3, y: 0 } as any]), edges: [["a1", "a2"], ["a2", "a3"], ["a3", "e"]] }),
], { checkRoots: [join(import.meta.dir, "fixture/checks"), checkRoot] });
const E = H.engine as any, pushed: string[] = [], calls: any[] = [];
E.actions["push-sim"] = (x: any) => { pushed.push(x.run.id); return "ok"; };
// the test mode's round carries the tools a code round would: the profile must take the test and script ones away
const testTools = E.modes.test.tools; E.modes.test.tools = (x: any) => [...testTools(x), ...["run_tests", "run_command", "skill_run", "fs_read"].map((name) => ({ name, description: name, schema: { type: "object" }, run: () => ({ ok: true }) }))];
const orig = H.agents.run.bind(H.agents);
(H.agents as any).run = async (o: any) => { calls.push(o); const j = await orig(o); if (String(E.get(o.ref)?.title ?? "").startsWith("costly-")) j.cost = { usd: 0.6, inTokens: 1, outTokens: 1 }; return j; };
installLanProfile(E);
const mark = (usd = 5, rounds = 9) => ({ _lan: JSON.stringify({ item: "test-item", usd, rounds }), _tainted: "lan" });
const done = (id: string) => until(() => ["succeeded", "failed", "cancelled"].includes(E.get(id)?.status) || E.get(id)?.status === "waiting", 30000);
{ const ctl = E.start({ workflow: "pushwf", text: "x" }); await done(ctl.id);
  const lan = E.start({ workflow: "pushwf", text: "x", params: mark() }); await done(lan.id); await sleep(200);
  const err = (E.get(lan.id).steps ?? []).map((s: any) => s.error ?? "").join(" ");
  ok(pushed.includes(ctl.id), "control: an ordinary Task reaches its pushing hook");
  ok(!pushed.includes(lan.id) && /not allowed on work from a peer/.test(err), "push is blocked: a LAN-originated Task stops before a hook that pushes, opens a pull request or merges", err.slice(0, 200));
  ok(workflowRefusals(E.defs.get("pushwf")).length === 1 && workflowRefusals(E.defs.get("lanwf")).length === 0, "the take dialog's static check names the same step"); }
{ const ctl = E.start({ workflow: "lanwf", text: "x" }); await done(ctl.id);
  const lan = E.start({ workflow: "lanwf", text: "x", params: mark() }); await done(lan.id);
  const of = (id: string) => calls.find((o) => o.ref === id);
  const c = of(ctl.id), l = of(lan.id), names = (o: any) => (o?.tools ?? []).map((t: any) => t.name);
  ok(JSON.stringify(c?.sandbox?.allow) === '["registry.example.test"]' && names(c).includes("run_tests"), "control: an ordinary round gets the hosts egress.allow grants and its run_tests", JSON.stringify([c?.sandbox?.allow, names(c)]));
  ok(JSON.stringify(l?.sandbox?.allow) === "[]", "egress beyond the provider is blocked: a LAN round's sandbox grants no extra host (its provider's API only)", JSON.stringify(l?.sandbox?.allow));
  ok(!names(l).some((n: string) => ["run_tests", "run_command", "skill_run"].includes(n)) && names(l).includes("fs_read"), "no test-run listener: a LAN round gets no run_tests, run_command or skill_run (its other tools stay)", JSON.stringify(names(l)));
  const v = (id: string) => E.ledger(id).find((e: any) => e.check === "l/tr");
  ok(v(ctl.id)?.verdict === "pass", "control: an ordinary Task runs a test-run check", JSON.stringify(v(ctl.id)?.verdict));
  ok(v(lan.id)?.verdict === "error" && /runs the project's tests/.test(v(lan.id)?.error ?? ""), "a LAN-originated Task never runs a check that runs the project's tests: it reports why", JSON.stringify(v(lan.id)?.error)); }
{ const lan = E.start({ workflow: "costly", title: "costly-1", text: "x", params: mark(1, 9) }); await done(lan.id);
  const steps = E.get(lan.id).steps.map((s: any) => `${s.node}:${s.state}`), err = E.get(lan.id).steps.find((s: any) => s.node === "a3")?.error ?? "";
  ok(steps.includes("a1:passed") && steps.includes("a2:passed") && /spend cap: this received item allows \$1\.00 and \$1\.20 was spent/.test(err) && !calls.some((o) => o.ref === lan.id && /a3/.test(o.title)), "the dollar cap stops the next round once what was spent reaches it ($1.00 cap: two $0.60 rounds ran, the third never started)", JSON.stringify([steps, err]));
  const ctl = E.start({ workflow: "costly", title: "costly-2", text: "x" }); await done(ctl.id);
  ok(E.get(ctl.id).status === "succeeded", "control: without the LAN mark all three rounds run"); }
H.stop();

// ---------- the relay, in process ----------
const fakeRunner = (): LanRunner => ({ workflows: () => [{ id: "documents", version: 1, name: "Documents", defHash: "a".repeat(64), eligible: true, why: [], notRun: [], staffing: null }],
  start: async () => { throw new Error("not in this suite"); }, status: () => null, output: async () => { throw new Error("no"); }, cancel: () => {} });
const mk = (name: string, disc?: Discovery) => { const dir = mkdtempSync(join(tmpdir(), `crew-lan-${name}-`)); return new Lan({ dataDir: dir, runner: fakeRunner(), bind: "127.0.0.1", port: 0, discovery: disc ?? null }); };
// a spoofed mDNS answer: seen, listed, never contacted
{ let hits = 0; const trap = createServer((c) => { hits++; c.destroy(); }); await new Promise<void>((r) => trap.listen(0, "127.0.0.1", () => r()));
  const disc = new Discovery({ enabled: false }); const B = mk("mdns", disc); B.setEnabled(true);
  disc.feed(`10:00:00.000  Add        3   4 local.               _crewstudio._tcp.    cs-0123456789ab`);
  disc.feed(`10:00:00.000  Add        3   4 local.               _crewstudio._tcp.    Free accelerator (click me)`);
  await sleep(1500);
  const v = B.view();
  ok(v.nearby.length === 1 && v.nearby[0].id === "cs-0123456789ab" && v.nearby[0].host === null, "a nearby Studio is listed by its opaque id only (an answer that is not one is ignored)", JSON.stringify(v.nearby));
  ok(hits === 0 && !v.peers.length && !v.intros.length, "a spoofed mDNS target is not auto-connected: no connection, no introduction, no trust");
  delete process.env.CREW_LAN_ALLOW_LOOPBACK;
  const port = (trap.address() as any).port; let e1: any = null, e2: any = null;
  try { await B.startIntro("127.0.0.1", port); } catch (e) { e1 = e; } try { await B.startIntro("169.254.169.254", 80); } catch (e) { e2 = e; }
  ok(e1?.code === "target" && e2?.code === "target" && hits === 0, "even a person cannot point an introduction at loopback or a metadata address (the peer address guard)", `${e1?.message} | ${e2?.message}`);
  trap.close(); B.close(); }
// two Lan instances introduced to each other; a chain that does not join freezes its author; a revoked key stays out
process.env.CREW_LAN_ALLOW_LOOPBACK = "1";
{ const A = mk("a"), B = mk("b"); A.setEnabled(true); B.setEnabled(true); B.openIntro(1);
  const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros[0];
  A.confirmIntro(ia.id, ib.sas, "B"); B.confirmIntro(ib.id, ia.sas, "A");
  const t = A.dispatch({ to: B.id.key, title: "t", briefing: "hello" }); await until(() => B.view().items.length === 1, 5000);
  ok(B.view().items[0]?.kind === "dispatch", "two in-process Studios exchange a dispatch once introduced");
  const peerB = { key: B.id.key, host: "127.0.0.1", port: B.wire.port };
  const seq = 1000, e1 = makeEnvelope(A.id, seq, randomBytes(32).toString("hex"), [B.id.key], { kind: "revoke", thread: t.id, round: 1, target: t.rounds[0].briefing.entry, reason: "x" } as Body);
  const e2 = makeEnvelope(A.id, seq + 1, randomBytes(32).toString("hex"), [B.id.key], { kind: "revoke", thread: t.id, round: 1, target: t.rounds[0].briefing.entry, reason: "y" } as Body);
  const r1 = await call(A.id, peerB, "push", { entries: [e1], blobs: [] }), r2 = await call(A.id, peerB, "push", { entries: [e2], blobs: [] });
  const pa = B.view().peers.find((p: any) => p.key === A.id.key);
  ok(r1.accepted.length === 1 && /fork/.test(r2.refused[0]?.reason ?? "") && /does not join/.test(pa?.frozen?.why ?? ""), "an entry that does not join its author's chain (prev ≠ the entry before it) also freezes the author", JSON.stringify([r1, r2, pa?.frozen?.why]));
  B.removePeer(A.id.key, "revoke");
  let err = ""; try { await call(A.id, peerB, "push", { entries: [], blobs: [] }); } catch (e: any) { err = e.message; }
  ok(/403/.test(err), "a revoked key is refused at once", err);
  B.openIntro(1); let again: any = null; try { await A.startIntro("127.0.0.1", B.wire.port); } catch (e) { again = e; }
  ok(!B.view().intros.some((i: any) => i.key === A.id.key) && !B.view().peers.some((p: any) => p.key === A.id.key && p.state === "trusted"), "a revoked key cannot be introduced again", again?.message ?? "");
  A.close(); B.close(); }

// ---------- the Keychain: never by default, never in a test; its own path only through a stand-in ----------
{ const spawned: string[][] = [], real = keychainSpawn.run;
  keychainSpawn.run = (argv: string[]) => { spawned.push(argv); throw new Error("the keychain tool must not run here"); };
  const saved = { ks: process.env.CREW_KEYSTORE, iso: process.env.CREW_TEST_ENV_ISOLATED };
  try {
    delete process.env.CREW_KEYSTORE;
    const d1 = mkdtempSync(join(tmpdir(), "crew-lan-id-")), id = loadIdentity(d1);
    ok(id.store === "file" && existsSync(join(d1, "lan", "identity.key")) && !spawned.length && !keychainWanted(d1), "with the default environment the identity is a 0600 file and the keychain tool is never spawned", JSON.stringify(spawned));
    process.env.CREW_KEYSTORE = "keychain";
    const d2 = mkdtempSync(join(tmpdir(), "crew-lan-id-")), id2 = loadIdentity(d2);
    ok(id2.store === "file" && !spawned.length && !keychainWanted(d2), "even with CREW_KEYSTORE=keychain, a test run or a temporary data folder never reaches the Keychain", JSON.stringify(spawned));
    delete process.env.CREW_TEST_ENV_ISOLATED;
    ok(!keychainWanted(d2), "a data folder under the temporary directory never reaches the Keychain, test mark or not");
  } finally { keychainSpawn.run = real; if (saved.ks === undefined) delete process.env.CREW_KEYSTORE; else process.env.CREW_KEYSTORE = saved.ks; if (saved.iso !== undefined) process.env.CREW_TEST_ENV_ISOLATED = saved.iso; } }
{ // the opt-in path itself, against an in-memory stand-in (no process, nothing on the Mac's Keychain)
  const db = new Map<string, string>(), calls: { argv: string[]; stdin: string }[] = [], real = keychainSpawn.run;
  keychainSpawn.run = (argv: string[], o: any) => { const stdin = o?.stdin ? Buffer.from(o.stdin).toString() : ""; calls.push({ argv, stdin });
    if (argv[1] === "-i") { const m = /-s (\S+) -a (\S+).* -w (\S+)/.exec(stdin); if (m) db.set(`${m[1]}/${m[2]}`, m[3]); return { exitCode: m ? 0 : 2, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
    const v = db.get(`${argv[argv.indexOf("-s") + 1]}/${argv[argv.indexOf("-a") + 1]}`); return { exitCode: v ? 0 : 44, stdout: Buffer.from(v ? `${v}\n` : ""), stderr: Buffer.alloc(0) }; };
  try {
    const data = mkdtempSync(join(tmpdir(), "crew-lan-kc-")), id1 = loadIdentity(data, { keychain: true }), id2 = loadIdentity(data, { keychain: true }), secret = b64u(id1.priv);
    ok(id1.store === "keychain" && id2.key === id1.key && [...db.keys()].every((k) => k.startsWith("crew-studio-lan-identity/")), "opted in, the identity is kept under the Keychain service crew-studio-lan-identity and read back");
    ok(!calls.some((c) => c.argv.join(" ").includes(secret)) && calls.some((c) => c.stdin.includes(secret)) && !existsSync(join(data, "lan", "identity.key")), "the private key goes to the keychain tool on stdin, never on its argv");
  } finally { keychainSpawn.run = real; } }
end();
