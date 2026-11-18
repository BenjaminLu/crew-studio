// The rest of a Studio for the read tools' P2 kinds (tests/observe-kinds.ts, and the grant tests after it), on top of
// tests/lib/observe-fixture.ts: a skill library with a script skill (baton, two versions, the second approved by the
// captain), the Library with a page and a document, Studio's event log with the retro's signals and a captain's note, two
// web terminals (one waiting for input), Doctor rows, the settings, a LAN peer and a paired phone, the crew and a project.
// Every name is invented; every text someone else wrote carries the injection line.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { observeFixture, INJECTION, ROOM, REPO } from "./observe-fixture";
import { createObserve } from "../../src/observe/tools";
import { taskRow } from "../../src/runtime/task-row";
import { Skills } from "../../src/skills";
import { SkillPackages } from "../../src/skillpkg/index";
import { ArtifactStore } from "../../src/artifacts";
import { StudioLog } from "../../src/rawlog";
import { RetroStore, signal } from "../../src/retro-signals";
import { Projects } from "../../src/doors";
import { createProjectOverview } from "../../src/project-overview";
import { Worktrees } from "../../src/worktrees";

export const SECRET = "sk-" + "ant-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
export async function observeP2Fixture() {
  const F = await observeFixture(), data = F.H.data;
  // ---------- skills: baton v1 (text), v2 (with a script, approved by the captain, not yet prepared) ----------
  const skills = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
  const src = mkdtempSync(join(tmpdir(), "crew-obs-skill-")), dir = join(src, "baton"); mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: baton\ndescription: Hand work on. ${INJECTION}\n---\n\nWrite the walkthrough.\n`);
  skills.importFolder(dir, "captain");
  writeFileSync(join(dir, "scripts", "outline.sh"), "#!/bin/sh\necho outline\n");
  skills.importFolder(dir, "captain");
  const packages = new SkillPackages({ dataDir: data, skills, brew: false, uv: false, inUse: () => new Set(["baton@v2"]) });
  const facts = packages.cardFacts("baton", 2)!;
  packages.decide("baton", 2, "approved", "captain", "card", { card: "SC-77", expected: { sha256: facts.sha256, filesSha256: facts.filesSha256 } } as any);
  // ---------- the Library: a page with two versions (the second approved) and a document ----------
  const artifacts = new ArtifactStore(data), work = mkdtempSync(join(tmpdir(), "crew-obs-art-"));
  artifacts.create({ id: "harbor-banner", title: "Harbor banner", type: "web", source: "html", entry: "index.html" });
  for (const [n, summary] of [[1, "first cut"], [2, `brighter waves. ${INJECTION}`]] as const) { const d = join(work, `v${n}`); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "index.html"), `<h1>v${n}</h1>`);
    artifacts.addVersion("harbor-banner", { from: d, primary: "index.html", createdBy: { kind: "agent", provider: "codex", model: "fixture-model", run: F.ids.plain }, status: n === 2 ? "approved" : "in-review", summary } as any); }
  try { (artifacts as any).approve?.("harbor-banner", 2, "captain"); } catch {}
  { const d = join(work, "doc"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "doc.md"), `# Tide brief\n\nThe tide sync plan. ${INJECTION}\n`); writeFileSync(join(d, "doc.html"), "<h1>Tide brief</h1>");
    artifacts.create({ id: "tide-brief", title: "Tide brief", type: "doc", source: "md", entry: "doc.md" });
    artifacts.addVersion("tide-brief", { from: d, primary: "doc.html", createdBy: { kind: "agent" }, status: "in-review", summary: "first draft" } as any); }
  // ---------- Studio's event log: the retro's signals, a captain's note, a line that quotes a tool ----------
  const log = new StudioLog(join(data, "events.jsonl"));
  signal(log, "run_failed", { task: F.ids.failed, node: "deploy", failure: "internal.unmapped", cls: "internal", ending: "failed" }, { task: F.ids.failed });
  signal(log, "room_round_failed", { room: ROOM, run: F.ids.plain, why: "limit", code: "explain" }, { task: F.ids.plain });
  signal(log, "pr_merged", { pr: `${REPO}#1601`, mergedAt: new Date().toISOString() });
  signal(log, "pr_live_partial", { pr: `${REPO}#1601`, env: "staging", production: false, pods: { on: 1, off: 1 } });
  const retro = new RetroStore(data), note = retro.addNote({ text: "The deploy card hid the pod name", by: "captain", kind: "note", route: "#/prs", ref: `${REPO}#1601`, sel: `selected page text. ${INJECTION}` });
  signal(log, "captain_note", { route: "#/prs", ref: `${REPO}#1601`, sel: true, note: note.id, by: "captain" }, { actor: "captain" });
  log.emit({ type: "terminal", workflow: "terminal", summary: `terminal T-1 exited: ${INJECTION}` });
  // ---------- terminals: one waiting for input, one working; their screens hold the injection line ----------
  const term = (id: string, state: string, reason: string, ask: string | null) => ({ id, project: { id: "harbor-app", name: "Harbor app", path: "/x" }, preset: "claude", kind: "claude", label: "Claude Code", command: "claude", by: "captain",
    startedAt: new Date(Date.now() - 600_000).toISOString(), endedAt: null, exitCode: null, signal: null, state, reason, ask, cols: 120, rows: 40, running: true, git: { start: { branch: "feat/tide", head: "e".repeat(40), commits: 0, base: "main" }, end: null },
    review: null, remote: { enabled: true, mode: "flag", sent: true, url: "https://claude.ai/code/remote-fixture" }, transcriptTruncated: false, restored: false, stopped: null });
  const terms = [term("T-mf3k2a-1b2c3d", "waiting", "question", `Proceed with the migration? [y/N] ${INJECTION}`), term("T-mf3k2b-4e5f6a", "working", "busy", null)];
  const terminals = { list: () => structuredClone(terms), tail: (id: string, n: number) => (terms.some((t) => t.id === id) ? ["$ npm test", `1 failing: ${INJECTION}`, "Proceed with the migration? [y/N]"].slice(-n) : null) };
  // ---------- Doctor, settings, peers, the crew, projects ----------
  const doctorItems = [{ id: "claude", title: "Claude Code", status: "ok", detail: `found at ${process.env.HOME ?? "/home/x"}/.local/bin/claude`, adds: "Firstmate on Claude", fix: "", group: "basic", action: { kind: "none" }, version: "2.1.0" },
    { id: "ffmpeg", title: "ffmpeg", status: "missing", detail: "not on PATH", adds: "films", fix: "brew install ffmpeg", group: "optional", action: { kind: "install" }, version: null }];
  const settings = { language: "zh-TW", chat: { provider: "claude", model: null, cli: true }, keys: { anthropic: true, openai: false, compatible: false }, sharing: true, phoneDrive: false, lan: { on: true }, token: SECRET, apiKey: { value: SECRET } };
  const peers = { lan: [{ key: "k".repeat(64), fp: "3F2A-9C0D-1E7B-6A54-0000", petname: "Mira's Studio", claimed: `MIRA ${INJECTION}`, host: "192.168.7.21", port: 4311, introducedAt: new Date().toISOString(), state: "trusted", vouched: true }],
    phones: [{ id: "d-9a8b", name: `Captain's phone ${INJECTION}`, hash: "h".repeat(64), paired: new Date().toISOString(), lastSeen: null }] };
  const crew = { schema: 1, version: 3, previous: null, hash: "x", signature: "y", approval: { by: "captain", via: "page" }, members: { worker: { provider: "codex", model: "fixture-model", effort: "high", skills: [{ id: "baton", v: 2, sha256: facts.sha256 }] }, reviewer: { provider: "claude", model: "fixture-model", effort: null, skills: [] } }, seats: {}, workflows: {} };
  const projects = new Projects(data), repo = mkdtempSync(join(tmpdir(), "crew-obs-proj-"));
  projects.add({ id: "harbor-app", name: "Harbor app", path: null, base: "main" }); void repo;
  const overview = createProjectOverview({ dataDir: data, projects, engine: F.E, session: "fixture-session", worktrees: new Worktrees(data), artifacts });
  const sources = { engine: F.E, taskRow: (r: any) => taskRow(F.E, r), prs: () => F.prs, focus: F.focus, log, dataDir: data, skills: () => skills, packages: () => packages, artifacts: () => artifacts, crew: () => crew,
    terminals: () => terminals, doctor: () => doctorItems, settings: () => settings, peers: () => peers, projects: () => overview };
  const observe = createObserve(sources as any);
  return { ...F, observe, sources, skills, packages, artifacts, log, retro, note, terms, terminals, doctorItems, settings, peers, crew, overview, projects };
}
export { INJECTION, ROOM, REPO };
