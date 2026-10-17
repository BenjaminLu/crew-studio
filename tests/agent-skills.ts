import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Agent skills (docs/units/agent-skills.md): a skill library in Studio's versioned
// skill store, imports from a folder, a skills home or a public https git URL, an
// ordered list of enabled skills per agent node, pinned by version and hash, and
// the agent's instructions built from them. The import route is the captain's act
// (session cookie plus Origin). Temporary data, the stub provider.   bun tests/agent-skills.ts
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { freePort, waitUp } from "./boot.mjs";
import { harness, suite, until, Y } from "./rt-harness";

const { ok, end } = suite("agent-skills");
const here = import.meta.dir, root = join(here, "..");
const sha = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
const skillMd = (name: string, desc: string, body: string, extra = "") => `---\nname: ${name}\ndescription: ${desc}\n${extra}---\n\n${body}\n`;
const tmp = mkdtempSync(join(tmpdir(), "crew-skills-"));
const mk = (dir: string, files: Record<string, string>) => { for (const [f, t] of Object.entries(files)) { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), t); } return dir; };
const S = await import("../src/skills").catch(() => ({} as any));
const D = await import("../src/runtime/defs");

// ---------- engine level: pins, order, step, tools, cap, re-import ----------
{
  const h = await harness([Y({ id: "sk", name: "SK", version: 1, roles: [{ id: "writer", label: "Writer", skill: "x" }], nodes: [
    { id: "start", kind: "hook", label: "Start", do: "note", x: 0, y: 0 },
    { id: "write", kind: "agent", label: "Write", role: "writer", mode: "skilltest", x: 100, y: 0 },
    { id: "end", kind: "hook", label: "End", do: "note", x: 200, y: 0 }], edges: [["start", "write"], ["write", "end"]] })]);
  const lib = S.Skills ? new S.Skills(h.data, { list: () => [], get: () => null, sourceSkill: () => null }) : null;
  if (lib) { (h.engine.deps as any).library = lib; h.defs.skillInfo = (id: string, v: number) => lib.pinInfo(id, v); }
  const box = mkdtempSync(join(tmpdir(), "crew-skills-box-"));
  const seen: { system: string; tools: string[]; sandbox: any; provSystem?: string }[] = [];
  const run0 = h.agents.run.bind(h.agents);
  (h.agents as any).run = (o: any) => { seen.push({ system: o.system, tools: o.tools.map((t: any) => t.name), sandbox: JSON.stringify(o.sandbox ?? null) }); return run0(o); };
  h.engine.modes.skilltest = { tools: () => [{ name: "note_write", description: "w", schema: { type: "object" }, run: () => ({ ok: true }) }, { name: "fs_read", description: "r", schema: { type: "object" }, run: () => ({ ok: true }) }],
    system: (_x: any, skill: string) => `${skill}\n\nMODE TAIL`, prompt: (x: any) => `TEST AGENT\n${x.run.text}`, after: () => "ok", sandbox: () => ({ writes: [box] }) } as any;
  const alphaDir = mk(join(tmp, "alpha"), { "SKILL.md": skillMd("alpha", "Alpha rules", "ALPHA-BODY-ONE"), "ref/notes.md": "supporting" });
  const betaDir = mk(join(tmp, "beta"), { "SKILL.md": skillMd("beta", "Beta rules", "BETA-BODY") });
  const toolsDir = mk(join(tmp, "greedy"), { "SKILL.md": skillMd("greedy", "Wants tools", "GREEDY-BODY", "allowed-tools: Bash, WebFetch\nnetwork: true\nsandbox: off\n") });
  let a1: any = null, b1: any = null, g1: any = null;
  try { a1 = lib.importFolder(alphaDir, "test"); b1 = lib.importFolder(betaDir, "test"); g1 = lib.importFolder(toolsDir, "test"); } catch (e: any) { console.log(`  (import: ${e?.message ?? e})`); }
  const runOn = async (version: number) => { const n = seen.length; try { const r = h.engine.start({ workflow: "sk", version, title: "t", text: "go", params: {}, by: "t" } as any);
    await until(() => ["succeeded", "failed"].includes(h.engine.get(r.id)!.status)); const run = h.engine.get(r.id)!; return { status: run.status, system: seen.length > n ? seen.at(-1)!.system : "", seen: seen.length > n ? seen.at(-1)! : null, run }; }
    catch (e: any) { console.log(`  (run v${version}: ${e?.message})`); return { status: "error", system: "", seen: null, run: null as any }; } };
  const pin = (r: any) => r ? { id: r.skill.id, v: r.version.n, sha256: r.version.sha256 } : { id: "missing", v: 1, sha256: "0" };
  const base = h.defs.get("sk")!;
  const withSkills = (list: any[], b = h.defs.get("sk")!) => ({ base: b.version, nodes: b.nodes.map((n: any) => (n.id === "write" ? { ...n, skills: list } : n)), edges: b.edges });
  let v2: any = null; try { v2 = h.defs.save("sk", withSkills([pin(a1), pin(b1)]), "captain"); } catch (e: any) { console.log(`  (save: ${e?.message})`); }
  ok(!!v2 && v2.version === 2 && JSON.stringify(v2.diff?.skills) === JSON.stringify([{ node: "write", before: [], after: ["alpha@v1", "beta@v1"] }]) && v2.diff.nodesChanged.some((c: any) => c.id === "write" && c.fields.includes("skills")),
    "two skills on one node make a new version whose diff names both, in order (save)", JSON.stringify(v2?.diff));
  // a run on v2: safety rules, role skill, alpha, beta, in that order; the step shows name@v1
  const R2 = await runOn(2); const sys = R2.system;
  const at = (s: string | RegExp) => typeof s === "string" ? sys.indexOf(s) : sys.search(s);
  const order = [at(/^# Studio safety rules/m), at("# Test skill"), at(/^# Skill: alpha \(v1\)$/m), at("ALPHA-BODY-ONE"), at(/^# Skill: beta \(v1\)$/m), at("BETA-BODY"), at("MODE TAIL")];
  ok(R2.status === "succeeded" && at(/^# Studio safety rules/m) === 0 && order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])),
    "the agent receives its skills in order: safety rules, role skill, then each skill under its heading", JSON.stringify(order));
  ok(!/^name: alpha$/m.test(sys) && !sys.includes("Alpha rules"), "a skill's frontmatter is not passed as instructions (only its body)");
  const step = R2.run?.steps.find((s: any) => s.node === "write") as any;
  ok(JSON.stringify(step?.skills) === JSON.stringify(["alpha@v1", "beta@v1"]), "the step shows name@v1 for each loaded skill, in order", JSON.stringify(step?.skills));
  // done 6: a skill whose frontmatter asks for tools, network or sandbox changes none of them
  const before = R2.seen ?? { system: "", tools: [], sandbox: "" };
  let v3: any = null; try { v3 = h.defs.save("sk", withSkills([pin(a1), pin(b1), pin(g1)]), "captain"); } catch (e: any) { console.log(`  (save greedy: ${e?.message})`); }
  const after = (await runOn(v3?.version ?? 2)).seen ?? { system: "", tools: ["-"], sandbox: "-" };
  ok(!!v3 && after.system.includes("GREEDY-BODY") && JSON.stringify(after.tools) === JSON.stringify(before.tools) && after.sandbox === before.sandbox && after.sandbox.includes(box)
    && JSON.stringify(g1?.version?.ignored) === JSON.stringify(["allowed-tools", "network", "sandbox"]),
    "a skill cannot grant tools: tools and sandbox unchanged, the requested keys recorded as ignored", JSON.stringify({ b: before.tools, a: after.tools, sb: [before.sandbox, after.sandbox], ign: g1?.version?.ignored }));
  // done 5: re-import a changed source → v2; a run on the pinned version keeps v1
  writeFileSync(join(alphaDir, "SKILL.md"), skillMd("alpha", "Alpha rules", "ALPHA-BODY-TWO"));
  let a2: any = null; try { a2 = lib.importFolder(alphaDir, "test"); } catch (e: any) { console.log(`  (reimport: ${e?.message})`); }
  let same: any = null; try { same = lib.importFolder(betaDir, "test"); } catch {}
  const sys4 = (await runOn(2)).system;
  let v4: any = null; try { v4 = h.defs.save("sk", withSkills([pin(a2), pin(b1)]), "captain"); } catch (e: any) { console.log(`  (move to v2: ${e?.message})`); }
  ok(a2?.version?.n === 2 && a2.created === true && same?.created === false && same?.version?.n === 1 && sys4.includes("ALPHA-BODY-ONE") && !sys4.includes("ALPHA-BODY-TWO")
    && lib?.library().find((s: any) => s.id === "alpha")?.current === 2 && !!v4 && JSON.stringify(v4.diff?.skills) === JSON.stringify([{ node: "write", before: ["alpha@v1", "beta@v1", "greedy@v1"], after: ["alpha@v2", "beta@v1"] }]),
    "re-import makes v2; the pinned run keeps v1, and moving to v2 is a new workflow version", JSON.stringify({ a2: a2?.version?.n, same: same?.created, v4: v4?.diff?.skills }));
  // a pinned text changed on disk: the run refuses it (never a silent swap)
  { const f = join(h.data, "skills", "_library", "beta", "v1", "SKILL.md"); if (existsSync(f)) writeFileSync(f, skillMd("beta", "Beta rules", "TAMPERED"));
    const R5 = await runOn(2);
    ok(existsSync(f) && !R5.system.includes("TAMPERED") && R5.status === "failed", "a pinned skill whose text changed since its hash was taken is refused, not sent"); }
  // done 7: the per-node cap
  const big = (n: string) => mk(join(tmp, n), { "SKILL.md": skillMd(n, "big", "x".repeat(60 * 1024)) });
  let bA: any = null, bB: any = null; try { bA = lib.importFolder(big("big-a"), "t"); bB = lib.importFolder(big("big-b"), "t"); } catch (e: any) { console.log(`  (big: ${e?.message})`); }
  let capErr = ""; try { h.defs.save("sk", withSkills([pin(bA), pin(bB)]), "captain"); } catch (e: any) { capErr = e.message; }
  const cap = S.SKILL_CAPS?.node ?? -1;
  ok(!!bA && !!bB && new RegExp(`write: the enabled skills total ${Math.round((bA.version.bytes + bB.version.bytes) / 1024)} KB; the cap is ${Math.round(cap / 1024)} KB`).test(capErr) && h.defs.versions("sk").length === 4,
    "the per-node cap is enforced: the save is refused with the total and the cap", capErr);
  let badPin = ""; try { h.defs.save("sk", withSkills([{ ...pin(a1), sha256: "f".repeat(64) }]), "captain"); } catch (e: any) { badPin = e.message; }
  ok(/alpha v1: the hash does not match/.test(badPin), "a pin whose hash does not match the stored version is refused", badPin);
  // r2 fix 4: a run on a version whose pinned skill left the library is refused at start, with the reason
  { let tmpPin: any = null; try { tmpPin = lib.importFolder(mk(join(tmp, "doomed"), { "SKILL.md": skillMd("doomed", "d", "DOOMED") }), "t"); } catch {}
    let vd: any = null; try { vd = h.defs.save("sk", withSkills([pin(tmpPin)]), "captain"); } catch (e: any) { console.log(`  (save doomed: ${e?.message})`); }
    rmSync(join(h.data, "skills", "_library", "doomed"), { recursive: true, force: true });
    let err = "", started = false; try { h.engine.start({ workflow: "sk", version: vd?.version ?? 999, title: "t", text: "go", params: {}, by: "t" } as any); started = true; } catch (e: any) { err = String(e?.message ?? e); }
    ok(!!vd && !started && /is not runnable: .*no skill doomed v1 in the library/.test(err), "a run on a version whose pinned skill is missing is refused at start, with the reason", err); }
  h.stop();
}

// ---------- r2 fixes 1 and 5: a git import, after the clone (the clone itself injected: no network) ----------
{ const data3 = mkdtempSync(join(tmpdir(), "crew-skills-git-"));
  const lib3 = S.Skills ? new S.Skills(data3, { list: () => [], get: () => null, sourceSkill: () => null }) : null;
  const away = mk(join(tmp, "away-git"), { "SKILL.md": skillMd("away", "Captain's local skill", "AWAY-BODY"), "inner/SKILL.md": skillMd("away-inner", "inner", "AWAY-INNER") });
  const fixture = mk(join(tmp, "fixture-repo"), { ".git/hooks/post-checkout": "#!/bin/sh\necho HOOK-RAN\n", ".git/config": "[core]\n", "skills/x/SKILL.md": skillMd("gitx", "From a public repo", "GIT-BODY"), "skills/x/ref/notes.md": "notes" });
  symlinkSync(away, join(fixture, "out")); symlinkSync(away, join(fixture, "via")); symlinkSync(join(away, "inner"), join(fixture, "skills", "lnk"));
  const rootRepo = mk(join(tmp, "fixture-root"), { ".git/config": "[core]\nGIT-CONFIG-TEXT\n", "SKILL.md": skillMd("rooted", "At the repo root", "ROOT-BODY") });
  const clone = (from: string) => async (_u: string, dest: string) => { cpSync(from, dest, { recursive: true, verbatimSymlinks: true }); };
  const tryGit = async (url: string, path: string | null, from = fixture) => { try { return await lib3.importGit(url, path, "t", { clone: clone(from) }); } catch (e: any) { return { error: String(e?.message ?? e) }; } };
  const url = "https://example.com/org/skills.git";
  const bad = [await tryGit(url, "out"), await tryGit(url, "via/inner"), await tryGit(url, "skills/lnk")];
  const listed = () => (lib3?.library?.() ?? []).map((x: any) => x.id);
  ok(/out is a symlink/.test(bad[0]?.error ?? "") && /via is a symlink/.test(bad[1]?.error ?? "") && /skills\/lnk is a symlink/.test(bad[2]?.error ?? "") && !listed().includes("away") && !listed().includes("away-inner")
    && !(existsSync(join(data3, "skills")) && JSON.stringify(readdirSync(join(data3, "skills"), { recursive: true } as any)).includes("away")),
    "a git import's folder may not be a link, nor sit under one, that leaves the clone (nothing outside is imported)", JSON.stringify(bad));
  const good: any = await tryGit(url, "skills/x"); const gx = (lib3?.library?.() ?? []).find((x: any) => x.id === "gitx");
  const root: any = await tryGit("https://example.com/org/rooted.git", null, rootRepo); const rt = (lib3?.library?.() ?? []).find((x: any) => x.id === "rooted");
  const stored = existsSync(join(data3, "skills", "_library")) ? JSON.stringify(readdirSync(join(data3, "skills", "_library"), { recursive: true } as any)) : "";
  ok(!good?.error && !!gx && gx.sourceKind === "git" && gx.source === `${url}#skills/x` && gx.current === 1 && gx.sha256 === sha(skillMd("gitx", "From a public repo", "GIT-BODY")) && gx.files.includes("ref/notes.md")
    && !!rt && rt.source === "https://example.com/org/rooted.git" && !rt.files.some((f: string) => f.startsWith(".git")) && !stored.includes(".git") && !stored.includes("hooks"),
    "import from a public https git URL: listed with source url#path, v1 and sha256; .git is never copied", JSON.stringify({ good, gx, root, rt })); }

// ---------- r2 fix 3: every agent invocation starts with the safety rules; the merge card's coordinator gets its skills ----------
{ const seen: { id: string; sys: string }[] = [];
  const recorder = (id: string) => ({ id, model: "rec", start: (sys: string) => { seen.push({ id, sys }); return { interrupt() {}, async *send() { yield { type: "turnEnd", status: "ok" } as any; } }; } });
  const d4 = mkdtempSync(join(tmpdir(), "crew-skills-inv-"));
  const { Agents } = await import("../src/agent");
  await new Agents(d4, () => "http://127.0.0.1:1").run({ kind: "t", title: "t", system: "PLAIN-SYSTEM", text: "x", tools: [], provider: recorder("agents") as any });
  const { runChat } = await import("../src/chat");
  await runChat({ provider: recorder("chat") as any, message: "hi", history: [], lang: "en", studioUrl: "http://127.0.0.1:1", token: "t", dataDir: d4, onEvent: () => {} } as any);
  const { ArtifactStore } = await import("../src/artifacts"); const { WorkRuns } = await import("../src/work");
  const st = new ArtifactStore(join(d4, "w")); const src = join(d4, "src"); mkdirSync(src); writeFileSync(join(src, "index.html"), "<html><body>x</body></html>");
  st.create({ id: "pg", title: "pg", type: "web", source: "html", entry: "index.html" } as any); st.addVersion("pg", { from: src, primary: "index.html", createdBy: { kind: "captain" } } as any); st.addNote("pg", 1, { kind: "pin", selector: "body", comment: "c" } as any);
  new WorkRuns(st, join(d4, "w")).start({ artifact: "pg", n: 1, provider: recorder("work") as any, studioUrl: "http://127.0.0.1:1" }); await until(() => seen.some((x) => x.id === "work"), 5000);
  const first = (id: string) => seen.find((x) => x.id === id)?.sys ?? "";
  ok(["agents", "chat", "work"].every((id) => first(id).startsWith("# Studio safety rules")) && first("agents").split("PLAIN-SYSTEM").length === 2 && first("agents").split("# Studio safety rules").length === 2,
    "every agent invocation (agent runs, the chat, work runs) starts with the safety rules, once", JSON.stringify(seen.map((x) => [x.id, x.sys.slice(0, 40)])));
  // the merge card's coordinator: the safety rules, the coordinator role skill, then plain-writing
  const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
  const d5 = mkdtempSync(join(tmpdir(), "crew-skills-merge-"));
  const H = await harness([readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")], { data: d5, checkRoots: [] });
  const lib5 = S.Skills ? new S.Skills(d5, { list: () => [], get: () => null, sourceSkill: () => null }) : null;
  if (lib5) { (H.engine.deps as any).library = lib5; H.defs.skillInfo = (id: string, v: number) => lib5.pinInfo(id, v); }
  installCode(H.engine, { dataDir: d5, projects: new Projects(d5) });
  const caught: { kind: string; system: string }[] = []; const run5 = H.agents.run.bind(H.agents);
  (H.agents as any).run = (o: any) => { caught.push({ kind: o.kind, system: o.system }); return run5(o); };
  let msys = "";
  try { const r = H.engine.start({ workflow: "code-firstmate", text: "Add a percent function", params: {} } as any); H.engine.cancel(r.id, "t");
    const run = H.engine.get(r.id)!; const node = run.def.nodes.find((n: any) => n.id === "merge-card")!;
    await H.engine.cardBodies.merge(H.engine.x(run, node, run.nodes["merge-card"]));
    msys = caught.find((c) => c.kind === "card:merge")?.system ?? ""; } catch (e: any) { console.log(`  (merge card: ${e?.message})`); }
  const mo = [msys.search(/^# Studio safety rules/m), msys.indexOf("# Test skill"), msys.search(/^# Skill: plain-writing \(v1\)$/m), msys.indexOf("You are the coordinator (firstmate)")];
  ok(mo[0] === 0 && mo.every((v, i) => v >= 0 && (i === 0 || v > mo[i - 1])), "the merge card's coordinator gets the safety rules, the role skill, then plain-writing", JSON.stringify(mo));
  H.stop(); }

// ---------- the server: the import route, the homes, the built-in skill, a real code-firstmate run ----------
const home = join(tmp, "home"); const data = join(tmp, "data"); const state = join(tmp, "fm", "state");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data, { recursive: true });
mk(join(home, ".claude", "skills", "home-skill"), { "SKILL.md": skillMd("home-skill", "From the claude home", "HOME-BODY") });
mk(join(home, ".codex", "skills", "codex-one"), { "SKILL.md": skillMd("codex-one", "From the codex home", "CODEX-BODY") });
const port = await freePort(); const base = `http://127.0.0.1:${port}`;
const env: Record<string, string> = { ...process.env as any }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const TOKEN = "test-session-skills";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_SESSION_TOKEN: TOKEN, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: home, CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout!.on("data", (d) => (appLog += d)); app.stderr!.on("data", (d) => (appLog += d));
try {
  await waitUp(base, app);
  const get = async (p: string) => { const r = await fetch(base + p); try { return await r.json(); } catch { return { status: r.status }; } };
  const imp = async (body: any, headers: Record<string, string> = { cookie: `crew_session=${TOKEN}`, origin: base }) => {
    const r = await fetch(`${base}/api/skills/import`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
  const listed = async () => ((await get("/api/skills")).skills ?? []) as any[];
  // done 1
  const fdir = mk(join(tmp, "srv-folder"), { "SKILL.md": skillMd("folder-skill", "Folder rules for testing", "FOLDER-BODY"), "examples/a.md": "example" });
  const f1 = await imp({ kind: "folder", path: fdir });
  const L1 = await listed(); const fs1 = L1.find((s) => s.id === "folder-skill");
  ok(f1.status === 200 && !!fs1 && fs1.name === "folder-skill" && fs1.description === "Folder rules for testing" && fs1.source === fdir && fs1.sourceKind === "folder" && fs1.current === 1 && fs1.sha256 === sha(readFileSync(join(fdir, "SKILL.md")))
    && fs1.files?.includes("examples/a.md"), "import from a folder: listed with name, description, source, v1 and sha256", JSON.stringify({ f1, fs1 }));
  const homes = await get("/api/skills/homes");
  const ch = (homes.homes ?? []).find((x: any) => x.id === "claude"); const cx = (homes.homes ?? []).find((x: any) => x.id === "codex");
  const h1 = await imp({ kind: "home", home: "claude", name: "home-skill" });
  const hs = (await listed()).find((s) => s.id === "home-skill");
  ok(ch?.skills?.some((s: any) => s.dir === "home-skill" && s.description === "From the claude home") && cx?.skills?.some((s: any) => s.dir === "codex-one") && h1.status === 200 && !!hs && hs.description === "From the claude home"
    && hs.sourceKind === "home" && hs.source === "~/.claude/skills/home-skill" && hs.current === 1 && hs.sha256 === sha(readFileSync(join(home, ".claude/skills/home-skill/SKILL.md"))),
    "import from a skills home: picked from the list, listed with name, description, source, v1 and sha256", JSON.stringify({ homes, h1, hs }));
  // done 2: each refusal, with the reason, and nothing imported
  const n0 = (await listed()).length;
  const unchanged = async () => (await listed()).length === n0;
  { const d = mk(join(tmp, "no-skill"), { "README.md": "not a skill" }); const r = await imp({ kind: "folder", path: d });
    ok(r.status === 400 && /no SKILL\.md/.test(r.error ?? "") && await unchanged(), "import refuses a folder without SKILL.md, with the reason", JSON.stringify(r)); }
  { const d = mk(join(tmp, "too-big"), { "SKILL.md": skillMd("too-big", "big", "y".repeat(70 * 1024)) }); const r = await imp({ kind: "folder", path: d });
    ok(r.status === 400 && /SKILL\.md is 70 KB; the cap is 64 KB/.test(r.error ?? "") && await unchanged(), "import refuses a skill over the size cap, with the size and the cap", JSON.stringify(r)); }
  { const d = mk(join(tmp, "big-folder"), { "SKILL.md": skillMd("big-folder", "b", "ok"), "a.bin": "z".repeat(600 * 1024), "deep/b.bin": "z".repeat(600 * 1024) }); const r = await imp({ kind: "folder", path: d });
    ok(r.status === 400 && /the folder is over the 1024 KB cap/.test(r.error ?? "") && await unchanged(), "import refuses a folder over the size cap (supporting files count)", JSON.stringify(r)); }
  { const outside = mk(join(tmp, "outside-secret"), { "secret.txt": "OUTSIDE-SECRET-TEXT" });
    const d = mk(join(tmp, "leaky"), { "SKILL.md": skillMd("leaky", "l", "ok"), "refs/keep.md": "fine" }); symlinkSync(join(outside, "secret.txt"), join(d, "refs", "notes.md"));
    const d2 = mk(join(tmp, "leaky-dir"), { "SKILL.md": skillMd("leaky-dir", "l", "ok") }); symlinkSync(outside, join(d2, "more"));
    const r = await imp({ kind: "folder", path: d }); const r2 = await imp({ kind: "folder", path: d2 });
    const grep = (dir: string): boolean => existsSync(dir) && readdirSync(dir).some((f) => { const p = join(dir, f); const st = statSync(p); return st.isDirectory() ? grep(p) : readFileSync(p, "utf8").includes("OUTSIDE-SECRET-TEXT"); });
    ok(r.status === 400 && /refs\/notes\.md is a symlink that leaves the folder/.test(r.error ?? "") && r2.status === 400 && /more is a symlink that leaves the folder/.test(r2.error ?? "") && await unchanged() && !grep(join(data, "skills")),
      "import refuses a symlink that leaves the folder (a nested file and a folder link), and copies nothing from outside", JSON.stringify([r, r2])); }
  // git: a local listener counts every connection; a refused URL never reaches it
  let hits = 0; const lis = createServer((s) => { hits++; s.destroy(); }); await new Promise<void>((res) => lis.listen(0, "127.0.0.1", () => res())); const gp = (lis.address() as any).port;
  { const urls = [`http://127.0.0.1:${gp}/r.git`, `git://127.0.0.1:${gp}/r.git`, `ssh://127.0.0.1:${gp}/r.git`, `file://${tmp}/r.git`, `git@127.0.0.1:r.git`, `ext::sh -c touch% ${tmp}/pwned`];
    const rs = []; for (const u of urls) rs.push(await imp({ kind: "git", url: u }));
    ok(rs.every((r) => r.status === 400 && /only https:\/\/ git URLs/.test(r.error ?? "")) && hits === 0 && !existsSync(join(tmp, "pwned")) && await unchanged(), "import refuses a git URL that is not https, before any connection", JSON.stringify(rs)); }
  { const rs = [await imp({ kind: "git", url: `https://captain:ghp_SECRETVALUE123@127.0.0.1:${gp}/r.git` }), await imp({ kind: "git", url: `https://ghp_SECRETVALUE123@127.0.0.1:${gp}/r.git` }), await imp({ kind: "git", url: `https://127.0.0.1:${gp}/r.git?access_token=ghp_SECRETVALUE123` })];
    ok(rs.every((r) => r.status === 400 && /credentials/.test(r.error ?? "") && !JSON.stringify(r).includes("SECRETVALUE")) && hits === 0 && await unchanged(), "import refuses a git URL that carries credentials, and never echoes them", JSON.stringify(rs)); }
  lis.close();
  { const d = mk(join(tmp, "sess"), { "SKILL.md": skillMd("sess", "s", "ok") });
    const rs = [await imp({ kind: "folder", path: d }, { origin: base }), await imp({ kind: "folder", path: d }, { origin: base, "x-crew-session": TOKEN }), await imp({ kind: "folder", path: d }, { cookie: `crew_session=wrong`, origin: base })];
    ok(rs.every((r) => r.status === 403 && /session/.test(r.error ?? "")) && await unchanged(), "import refuses a request without a session (no cookie, a script header, a wrong cookie)", JSON.stringify(rs)); }
  { const d = mk(join(tmp, "orig"), { "SKILL.md": skillMd("orig", "o", "ok") });
    const rs = [await imp({ kind: "folder", path: d }, { cookie: `crew_session=${TOKEN}`, origin: "http://evil.example" }), await imp({ kind: "folder", path: d }, { cookie: `crew_session=${TOKEN}` })];
    ok(rs[0].status === 403 && /another site/.test(rs[0].error ?? "") && rs[1].status === 403 && /Origin/.test(rs[1].error ?? "") && await unchanged(), "import refuses a foreign Origin (and a request with no Origin)", JSON.stringify(rs)); }
  { const r = await imp({ kind: "home", home: "claude", name: "../../outside-secret" });
    ok(r.status === 400 && await unchanged(), "a skills home pick is one folder name inside the home", JSON.stringify(r)); }
  // done 10: the built-in plain-writing skill, listed and pinned on code-firstmate's coordinator; a real run's coordinator prompt has it after the role skill
  const pw = (await listed()).find((s) => s.id === "plain-writing");
  const pwFile = join(root, "packs/core/skills/plain-writing/SKILL.md"); const pwText = existsSync(pwFile) ? readFileSync(pwFile, "utf8") : "@@missing";
  const wf = await get("/api/wf/code-firstmate");
  const coord = (wf.def?.nodes ?? []).filter((n: any) => n.kind === "agent" && n.role === "coordinator");
  ok(!!pw && pw.sourceKind === "builtin" && pw.source === "core pack" && pw.current === 1 && pw.sha256 === sha(pwText) && coord.length >= 2 && coord.every((n: any) => (n.skills ?? []).some((p: any) => p.id === "plain-writing" && p.v === 1 && p.sha256 === pw.sha256)),
    "the built-in plain-writing skill is listed (core pack) and enabled on code-firstmate's coordinator nodes", JSON.stringify({ pw, coord: coord.map((n: any) => [n.id, n.skills]) }));
  // A code-firstmate Task through the HTTP route now needs the captain's staffing approval (src/domain/staffing.ts,
  // installStaffingGuard), so the coordinator prompt is checked on the engine below, with the real role skill.
  const notice = join(data, "skills", "_library", "plain-writing", "v1", "files", "NOTICE.md");
  ok((pw?.files ?? []).includes("NOTICE.md") && existsSync(notice) && /MIT License/.test(readFileSync(notice, "utf8")) && /Copyright/.test(readFileSync(notice, "utf8")),
    "the credit and MIT notices ship as NOTICE.md with the skill", JSON.stringify({ files: pw?.files }));
  // imported text stays local: not in the events log, not in a workflow version
  const evs = existsSync(join(data, "events.jsonl")) ? readFileSync(join(data, "events.jsonl"), "utf8") : "";
  const wfs = JSON.stringify(readdirSync(join(data, "workflows", "code-firstmate")).map((f) => readFileSync(join(data, "workflows", "code-firstmate", f), "utf8")));
  ok(!evs.includes("FOLDER-BODY") && !evs.includes("HOME-BODY") && !wfs.includes("Plain writing (English"), "imported skill text is not written to the events log or a workflow version");
} catch (e: any) { ok(false, "server suite", `${e?.stack ?? e}\n${appLog.slice(-2000)}`); }
finally { app.kill(); }

// ---------- a real code-firstmate run's coordinator prompt (engine, registered project, real role skill) ----------
{ const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors"); const { bundledText } = await import("../src/bundled");
  const d6 = mkdtempSync(join(tmpdir(), "crew-skills-run-")), repo = mkdtempSync(join(tmpdir(), "crew-skills-repo-"));
  for (const a of [["init", "-b", "main"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "init"]]) Bun.spawnSync(["git", ...a], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  writeFileSync(join(d6, "projects.json"), JSON.stringify([{ id: "p", name: "Fixture", path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
  const H = await harness([readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")], { data: d6, checkRoots: [] });
  const lib6 = S.Skills ? new S.Skills(d6, { list: () => [], get: () => null, sourceSkill: () => null }) : null;
  if (lib6) { (H.engine.deps as any).library = lib6; H.defs.skillInfo = (id: string, v: number) => lib6.pinInfo(id, v); }
  (H.engine.deps as any).skillText = (ref: string) => bundledText("packs/" + ref.slice(5)) ?? "";
  installCode(H.engine, { dataDir: d6, projects: new Projects(d6) });
  const caught: { kind: string; system: string }[] = []; const run6 = H.agents.run.bind(H.agents);
  (H.agents as any).run = (o: any) => { caught.push({ kind: o.kind, system: o.system }); return run6(o); };
  const r = H.engine.start({ workflow: "code-firstmate", text: "Add a percent function to money-kit", params: { project: "p" } } as any);
  await until(() => caught.some((c) => c.kind === "run:spec") || ["failed", "succeeded"].includes(H.engine.get(r.id)!.status), 30000);
  const ssys = caught.find((c) => c.kind === "run:spec")?.system ?? "";
  const pwText = readFileSync(join(root, "packs/core/skills/plain-writing/SKILL.md"), "utf8");
  const roleText = readFileSync(join(root, "packs/firstmate/skills/firstmate.md"), "utf8").split("\n").find((l) => l.trim()) ?? "@@";
  const pwBody = pwText.split("\n").find((l) => l.startsWith("# Plain writing")) ?? "@@";
  const o = [ssys.search(/^# Studio safety rules/m), ssys.indexOf(roleText), ssys.search(/^# Skill: plain-writing \(v1\)$/m), ssys.indexOf(pwBody), ssys.indexOf("Credit and licenses: NOTICE.md")];
  ok(o.every((v, i) => v >= 0 && (i === 0 || v > o[i - 1])), "a code-firstmate run's coordinator prompt contains plain-writing after the role skill", JSON.stringify({ o, run: r.id, err: H.engine.get(r.id)?.error }));
  ok(!!ssys && !/Copyright|MIT License|Permission is hereby granted/.test(ssys), "the credit and MIT notices are never in the coordinator prompt");
  const run = H.engine.get(r.id)!;
  ok((run.steps ?? []).some((s: any) => s.node === "spec" && JSON.stringify(s.skills) === JSON.stringify(["plain-writing@v1"])), "the run's spec step shows plain-writing@v1", JSON.stringify((run.steps ?? []).map((s: any) => [s.node, s.skills])));
  try { H.engine.cancel(r.id, "t"); } catch {}
  H.stop(); }

// ---------- done 9: the architecture says it ----------
{ const a = readFileSync(join(root, "docs/architecture.md"), "utf8");
  const s4 = a.slice(a.indexOf("## 4. Contracts"), a.indexOf("## 5.")); const s5 = a.slice(a.indexOf("## 5. Workflows"), a.indexOf("## 6."));
  ok(/license attribution of public open-source works that Studio ships is required, and is not private content/i.test(a.slice(a.indexOf("## 1."), a.indexOf("## 2."))), "architecture §1.9 says shipped license attribution is required and not private content");
  ok(/^\| skill \|/m.test(s4) && /ordered list of enabled skills/.test(s5), "architecture.md §4 has a skill contract row and §5 says agent nodes carry an ordered skill list"); }
// a git clone never runs a hook, never asks for or sends a credential (the argv and environment the import uses)
{ const g = S.gitCloneCommand?.("https://example.com/a/b.git", "/tmp/x") ?? { argv: [], env: {} };
  const a = g.argv.join(" ");
  ok(/core\.hooksPath=\/dev\/null/.test(a) && /--template=/.test(a) && /protocol\.allow=never/.test(a) && /protocol\.https\.allow=always/.test(a) && /credential\.helper=/.test(a) && g.env.GIT_TERMINAL_PROMPT === "0" && g.env.GIT_CONFIG_GLOBAL === "/dev/null" && g.env.GIT_CONFIG_NOSYSTEM === "1" && !Object.keys(g.env).some((k) => /TOKEN|KEY|SECRET/.test(k)),
    "a git import clones with no hooks, https only, no credential helper and no prompt", a); }
end();
