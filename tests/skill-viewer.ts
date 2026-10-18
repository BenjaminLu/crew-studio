import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The skill viewer's routes (src/skill-routes.ts): GET /api/skills/<id>?version=N answers a library skill's SKILL.md
// exactly as stored (that version, the latest when none is asked), its frontmatter, versions, supporting files and where
// the workflows and the team use it; GET /api/skills/<id>/files/<path> answers one supporting file as text: only a file
// that version recorded, never a link, text only, under the cap. Traversal (plain, encoded, absolute) is refused.
// A temporary skill store and the routes' own handler; no server, no provider.      bun tests/skill-viewer.ts
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Skills, SKILL_VIEW_FILE_CAP } from "../src/skills";
import { createSkillRoutes } from "../src/skill-routes";

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const sha = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
const tmp = mkdtempSync(join(tmpdir(), "crew-skill-viewer-")), data = join(tmp, "data");
const mk = (dir: string, files: Record<string, string | Buffer>) => { for (const [f, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), t); } return dir; };
const XSS = `---\nname: alpha\ndescription: Alpha rules\nmetadata:\n  fits:\n    roles: [writer]\n---\n\n# Alpha\n\n<script>window.__xss=1</script>\n<img src=x onerror="window.__xss=2">\n\n[evil](javascript:alert(1))\n`;
try {
  const skills = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
  const src = mk(join(tmp, "alpha"), { "SKILL.md": XSS, "ref/notes.md": "# Notes\nsupporting text\n", "img/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), "big.txt": "x".repeat(SKILL_VIEW_FILE_CAP + 10), "LICENSE": "MIT\n" });
  const v1 = skills.importFolder(src, "test");
  writeFileSync(join(src, "SKILL.md"), XSS.replace("# Alpha", "# Alpha, second"));
  const v2 = skills.importFolder(src, "test");
  const team = { schema: 1, members: { maker: { provider: "codex", model: "m", effort: null, skills: [{ id: "alpha", v: 1, sha256: v1.version.sha256 }] } }, seats: {}, workflows: { documents: { nodes: { draft: { at: { role: "writer", kind: "agent" }, add: [{ id: "alpha", v: 2, sha256: v2.version.sha256 }] } } } },
    projects: { shop: { seats: { reviewer: { skills: [{ id: "alpha", v: 1, sha256: v1.version.sha256 }] } } } } } as any;
  const defs = { list: () => [{ id: "wf" }], get: () => ({ version: 3, nodes: [{ id: "write", skills: [{ id: "alpha", v: 1, sha256: v1.version.sha256 }] }] }) } as any;
  const handle = createSkillRoutes({ skills, defs: () => defs, session: "s", log: { emit() {} } as any, team: () => team });
  const get = async (path: string, writing = false) => { const url = new URL(`http://127.0.0.1${path}`); const r = await handle(new Request(url, { method: writing ? "POST" : "GET" }), url, { kind: "desktop" }, writing); return { status: r?.status ?? 0, j: r ? await r.json() : null }; };
  const stored = (v: number) => readFileSync(join(data, "skills", "_library", "alpha", `v${v}`, "SKILL.md"), "utf8");

  // ---------- one skill ----------
  const latest = await get("/api/skills/alpha");
  ok(latest.status === 200 && latest.j.version === 2 && latest.j.latest === 2 && latest.j.text === stored(2) && latest.j.text === XSS.replace("# Alpha", "# Alpha, second") && latest.j.sha256 === sha(latest.j.text),
    "no version: the latest, its SKILL.md byte for byte as stored, and its hash", JSON.stringify({ s: latest.status, v: latest.j?.version }));
  const one = await get("/api/skills/alpha?version=1");
  ok(one.status === 200 && one.j.version === 1 && one.j.latest === 2 && one.j.text === XSS && one.j.text === stored(1) && one.j.sha256 === v1.version.sha256,
    "version=1: the pinned older version's exact text, with the latest named", JSON.stringify({ s: one.status, v: one.j?.version }));
  ok(one.j.frontmatter?.name === "alpha" && one.j.frontmatter?.description === "Alpha rules" && JSON.stringify(one.j.fits) === JSON.stringify({ roles: ["writer"] }) && one.j.sourceKind === "folder",
    "its frontmatter fields, what it fits and its source kind", JSON.stringify([one.j.frontmatter, one.j.fits, one.j.sourceKind]));
  ok(JSON.stringify(one.j.versions.map((x: any) => x.n)) === "[1,2]", "every version is listed", JSON.stringify(one.j.versions));
  const files = Object.fromEntries((one.j.files ?? []).map((f: any) => [f.path, f]));
  ok(files["ref/notes.md"]?.viewable === true && files["LICENSE"]?.viewable === true && files["img/logo.png"]?.viewable === false && files["big.txt"]?.viewable === false && files["big.txt"].bytes > SKILL_VIEW_FILE_CAP,
    "the supporting files, each marked openable or not (a binary name, over the cap)", JSON.stringify(one.j.files));
  ok(JSON.stringify(one.j.usedBy) === JSON.stringify([{ workflow: "wf", version: 3, node: "write", v: 1 }]), "the workflow nodes pinning it (usedBy)", JSON.stringify(one.j.usedBy));
  ok(JSON.stringify(one.j.usedBySeats) === JSON.stringify([{ seat: "maker", label: { en: "Maker", zh: "產出" }, v: 1 }, { project: "shop", seat: "reviewer", label: { en: "Reviewer", zh: "審查" }, v: 1 }, { workflow: "documents", node: "draft", v: 2 }]),
    "the team's seats (with their display names), project seats and node additions using it, each with its version", JSON.stringify(one.j.usedBySeats));
  ok((await get("/api/skills/alpha?version=9")).status === 404 && (await get("/api/skills/alpha?version=abc")).status === 400 && (await get("/api/skills/alpha?version=-1")).status === 400 && (await get("/api/skills/nope")).status === 404,
    "a version or skill that does not exist is 404; a version that is not a whole number is 400");
  ok((await get("/api/skills/alpha", true)).status === 404 && (await get("/api/skills/alpha/files/ref/notes.md", true)).status === 404, "the viewer routes only read: a write to them is not a route");

  // ---------- supporting files ----------
  const note = await get("/api/skills/alpha/files/ref/notes.md?version=1");
  ok(note.status === 200 && note.j.text === "# Notes\nsupporting text\n" && note.j.sha256 === sha("# Notes\nsupporting text\n") && note.j.path === "ref/notes.md", "a text supporting file, exact", JSON.stringify(note));
  ok((await get("/api/skills/alpha/files/LICENSE")).j?.text === "MIT\n", "a plain name (LICENSE) is text too");
  const bin = await get("/api/skills/alpha/files/img/logo.png"), big = await get("/api/skills/alpha/files/big.txt");
  ok(bin.status === 415 && !bin.j.text && big.status === 413 && !big.j.text, "a binary file and a file over the cap are refused with the reason", JSON.stringify([bin, big.status]));
  // traversal: plain dots are resolved by the URL before the route (nothing of the store is served), encoded slashes and
  // dots, an absolute path and a file the version never recorded are refused by the route itself
  const index = readFileSync(join(data, "skills", "_library", "alpha", "index.json"), "utf8");
  const tries = ["/api/skills/alpha/files/../index.json", "/api/skills/alpha/files/..%2Findex.json", "/api/skills/alpha/files/..%2F..%2F..%2Fskills%2F_library%2Falpha%2Findex.json",
    "/api/skills/alpha/files/%2e%2e/%2e%2e/index.json", "/api/skills/alpha/files/%2Fetc%2Fpasswd", "/api/skills/alpha/files/ref%5C..%5C..%5Cindex.json", "/api/skills/alpha/files/SKILL.md", "/api/skills/alpha/files/ref/../../v1/SKILL.md", "/api/skills/alpha/files/%E0%A4%A"];
  const answers = await Promise.all(tries.map((t) => get(t)));
  ok(answers.every((a) => a.status !== 200 && !JSON.stringify(a.j ?? {}).includes('"filesSha256"') && !a.j?.text), "traversal is refused: no path outside the version's recorded files is served", JSON.stringify(answers.map((a, i) => [tries[i], a.status])));
  ok(answers[1].status === 400 && answers[4].status === 400 && answers[6].status === 404, "an encoded .. or an absolute path is 400; a file the version never recorded is 404", JSON.stringify(answers.map((a) => a.status)));
  // a supporting file changed on disk since the version was recorded is refused (the version's files no longer hash to filesSha256),
  // and so is any other file of that version while one of them is changed
  const notesAt = join(data, "skills", "_library", "alpha", "v1", "files", "ref", "notes.md"), notesWas = readFileSync(notesAt);
  writeFileSync(notesAt, "TAMPERED-NOTES\n");
  const changed = await get("/api/skills/alpha/files/ref/notes.md?version=1"), sibling = await get("/api/skills/alpha/files/LICENSE?version=1");
  ok(changed.status === 409 && /changed on disk since it was recorded/.test(changed.j?.error) && !JSON.stringify(changed.j).includes("TAMPERED"), "a tampered supporting file is refused (409), its text never served", JSON.stringify(changed));
  ok(sibling.status === 409, "another file of a tampered version is refused too", JSON.stringify(sibling));
  writeFileSync(notesAt, notesWas);
  ok((await get("/api/skills/alpha/files/ref/notes.md?version=1")).status === 200, "put back byte for byte, it is served again");
  // a stored file replaced on disk by a link (to a file outside, or one inside) is never followed
  const outside = join(tmp, "secret.txt"); writeFileSync(outside, "SECRET-OUTSIDE");
  const notes = join(data, "skills", "_library", "alpha", "v1", "files", "ref", "notes.md"); unlinkSync(notes); symlinkSync(outside, notes);
  const linked = await get("/api/skills/alpha/files/ref/notes.md?version=1");
  ok(linked.status === 403 && !JSON.stringify(linked.j).includes("SECRET-OUTSIDE"), "a link on disk is refused, never followed", JSON.stringify(linked));
  const refDir = join(data, "skills", "_library", "alpha", "v2", "files", "ref"); rmSync(refDir, { recursive: true }); mkdirSync(join(tmp, "elsewhere")); writeFileSync(join(tmp, "elsewhere", "notes.md"), "SECRET-DIR"); symlinkSync(join(tmp, "elsewhere"), refDir);
  const linkedDir = await get("/api/skills/alpha/files/ref/notes.md?version=2");
  ok(linkedDir.status === 403 && !JSON.stringify(linkedDir.j).includes("SECRET-DIR"), "a linked folder on the way is refused too", JSON.stringify(linkedDir));
  // a SKILL.md changed on disk since it was recorded is not shown as the pinned text
  writeFileSync(join(data, "skills", "_library", "alpha", "v1", "SKILL.md"), "TAMPERED");
  const tampered = await get("/api/skills/alpha?version=1");
  ok(tampered.status === 409 && !JSON.stringify(tampered.j).includes("TAMPERED"), "a SKILL.md whose hash no longer matches is refused", JSON.stringify(tampered));
  // the built-in skill: served like any other, its source kind builtin
  const builtin = await get("/api/skills/plain-writing");
  ok(builtin.status === 200 && builtin.j.sourceKind === "builtin" && builtin.j.text === readFileSync(join(import.meta.dir, "..", "packs/core/skills/plain-writing/SKILL.md"), "utf8"), "a built-in skill's text is the pack's file, byte for byte", String(builtin.status));
} catch (e: any) { ok(false, "skill-viewer threw", e?.stack ?? String(e)); }
finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`\nskill-viewer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
