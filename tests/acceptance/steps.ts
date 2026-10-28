// Named captain steps a stub run names in `setup:` (before its start) or `before:` (before it answers a
// card). Each is something the captain does on the board, through the same HTTP route.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, readdirSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { accountHomeDir } from "../../src/runtime/checks";
import { assertTempRepo } from "../lib/git-hygiene.mjs"; // repositories only in checked temp folders
import { drive, verify, answerCard, type Decide } from "./drive";
import type { Studio } from "./studio";
import { ON_CURSOR, STAFFING_ANSWER } from "./provider";

export type Ctx = { s: Studio; vars: Record<string, string>; firstmate(marker: "NATIVE-PROPOSE " | "NATIVE-PROJECT " | "NATIVE-TOOL ", args: unknown): Promise<any[]>;
  /** connections the probe's sink port took (setup step probe): any is a round that went around the proxy */
  sinkHits?: () => number;
  github?: { origin: string; calls: { method: string; path: string }[] };
  fileorg?: { root: string; files: Record<string, string>; plan?: any } };
type Step = (h: Ctx, card?: any, view?: any) => Promise<void | { note?: string; choice?: string }>;
const git = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(["git", "-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", ...a], { cwd, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); };
/** Captain-side folders live under the Studio's own temp root (outside its CREW_DATA), so close() removes them. */
const scratch = (h: Ctx) => { const d = join(h.s.root, "captain"); mkdirSync(d, { recursive: true }); return d; };
const approveOnly: Decide = async (c) => ({ choice: c.options?.some((o: any) => o.id === "approve") ? "approve" : "?" });

/** The staffing interview and its captain-only confirmation card, for every role of one workflow. */
export async function approveStaffing(h: Ctx, project: string, workflow: string): Promise<string> {
  const version = (await h.s.api(`/api/wf/${workflow}`)).body.def.version, base = { project, workflow, version };
  let r = (await h.s.api(`/api/intake/staffing?project=${encodeURIComponent(project)}&workflow=${workflow}&version=${version}`)).body;
  if (r.error) throw new Error(`staffing interview refused: ${r.error}`);
  const roles = [...new Set<string>((r.frontier ?? []).map((q: any) => q.role))];
  for (const [field, value] of Object.entries(STAFFING_ANSWER)) {
    const res = await h.s.api("/api/intake/staffing", { ...base, answers: Object.fromEntries(roles.map((id) => [id, { [field]: value }])) });
    if (res.status !== 200 || res.body.error) throw new Error(`staffing ${field} answer refused: ${res.status} ${res.body.error ?? ""}`); r = res.body;
  }
  if (!r.complete) throw new Error(`staffing interview not complete: ${JSON.stringify(r.frontier).slice(0, 300)}`);
  const conf = await h.s.api("/api/intake/staffing", { ...base, roles: r.choices, confirm: true });
  if (conf.status !== 200 || !conf.body.proposal) throw new Error(`staffing confirmation refused: ${conf.status} ${JSON.stringify(conf.body).slice(0, 300)}`);
  return conf.body.proposal;
}

/** One staffing approval per Studio and project: concurrent runs share it (the interview is one per project). */
const staffed: Record<string, Promise<void>> = {};
async function approveCode(h: Ctx) { const id = await approveStaffing(h, h.vars.project, "code-firstmate"); const d = await drive(h.s, id, approveOnly, { timeoutMs: 30_000 }); const bad = await verify(h.s, d, { status: "succeeded", visited: ["confirm", "activate", "done"] }); if (bad.length) throw new Error(`staffing: ${bad.join("; ")}`); }

/** The sandbox probe's arguments ({probe} in the topic, read by tests/acceptance/agent.mjs): the provider's API host, a loopback
 *  sink the harness listens on and Studio's own port (no round may connect to either), files a round must not read and folders it
 *  must not write. */
async function probeSetup(h: Ctx, host: string) {
  let hits = 0; const sink = createServer((c) => { hits++; c.destroy(); }); await new Promise<void>((r) => sink.listen(0, "127.0.0.1", () => r()));
  const closeStudio = h.s.close; h.s.close = async () => { sink.close(); await closeStudio(); };
  h.sinkHits = () => hits;
  const home = join(h.s.root, "home"), acct = accountHomeDir();
  // a file beside each bin folder on PATH whose parent is a tool's private folder (no lib/): the round runs the tool, never reads the rest
  const beside = (process.env.PATH ?? "").split(":").filter((d) => /\/bin$/.test(d) && d.startsWith(acct + "/")).map(dirname).filter((p) => existsSync(p) && !existsSync(join(p, "lib")))
    .flatMap((p) => { try { return readdirSync(p).map((f) => join(p, f)).filter((f) => !/[\s,]/.test(f) && statSync(f).isFile()).slice(0, 1); } catch { return []; } });
  const own = [".ssh/known_hosts", ".ssh/config", ".gitconfig", ".zshrc", ".zsh_history"].map((f) => join(acct, f)).filter(existsSync);
  const deny = [join(home, ".codex", "auth.json"), join(h.s.data, "ledger.key"), join(h.s.data, "projects.json"), ...own, ...beside];
  const nowrite = [h.s.data, home]; // never the account home: a probe that could write there would leave a file behind
  h.vars.probe = `ACCEPT_PROBE host=${host} sink=${(sink.address() as any).port} studio=${new URL(h.s.base).port} deny=${deny.join(",")} nowrite=${nowrite.join(",")}`;
}

/** The GitHub simulator of each project a github-sim step connected (tests/lib/github-simulator.ts, in this process). */
const simulators = new Map<string, any>();
/** A money-kit repository (Studio's own sandbox template) whose origin is a bare repository that the GitHub simulator serves as
 *  fixture/project: registered through Firstmate, then connected with the signed simulator grant the captain's Connect card
 *  writes for a simulator (as tests/github-pr-flow.ts writes it); ops adds the operations grant (Studio merges on GitHub). */
async function githubSim(h: Ctx, ops: boolean) {
  const { prepareSandbox } = await import("../../src/sandbox-repo");
  const { githubSimulator } = await import("../lib/github-simulator");
  const { grantSignature } = await import("../../src/github-grant");
  const root = realpathSync(mkdtempSync(join(scratch(h), "github-"))); assertTempRepo(root);
  const repo = prepareSandbox(root).path, bare = join(root, "remote.git");
  git(root, "clone", "--bare", "-q", repo, bare); git(repo, "remote", "add", "origin", bare);
  const sim = githubSimulator(bare); sim.autoCi("ci");
  // GitHub serves the repository's own pull request template (its contents API), so Studio fills it and asks the captain first
  sim.community.set(".github/pull_request_template.md", readFileSync(join(repo, ".github", "pull_request_template.md"), "utf8"));
  const closeStudio = h.s.close; h.s.close = async () => { sim.stop(); await closeStudio(); };
  h.vars.repo = repo; await STEPS.register(h);
  const file = join(h.s.data, "projects.json"), all = JSON.parse(readFileSync(file, "utf8")), p = all.find((x: any) => x.id === h.vars.project);
  const at = new Date().toISOString();
  p.github = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: at, approvalId: "acceptance-simulator",
    ...(ops ? { operations: { version: 1, repository: "fixture/project", approvalId: "acceptance-operations", approvedAt: at, mergeMethod: "squash" } } : {}) };
  p.github.signature = grantSignature(h.s.data, p, p.github);
  writeFileSync(file, JSON.stringify(all, null, 2));
  // the token Studio sends the simulator (a fixture, never a real one: the acceptance Studio never asks gh or the keychain)
  writeFileSync(join(h.s.data, "github-token"), "fake-acceptance-token", { mode: 0o600 });
  simulators.set(h.vars.project, sim);
  h.github = { origin: sim.origin, calls: sim.calls };
}

export const STEPS: Record<string, Step> = {
  /** a registered money-kit project on the GitHub simulator, merging off (the Connect card's default): {repo}, {project} */
  async "github-sim"(h) { await githubSim(h, false); },
  /** Read-only repository permission fixture: the real grant workflow must still ask its captain card. */
  async "merge-access"(h) {
    const sim = simulators.get(h.vars.project); if (!sim) throw new Error("merge-access needs github-sim");
    sim.expect("GET", "", { full_name: "fixture/project", private: true, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: false,
      permissions: { admin: false, maintain: false, push: true, triage: true, pull: true } });
  },
  /** Before answering a merge card, the registry must still have no operations permission. */
  async "merge-ungranted"(h) {
    const project = JSON.parse(readFileSync(join(h.s.data, "projects.json"), "utf8")).find((p: any) => p.id === h.vars.project);
    if (!project?.github || project.github.operations) throw new Error("merge permission changed before captain approval");
  },
  /** the simulator's open issues: one, then an empty page (src/issue-triage-workflow.ts reads them page by page) */
  async "github-issues"(h) { const sim = simulators.get(h.vars.project); if (!sim) throw new Error("github-issues needs github-sim");
    const page = (n: number) => `/issues?state=open&sort=created&direction=asc&per_page=50&page=${n}`;
    sim.expect("GET", page(1), [{ number: 1, title: "Allowlist matches substrings", body: "A host check uses includes", labels: [], user: { login: "reporter" }, author_association: "NONE", updated_at: "2026-10-20T00:00:00Z" }]); sim.expect("GET", page(2), []); },
  /** no open issue at all */
  async "github-no-issues"(h) { const sim = simulators.get(h.vars.project); if (!sim) throw new Error("github-no-issues needs github-sim"); sim.expect("GET", "/issues?state=open&sort=created&direction=asc&per_page=50&page=1", []); },
  /** the same with the operations grant: Studio merges the pull request on GitHub itself */
  async "github-sim-ops"(h) { await githubSim(h, true); },
  /** the captain merges the open pull request on GitHub's own page, then answers the card */
  async "github-merge"(h) { const sim = simulators.get(h.vars.project); if (!sim) throw new Error("github-merge needs the github-sim step"); const open = [...sim.pulls.values()].filter((p: any) => p.state === "open"); if (open.length !== 1) throw new Error(`${open.length} open pull requests on the simulator`); sim.mergeOnGitHub(open[0].number); },
  /** the sandbox probe for a Codex round: {probe} (its API host api.openai.com) */
  async probe(h) { await probeSetup(h, "api.openai.com"); },
  /** the sandbox probe for a Claude round: {probe} (its API host api.anthropic.com) */
  async "probe-claude"(h) { await probeSetup(h, "api.anthropic.com"); },
  /** the sandbox probe for a Cursor round: {probe} (its API host api2.cursor.sh) */
  async "probe-cursor"(h) { await probeSetup(h, "api2.cursor.sh"); },
  /** the Claude account card's Verify (one bounded request on the exact configured model); its receipt admits Claude rounds for 30 s */
  async "verify-claude"(h) { const r = await h.s.api("/api/claude/native/verify", { model: "claude-sonnet-5-5", effort: null, confirm: true }); if (r.status !== 200 || r.body.admission !== "verified-execution") throw new Error(`Claude verify: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); },
  /** a throwaway folder with a few files to tidy: {folder} */
  async folder(h) { const d = realpathSync(mkdtempSync(join(scratch(h), "folder-"))); for (const f of ["report.pdf", "photo.jpg", "notes.txt", "song.mp3"]) writeFileSync(join(d, f), `acceptance ${f}\n`); h.vars.folder = d; h.fileorg = { root: d, files: Object.fromEntries(readdirSync(d).map(f => [f, readFileSync(join(d, f), "utf8")])) }; },
  /** a throwaway local git repository: {repo} */
  async repo(h) { const d = realpathSync(mkdtempSync(join(scratch(h), "repo-"))); assertTempRepo(d); git(d, "init", "-q", "-b", "main"); writeFileSync(join(d, "README.md"), "# Acceptance repo\n"); git(d, "add", "."); git(d, "commit", "-qm", "Initial"); h.vars.repo = d; },
  /** {repo}'s origin is a github.com repository (nothing is fetched or pushed) */
  async "github-origin"(h) { if (!h.vars.repo) await STEPS.repo(h); git(h.vars.repo, "remote", "add", "origin", "https://github.com/acceptance-fixture/acceptance-repo.git"); },
  /** register {repo} through Firstmate (NATIVE-PROJECT) and approve the registration card: {project} */
  async register(h) {
    if (!h.vars.repo) await STEPS.repo(h);
    const runs = await h.firstmate("NATIVE-PROJECT ", { path: h.vars.repo, name: "Acceptance repo", workflow: "code-firstmate", version: 1, text: "Acceptance: register this repository", params: {} });
    const reg = runs.find((r) => r.workflow === "firstmate-register-project"); if (!reg) throw new Error("Firstmate prepared no project registration");
    const d = await drive(h.s, reg.id, approveOnly, { timeoutMs: 30_000 }); const bad = await verify(h.s, d, { status: "succeeded", visited: ["register", "continue", "done"] });
    if (bad.length) throw new Error(`registration: ${bad.join("; ")}`);
    const projects = (await h.s.api("/api/policies")).body.projects ?? [];
    const raw = JSON.parse(readFileSync(join(h.s.data, "projects.json"), "utf8")); const p = raw.find((x: any) => x.path && realpathSync(x.path) === h.vars.repo);
    if (!p || !projects.some((x: any) => x.id === p.id)) throw new Error("the registered project is not listed"); h.vars.project = p.id;
  },
  /** The exact reviewed dry-run plan, before the captain allows or discards any moves. */
  async "fileorg-unmoved"(h, _card, view) {
    if (!h.fileorg) throw new Error("fileorg-unmoved needs the folder fixture");
    const { root, files } = h.fileorg;
    if (JSON.stringify(readdirSync(root).sort()) !== JSON.stringify(Object.keys(files).sort()) || Object.entries(files).some(([f, text]) => readFileSync(join(root, f), "utf8") !== text)) throw new Error("files changed before the captain answered");
    const plan = JSON.parse(readFileSync(join(h.s.data, "fileorg", view.ctx.plan.id, "plan.json"), "utf8"));
    if (plan.root !== root || plan.status !== "planned") throw new Error("the reviewed file plan is not the fixture's unmodified dry run");
    h.fileorg.plan = plan;
  },
  /** connect {project} to its GitHub origin through Firstmate (studio_connect_github) and approve the connect card (nothing is pushed) */
  async connect(h) {
    const runs = await h.firstmate("NATIVE-TOOL ", { name: "studio_connect_github", args: { project: h.vars.project } });
    const run = runs.find((r) => r.workflow === "firstmate-connect-github"); if (!run) throw new Error("Firstmate proposed no GitHub connection");
    const d = await drive(h.s, run.id, approveOnly, { timeoutMs: 30_000 }); const bad = await verify(h.s, d, { status: "succeeded", visited: ["connect", "write", "done"] });
    if (bad.length) throw new Error(`connect: ${bad.join("; ")}`);
  },
  /** staffing for code-firstmate on {project} (default: the built-in sandbox project), approved on its card */
  async "staffing-code"(h) { h.vars.project ??= "sandbox"; const key = `${h.s.base} ${h.vars.project}`; staffed[key] ??= approveCode(h); return staffed[key]; },

  /** the coffee form's inputs: an approved coffee staffing and the validated design plan: {project}, {coffeeDesignPlan} */
  async coffee(h) {
    h.vars.project = "acceptance-coffee";
    staffed[`${h.s.base} coffee`] ??= (async () => { const id = await approveStaffing(h, "acceptance-coffee", "coffee-kit");
      const d = await drive(h.s, id, approveOnly, { timeoutMs: 30_000 }); const bad = await verify(h.s, d, { status: "succeeded", visited: ["confirm", "activate", "done"] }); if (bad.length) throw new Error(`coffee staffing: ${bad.join("; ")}`); })();
    await staffed[`${h.s.base} coffee`];
    const plan = JSON.parse(readFileSync(join(import.meta.dir, "../fixture/coffee-design.json"), "utf8"));
    const v = await h.s.api("/api/coffee/design", { plan }); if (v.status !== 200) throw new Error(`coffee design refused: ${JSON.stringify(v.body).slice(0, 300)}`); h.vars.coffeeDesignPlan = v.body.canonical;
  },
  // ---- pack genesis: what the captain does on the pack page before answering each card ----
  /** answer the six interview questions in the card's own form */
  async "pack-interview"(_h, card) { const f = card.interview; if (!f) throw new Error("the interview card carries no form"); return { note: JSON.stringify({ schema: 1, card: card.id, visit: card.visit, batchHash: f.batchHash, answers: Object.fromEntries(f.questions.map((q: any) => [q.key, `Acceptance answer for ${q.key}`])) }) }; },
  /** label the first sample good and the second bad, with a pin on the bad one */
  async "pack-label"(h, card) {
    const g = (await h.s.api(`/api/pack-genesis/${card.run}`)).body; if ((g.samples ?? []).length < 2) throw new Error(`pack genesis has ${(g.samples ?? []).length} samples`);
    const [good, bad] = g.samples;
    const n = await h.s.api(`/api/artifacts/${bad.artifact}/v/${bad.version}/notes`, { kind: "pin", selector: "button", bbox: { x: 10, y: 10, w: 80, h: 40 }, comment: "Give the empty button an accessible label" }); if (n.status !== 200) throw new Error(`note refused: ${JSON.stringify(n.body).slice(0, 200)}`);
    for (const [sample, label] of [[good.id, "good"], [bad.id, "bad"]]) { const r = await h.s.api(`/api/pack-genesis/${card.run}/labels`, { sample, label }); if (r.status !== 200) throw new Error(`label refused: ${JSON.stringify(r.body).slice(0, 200)}`); }
  },
  /** decide every offered proposal: reject (kept as a rejected fingerprint) */
  async "pack-proposals"(h, card) { const g = (await h.s.api(`/api/pack-genesis/${card.run}`)).body; for (const p of (g.proposals ?? []).filter((p: any) => p.status === "offered")) { const r = await h.s.api(`/api/pack-genesis/${card.run}/proposals/${p.id}`, { choice: "reject" }); if (r.status !== 200) throw new Error(`proposal decision refused: ${JSON.stringify(r.body).slice(0, 200)}`); } },
  /** one real shadow Task on the pinned candidate, accepted by the captain */
  async "pack-shadow"(h, card) {
    // the shadow Task runs the published-pack producer on Studio's default provider (Claude): the captain verifies Claude first;
    // on Cursor the default provider is Cursor, which has no verification step
    if (!ON_CURSOR) await STEPS["verify-claude"](h);
    const r = await h.s.api(`/api/pack-genesis/${card.run}/shadow`, { text: "Create a good accessible page" }); if (r.status !== 200) throw new Error(`shadow start refused: ${JSON.stringify(r.body).slice(0, 300)}`);
    const d = await drive(h.s, r.body.task.id, async (c) => c.node === "accept" ? { choice: "accept" } : { stop: "the shadow Task's only captain card is its acceptance" }, { timeoutMs: 60_000 });
    const bad = await verify(h.s, d, { status: "succeeded", visited: ["accept"] }); if (bad.length) throw new Error(`shadow Task ${r.body.task.id}: ${bad.join("; ")}`);
  },
};
export { answerCard };
