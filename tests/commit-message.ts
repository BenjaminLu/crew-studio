import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// One curated commit per Task (retro 2026-10-17, finding 19): the subject is Conventional style within the limit and never
// cut mid-word, carries no "(round N)"; the body is what and why plus each done line with its proof; a repository's
// CONTRIBUTING commit rules win; no claude.ai link ever lands; the GitHub path sends the same title and message with a
// squash or merge commit (the local path is covered end to end by tests/smoke-code.ts).      bun tests/commit-message.ts
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { must, setGitHome } from "../src/git";
import { commitConvention, commitSubject, taskCommitMessage } from "../src/domain/commit-message";
import { GitHubPrAdapter, type GitHubProjectGrant } from "../src/adapters/github";
import { mergeOnce } from "../src/domain/remote-gates";
import { githubSimulator } from "./lib/github-simulator";
const LINK = "https://claude.ai/code/" + "session_"; // built at runtime: no tracked file holds a session link
let pass = 0, fail = 0; const ok = (v: unknown, n: string, extra = "") => { if (v) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${extra}`); } };
const temp = checkedTempDir("commit-message-"); setGitHome(join(temp, "data"));
const repoWith = (name: string, files: Record<string, string>) => { const r = join(temp, name); mkdirSync(r); must(r, ["init", "-q", "-b", "main"]);
  for (const [p, c] of Object.entries({ "README.md": "# r\n", ...files })) { mkdirSync(join(r, p, ".."), { recursive: true }); writeFileSync(join(r, p), c); }
  must(r, ["add", "-A"]); must(r, ["commit", "-qm", "base"]); return { repo: r, head: must(r, ["rev-parse", "HEAD"]) }; };
try {
  // ---------- the subject ----------
  const def = { conventional: true, max: 72, source: null };
  const long = "Format money in euros across the shop, the static pages and the isolated server with demo rates";
  const s = commitSubject("feat", long, def, "Task R-1");
  ok(s.length <= 72 && /^feat: format money in euros/.test(s) && long.toLowerCase().startsWith(s.slice(6) + " ") && !/\s(and|the|with)$/.test(s), "a long title is cut between words within 72 characters, never on a dangling word", s);
  ok(commitSubject("fix", "fix: Round the basket total (round 3)", def, "x") === "fix: round the basket total", "an existing type prefix and a (round N) suffix are dropped");
  ok(commitSubject("nonsense", "Add EUR", def, "x") === "feat: add EUR" && commitSubject(null, "Add EUR", { conventional: false, max: 72, source: "CONTRIBUTING.md" }, "x") === "Add EUR", "an unknown type is feat; a repository without Conventional Commits gets a plain subject");
  ok(commitSubject("feat", "Supercalifragilisticexpialidociousandmuchmuchmuchlongerthanseventytwocharacters", def, "Task R-9") === "feat: task R-9", "a single word over the limit is never cut: the Task fallback");
  // ---------- the body ----------
  const m = taskCommitMessage({ run: "R-058", head: "a".repeat(40), type: "feat", title: "Add EUR formatting", what: "Shop prices show in euros.\nSee " + LINK + "01ABC for the chat.",
    why: ["Customers in the EU pay in euros"], done: [{ text: "formatMoney(1999, 'EUR') returns €19,99", proofs: [{ check: "firstmate/fail-first", verdict: "pass" }, { check: "firstmate/ci", verdict: "pass" }] }, { text: "The README says how", proofs: [] }] }, def);
  ok(m.message.startsWith("feat: add EUR formatting\n\nShop prices show in euros.") && /\nWhy:\n- Customers in the EU pay in euros\n/.test(m.message)
    && m.message.includes("- formatMoney(1999, 'EUR') returns €19,99 (proved by firstmate/fail-first: pass, firstmate/ci: pass)") && m.message.includes("- The README says how (no check proved it)")
    && /Crew Studio Task R-058, reviewed head aaaaaaaaaaaa\./.test(m.message), "the body: what, why, each done line with its proof, the Task and reviewed head", m.message);
  ok(!/claude\.ai|session_/.test(m.message) && !/Claude-Session/i.test(taskCommitMessage({ run: "R-1", head: "b".repeat(40), title: "x", what: "Claude-Session: " + LINK + "X", done: [] }, def).message), "no claude.ai session link or trailer ever lands");
  { const host = "claude" + ".ai"; const t = `See ${host}/code/session_9 and [the chat](https://${host}/code/session_8) or <https://${host}/x> today. Mail a@b.io.`;
    const out = taskCommitMessage({ run: "R-2", head: "c".repeat(40), title: "x", what: t, done: [] }, def).message;
    ok(!out.includes(host) && !out.includes("the chat") && !out.includes("session_") && out.includes("Mail a@b.io."), "scheme-less links, whole Markdown links and <links> to claude.ai are dropped", out); }
  // ---------- who authors it: the repository's user, else the captain's, never a config write; Crew Studio commits ----------
  { const { commitIdentity, commitTree } = await import("../src/domain/commit-message");
    const home = join(temp, "home"), bare = join(temp, "home-bare"); mkdirSync(home); mkdirSync(bare);
    writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Captain Ada\n\temail = ada@example.com\n");
    const own = repoWith("own-user", {}); writeFileSync(join(own.repo, ".git", "config"), readFileSync(join(own.repo, ".git", "config"), "utf8") + "[user]\n\tname = Repo Bob\n\temail = bob@example.com\n");
    const plainRepo = repoWith("no-user", {});
    const a = commitIdentity(own.repo, home), b = commitIdentity(plainRepo.repo, home), c = commitIdentity(plainRepo.repo, bare);
    ok(a.source === "repository" && a.name === "Repo Bob" && b.source === "captain" && b.email === "ada@example.com" && c.source === "studio" && c.name === "Crew Studio",
      "the author: the repository's own user, else the captain's ~/.gitconfig, else Crew Studio", JSON.stringify([a, b, c]));
    const before = readFileSync(join(own.repo, ".git", "config"), "utf8");
    const sha = commitTree(own.repo, must(own.repo, ["rev-parse", "HEAD^{tree}"]), own.head, "feat: one\n\nbody\n", a);
    ok(must(own.repo, ["log", "-1", "--format=%an <%ae>|%cn", sha]) === "Repo Bob <bob@example.com>|Crew Studio" && readFileSync(join(own.repo, ".git", "config"), "utf8") === before,
      "the commit is authored by that identity and committed by Crew Studio; the repository's config is untouched", must(own.repo, ["log", "-1", "--format=%an <%ae>|%cn", sha])); }
  { const dco = repoWith("dco", { "CONTRIBUTING.md": "# Contributing\n\n## Commits\n\nConventional Commits. Every commit carries a DCO sign-off (Signed-off-by).\n" });
    const conv = commitConvention(dco.repo, dco.head); const msg = taskCommitMessage({ run: "R-3", head: "d".repeat(40), title: "Add x", done: [], author: { name: "Ada", email: "ada@example.com", source: "captain" } }, conv).message;
    const none = taskCommitMessage({ run: "R-3", head: "d".repeat(40), title: "Add x", done: [], author: { name: "Ada", email: "ada@example.com", source: "captain" } }, def).message;
    ok(conv.signoff === true && msg.trimEnd().endsWith("Signed-off-by: Ada <ada@example.com>") && !/Signed-off-by/.test(none), "Signed-off-by only when CONTRIBUTING asks for a DCO sign-off", msg); }
  // ---------- the repository's rules ----------
  const kit = repoWith("money-kit", { "CONTRIBUTING.md": readFileSync(join(import.meta.dir, "../templates/sandbox-repo/CONTRIBUTING.md"), "utf8") });
  const kc = commitConvention(kit.repo, kit.head);
  ok(kc.conventional && kc.max === 71 && kc.source === "CONTRIBUTING.md", "money-kit's CONTRIBUTING (Conventional Commits, under 72 characters) is read at the head", JSON.stringify(kc));
  const plain = repoWith("plain", { ".github/CONTRIBUTING.md": "# Contributing\n\n## Commit messages\n\nWrite a plain English subject that describes the behaviour, at most 50 characters.\n\n## Tests\n\nRun them.\n" });
  const pc = commitConvention(plain.repo, plain.head);
  ok(!pc.conventional && pc.max === 50 && commitSubject("feat", long, pc, "x").length <= 50 && /^Format money in euros/.test(commitSubject("feat", long, pc, "x")), "a plain-English commit rule (.github/CONTRIBUTING.md, at most 50) gives a plain subject within 50", JSON.stringify([pc, commitSubject("feat", long, pc, "x")]));
  const none = repoWith("none", {}); const nc = commitConvention(none.repo, none.head);
  ok(nc.conventional && nc.max === 72 && nc.source === null, "no CONTRIBUTING: Conventional style within 72 characters");
  // ---------- the GitHub path: a squash carries the curated title and message; rebase lands the branch as it is ----------
  for (const method of ["squash", "rebase"] as const) {
    const { repo, head: base } = repoWith(`gh-${method}`, {}); const bare = join(temp, `gh-${method}.git`); must(temp, ["clone", "--bare", "-q", repo, bare]);
    must(repo, ["checkout", "-qb", "crew/task"]); writeFileSync(join(repo, "task"), "one"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "feat: round one"]);
    writeFileSync(join(repo, "task"), "two"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "feat: round two"]); const head = must(repo, ["rev-parse", "HEAD"]);
    const sim = githubSimulator(bare); const grant: GitHubProjectGrant = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-15T00:00:00Z", approvalId: "fake-grant",
      operations: { version: 1, repository: "fixture/project", approvalId: "fake-operations", approvedAt: "2026-10-15T00:00:00Z", mergeMethod: method } };
    const adapter = new GitHubPrAdapter(grant, () => "fake-test-token", 2000, join(temp, `data-${method}`)), dir = join(temp, `run-${method}`); mkdirSync(dir);
    try {
      const pr = await adapter.open({ repo, base: "main", branch: "crew/task", head, title: "fixture", body: "fixture" }, dir);
      sim.expect("GET", "", { full_name: "fixture/project", allow_squash_merge: true, allow_rebase_merge: true }); sim.expect("PUT", "/pulls/1/merge", { merged: true }, { sha: head, merge_method: method });
      const msg = taskCommitMessage({ run: "R-7", head, type: "feat", title: "Add the task file", what: "A task file.", why: [], done: [{ text: "task holds two", proofs: [{ check: "firstmate/ci", verdict: "pass" }] }] }, def);
      const result = await mergeOnce(adapter, pr, dir, "captain-card-1", undefined, base, undefined, { title: msg.subject, message: msg.body });
      const put = sim.calls.filter((c) => c.method === "PUT").at(-1)?.body; const landed = must(bare, ["log", "--format=%B", `${base}..main`]);
      if (method === "squash") ok(put?.commit_title === "feat: add the task file" && put?.commit_message === msg.body && must(bare, ["rev-list", "--count", `${base}..main`]) === "1" && landed.startsWith("feat: add the task file\n\nA task file.") && !/round (one|two)/.test(landed) && result.sourceHead === head,
        "GitHub squash: one commit with the curated title and message, never the round commits", JSON.stringify([put, landed]));
      else ok(put && !("commit_title" in put) && !("commit_message" in put) && /round two/.test(landed), "GitHub rebase: no commit title or message is sent (GitHub lands the branch's own commits)", JSON.stringify(put));
    } finally { sim.stop(); }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`\ncommit-message: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
