// Temporary data for the Projects UI (tests/projects-ui.mjs): three projects in different states and a run in no project.
//   harbor-api     a busy local repository: two Tasks wait at cards, a merged Task, an approved crew, a proposed
//                  sensitive-path list, .crew/gates.json, a worktree, a website output
//   tidepool-docs  an external (GitHub) project: cannot dispatch yet
//   sandbox        the built-in sandbox (registered by the server itself at start), idle
// and, returned but not registered (the UI test registers them for its broken-registration pass):
//   kelp-notes     an old registration, disabled, whose folder is gone
//   reef-log       an enabled registration whose folder is gone
//   Studio         one Task with no project, waiting at its card
// Every Task here waits at a card or has ended, so the server started on this data never launches an agent.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Projects } from "../src/doors";
import { StaffingStore } from "../src/domain/staffing";
import { ArtifactStore } from "../src/artifacts";
import { prepareSandbox, registerSandbox } from "../src/sandbox-repo";
import { harness, until, Y } from "./rt-harness";

export async function seedProjects() {
  const H = await harness([
    Y({ id: "ship", name: "Ship a change", roles: [{ id: "worker", label: "Worker", skill: "x" }], nodes: [
      { id: "build", kind: "agent", label: "Build", role: "worker", mode: "test", x: 0, y: 0 },
      { id: "tests", kind: "check", label: "Tests", checks: [{ use: "t/ok" }], x: 1, y: 0 },
      { id: "merge", kind: "card", label: "Merge", args: { card_kind: "merge" }, card: { title: { en: "Merge it into main?", "zh-TW": "要合併到 main 嗎？" }, options: [{ id: "go", label: "Merge" }] }, x: 2, y: 0 },
      { id: "land", kind: "hook", label: "Land", do: "merge-sim", x: 3, y: 0 },
      { id: "done", kind: "hook", label: "Done", x: 4, y: 0 }], edges: [["build", "tests"], ["tests", "merge", "pass"], ["merge", "land", "go"], ["land", "done"]] }),
    Y({ id: "ask", name: "Ask the captain", roles: [], nodes: [
      { id: "plan", kind: "card", label: "Plan", args: { card_kind: "plan" }, card: { title: { en: "Is this plan right?", "zh-TW": "這個計畫對嗎？" }, options: [{ id: "go", label: "Yes" }] }, x: 0, y: 0 },
      { id: "end", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["plan", "end", "go"]] })]);
  const E: any = H.engine, DATA = H.data;
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).toString().trim();
  const repos = mkdtempSync(join(tmpdir(), "crew-projects-ui-"));
  const repo = (name: string) => { const d = join(repos, name); mkdirSync(d); git(d, "init", "-q", "-b", "main"); writeFileSync(join(d, "README.md"), name); git(d, "add", "README.md"); git(d, "commit", "-q", "-m", "start"); return d; };
  const harbor = repo("harbor-api"), tide = repo("tidepool-docs");
  mkdirSync(join(harbor, ".crew")); writeFileSync(join(harbor, ".crew", "gates.json"), JSON.stringify({ test: ["bun", "test"] }));
  prepareSandbox(DATA); registerSandbox(DATA);
  const reg = JSON.parse(readFileSync(join(DATA, "projects.json"), "utf8"));
  reg.unshift({ id: "harbor-api", name: "harbor-api", path: harbor, base: "main", sensitive: [], proposed: [{ glob: "infra/terraform/**", why: "cloud resources" }], proposedAt: new Date().toISOString(), approvedAt: null });
  reg.push({ id: "tidepool-docs", name: "tidepool-docs", path: tide, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null,
    github: { mode: "github", repository: "acme/tidepool-docs", localPath: tide, pushUrl: "https://github.com/acme/tidepool-docs.git", apiOrigin: "https://api.github.com", base: "main", branchPrefix: "crew/", approvedAt: new Date().toISOString(), approvalId: "fixture" } });
  writeFileSync(join(DATA, "projects.json"), JSON.stringify(reg, null, 1));
  mkdirSync(join(DATA, "policies"), { recursive: true });
  const broken = [{ id: "kelp-notes", name: "kelp-notes", path: join(repos, "kelp-notes-gone"), base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: false },
    { id: "reef-log", name: "reef-log", path: join(repos, "reef-log-gone"), base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null }];
  writeFileSync(join(DATA, "policies", "project-harbor-api.yaml"), "sensitive_paths:\n  - glob: migrations/**\n    why: schema changes\n  - glob: src/billing/**\n    why: money moves\n");
  // an approved crew for harbor-api, signed by the real store
  const projects = new Projects(DATA), store = new StaffingStore(DATA), identity = projects.staffingIdentity("harbor-api");
  const roles: any = {}, sources: Record<string, string> = {};
  for (const [role, provider, model, effort] of [["coordinator", "claude", "opus-5.5", "high"], ["worker", "codex", "gpt-5.5", "high"], ["reviewer", "claude", "opus-5.5", "high"], ["designer", "claude", "sonnet-5", "medium"]]) {
    const ref = `pack:firstmate/skills/${role === "coordinator" ? "firstmate" : role}.md`, text = `# ${role}\n`;
    roles[role] = { provider, model, effort, skill: store.snapshot({ ref, version: 1, text }) }; sources[ref] = text;
  }
  store.approve({ schema: 1, algorithm: "sha256-canonical-v1", project: identity, workflow: { id: "code-firstmate", version: 1, sha256: createHash("sha256").update("code-firstmate").digest("hex") }, roles, review: { freshContexts: 3, distinctProviders: true } } as any,
    null, { run: "R-0", card: "SC-0", answerSeq: 1 }, sources);
  // Tasks
  const merged = E.start({ workflow: "ship", title: "Export job runbook", text: "Write the export job runbook", params: { project: "harbor-api" } });
  await until(() => E.get(merged.id)?.status === "waiting", 15000);
  await E.answer(E.cards.list({ run: merged.id, open: true })[0].id, { choice: "go", by: "captain" });
  await until(() => E.get(merged.id)?.status === "succeeded", 15000);
  const rate = E.start({ workflow: "ship", title: "Add rate limiting to the export endpoint", text: "Add rate limiting to the export endpoint", params: { project: "harbor-api" } });
  const onboard = E.start({ workflow: "ask", title: "Update the onboarding email copy", text: "Update the onboarding email copy", params: { project: "harbor-api" } });
  const loose = E.start({ workflow: "ask", title: "Sort the March receipts", text: "Sort the March receipts" });
  await until(() => [rate, onboard, loose].every((r) => E.get(r.id)?.status === "waiting"), 15000);
  // a worktree record for the waiting change (as src/worktrees.ts writes it, with its marker)
  const head = git(harbor, "rev-parse", "HEAD"), wt = join(DATA, "work", "wt", "harbor-api"); mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, `${rate.id}.marker`), "");
  writeFileSync(join(wt, `${rate.id}.json`), JSON.stringify({ kind: "crew-worktree", project: "harbor-api", task: rate.id, repo: harbor, base: "main", baseCommit: head, branch: `crew/${rate.id}`, path: join(wt, rate.id), head, run: rate.id, kept: [], history: [], createdAt: new Date().toISOString(), removedAt: null }));
  // a website output in harbor-api
  const art = new ArtifactStore(DATA);
  if (!art.get("export-api-docs")) {
    art.create({ id: "export-api-docs", title: "Export API docs site", type: "web", project: "harbor-api", source: "html", entry: "index.html" });
    const src = join(repos, "site"); mkdirSync(src); writeFileSync(join(src, "index.html"), "<!doctype html><title>docs</title><h1>Export API</h1>");
    try { art.addVersion("export-api-docs", { from: src, primary: "index.html", createdBy: { kind: "agent" } as any, status: "approved", summary: "first", source: { run: merged.id } }); } catch {}
  }
  H.stop();
  return { data: DATA, harbor, tide, broken, runs: { merged: merged.id, rate: rate.id, onboard: onboard.id, loose: loose.id } };
}

if (import.meta.main) { const s = await seedProjects(); console.log(JSON.stringify(s)); }
