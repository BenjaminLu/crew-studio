import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// baton as the review room's built-in default skill (src/domain/review-baton.ts): Studio ships upstream baton byte for byte in
// packs/core/skills/baton/, credited, with diagram-design's guidance beside it; the library seeds it as a built-in skill whose two
// hashes are exactly Studio's pin, each script and the OpenCC lockfile pinned by sha256; the adapter tells it to read the room's
// materials and never git, gh or a transcript.
//        bun tests/review-baton.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkedTempDir } from "./lib/git-hygiene.mjs";
import { Skills } from "../src/skills";
import { BATON_ADAPTER, BATON_PIN, isPinnedBaton } from "../src/domain/review-baton";

let pass = 0, fail = 0;
const ok = (v: any, name: string, detail = "") => { console.log(`${v ? "  ok   " : "  FAIL "} ${name}${v ? "" : " " + detail}`); v ? pass++ : fail++; };
const root = join(import.meta.dir, ".."), dir = join(root, "packs/core/skills/baton");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const lib = new Skills(checkedTempDir("crew-baton-lib-"), { list: () => [], get: () => null, sourceSkill: () => null } as any);
const b = lib.library().find((s) => s.id === "baton");
ok(b?.sourceKind === "builtin" && b.current === 1, "a new data folder gets baton as a built-in library skill, v1", JSON.stringify(b && { kind: b.sourceKind, v: b.current }));
ok(b?.sha256 === BATON_PIN.sha256 && b?.filesSha256 === BATON_PIN.filesSha256 && isPinnedBaton(b), "the seeded version is exactly Studio's pin (SKILL.md and every other file)",
  JSON.stringify({ sha256: b?.sha256, filesSha256: b?.filesSha256 }));
ok(!isPinnedBaton({ id: "baton", sha256: BATON_PIN.sha256, filesSha256: "0".repeat(64) }) && !isPinnedBaton({ id: "other", sha256: BATON_PIN.sha256, filesSha256: BATON_PIN.filesSha256 }),
  "a changed file or another skill is not the pinned baton");
const pkg = lib.pkg("baton", 1);
ok(!!pkg && pkg.scripts.length === 5 && pkg.scripts.every((s) => BATON_PIN.scripts[s.path] === s.sha256), "every script is pinned by its sha256", JSON.stringify(pkg?.scripts.map((s) => [s.path, s.sha256])));
ok(pkg?.python?.kind === "requirements" && pkg.python.files[0] === "requirements.txt" && sha(readFileSync(join(dir, "requirements.txt"))) === BATON_PIN.scripts["requirements.txt"],
  "the OpenCC lockfile is the package's Python lock and is pinned by sha256", JSON.stringify(pkg?.python));
{ const req = readFileSync(join(dir, "requirements.txt"), "utf8"), lines = req.split("\n").filter((l) => l.trim() && !l.startsWith("#")).join(" ");
  ok(/^opencc==\d+\.\d+\.\d+ /.test(lines) && (lines.match(/--hash=sha256:[a-f0-9]{64}/g) ?? []).length >= 10, "requirements.txt pins OpenCC to one version with a sha256 for every wheel", lines.slice(0, 120)); }
ok(!b?.files.some((f) => /__pycache__|\.pyc$|README\.md$|AGENTS\.md$/.test(f)) && b?.files.includes("templates/packet.html") && b?.files.includes("diagram-design/SKILL.md"),
  "the package: baton's skill files, its template and diagram-design's guidance; no cache and no contributor docs", JSON.stringify(b?.files));
ok(!!b?.fits?.roles?.includes("reviewer"), "baton says where it fits (a reviewer's or a tutor's seat)", JSON.stringify(b?.fits));

// credit and license
const notice = readFileSync(join(dir, "NOTICE.md"), "utf8"), third = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
ok(/MIT License/.test(notice) && notice.includes(BATON_PIN.upstream.commit) && /Cathryn Lavery/.test(notice) && existsSync(join(dir, "diagram-design/LICENSE")),
  "NOTICE.md credits baton (its commit, MIT) and diagram-design (its LICENSE beside it)");
ok(third.includes("packs/core/skills/baton/") && third.includes(BATON_PIN.upstream.commit), "THIRD_PARTY_NOTICES.md names the vendored copy and its commit");

// the adapter
ok(/never run or imitate git or gh/.test(BATON_ADAPTER) && /mat_list, mat_read, mat_search/.test(BATON_ADAPTER) && /transcript/.test(BATON_ADAPTER) && /diagram-design\/SKILL\.md/.test(BATON_ADAPTER)
  && /explain_done \{entry: "index\.html"/.test(BATON_ADAPTER) && /no network/.test(BATON_ADAPTER),
  "the adapter: the room's materials, never git, gh or a transcript; diagram-design from the folder; no external URL; index.html as the entry");
ok(/scripts\/render\.py \["\.baton\/packet\.json", "-o", "index\.html"\]/.test(BATON_ADAPTER) && /scripts\/verify\.py/.test(BATON_ADAPTER) && /scripts\/snapshot\.py/.test(BATON_ADAPTER),
  "the adapter runs baton's own scripts (render, verify, snapshot) through skill_run");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
