// Exact reviewed recipe identity; actual git refs, checked-out and other-branch paths.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts";
import { Lane } from "../src/recipes";
import { suite } from "./rt-harness";
const { ok, end } = suite("lane-pin");
const data = mkdtempSync(join(tmpdir(), "crew-lane-pin-")), store = new ArtifactStore(data), lane = new Lane(data, store);
const image = join(data, "image"); mkdirSync(image); writeFileSync(join(image, "banner.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'); store.create({ id: "fixture-image", title: "Fixture image", type: "image", source: "file", entry: "banner.svg" }); store.addVersion("fixture-image", { from: image, primary: "banner.svg", createdBy: { kind: "captain" } }); store.approve("fixture-image", 1, "fixture captain");
const sh = (cwd: string, ...argv: string[]) => { const r = Bun.spawnSync(argv, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
let n = 0;
const fixture = (other = false) => { const repo = join(data, `repo-${++n}`); mkdirSync(repo); sh(repo,"git","init","-q","-b","main"); writeFileSync(join(repo,"README.md"),"# Fixture\n");sh(repo,"git","add","README.md");sh(repo,"git","commit","-qm","base"); const r = lane.addRepo({ path: repo, name: `fixture-${n}` }), c = lane.run({ artifact: "fixture-image", repo: r.id }); if(other)sh(repo,"git","switch","-qc","work"); return {repo,c}; };
const save = (c: any) => writeFileSync(join(data, "lane", `${c.id}.json`), JSON.stringify(c));
const refs = () => { try { return readFileSync(join(data,"repo-refs.jsonl"),"utf8"); } catch { return ""; } };
for (const other of [false,true]) for (const change of ["branch-advance", "branch-replace", "base-advance", "card-commit", "card-branch", "card-base", "repo-path", "repo-base"]) {
 const { repo, c } = fixture(other), base = sh(repo,"git","rev-parse","main"), records = refs();
 if(change === "branch-advance") { const next = sh(repo,"git","commit-tree",`${c.commit}^{tree}`,"-p",c.commit!,"-m","unreviewed branch advance");sh(repo,"git","update-ref",`refs/heads/${c.branch}`,next); }
 if(change === "branch-replace") sh(repo,"git","update-ref",`refs/heads/${c.branch}`,base);
 if(change === "base-advance") { const next = sh(repo,"git","commit-tree",`${base}^{tree}`,"-p",base,"-m","base moved");sh(repo,"git","update-ref","refs/heads/main",next); }
 if(change === "card-commit") { c.commit = base; save(c); }
 if(change === "card-branch") { c.branch = "main"; save(c); }
 if(change === "card-base") { c.base = other ? "work" : "missing"; save(c); }
 if(change === "repo-path" || change === "repo-base") { const registered = lane.repos().map(r => r.id !== c.repo ? r : { ...r, ...(change === "repo-path" ? { path: data } : { base: "missing" }) }); writeFileSync(join(data, "repos.json"), JSON.stringify(registered)); }
 const before = sh(repo,"git","rev-parse","main");let error = "";try{await lane.merge(c.id,"fixture captain")}catch(e){error=String(e)}
 ok(!!error && sh(repo,"git","rev-parse","main") === before && lane.card(c.id)?.state !== "merged" && refs() === records, `${other?"other branch":"checked-out base"}: ${change} rejects before base mutation or merged record`,error);
}
for(const other of [false,true]) {
 const {repo,c}=fixture(other);await lane.merge(c.id,"fixture captain");
 ok(sh(repo,"git","rev-parse","main") === c.commit && lane.card(c.id)?.commit === c.commit,`${other?"other branch":"checked-out base"}: success moves to exact pinned commit and reports actual head`);
}
// Simulate the irreversible side effect completing before the card record was saved.
for(const other of [false,true]) {
 const {repo,c}=fixture(other);
 if(other)sh(repo,"git","update-ref","refs/heads/main",c.commit!,c.baseCommit!);else sh(repo,"git","merge","--ff-only","-q",c.commit!);
 const before = sh(repo,"git","rev-parse","main");await lane.merge(c.id,"fixture captain");
 ok(sh(repo,"git","rev-parse","main") === before && lane.card(c.id)?.state === "merged",`${other?"other branch":"checked-out base"}: side-effect replay recognizes only exact pinned commit without merging twice`);
}
const occupied = fixture(true), baseTree = join(data, "checked-out-base-tree"); sh(occupied.repo, "git", "worktree", "add", "-q", baseTree, "main"); const occupiedBefore = sh(occupied.repo, "git", "rev-parse", "main"), recordsBefore = refs();let occupiedRefused=false;try{await lane.merge(occupied.c.id,"fixture captain")}catch{occupiedRefused=true}
ok(occupiedRefused&&sh(occupied.repo,"git","rev-parse","main")===occupiedBefore&&refs()===recordsBefore,"other-branch CAS preserves Git's refusal to change a base checked out in another worktree");
const legacy=fixture();delete legacy.c.pin;save(legacy.c);const before=sh(legacy.repo,"git","rev-parse","main");let refused=false;try{await lane.merge(legacy.c.id,"fixture captain")}catch{refused=true}
ok(refused&&sh(legacy.repo,"git","rev-parse","main")===before&&!lane.card(legacy.c.id)?.pin,"historical unpinned ready recipe is refused without synthesizing identity or rewriting history");
end();
