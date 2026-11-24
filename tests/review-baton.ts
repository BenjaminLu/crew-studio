import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// baton as the review room's built-in default skill (src/domain/review-baton.ts): Studio ships upstream baton byte for byte in
// packs/core/skills/studio-baton/, credited, with diagram-design's guidance beside it; the library seeds it as a built-in skill whose two
// hashes are exactly Studio's pin, each script and the OpenCC lockfile pinned by sha256; the adapter tells it to read the room's
// materials and never git, gh or a transcript.
//        bun tests/review-baton.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkedTempDir } from "./lib/git-hygiene.mjs";
import { Skills } from "../src/skills";
import { BATON_ADAPTER, BATON_PIN, batonUpstreamOf, isPinnedBaton } from "../src/domain/review-baton";

let pass = 0, fail = 0;
const ok = (v: any, name: string, detail = "") => { console.log(`${v ? "  ok   " : "  FAIL "} ${name}${v ? "" : " " + detail}`); v ? pass++ : fail++; };
const root = join(import.meta.dir, ".."), dir = join(root, "packs/core/skills/studio-baton");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const lib = new Skills(checkedTempDir("crew-baton-lib-"), { list: () => [], get: () => null, sourceSkill: () => null } as any);
const b = lib.library().find((s) => s.id === "studio-baton");
ok(b?.sourceKind === "builtin" && b.current === 1, "a new data folder gets baton as a built-in library skill of its own id (studio-baton), v1", JSON.stringify(b && { kind: b.sourceKind, v: b.current }));
ok(b?.sha256 === BATON_PIN.sha256 && b?.filesSha256 === BATON_PIN.filesSha256 && isPinnedBaton(b), "the seeded version is exactly Studio's pin (SKILL.md and every other file)",
  JSON.stringify({ sha256: b?.sha256, filesSha256: b?.filesSha256 }));
ok(!isPinnedBaton({ id: "studio-baton", sha256: BATON_PIN.sha256, filesSha256: "0".repeat(64) }) && !isPinnedBaton({ id: "baton", sha256: BATON_PIN.sha256, filesSha256: BATON_PIN.filesSha256 }) && !isPinnedBaton({ id: "other", sha256: BATON_PIN.sha256, filesSha256: BATON_PIN.filesSha256 }),
  "a changed file or another skill is not the pinned baton");
const pkg = lib.pkg("studio-baton", 1);
ok(!!pkg && pkg.scripts.length === 5 && pkg.scripts.every((s) => BATON_PIN.scripts[s.path] === s.sha256), "every script is pinned by its sha256", JSON.stringify(pkg?.scripts.map((s) => [s.path, s.sha256])));
ok(pkg?.python?.kind === "requirements" && pkg.python.files[0] === "requirements.txt" && sha(readFileSync(join(dir, "requirements.txt"))) === BATON_PIN.scripts["requirements.txt"],
  "the OpenCC lockfile is the package's Python lock and is pinned by sha256", JSON.stringify(pkg?.python));
{ const req = readFileSync(join(dir, "requirements.txt"), "utf8"), lines = req.split("\n").filter((l) => l.trim() && !l.startsWith("#")).join(" ");
  ok(/^opencc==\d+\.\d+\.\d+ /.test(lines) && (lines.match(/--hash=sha256:[a-f0-9]{64}/g) ?? []).length >= 10, "requirements.txt pins OpenCC to one version with a sha256 for every wheel", lines.slice(0, 120)); }
ok(!b?.files.some((f) => /__pycache__|\.pyc$|README\.md$|AGENTS\.md$/.test(f)) && b?.files.includes("templates/packet.html") && b?.files.includes("diagram-design/SKILL.md"),
  "the package: baton's skill files, its template and diagram-design's guidance; no cache and no contributor docs", JSON.stringify(b?.files));
ok(!!b?.fits?.roles?.includes("reviewer"), "baton says where it fits (a reviewer's or a tutor's seat)", JSON.stringify(b?.fits));

ok(["references/boundary-review.md", "references/components.md"].every((f) => b?.files.includes(f)), "baton v2's references (the boundary review, the components) are in the package", JSON.stringify(b?.files));

// credit and license
const notice = readFileSync(join(dir, "NOTICE.md"), "utf8"), third = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
ok(/MIT License/.test(notice) && notice.includes(BATON_PIN.upstream.commit) && /Cathryn Lavery/.test(notice) && existsSync(join(dir, "diagram-design/LICENSE")),
  "NOTICE.md credits baton (its commit, MIT) and diagram-design (its LICENSE beside it)");
ok(third.includes("packs/core/skills/studio-baton/") && third.includes(BATON_PIN.upstream.commit), "THIRD_PARTY_NOTICES.md names the vendored copy and its commit");

// the adapter
ok(/never run or imitate git or gh/.test(BATON_ADAPTER) && /mat_list, mat_read, mat_search/.test(BATON_ADAPTER) && /transcript/.test(BATON_ADAPTER) && /diagram-design\/SKILL\.md/.test(BATON_ADAPTER)
  && /explain_done \{entry: "index\.html"/.test(BATON_ADAPTER) && /no network/.test(BATON_ADAPTER),
  "the adapter: the room's materials, never git, gh or a transcript; diagram-design from the folder; nothing loaded from a URL; index.html as the entry");
ok(/scripts\/render\.py \["\.baton\/packet\.json", "-o", "index\.html"\]/.test(BATON_ADAPTER) && /scripts\/verify\.py/.test(BATON_ADAPTER) && /scripts\/snapshot\.py/.test(BATON_ADAPTER),
  "the adapter runs baton's own scripts (render, verify, snapshot) through skill_run");

ok(/checks\.md \(where baton says "gh pr checks"/.test(BATON_ADAPTER) && /You run no test here/.test(BATON_ADAPTER) && /code-only/.test(BATON_ADAPTER),
  "the adapter: review proof comes from the room's record (CI from checks.md), and no test run is claimed");
ok(/references\/boundary-review\.md/.test(BATON_ADAPTER) && /You never post\s+them/.test(BATON_ADAPTER) && /nothing in this run posts to GitHub/.test(BATON_ADAPTER),
  "the adapter: the boundary review's PR comments stay in the context; nothing is posted");
ok(/references\/components\.md/.test(BATON_ADAPTER) && /cannot fetch a library's source/.test(BATON_ADAPTER),
  "the adapter: the components reference, and a library fact the materials cannot show is unverified (no network)");

// a proof chip's state is upstream's own rule since ba68615 (verify.py fails a chip without one, the page draws "state not
// given"), so the adapter no longer repeats it
ok(!/proof chip/.test(BATON_ADAPTER) && /no default; a chip without one fails `verify\.py`/.test(readFileSync(join(dir, "SKILL.md"), "utf8")),
  "a proof chip's missing state is upstream baton's rule now, not the adapter's");
// each version names the built-in's upstream commit by its hashes, the shipped pins only
ok(batonUpstreamOf(BATON_PIN) === BATON_PIN.upstream.commit
  && batonUpstreamOf({ id: "studio-baton", sha256: "9eef584142c1dd243fe8b2395cf03482e7d3c5dcefd5d1b44bbb8e220fe828f1", filesSha256: "7688fcaa6672ed7d483f8b299dce2cebc7debfd5ccdef91bbf4ba179020d6ae9" }) === "c382464ab02a14ad3dda364143c74bff58ddbcfc"
  && batonUpstreamOf({ id: "studio-baton", sha256: "96d3ca8f0dc741e1fd308ed6d6d3496f8618aa8f9f12de03031ab7bf5b721cb4", filesSha256: "745774aad1f9aded7229689dc0d1c273659d4bbaf45d0e050d001d1ea9e9937b" }) === "e74aeed230ce8126b7b5be5c42d1dcb202d93a40"
  && batonUpstreamOf({ id: "studio-baton", sha256: "ee3a9f5221a1c77e10e2f8d3954d7ce558fc50ca3edd403e5a087d5ab2afce4a", filesSha256: "b9e6622e7a06ee1d9674f7d589c93f9e4d6054fec7bf43647df28e4e2c1ffe06" }) === "ba68615428b9c366eb5339778683e67b9b6c31c7"
  && batonUpstreamOf({ id: "studio-baton", sha256: BATON_PIN.sha256, filesSha256: "0".repeat(64) }) === null && batonUpstreamOf({ id: "baton", sha256: BATON_PIN.sha256, filesSha256: BATON_PIN.filesSha256 }) === null,
  "the upstream commit of a built-in version, by both hashes: the current pin, ba68615, e74aeed and c382464; a changed file or another skill has none");

// 2d7f9b9: the failure-mode table under the boundary map (the runbook), one system map drawn everywhere, full-text search. The
// adapter says what upstream now requires and how the room does what upstream does with git; each rule it names is upstream's
// own (the vendored verify.py holds it), so none is idle. tests/review-baton-page-ui.mjs runs verify.py on a packet so shaped.
{ const vp = readFileSync(join(dir, "scripts/verify.py"), "utf8"), br = readFileSync(join(dir, "references/boundary-review.md"), "utf8"), sk = readFileSync(join(dir, "SKILL.md"), "utf8");
  ok(/the boundary map has no `failures`/.test(vp) && /register == "engineer"/.test(vp) && /`handled` needs `ref`/.test(vp) && /not pinned to a commit/.test(vp) && /def check_system_map/.test(vp),
    "upstream verify.py requires the failure modes on the engineer register, evidence for a handled row, commit-pinned GitHub links and one system map");
  ok(/git grep -n/.test(br) && /git cat-file -e/.test(br) && /`#q=<code>`/.test(sk),
    "upstream checks a row's ref with git grep and git cat-file, and its page has #q= deep links (the room has no git: the adapter says what stands in)"); }
ok(/failure-mode table/.test(BATON_ADAPTER) && /It is required: on the engineer register verify\.py fails a map that crosses a boundary\s+with no `failures`/.test(BATON_ADAPTER)
  && /`runbook` section, never a compare or a matrix/.test(BATON_ADAPTER) && /runbook, compare, matrix/.test(BATON_ADAPTER),
  "the adapter: the failure-mode table is required under the map; error codes go in a runbook section (listed among the components)");
ok(/Head commit pull-request\.md names, the full 40-hex sha/.test(BATON_ADAPTER) && /blob\/<sha>\/<path>#La-Lb/.test(BATON_ADAPTER) && /lines found in head\/<path>/.test(BATON_ADAPTER)
  && /in place of baton's git grep and git cat-file/.test(BATON_ADAPTER) && /never a URL you were given or guessed/.test(BATON_ADAPTER),
  "the adapter: a row's ref is a permalink at the room's head commit, its lines found in head/ (in place of git grep and git cat-file)");
ok(/could not read in the materials is never `handled`/.test(BATON_ADAPTER) && /open questions as unchecked/.test(BATON_ADAPTER) && /`detect` names a signal the materials show/.test(BATON_ADAPTER),
  "the adapter: never handled from code it did not read, never a signal the materials do not show");
ok(/no `ref`\s+\(there is no commit here\) and no `planned`/.test(BATON_ADAPTER) && /each with its source sentence \(`source`\)/.test(BATON_ADAPTER),
  "the adapter: a document room's failure modes cite the document's sentence, with no ref and no planned (the room cannot tell what is built)");
ok(/one system map \(`systems`/.test(BATON_ADAPTER) && /says its `view` and `state`/.test(BATON_ADAPTER),
  "the adapter: one system map, and every figure with edges says its view and state");
// the old blanket rule is gone: upstream now asks for one link (a row's evidence); nothing on the page may load from a URL
ok(!/No external URL anywhere on the page/.test(BATON_ADAPTER) && /Nothing on the page loads from a URL/.test(BATON_ADAPTER) && /The one link baton asks for is a failure row's `ref`; write no other/.test(BATON_ADAPTER),
  "the adapter: nothing loads from a URL; the one link is a failure row's ref (the old \"no external URL anywhere\" would forbid it)");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
