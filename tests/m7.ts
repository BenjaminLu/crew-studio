// M7 checks: the domain-pack format and its validator, the built-in file
// organization pack (dry-run plan, gates, review, apply with an undo log, undo),
// workflow genesis (a described way of working → a drafted pack + evals, stub
// author), hash-pinned installs that refuse a tampered pack, and the chat's
// pack_draft tool. Temporary folders only.   bun tests/m7.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const here = import.meta.dir, root = join(here, "..");
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];

// ---------- unit: the validator ----------
{
  const { validate } = await import("../src/packs");
  const mk = (files: Record<string, string>) => ({ kind: "draft" as const, id: "x", dir: null, read: (r: string) => files[r] ?? null, files: () => Object.keys(files) });
  const good = { "manifest.yaml": "id: tiny\nname: Tiny\nversion: 1.0.0\ndescription: d\nskills: [{ role: a, file: s.md }]\ngates: []\nartifactTypes: []\nworkflows: [w.yaml]\nevals: [e.json]\npermissions: [fs.read]\n",
    "s.md": "# A\n- ask when unclear\n", "w.yaml": "id: tiny\nname: Tiny\nversion: 1\nnodes:\n  - { id: a, kind: human, label: A, x: 0, y: 0 }\n  - { id: b, kind: done, label: B, x: 200, y: 0 }\nedges: [[a, b]]\nroles: [{ id: a, label: A, skill: \"pack:tiny/s.md\" }]\n",
    "e.json": JSON.stringify([{ id: "c1", role: "a", title: "t", ask: "q", terms: ["ask"], expect: [{ pattern: "ask", why: "asks" }] }]) };
  const v = validate(mk(good));
  ok(v.ok && v.flows.length === 1 && v.cases.length === 1, "a minimal pack validates: manifest, a skill, a workflow, an eval", JSON.stringify(v.errors));
  ok(!validate(mk({ ...good, "w.yaml": good["w.yaml"].replace("[[a, b]]", "[[a, zz]]") })).ok, "an edge to a node that does not exist is refused");
  ok(validate(mk({ ...good, "manifest.yaml": good["manifest.yaml"].replace("[fs.read]", "[network]") })).errors.some((e) => /network/.test(e)), "a pack cannot ask for the network");
  ok(validate(mk({ ...good, "manifest.yaml": good["manifest.yaml"].replace("gates: []", "gates: [{ id: g, builtin: rm-rf }]") })).errors.some((e) => /unknown builtin/.test(e)), "a gate must be a known builtin or an argv");
  ok(validate(mk({ ...good, "manifest.yaml": good["manifest.yaml"].replace("gates: []", "gates: [{ id: g, run: [curl, \"https://x\"] }]") })).errors.some((e) => /network/.test(e)), "a gate that reaches the network is refused");
  ok(!validate(mk({ ...good, "e.json": "[]" })).ok, "a pack without eval cases is refused");
  const { e: _, ...noSkill } = { ...good, e: 1 } as any; delete noSkill["s.md"];
  ok(validate(mk(noSkill)).errors.some((e) => /s\.md is missing/.test(e)), "a missing skill file is named");
}

const tmp = mkdtempSync(join(tmpdir(), "crew-m7-"));
const fmRoot = join(tmp, "fm"), state = join(fmRoot, "state"), data = join(tmp, "data"), home = join(tmp, "home");
mkdirSync(join(state, "pending"), { recursive: true }); writeFileSync(join(state, "events.jsonl"), ""); mkdirSync(data); mkdirSync(home);
// Pre-existing legacy records exercise T-185 history compatibility; new requests use native Tasks.
const {Packs}=await import('../src/packs');const history=new Packs(data);
for(const id of ['historical-review','historical-invalid']){const dir=history.draftDir(id);const files:any={'manifest.yaml':JSON.stringify({id,name:'Historical review',version:'0.1.0',description:'Existing legacy draft',skills:[{role:'maker',file:'skills/maker.md'},{role:'checker',file:'skills/checker.md'}],gates:[],artifactTypes:[],workflows:['workflows/review.yaml'],evals:['evals/maker.json'],permissions:[]}),'skills/maker.md':'# Maker\n- Ask when unclear','skills/checker.md':'# Checker\n- Review all points','workflows/review.yaml':JSON.stringify({id,name:'Historical review',version:1,nodes:[{id:'ask',kind:'human',label:'Request',x:0,y:0},{id:'done',kind:'done',label:'Done',x:200,y:0}],edges:[['ask','done']],roles:[{id:'maker',label:'Maker',skill:`pack:${id}/skills/maker.md`},{id:'checker',label:'Checker',skill:`pack:${id}/skills/checker.md`}]}),'evals/maker.json':JSON.stringify([{id:'old-'+id,role:'maker',title:'Existing replay',ask:'What when unclear?',terms:['ask'],expect:[{pattern:'ask',why:'asks'}]}])};for(const [file,text]of Object.entries(files)){mkdirSync(join(dir,file,'..'),{recursive:true});writeFileSync(join(dir,file),String(text));}const {validate}=await import('../src/packs');history.saveDraft({id,description:'Existing legacy record',status:'drafted',createdAt:'2026-10-13T00:00:00Z',job:null,summary:'Historical measured replay',validation:validate(history.draftSource(id)),evals:{total:1,passed:1},error:null,by:'captain'} as any);}
const port = await freePort();
const app = Bun.spawn(["bun", "src/server.ts"], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: home, CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
const get = async (p: string) => (await fetch(base + p)).json();
const post = async (p: string, b: any = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) }); return { ...(await r.json()), http: r.status }; };
const until = async (f: () => Promise<boolean>, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await Bun.sleep(150); } return false; };

try {
  const pk = await get("/api/packs");
  const fo = pk.packs.find((p: any) => p.id === "file-organization");
  ok(fo?.ok && fo.kind === "builtin" && fo.manifest.skills.length && fo.manifest.gates.length === 3 && fo.manifest.artifactTypes.length === 2 && fo.flows[0].gates === 3 && fo.cases === 2, "the built-in file-organization pack: manifest, skills, gates, artifact types, a workflow and evals", JSON.stringify(fo?.errors));
  const flows = await get("/api/flows");
  ok(["code", "change", "genesis", "file-organization"].every((id) => flows.some((f: any) => f.id === id)), "the pack's workflow joins the workflow list (beside code, change and genesis)");
  ok((await get("/api/improve")).skills.some((s: any) => s.workflow === "file-organization" && s.role === "organizer"), "its role's skill is editable like any other (M6)");
  ok((await get("/api/improve/evals/file-organization/organizer")).length === 2, "its eval cases are replay cases for that role");

  // ---- file organization: dry run, review, apply, undo ----
  const dir = join(home, "Downloads"); mkdirSync(join(dir, "Documents"), { recursive: true }); mkdirSync(join(dir, "projects"));
  for (const [f, t] of [["photo.PNG", "img"], ["report.pdf", "pdf1"], ["backup.zip", "zip"], ["notes.txt", "n"], ["song.mp3", "a"], [".DS_Store", "x"], ["weird.xyz", "?"]]) writeFileSync(join(dir, f), t);
  writeFileSync(join(dir, "Documents", "report.pdf"), "older");
  const pl = await post("/api/fileorg/plan", { root: dir });
  ok(pl.http === 200 && pl.moves.length === 6 && pl.skipped.some((s: any) => s.name === ".DS_Store" && s.why === "hidden") && pl.skipped.some((s: any) => s.name === "projects"), "a dry run plans one move per loose file; hidden files and folders stay", JSON.stringify(pl.error ?? pl.skipped));
  ok(existsSync(join(dir, "photo.PNG")) && !existsSync(join(dir, "Images")), "the dry run moves nothing");
  const rep = pl.moves.find((m: any) => m.from.endsWith("report.pdf"));
  ok(rep.to.endsWith("Documents/report (2).pdf") && /taken/.test(rep.note), "a taken name gets “ (2)”, never an overwrite");
  ok(pl.moves.find((m: any) => m.from.endsWith("weird.xyz")).category === "Other" && pl.moves.find((m: any) => m.from.endsWith("photo.PNG")).category === "Images", "files sort by kind (case-insensitive), the rest to Other");
  ok(pl.gates.length === 3 && pl.gates.every((g: any) => g.state === "pass"), "the pack's three gates pass on the plan");
  const zip = pl.moves.find((m: any) => m.from.endsWith("backup.zip"));
  const inc = await post(`/api/fileorg/${pl.id}/include`, { include: { [zip.id]: false } });
  ok(inc.moves.find((m: any) => m.id === zip.id).include === false, "review: the captain unticks a move");
  await Bun.sleep(20); writeFileSync(join(dir, "notes.txt"), "edited after the plan");
  const ap = await post(`/api/fileorg/${pl.id}/apply`);
  ok(ap.http === 200 && ap.status === "applied", "apply", JSON.stringify(ap.error));
  ok(existsSync(join(dir, "Images", "photo.PNG")) && existsSync(join(dir, "Documents", "report (2).pdf")) && readFileSync(join(dir, "Documents", "report.pdf"), "utf8") === "older", "files moved; the existing file is untouched");
  ok(existsSync(join(dir, "backup.zip")) && ap.moves.find((m: any) => m.id === zip.id).result === "kept", "the unticked file stays");
  ok(existsSync(join(dir, "notes.txt")) && /changed since the plan/.test(ap.moves.find((m: any) => m.from.endsWith("notes.txt")).note), "a file changed since the plan is skipped and says why");
  const undoLog = readFileSync(join(data, "fileorg", pl.id, "undo.jsonl"), "utf8").trim().split("\n");
  ok(undoLog.length === ap.moves.filter((m: any) => m.result === "moved").length, "every move has its undo line, written before the move");
  ok((await post(`/api/fileorg/${pl.id}/apply`)).http === 400, "a plan applies once");
  const un = await post(`/api/fileorg/${pl.id}/undo`);
  ok(un.status === "undone" && existsSync(join(dir, "photo.PNG")) && existsSync(join(dir, "report.pdf")) && !existsSync(join(dir, "Images")) && !existsSync(join(dir, "Audio")) && existsSync(join(dir, "Documents", "report.pdf")), "undo moves every file back and removes the folders it made (not the one that was there)");
  ok((await post("/api/fileorg/plan", { root: fmRoot })).http === 400 && (await post("/api/fileorg/plan", { root: join(fmRoot, "state") })).http === 400, "the firstmate checkout is refused");
  ok((await post("/api/fileorg/plan", { root: home })).http === 400 && (await post("/api/fileorg/plan", { root: "/etc" })).http === 400 && (await post("/api/fileorg/plan", { root: data })).http === 400, "the home folder itself, system folders and Studio's data are refused");
  const ev = readFileSync(join(data, "events.jsonl"), "utf8");
  ok(/fileorg_planned/.test(ev) && /fileorg_applied/.test(ev) && /fileorg_undone/.test(ev), "every step is in Studio's event log (for the pack's retro)");

  // ---- workflow genesis ----
  const started = await post("/api/packs/genesis", { description: "A weekly review of open support mail: sort it, answer the easy ones, escalate the rest to a human" });
  ok(started.http===200&&started.native===true&&/^R-\d+$/.test(started.task?.id)&&started.link===`#/tasks/${started.task.id}`,"new pack requests start a canonical native Task rather than a legacy detached draft");
  ok(await until(async()=> (await get('/api/scards?open=1')).cards.some((c:any)=>c.run===started.task.id&&c.node==='interview-answers')),"actual native coordinator reaches a pending batch interview card");
  const g={id:'historical-review'};
  const d = await get(`/api/packs/drafts/${g.id}`);
  ok(d.status === "drafted" && d.validation.ok && d.files.some((f: any) => f.path === "manifest.yaml") && d.files.some((f: any) => f.path.startsWith("workflows/")), "the draft has a manifest, a workflow, skills and evals, and validates", JSON.stringify(d.validation));
  ok(d.evals?.total === 1 && d.evals.passed === 1 && d.job === null, "existing legacy replay evidence remains readable without a new detached author job");
  const ins = await post(`/api/packs/drafts/${g.id}/install`);
  ok(ins.http === 200 && ins.lock && Object.keys(ins.lock.files).length >= 5 && /^[0-9a-f]{64}$/.test(ins.lock.sha256), "install pins every file by sha256", JSON.stringify(ins.error));
  ok((await get("/api/flows")).some((f: any) => f.id === g.id), "the installed pack's workflow appears");
  const lockFile = join(data, "packs", "installed", g.id, "skills", "maker.md");
  writeFileSync(lockFile, readFileSync(lockFile, "utf8") + "\n- sneaky new rule\n");
  const after = (await get("/api/packs")).packs.find((p: any) => p.id === g.id);
  ok(after && !after.ok && after.tampered.includes("skills/maker.md") && !(await get("/api/flows")).some((f: any) => f.id === g.id), "a file changed after install: the pack is refused, its workflow gone", JSON.stringify(after?.tampered));
  ok((await post(`/api/packs/${g.id}/uninstall`)).ok && !(await get("/api/packs")).packs.some((p: any) => p.id === g.id), "uninstall");
  ok((await post("/api/packs/file-organization/uninstall")).http === 409, "a built-in pack cannot be uninstalled");
  const g2={id:"historical-invalid"};
  rmSync(join(data, "packs", "drafts", g2.id, "skills", "checker.md"));
  const re = await post(`/api/packs/drafts/${g2.id}/recheck`);
  ok(re.status === "invalid" && re.validation.errors.some((e: string) => /checker\.md is missing/.test(e)) && (await post(`/api/packs/drafts/${g2.id}/install`)).http === 409, "an invalid draft says why and cannot be installed");
  const chat = await (await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ message: "STUB_PACK here is how we do support" }) })).text();
  const cid = /#\/tasks\/(R-\d+)/.exec(chat)?.[1];
  ok(!!cid && (await get(`/api/tasks/${cid}`)).id===cid, "the status chat pack_draft tool starts a real native Task");
} catch (e: any) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}`); }
finally { app.kill(); }
console.log(`\nm7: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
