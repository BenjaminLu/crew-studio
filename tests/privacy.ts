// Privacy (legacy class C1; architecture §1.9): no committed file names a private
// absolute path (a user's home), the person running Studio, or anything on the
// local denylist (data/privacy-denylist.txt, one name per line, never committed).
// The scan reads every tracked file.     bun tests/privacy.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const root = join(import.meta.dir, "..");
const files = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe" }).stdout.toString().split("\0").filter(Boolean); // data/ included: a tracked data file is committed content too
const text = (f: string) => { try { const b = readFileSync(join(root, f)); return b.includes(0) ? null : b.toString("utf8"); } catch { return null; } };
const user = userInfo().username;
const deny = existsSync(join(root, "data", "privacy-denylist.txt")) ? readFileSync(join(root, "data", "privacy-denylist.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [];
type Rule = [string, RegExp, "local-user"?];
const rules: Rule[] = [
  ["a macOS home path", /\/Users\/(?!you\b|you\/|<)[A-Za-z0-9._-]+/],
  ["a Linux home path", /\/home\/(?!captain\b|you\b|runner\b|<)[a-z0-9._-]+\//],
  ["a home path encoded as a project key", /-Users-(?!you-)[A-Za-z0-9]+-/],
  ...(user && user.length > 2 && !["root", "runner", "you", "captain"].includes(user) ? [[`the local user's name (${user.length} letters)`, new RegExp(`\\b${user}`, "i"), "local-user"] as Rule] : []),
  ...deny.map((d) => [`a denylisted name (${d.length} letters)`, new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")] as [string, RegExp]),
];
// Public source provenance: Captain import d2b9966 / aab02f0, imported
// source 671a0c7185d94b56b8d791fac309965251a3f966. Only the local-user
// heuristic is excepted: every path, denylist and secret-file check still runs.
const publicAttribution = new Map<string,string>([
 ["scripts/import-captain.py:23","b9bdb746199e3121f0fb698169aa8092479efb64fa95e54dc90142ef3ee67fb0"],
 ["scripts/import-captain.py:46","de19b9e0d77a12e38c4c6fb6794ab32bebd501c7f0361d8ddda1f710c5d6b335"],
 ["skins/captain/LICENSE.txt:3","0b744944c7f97122742417ed9293aa005079a2392d189913eab704590c476760"],
 ["skins/captain/ORIGIN.txt:1","05e4f682d505f2116a7b9b4cad5d04c9d28602634542f77d3a5e2051ebabdc96"],
]);
const publicLine=(f:string,n:number,line:string)=>publicAttribution.get(`${f}:${n}`)===createHash("sha256").update(line).digest("hex");
function violations(f:string,n:number,line:string,checks:Rule[]=rules){return checks.filter(([,re,kind])=>re.test(line)&&!(kind==="local-user"&&publicLine(f,n,line))).map(([what])=>`${f}:${n} ${what}`);}
const secretFile=(f:string)=>/(^|\/)(\.env|.*\.key|github-token|keys\.json|ledger\.key)$/.test(f);
// Exercise the real classifier with a synthetic local-user match so root/CI
// accounts cannot accidentally turn the exception controls into no-ops.
for(const [key] of publicAttribution){const split=key.lastIndexOf(":"),file=key.slice(0,split),n=Number(key.slice(split+1)),line=text(file)?.split("\n")[n-1]??"";const local:Rule=["synthetic local user",/./,"local-user"];
 ok(publicLine(file,n,line)&&violations(file,n,line,[local]).length===0,`exact public attribution classified: ${key}`);
 ok(violations(file,n,line+" changed",[local]).length===1&&violations("elsewhere.txt",n,line,[local]).length===1&&violations(file,n+1,line,[local]).length===1,`changed or relocated attribution refused: ${key}`);
 const privatePath="/"+"Users/"+"private-fixture/file";
 ok(violations(file,n,line+privatePath,[local,rules[0]]).length===2,`private path appended to attribution is refused: ${key}`);
 ok(violations(file,n,line,[["explicit denylist",/./]]).length===1,`explicit denylist overrides public attribution: ${key}`);
}
ok(secretFile("data/github-token")&&secretFile("private/ledger.key")&&!publicLine("data/github-token",1,text("skins/captain/ORIGIN.txt")?.split("\n")[0]??""),"public attribution cannot exempt tracked token or key files");
const hits: string[] = [];
for (const f of files) { const t = text(f); if (t == null) continue;
  t.split("\n").forEach((l, i) => { hits.push(...violations(f,i+1,l)); }); }
ok(files.length > 100, `the scan reads every tracked file (${files.length})`);
const tracked = Bun.spawnSync(["git", "ls-files", "-z", "data"], { cwd: root, stdout: "pipe" }).stdout.toString().split("\0").filter(Boolean);
ok(tracked.every((f) => files.includes(f)), `tracked data/ files are scanned too (${tracked.length})`);
ok(!hits.length, "no committed file names a private home path, the local user, or a denylisted name", hits.slice(0, 15).join(" | "));
ok(!files.some(secretFile), "no secret file is tracked");
console.log(`\nprivacy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
