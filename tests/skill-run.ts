import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// skill_run end to end (docs/units/skill-packages.md §3, §5, §6, §8): a workflow node pins a script skill whose folder carries a
// package-lock.json and a hash-pinned requirements.txt. Unapproved, the round is blocked before its agent. Approved, Studio
// prepares it by itself (local fixture registry and wheel index behind the egress proxy), then the round's agent gets
// skill_files / skill_read / skill_run and the skill's folder as a read-only copy. At run time the registry is gone (offline):
// the script finds its dependency in the prepared env, writes where the round writes, cannot write the skill, cannot install
// a package; it reaches its approved fixture host through a credential of its own, is refused any other host and any listed
// name that resolves to a metadata or private address; the agent's own command reaches none of them. Every call is recorded
// (step, evidence ledger, the Task's egress log), a refused host lands in the Task's context, and a changed script is a new
// version with no approval.   bun tests/skill-run.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
import { REGISTRY, PYPI, skillFolder, startRegistry } from "./lib/skill-fixtures";
const { ok, end } = suite("skill-run");
const { Skills } = await import("../src/skills");
const { SkillPackages } = await import("../src/skillpkg/index");
const { Egress } = await import("../src/egress");
const { roundExec } = await import("../src/runtime/checks");

const fx = startRegistry();
const box = mkdtempSync(join(tmpdir(), "crew-skillrun-box-"));
const h = await harness([Y({ id: "sr", name: "SR", version: 1, roles: [{ id: "maker", label: "Maker", skill: "x" }], nodes: [
  { id: "start", kind: "hook", label: "Start", do: "note", x: 0, y: 0 },
  { id: "make", kind: "agent", label: "Make", role: "maker", mode: "srtest", x: 100, y: 0 },
  { id: "end", kind: "hook", label: "End", do: "note", x: 200, y: 0 }], edges: [["start", "make"], ["make", "end"], ["make", "end", "blocked"]] })]);
const egress = new Egress(join(h.data, "egress.log")); await egress.start();
egress.taskLog = (run) => join(h.data, "runs", run, "egress.jsonl");
for (const host of [REGISTRY, PYPI, "api.fixture.test", "other.fixture.test"]) egress.testUpstreams.set(host, { address: "127.0.0.1", port: fx.port });
egress.lookup = ((host: string, _o: any, cb: any) => host === "meta.fixture.test" ? cb(null, [{ address: "169.254.169.254", family: 4 }]) : host === "lan.fixture.test" ? cb(null, [{ address: "10.20.30.40", family: 4 }]) : cb(Object.assign(new Error("no such host"), { code: "ENOTFOUND" }))) as any;
(h.agents as any).egress = egress;
const lib = new Skills(h.data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
(h.engine.deps as any).library = lib; h.defs.skillInfo = (id: string, v: number) => lib.pinInfo(id, v);
const pk = new SkillPackages({ dataDir: h.data, skills: lib, egress: () => egress, brew: false, uv: false });
(h.engine.deps as any).skillPackages = pk;
const seen: { system: string; tools: string[] }[] = [];
const run0 = h.agents.run.bind(h.agents);
(h.agents as any).run = (o: any) => { seen.push({ system: o.system, tools: o.tools.map((t: any) => t.name) }); return run0(o); };
let ownFetch = "";
h.engine.modes.srtest = { tools: () => [{ name: "own_fetch", description: "the agent's own command", schema: { type: "object" },
    // the agent's own command, as run_command runs one: the round sandbox, the round's egress list (none here)
    run: async (a: any) => { const t = mkdtempSync(join(h.data, "own-")); const r = await roundExec(["/usr/bin/curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", a.url], { cwd: box, writes: [box], tmp: t, dataDir: h.data, timeoutS: 20, egress, hosts: [] }); ownFetch = `${r.code}:${r.stdout}`; return { code: r.code }; } }],
  system: (_x: any, skill: string) => `${skill}\n\nMODE TAIL`, prompt: (x: any) => `TEST AGENT\n${x.run.text}`, after: () => "ok", sandbox: () => ({ writes: [box], cwd: box }) } as any;

const src = mkdtempSync(join(tmpdir(), "skill-src-"));
const folder = skillFolder(src, fx, { name: "pkg-run", hosts: ["api.fixture.test", "meta.fixture.test", "lan.fixture.test"] });
const imp = lib.importFolder(folder, "captain");
const pin = { id: "pkg-run", v: 1, sha256: imp.version.sha256, filesSha256: imp.version.filesSha256 };
const withPins = (pins: any[]) => { const b = h.defs.get("sr")!; return h.defs.save("sr", { base: b.version, nodes: b.nodes.map((n: any) => n.id === "make" ? { ...n, skills: pins } : n), edges: b.edges }, "captain"); };
const v2 = withPins([pin]);
ok(v2.version === 2 && JSON.stringify(h.defs.get("sr")!.nodes.find((n: any) => n.id === "make")!.skills) === JSON.stringify([pin]), "a node pins a library skill by version and both hashes (SKILL.md and its other files)");
const runOn = async (text: string, version = h.defs.get("sr")!.version) => { const r = h.engine.start({ workflow: "sr", version, title: "t", text, params: {}, by: "t" } as any);
  await until(() => ["succeeded", "failed", "cancelled"].includes(h.engine.get(r.id)!.status), 120000); return h.engine.get(r.id)!; };

// ---------- not approved: blocked before the agent ----------
{ const n = seen.length; const r = await runOn("go");
  const rn = r.nodes.make;
  const why = h.engine.events(r.id).find((e: any) => e.type === "round_blocked")?.summary ?? "";
  ok(rn.outcome === "blocked" && seen.length === n && /pkg-run@v1 has \d+ scripts and is not approved: the captain approves it on the team-change card/.test(why), "an unapproved script skill blocks the round before its agent starts, saying why", `${rn.outcome} ${why}`); }

// ---------- approved: prepared by itself, then delivered with its tools ----------
pk.decide("pkg-run", 1, "approved", "captain", "test");
const prepared = await pk.ensure("pkg-run", 1);
ok(prepared.state === "ready" && JSON.stringify(prepared.decision?.hosts) === JSON.stringify(["api.fixture.test", "lan.fixture.test", "meta.fixture.test"]), "approving the version approves exactly the hosts it proposed (its frontmatter here), and it is prepared", JSON.stringify([prepared.state, prepared.reasons, prepared.decision?.hosts]));
// offline at run time: the registry and the index are gone
egress.testUpstreams.delete(REGISTRY); egress.testUpstreams.delete(PYPI);
const calls = [
  ["skill_files", { skill: "pkg-run" }],
  ["skill_read", { skill: "pkg-run", path: "SKILL.md" }],
  ["skill_run", { skill: "pkg-run", script: "scripts/use-dep.js", args: ["hello"] }],
  ["skill_run", { skill: "pkg-run", script: "scripts/use-py.py", args: ["hello"] }],
  ["skill_run", { skill: "pkg-run", script: "scripts/fetch.js", args: ["http://api.fixture.test/fixture-dep"] }],
  ["skill_run", { skill: "pkg-run", script: "scripts/fetch.js", args: ["http://other.fixture.test/fixture-dep"] }],
  ["skill_run", { skill: "pkg-run", script: "scripts/fetch.js", args: ["http://meta.fixture.test/latest"] }],
  ["skill_run", { skill: "pkg-run", script: "scripts/fetch.js", args: ["http://lan.fixture.test/"] }],
  ["skill_run", { skill: "pkg-run", script: "scripts/install.sh", args: [] }],
  ["skill_run", { skill: "pkg-run", script: "scripts/write-self.sh", args: [] }],
  ["skill_run", { skill: "pkg-run", script: "../../etc/passwd", args: [] }],
  ["own_fetch", { url: "http://api.fixture.test/fixture-dep" }],
];
const r1 = await runOn(calls.map(([t, a]) => `Call: ${t} ${JSON.stringify(a)}`).join("\n"));
const rn = r1.nodes.make, runs: any[] = rn.data.skillRuns ?? [];
const sys = seen.at(-1)?.system ?? "", tools = seen.at(-1)?.tools ?? [];
ok(r1.status === "succeeded" && ["skill_files", "skill_read", "skill_run", "own_fetch"].every((t) => tools.includes(t)), "an approved, prepared script skill gives the round skill_files, skill_read and skill_run", JSON.stringify([r1.status, rn.note, tools]));
ok(/# Skill files: pkg-run \(v1\)/.test(sys) && /skill_run\("pkg-run"/.test(sys) && /never install packages/.test(sys), "the instructions say where the skill's files are and how to run its scripts", sys.slice(-600));
const by = (script: string, arg?: string) => runs.find((x) => x.script === script && (arg === undefined || x.argv[0] === arg));
ok(by("scripts/use-dep.js")?.exit === 0 && readFileSync(join(box, "skill-output.txt"), "utf8") === "dep:hello", "skill_run runs the script offline with its dependency from the prepared env (NODE_PATH), writing where the round writes", JSON.stringify(by("scripts/use-dep.js")));
ok(by("scripts/use-py.py")?.exit === 0 && /py:HELLO/.test(by("scripts/use-py.py")?.stdoutTail ?? ""), "a Python script runs in the prepared venv with its hash-pinned package", JSON.stringify(by("scripts/use-py.py")));
ok(/^200 /.test(by("scripts/fetch.js", "http://api.fixture.test/fixture-dep")?.stdoutTail ?? "") && by("scripts/fetch.js", "http://api.fixture.test/fixture-dep")?.egress.allowed.includes("api.fixture.test"), "skill_run reaches a host its approval names, through a credential of its own", JSON.stringify(by("scripts/fetch.js", "http://api.fixture.test/fixture-dep")));
const other = by("scripts/fetch.js", "http://other.fixture.test/fixture-dep");
ok(/^403 /.test(other?.stdoutTail ?? "") && other?.egress.refused.some((e: any) => e.host === "other.fixture.test"), "a host its approval does not name is refused (403) and recorded on the call", JSON.stringify(other));
const meta = by("scripts/fetch.js", "http://meta.fixture.test/latest"), lan = by("scripts/fetch.js", "http://lan.fixture.test/");
ok(/^403 /.test(meta?.stdoutTail ?? "") && /link-local|metadata/.test(meta?.egress.refused[0]?.why ?? "") && /^403 /.test(lan?.stdoutTail ?? "") && /private/.test(lan?.egress.refused[0]?.why ?? ""),
  "a listed host that resolves to a cloud metadata or private address is refused anyway", JSON.stringify([meta?.egress, lan?.egress]));
ok(by("scripts/install.sh")?.exit === 127 && /npm is not available when a skill runs/.test(by("scripts/install.sh")?.stderrTail ?? ""), "a script that tries npm install fails with Studio's clear reason (no installs at run time)", JSON.stringify(by("scripts/install.sh")));
ok(/refused-skill-write/.test(by("scripts/write-self.sh")?.stdoutTail ?? "") && lib.filesIntact("pkg-run", 1), "a script cannot write the skill's own copy (read-only, and denied by the sandbox); the library's version is intact", JSON.stringify(by("scripts/write-self.sh")));
ok(!runs.some((x) => x.script.includes("..")), "a script path outside the skill's detected scripts is refused, never run");
ok(/^\d+:/.test(ownFetch) && !/:200$/.test(ownFetch), "the agent's own command (another tool, the round's own list) reaches no skill host", ownFetch);
const ledger = readFileSync(join(h.data, "evidence", r1.id, "ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.record === "skill-run");
ok(ledger.length === runs.length && ledger.every((e) => e.data.skill === "pkg-run" && e.data.v === 1 && e.data.sha256 === pin.sha256 && e.data.filesSha256 === pin.filesSha256 && /^[a-f0-9]{64}$/.test(e.data.scriptSha256)) && ledger.some((e) => e.evidence[0] === "skill-run:pkg-run@v1/scripts/use-dep.js"),
  "every skill_run is in the evidence ledger with the skill, its version, both hashes, the script and its hash", JSON.stringify(ledger[0]));
const step = r1.steps.find((s: any) => s.node === "make") as any;
ok(step?.skillPackages?.[0]?.id === "pkg-run" && step.skillPackages[0].filesSha256 === pin.filesSha256 && step.skillPackages[0].scripts === "approved" && !!step.skillPackages[0].approval, "the step records the script skill it ran with: version, both hashes, the approval", JSON.stringify(step?.skillPackages));
const tlog = readFileSync(join(h.data, "runs", r1.id, "egress.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
ok(tlog.some((e) => e.host === "api.fixture.test" && e.allowed && e.skill === "pkg-run@v1") && tlog.some((e) => e.host === "other.fixture.test" && !e.allowed && e.skill === "pkg-run@v1"), "the Task's egress log has each connection: host, skill@version, allowed or refused", JSON.stringify(tlog.slice(0, 3)));
ok((r1.ctx.skillRefusals ?? []).some((x: any) => x.host === "other.fixture.test" && x.skill === "pkg-run@v1"), "a refused host lands in the Task's context for Firstmate (nobody is asked during the run)", JSON.stringify(r1.ctx.skillRefusals));
{ const tok = "round-token-probe"; egress.open(tok, ["api.provider.test"]);
  ok(!egress.allowed("api.fixture.test", tok) && egress.status().rounds === 1, "a round's own credential (its provider's hosts) does not carry the skill's hosts, and no skill credential outlives its call"); egress.close(tok); }

// ---------- text only; a changed script is a new version with no approval; a wrong files pin ----------
{ const d2 = skillFolder(src, fx, { name: "pkg-text", python: false }); lib.importFolder(d2, "captain"); pk.decide("pkg-text", 1, "text-only", "captain", "test");
  const t = lib.libVersion("pkg-text", 1)!.rec; withPins([{ id: "pkg-text", v: 1, sha256: t.sha256, filesSha256: t.filesSha256 }]);
  const r = await runOn("go"); const last = seen.at(-1)!;
  ok(r.status === "succeeded" && !last.tools.includes("skill_run") && /scripts are not enabled here; do not try to run or recreate them/.test(last.system), "text only: the agent gets the skill's text and the note, never skill_run", JSON.stringify(last.tools)); }
{ writeFileSync(join(folder, "scripts", "use-dep.js"), "console.log('changed');\n"); const v = lib.importFolder(folder, "captain");
  const s = pk.status("pkg-run", 2);
  ok(v.created && v.version.n === 2 && v.version.sha256 === pin.sha256 && v.version.filesSha256 !== pin.filesSha256 && s.state === "needs-approval" && !pk.decision("pkg-run", 2),
    "changing one script makes a new version (same SKILL.md, new files hash) with no inherited approval or hosts", JSON.stringify([v.version.n, s.state])); }
{ let err = ""; try { withPins([{ ...pin, filesSha256: "0".repeat(64) }]); } catch (e: any) { err = e.message; }
  ok(/files hash does not match/.test(err), "a pin whose files hash differs from the library's is refused when the workflow is saved", err); }

egress.stop(); fx.stop(); h.stop();
end();
