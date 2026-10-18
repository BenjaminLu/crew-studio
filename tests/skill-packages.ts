import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// Skill packages: the import, the scan, the captain's decision and readiness (docs/units/skill-packages.md §1-§3, §9):
//   - a skill with scripts imports under the larger cap; caches (__pycache__, *.pyc, .DS_Store) are skipped, native binaries refused
//   - the scan finds scripts, lockfiles, programs and hosts (never an XML namespace; an IP literal or a local name never gets listed)
//   - the decision is Studio's own signed record, bound to both hashes; an edited or forged line is ignored
//   - the team-change card lists an undecided script skill (scripts, flags, hosts) and the captain's one answer decides it:
//     with scripts or text only; Studio-wide per version, never asked again; the Crew page asks the same before it saves
//   - readiness is shown on the Crew page (en and zh-TW) and in Firstmate's work status, with the reason, never as a question
//      bun tests/skill-packages.ts
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("skill-packages");
const { Skills } = await import("../src/skills");
const { SkillPackages } = await import("../src/skillpkg/index");
const { checkHost } = await import("../src/skillpkg/net");
const C = await import("../src/domain/crew");
const { installCrewGuard } = await import("../src/crew-guard");
const { installCrewTools } = await import("../src/crew-tools");
const { installFirstmate } = await import("../src/firstmate");
const { crewRoutes } = await import("../src/crew-routes");
const { Projects } = await import("../src/doors");
const { bundledText } = await import("../src/bundled");
const tmp = checkedTempDir("skill-packages-");
const mk = (dir: string, files: Record<string, string | Buffer>) => { for (const [f, t] of Object.entries(files)) { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), t); } return dir; };
const md = (name: string, extra = "") => `---\nname: ${name}\ndescription: ${name} fixture\n${extra}---\n\nUse the scripts.\n`;

// ---------- hosts ----------
ok(checkHost("api.example.net").ok && !checkHost("10.0.0.1").ok && !checkHost("localhost").ok && !checkHost("printer.local").ok && !checkHost("metadata.google.internal").ok && !checkHost("169.254.169.254").ok && !checkHost("*.com").ok,
  "a skill's host list takes DNS names only: never an IP literal, a local name, a metadata name or a wildcard over a top-level domain");

const node = (id: string) => ({ id, kind: "agent", label: id.toUpperCase(), role: "maker", mode: "test", x: 0, y: 0 });
const wait = { id: "wait", kind: "card", label: "Wait", x: 0, y: 0, card: { body: { en: "A fixture card.", "zh-TW": "測試卡片。" }, options: [{ id: "go", label: "Go", labelZh: "Go" }] } };
const flow = Y({ id: "fixture-web", name: "fixture-web", kind: "web", version: 1, roles: [{ id: "maker", label: "Maker", skill: "bundled:x", seat: "maker" }], nodes: [wait, node("a")], edges: [["wait", "a", "go"]] });
const H = await harness([bundledText("workflows/v2/firstmate-proposal.wf.yaml")!, bundledText("workflows/v2/crew-change.wf.yaml")!, flow], { data: checkedTempDir("skill-packages-data-") });
const E = H.engine;
const lib = new Skills(H.data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
(E.deps as any).library = lib; H.defs.skillInfo = (id: string, v: number) => lib.pinInfo(id, v); H.defs.skillLibrary = () => lib.library();
const inUse = new Set<string>();
const pk = new SkillPackages({ dataDir: H.data, skills: lib, brew: false, uv: false, inUse: () => inUse });
(E.deps as any).skillPackages = pk;

// ---------- import: tiers, skips, refusals; the scan ----------
const big = Buffer.alloc(1200 * 1024, 65);
const pptxLike = mk(join(tmp, "deck"), { "SKILL.md": md("deck", "metadata:\n  requires:\n    bins: [no-such-program-xyz]\n"), "scripts/thumbnail.py": "import subprocess, os\nimport lxml\nURL = 'https://api.example.net/v1'\nNS = 'http://schemas.openxmlformats.org/drawingml/2006/main'\nsubprocess.run(['soffice', '--headless'])\nx = os.environ.get('HOME')\nrequests_url = 'http://10.0.0.7/x'\n",
  "scripts/office/schemas/big.xsd": big, "scripts/__pycache__/thumbnail.cpython-314.pyc": "PYC", ".DS_Store": "DS", "references/notes.md": "notes" });
const d1 = lib.importFolder(pptxLike, "captain");
const pkg = d1.version.pkg!;
ok(d1.created && !d1.version.files.some((f: string) => /__pycache__|\.pyc$|\.DS_Store/.test(f)) && d1.version.skipped.some((s: string) => /cache files? skipped/.test(s)),
  "a script skill over the text cap (1.2 MB of schemas) imports under the script cap; __pycache__, *.pyc and .DS_Store are skipped and named", JSON.stringify([d1.version.files, d1.version.skipped]));
ok(pkg.scripts.length === 1 && pkg.scripts[0].path === "scripts/thumbnail.py" && ["subprocess", "env-secret"].every((f) => pkg.scripts[0].flags.includes(f)),
  "the scan lists each script with its language, hash and flags (subprocess, env-secret …)", JSON.stringify(pkg.scripts));
ok(JSON.stringify(pkg.hosts.scan) === JSON.stringify(["api.example.net"]) && pkg.hosts.refused.some((r: string) => /^10\.0\.0\.7: an IP address/.test(r)),
  "hosts: a URL a script names is proposed; an XML namespace is not; an IP literal is refused, never listed", JSON.stringify(pkg.hosts));
ok(pkg.bins.includes("soffice") && pkg.bins.includes("no-such-program-xyz") && pkg.warnings.some((w: string) => /import lxml/.test(w)), "programs: declared in the frontmatter or named by a script; a Python import no lockfile installs is a warning", JSON.stringify([pkg.bins, pkg.warnings]));
{ let e1 = "", e2 = ""; try { lib.importFolder(mk(join(tmp, "native-so"), { "SKILL.md": md("native-so"), "scripts/run.py": "print(1)", "lib/fast.so": "x" }), "captain"); } catch (e: any) { e1 = e.message; }
  try { lib.importFolder(mk(join(tmp, "native-macho"), { "SKILL.md": md("native-macho"), "bin/tool": Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]) }), "captain"); } catch (e: any) { e2 = e.message; }
  ok(/lib\/fast\.so is a native binary/.test(e1) && /bin\/tool is a native binary/.test(e2), "a native binary (a .so, or Mach-O by its magic) is refused: a skill carries source only", `${e1} | ${e2}`); }

// ---------- the decision: signed, bound to both hashes ----------
const v1 = lib.libVersion("deck", 1)!.rec;
const pin = { id: "deck", v: 1, sha256: v1.sha256, filesSha256: v1.filesSha256 };
{ const f = join(H.data, "skills", "_library", "deck", "approvals.jsonl");
  appendFileSync(f, JSON.stringify({ v: 1, sha256: v1.sha256, filesSha256: v1.filesSha256, scripts: "approved", hosts: ["evil.example"], installScripts: [], by: "captain", via: "forged", at: "x", sig: "0".repeat(64) }) + "\n");
  ok(pk.decision("deck", 1) === null && pk.status("deck", 1).state === "needs-approval", "a forged approval line (no valid signature) is ignored: the version is still not approved"); }

// ---------- the team-change card decides it ----------
const store = new C.CrewStore(H.data);
installCrewGuard(E, store);
const facts = [{ provider: "codex", support: "supported", auth: "verified", models: [{ id: "gpt-6.1-sol", efforts: ["low", "medium", "high"] }] }];
const crew = installCrewTools(E, store, { facts: async () => facts as any });
const fm = installFirstmate(E, new Projects(H.data), { crewSeatGate: (d, o) => crew.seatGate(d, o), dispatchCrew: (d) => crew.dispatchCrew(d) });
const captain = (key: string) => ({ key, captain: true, text: "please", live: () => true });
const m = (skills: any[] = []) => ({ provider: "codex" as const, model: "gpt-6.1-sol", effort: "medium", skills });
store.write({ schema: 1, members: { coordinator: m(), maker: m(), "alt-maker": m(), reviewer: m() }, seats: {}, workflows: {} } as any, store.current()?.hash ?? null, { by: "captain", via: "page" } as any);
const done = (id: string) => until(() => ["succeeded", "failed", "cancelled"].includes(E.get(id)!.status));
const cardOf = async (run: string) => { await until(() => E.cards.list({ run, open: true }).length > 0); return E.cards.list({ run, open: true })[0]; };
{ const p: any = await crew.call("studio_propose_crew_change", { change: { kind: "member", seat: "maker", set: { skills: [pin] } } }, captain("k1"));
  const card = await cardOf(p.proposal); const opt = card.options.find((o: any) => o.id === "approve");
  ok(/Script skills this change brings/.test(card.body) && /deck@v1/.test(card.body) && /scripts\/thumbnail\.py \(python; [^)]*subprocess/.test(card.body) && /Network when it runs \/ 執行時可連: api\.example\.net/.test(card.body) && /只當文字/.test(card.body),
    "the team-change card lists the script skill it brings: version, both hashes, each script with its flags, and the hosts approving it allows (en and zh-TW)", card.body.slice(-900));
  ok(JSON.stringify(opt?.select?.map((x: any) => x.value)) === '["scripts","text-only"]' && card.options.length === 2, "one card, its approve answer says how: with scripts or text only (no second card)", JSON.stringify(card.options));
  await E.answer(card.id, { choice: "approve", note: "scripts", by: "captain" }); await done(p.proposal);
  const d = pk.decision("deck", 1);
  ok(E.get(p.proposal)!.status === "succeeded" && store.current()!.members.maker.skills[0]?.filesSha256 === v1.filesSha256 && d?.scripts === "approved" && d.via === "card" && d.card === card.id && JSON.stringify(d.hosts) === '["api.example.net"]',
    "the captain's answer writes the team and records the decision for exactly that version (both hashes), with the hosts it showed", JSON.stringify(d)); }
{ const p: any = await crew.call("studio_propose_crew_change", { change: { kind: "member", seat: "reviewer", set: { skills: [pin] } } }, captain("k2"));
  const card = await cardOf(p.proposal);
  ok(!/Script skills this change brings/.test(card.body) && !card.options.find((o: any) => o.id === "approve")?.select, "the same version on another seat is not asked again (Studio-wide per version hash)");
  await E.answer(card.id, { choice: "close", by: "captain" }); await done(p.proposal); }
{ const tx = lib.importFolder(mk(join(tmp, "tx"), { "SKILL.md": md("tx"), "scripts/go.sh": "#!/bin/sh\necho hi\n" }), "captain").version;
  const tpin = { id: "tx", v: 1, sha256: tx.sha256, filesSha256: tx.filesSha256 };
  const p: any = await crew.call("studio_propose_crew_change", { change: { kind: "member", seat: "alt-maker", set: { skills: [tpin] } } }, captain("k3"));
  const card = await cardOf(p.proposal); let refused = ""; try { await E.answer(card.id, { choice: "approve", by: "captain" }); } catch (e: any) { refused = e.message; }
  ok(/pick one of scripts, text-only/.test(refused) && !store.current()!.members["alt-maker"].skills.length && !pk.decision("tx", 1), "an approve with no choice of how the script skill is used is refused and writes nothing", refused);
  await E.answer(card.id, { choice: "approve", note: "text-only", by: "captain" }); await done(p.proposal);
  ok(pk.decision("tx", 1)?.scripts === "text-only" && pk.status("tx", 1).state === "text-only" && JSON.stringify(pk.decision("tx", 1)?.hosts) === "[]", "text only is the captain's choice on the same card, recorded with no hosts", JSON.stringify(pk.decision("tx", 1))); }

// ---------- the Crew page asks the same before it saves ----------
{ const pg = lib.importFolder(mk(join(tmp, "pg"), { "SKILL.md": md("pg"), "scripts/a.py": "print('a')\n" }), "captain").version;
  const ppin = { id: "pg", v: 1, sha256: pg.sha256, filesSha256: pg.filesSha256 };
  const handle = crewRoutes({ defs: H.defs, store, facts: () => facts as any, library: () => lib.library(), skillPackages: () => pk });
  const post = async (b: any) => { const r = (await handle("/api/team/change", new URL("http://x/api/team/change"), "POST", true, b, { kind: "desktop" }))!; return { status: r.status, j: await r.json() as any }; };
  const change = { kind: "member", seat: "coordinator", set: { skills: [ppin] } };
  const a = await post({ change, expected: store.current()!.hash });
  ok(a.status === 409 && a.j.code === "skillDecision" && a.j.skills?.[0]?.id === "pg" && a.j.skills[0].scripts[0].path === "scripts/a.py" && !store.current()!.members.coordinator.skills.length && /只當文字/.test(a.j.tw),
    "the Crew page's change that brings an undecided script skill is not saved: it answers with the skill's scripts and hosts to decide on", JSON.stringify(a.j).slice(0, 300));
  const b = await post({ change, expected: store.current()!.hash, skillDecisions: { "pg@v1": "scripts" } });
  ok(b.status === 200 && store.current()!.members.coordinator.skills[0]?.id === "pg" && pk.decision("pg", 1)?.via === "page" && pk.decision("pg", 1)?.by === "captain", "sent again with the captain's decision, the change is saved and the decision recorded", JSON.stringify(b.j).slice(0, 200));
  // ---------- readiness on the page and in Firstmate's status ----------
  inUse.clear(); for (const x of ["deck@v1", "pg@v1", "tx@v1"]) inUse.add(x);
  await pk.ensure("deck", 1); await pk.ensure("pg", 1);
  const view: any = await (await handle("/api/team", new URL("http://x/api/team"), "GET", false, null, { kind: "desktop" }))!.json();
  const deck = view.skillStatus?.["deck@v1"], pgs = view.skillStatus?.["pg@v1"];
  ok(deck?.state === "not-ready" && /not ready: .*no-such-program-xyz/.test(deck.en) && /還不能用：.*no-such-program-xyz/.test(deck.zh) && /含 1 個 script/.test(deck.zh) && /reaches api\.example\.net/.test(deck.en),
    "the Crew page shows a script skill's readiness with the reason, en and zh-TW: not ready, a program missing", JSON.stringify(deck));
  ok(pgs?.state === "ready" && /ready$/.test(pgs.en) && /可以用/.test(pgs.zh) && view.skillStatus?.["tx@v1"]?.state === "text-only" && view.library.find((s: any) => s.id === "pg")?.filesSha256 === pg.filesSha256,
    "a ready one says ready, a text-only one says so, and the library entries the page pins from carry the files hash", JSON.stringify([pgs, view.skillStatus?.["tx@v1"]]));
  const ws: any = await fm.call("studio_work_status", {}, captain("ws"));
  const s = ws.skills?.find((x: any) => x.skill === "deck@v1");
  ok(s?.state === "not-ready" && !s.ready && s.reasons.some((r: string) => /no-such-program-xyz missing/.test(r)), "Firstmate's work status lists each script skill in use and why one is not ready (no card, no question)", JSON.stringify(ws.skills)); }

H.stop(); end();
