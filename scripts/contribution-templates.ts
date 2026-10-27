// The pull request and issue templates a repository asks for, found as GitHub finds them (the repository's default
// branch first, then its owner's public .github repository), with the same code Studio's board uses
// (src/domain/github-community.ts). For an agent in a terminal about to open a PR or an issue, and for CI checking one.
//
//   bun scripts/contribution-templates.ts                      the checkout's origin, read through `gh api`
//   bun scripts/contribution-templates.ts --repo owner/name    any GitHub repository, through `gh api`
//   bun scripts/contribution-templates.ts --dir .              a local checkout's committed files (no network, no owner fallback)
//     --pr [path]          print the PR template to fill (with several and no default, name one by path)
//     --issue [path]       print an issue template (or list them)
//     --check-body <file>  exit 1 unless the PR body keeps a template's headings in order and its checkboxes, and has no session link
//     --check-commits <range>  exit 1 if a commit message in the range (in --dir, default .) has a session link
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { communitySource, discoverGitHubCommunity, type CommunityBundle, type CommunityFile } from "../src/domain/github-community";
import { SESSION_LINK, templateShapeProblem } from "../src/domain/pull-template";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : ""; };
const has = (name: string) => argv.includes(name);
const die = (m: string): never => { console.error(m); process.exit(1); };
const run = (cmd: string, args: string[], cwd?: string) => spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 8 << 20 });

/** `gh api` as the reader: the captain's own GitHub login, a 404 is "not there". */
const ghReader = async (repository: string, suffix: string) => {
  const r = run("gh", ["api", "-H", "Accept: application/vnd.github+json", `repos/${repository}${suffix}`]);
  if (r.status === 0) return JSON.parse(r.stdout);
  if (/HTTP 404|Not Found/.test(r.stderr + r.stdout)) return null;
  throw new Error(`gh api repos/${repository}${suffix}: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
};

/** A checkout's committed tree as the reader, shaped like GitHub's REST answers. */
const treeReader = (dir: string, repository: string) => async (repo: string, suffix: string) => {
  if (repo !== repository) return null; // no owner fallback offline
  const git = (...a: string[]) => { const r = run("git", a, dir); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.trim()}`); return r.stdout; };
  if (suffix === "") return { full_name: repository, default_branch: "HEAD", private: true, visibility: "private" };
  if (suffix === "/commits/HEAD") return { sha: git("rev-parse", "HEAD").trim() };
  const m = /^\/contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(suffix);
  if (!m) return null;
  const path = m[1].split("/").map(decodeURIComponent).join("/"), ref = m[2];
  const entry = git("ls-tree", ref, "--", path).trim();
  if (!entry) return null;
  const [, type, sha] = /^\d+ (\w+) ([a-f0-9]{40})\t/.exec(entry)!;
  if (type === "tree") return git("ls-tree", ref, "--", path + "/").trim().split("\n").filter(Boolean).map((l) => { const [, t, , p] = /^\d+ (\w+) ([a-f0-9]{40})\t(.*)$/.exec(l)!; return { type: t === "blob" ? "file" : "dir", path: p }; });
  const bytes = run("git", ["cat-file", "blob", sha], dir);
  const buf = Buffer.from(bytes.stdout, "utf8");
  return { type: "file", path, encoding: "base64", content: buf.toString("base64"), sha, size: buf.length };
};

const originRepo = (dir: string) => {
  const url = run("git", ["remote", "get-url", "origin"], dir).stdout.trim();
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
};

async function bundle(): Promise<CommunityBundle> {
  const dir = flag("--dir");
  if (dir !== undefined) {
    const d = dir || ".", repository = flag("--repo") || originRepo(d) || "local/checkout";
    return discoverGitHubCommunity(communitySource(repository, treeReader(d, repository)));
  }
  const repository = flag("--repo") || originRepo(".") || die("no --repo and no GitHub origin in this checkout");
  return discoverGitHubCommunity(communitySource(repository, ghReader));
}

const where = (f: CommunityFile) => `${f.repository}@${f.head.slice(0, 8)}:${f.path}`;
const pick = (files: CommunityFile[], path: string | undefined, kind: string) => {
  if (path) return files.find((f) => f.path === path) ?? die(`no ${kind} template at ${path}; there are: ${files.map((f) => f.path).join(", ") || "none"}`);
  const def = files.find((f) => /(^|\/)(pull_request_template|issue_template)\.md$/i.test(f.path));
  if (def || files.length === 1) return def ?? files[0];
  return files.length ? die(`several ${kind} templates and no default; name one with its path: ${files.map((f) => f.path).join(", ")}`) : null;
};

if (has("--check-commits")) {
  const range = flag("--check-commits") || die("--check-commits needs a range, e.g. origin/main..HEAD");
  const log = run("git", ["log", "--format=%H%n%B%n--end--", range], flag("--dir") || ".");
  if (log.status !== 0) die(log.stderr.trim());
  const bad = log.stdout.split("--end--").map((c) => c.trim()).filter((c) => SESSION_LINK.test(c)).map((c) => c.slice(0, 12));
  if (bad.length) die(`commit message has a session link (CONTRIBUTING.md "No session links"): ${bad.join(", ")}`);
  console.log("commit messages: no session links");
  if (!has("--check-body")) process.exit(0);
}

const b = await bundle();
if (has("--check-body")) {
  const file = flag("--check-body") || die("--check-body needs a file");
  const body = readFileSync(file, "utf8");
  if (SESSION_LINK.test(body)) die('the PR body has a session link (CONTRIBUTING.md "No session links")');
  if (b.pulls.length) {
    const problems = b.pulls.map((t) => [t, templateShapeProblem(t.text, body, [])] as const);
    if (problems.every(([, p]) => p)) die(`the PR body does not follow ${problems.length > 1 ? "any of the PR templates" : "the PR template"}:\n${problems.map(([t, p]) => `  ${where(t)}: ${p}`).join("\n")}`);
    console.log(`PR body follows ${where(problems.find(([, p]) => !p)![0])}`);
  } else console.log("no PR template; body has no session link");
} else if (has("--pr")) {
  const t = pick(b.pulls, flag("--pr") || undefined, "PR");
  if (!t) console.log(`${b.repository} has no PR template${b.contributing ? `; read ${where(b.contributing)}` : ""}`);
  else { console.error(`# PR template ${where(t)}: keep every heading in order; tick a checkbox only with evidence`); process.stdout.write(t.text); }
} else if (has("--issue")) {
  const forms = b.issues.filter((f) => !/config\.ya?ml$/i.test(f.path));
  const t = flag("--issue") ? pick(forms, flag("--issue"), "issue") : forms.length === 1 ? forms[0] : null;
  if (t) { console.error(`# issue template ${where(t)}`); process.stdout.write(t.text); }
  else console.log(forms.length ? `issue templates (name one with --issue <path>):\n${forms.map((f) => `  ${where(f)}`).join("\n")}` : `${b.repository} has no issue template`);
} else {
  console.log(`repository   ${b.repository}@${b.head.slice(0, 8)}`);
  console.log(`PR template  ${b.pulls.map(where).join(", ") || "none"}`);
  console.log(`issue        ${b.issues.map(where).join(", ") || "none"}`);
  console.log(`CONTRIBUTING ${b.contributing ? where(b.contributing) : "none"}`);
  console.log(`AGENTS.md    ${b.agents ? where(b.agents) : "none"}`);
}
