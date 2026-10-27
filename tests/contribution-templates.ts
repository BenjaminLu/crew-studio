import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// scripts/contribution-templates.ts on a local checkout (as CI's PR text check runs it): the PR template it finds, a body
// that keeps it or not, a session link in the body or a commit message.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const LINK = ["https://claude.ai/code", "session_abc"].join("/"); // built, so this file holds no session link
let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log(`  ${v ? "ok  " : "FAIL"}  ${n}${v ? "" : " " + extra}`); v ? pass++ : fail++; };
const temp = checkedTempDir("contribution-templates-"), repo = join(temp, "repo"), script = join(import.meta.dir, "..", "scripts", "contribution-templates.ts");
const git = (...a: string[]) => { const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: repo }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
const run = (...a: string[]) => { const r = Bun.spawnSync(["bun", script, "--dir", repo, ...a]); return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }; };
try {
  mkdirSync(join(repo, ".github"), { recursive: true }); git("init", "-q", "-b", "main"); assertTempRepo(repo);
  writeFileSync(join(repo, ".github", "pull_request_template.md"), "## Summary\n\n<!-- what -->\n\n## Evidence\n\n## Merge Danger\n\n**Door:**\n");
  git("add", ".github/pull_request_template.md"); git("commit", "-q", "-m", "template");
  const base = git("rev-parse", "HEAD");
  const body = (name: string, text: string) => { const f = join(temp, name); writeFileSync(f, text); return f; };
  ok(/PR template\s+local\/checkout@\w+:\.github\/pull_request_template\.md/.test(run().out), "it finds the checkout's committed PR template");
  ok(run("--pr").out.includes("## Merge Danger"), "--pr prints the template to fill");
  const good = run("--check-body", body("good.md", "## Summary\n\nWhat.\n\n## Evidence\n\nTests.\n\n## Merge Danger\n\n**Door:** two-way\n"));
  ok(good.code === 0, "a body that keeps every heading in order passes", good.out);
  const missing = run("--check-body", body("missing.md", "## Summary\n\nWhat.\n\n## Merge Danger\n\n**Door:** two-way\n"));
  ok(missing.code === 1 && /"Evidence" is missing/.test(missing.out), "a body missing a heading fails and names it", missing.out);
  const order = run("--check-body", body("order.md", "## Evidence\n\n## Summary\n\n## Merge Danger\n"));
  ok(order.code === 1, "headings out of order fail", order.out);
  const linked = run("--check-body", body("linked.md", `## Summary\n\n## Evidence\n\n## Merge Danger\n\n${LINK}\n`));
  ok(linked.code === 1 && /session link/.test(linked.out), "a session link in the body fails", linked.out);
  writeFileSync(join(repo, "a.txt"), "a"); git("add", "a.txt"); git("commit", "-q", "-m", "clean change");
  ok(run("--check-commits", `${base}..HEAD`).code === 0, "commit messages without a session link pass");
  writeFileSync(join(repo, "b.txt"), "b"); git("add", "b.txt"); git("commit", "-q", "-m", `change\n\nClaude-Session: ${LINK}`);
  const bad = run("--check-commits", `${base}..HEAD`);
  ok(bad.code === 1 && /session link/.test(bad.out), "a commit message with a session link fails", bad.out);
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`contribution-templates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
