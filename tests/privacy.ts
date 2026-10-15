// Privacy (legacy class C1; architecture §1.9): no committed file names a private
// absolute path (a user's home), the person running Studio, or anything on the
// local denylist (data/privacy-denylist.txt, one name per line, never committed).
// The scan reads every tracked file.     bun tests/privacy.ts
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
const rules: [string, RegExp][] = [
  ["a macOS home path", /\/Users\/(?!you\b|you\/|<)[A-Za-z0-9._-]+/],
  ["a Linux home path", /\/home\/(?!captain\b|you\b|runner\b|<)[a-z0-9._-]+\//],
  ["a home path encoded as a project key", /-Users-(?!you-)[A-Za-z0-9]+-/],
  ...(user && user.length > 2 && !["root", "runner", "you", "captain"].includes(user) ? [[`the local user's name (${user.length} letters)`, new RegExp(`\\b${user}`, "i")] as [string, RegExp]] : []),
  ...deny.map((d) => [`a denylisted name (${d.length} letters)`, new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")] as [string, RegExp]),
];
const hits: string[] = [];
for (const f of files) { const t = text(f); if (t == null) continue;
  t.split("\n").forEach((l, i) => { for (const [what, re] of rules) if (re.test(l)) hits.push(`${f}:${i + 1} ${what}`); }); }
ok(files.length > 100, `the scan reads every tracked file (${files.length})`);
const tracked = Bun.spawnSync(["git", "ls-files", "-z", "data"], { cwd: root, stdout: "pipe" }).stdout.toString().split("\0").filter(Boolean);
ok(tracked.every((f) => files.includes(f)), `tracked data/ files are scanned too (${tracked.length})`);
ok(!hits.length, "no committed file names a private home path, the local user, or a denylisted name", hits.slice(0, 15).join(" | "));
ok(!files.some((f) => /(^|\/)(\.env|.*\.key|github-token|keys\.json|ledger\.key)$/.test(f)), "no secret file is tracked");
console.log(`\nprivacy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
