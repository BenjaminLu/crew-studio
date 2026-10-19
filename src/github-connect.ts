// "Connect <project> to GitHub <owner/repo>": the only writer of a project's GitHub grant.
// Firstmate (studio_connect_github) or the Projects page proposes it for a registered local
// project whose origin is a github.com repository; a captain-only card shows the repository,
// push URL, base, branch prefix and what the grant allows; only the captain's Approve writes
// the signed grant (github-grant.ts), compare-and-set on the registry it was proposed from.
// The grant allows pushing Task branches (force-with-lease, each on its own branch) and
// opening pull requests; merging on GitHub stays off (no operations grant).
// The grant is part of the project's staffing identity, so the same Approve carries the
// project's approved crew over to the connected identity (same picks, signed, recorded):
// connecting never orphans an approved crew or asks for a fresh staffing interview.
//   workflows/v2/firstmate-connect-github.wf.yaml
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { bundledText } from "./bundled";
import { normalize } from "./runtime/defs";
import { Policies } from "./runtime/checks";
import { githubSlugOf, grantSignature, originOf, verifyGitHubGrant } from "./github-grant";
import type { Engine, X } from "./runtime/engine";
import type { Projects } from "./doors";
import type { GitHubProjectGrant } from "./adapters/github";
import { StaffingStore, staffingHash, type StaffingConfig, type StaffingDraft, type StaffingProject } from "./domain/staffing";

export const CONNECT_WORKFLOW = "firstmate-connect-github";
const canonical = (v: any): string => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v ?? null);
const pin = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");

export type ConnectProposal = { schema: 1; project: string; name: string; origin: string; registry: { exists: boolean; digest: string };
  grant: Omit<GitHubProjectGrant, "approvedAt" | "approvalId" | "signature" | "operations"> };

/** What connecting this project would grant, from its registration and its origin; throws why it cannot be connected. */
export function proposeGitHubGrant(projects: Projects, id: string): ConnectProposal {
  const snap = projects.nativeSnapshot(), p = snap.records.find((r) => r.id === id);
  if (!p?.path) throw new Error("Choose a registered project with a local repository");
  if (p.enabled !== undefined && p.enabled !== true) throw new Error("This project is disabled");
  if (p.github) { let ok = false; try { verifyGitHubGrant(projects.dataDir, p); ok = true; } catch {} if (ok) throw new Error(`This project is already connected to GitHub ${p.github.repository}`); }
  const origin = originOf(p.path), slug = githubSlugOf(origin.url);
  if (!slug) throw new Error("This project's origin is not a github.com repository");
  if (origin.pushUrl !== null && origin.pushUrl !== origin.url) throw new Error("This project's origin pushes somewhere else than it fetches");
  const prefix = new Policies(projects.dataDir).get("branch_prefix", { project: id }).value ?? "crew/";
  if (typeof prefix !== "string" || !prefix.endsWith("/")) throw new Error("The project's branch prefix must end with /");
  return { schema: 1, project: id, name: p.name, origin: origin.url!, registry: { exists: snap.exists, digest: snap.digest },
    grant: { mode: "github", repository: slug, localPath: p.path, pushUrl: `https://github.com/${slug}.git`, apiOrigin: "https://api.github.com", base: p.base, branchPrefix: prefix } };
}

/** Starts (or returns the open) captain card for connecting this project. */
export function startGitHubConnect(engine: Engine, projects: Projects, id: string, by: string) {
  const proposal = proposeGitHubGrant(projects, id), def = engine.defs.get(CONNECT_WORKFLOW, 1);
  if (!def) throw new Error("The GitHub connect workflow is missing");
  const params = { project: id, proposal: JSON.stringify(proposal) };
  const open = engine.list().find((r) => r.workflow === CONNECT_WORKFLOW && r.params.project === id && !["succeeded", "failed", "cancelled"].includes(r.status));
  if (open && open.params.proposal === params.proposal) return open;
  if (open) engine.cancel(open.id);
  return engine.start({ workflow: CONNECT_WORKFLOW, version: def.version, text: `Connect ${proposal.name} to GitHub ${proposal.grant.repository}`, title: `Connect ${id} to GitHub`, params, by } as any);
}

export function installGitHubConnect(engine: Engine, projects: Projects, o: { staffingProject?: (id: string) => StaffingProject } = {}) {
  const store = new StaffingStore(engine.deps.dataDir);
  /** The project's approved crew before the grant changes its identity; null when it has none. */
  const crewBefore = (id: string): { project: StaffingProject; config: StaffingConfig } | null => {
    if (!o.staffingProject) return null;
    try { const project = o.staffingProject(id); return { project, config: store.current(project) }; } catch { return null; }
  };
  /** The approved crew, re-signed for the connected identity, approved by the captain's connect answer. Never replaces a crew the new identity already has. */
  const carryCrew = (x: X, card: { id: string }, before: { project: StaffingProject; config: StaffingConfig }) => {
    const after = o.staffingProject!(x.run.params.project);
    if (staffingHash(after) === staffingHash(before.project)) return null;
    try { store.current(after); return null; } catch {}
    const { version: _v, previous: _p, approval: _a, hash: _h, signature: _s, ...body } = before.config;
    const draft = { ...body, project: after } as StaffingDraft;
    const sources: Record<string, string> = {};
    for (const r of Object.values(draft.roles)) try { sources[r.skill.ref] = store.skill(r.skill, before.project); } catch {}
    const answer = engine.ledger(x.run.id).find((e) => e.record === "card-answer" && e.data?.card === card.id && e.data?.choice === "approve");
    const carried = store.approve(draft, null, { run: x.run.id, card: card.id, answerSeq: answer!.seq }, sources);
    engine.record(x, "staffing-carried", { data: { schema: 1, project: x.run.params.project, from: before.config.hash, to: carried.hash, version: carried.version, workflow: carried.workflow } } as any);
    return carried;
  };
  const source = normalize(JSON.parse(bundledText(`workflows/v2/${CONNECT_WORKFLOW}.wf.yaml`) || "null"));
  const checked = (x: X): ConnectProposal => {
    if (x.run.def.id !== CONNECT_WORKFLOW || pin(x.run.def.nodes) !== pin(source.nodes) || pin(x.run.def.edges) !== pin(source.edges)) throw new Error("The installed GitHub connect workflow changed");
    const asked = JSON.parse(x.run.params.proposal) as ConnectProposal, now = proposeGitHubGrant(projects, x.run.params.project);
    if (asked.project !== x.run.params.project || pin(asked) !== pin(now)) throw new Error("The project, its origin or the registry changed; propose the connection again");
    return now;
  };
  engine.actions["github.connect-card"] = async (x) => {
    const p = checked(x), g = p.grant;
    await engine.card(x, "permission", { captainOnly: true, title: `Connect ${p.project} to GitHub ${g.repository}?`, zhTitle: `把專案「${p.project}」連到 GitHub 儲存庫「${g.repository}」嗎？`,
      en: { why: `Studio then pushes this project's Task branches to ${g.repository} and opens pull requests there. Each pull request still waits for your approval of its exact text.`, how: "Approve to write the signed grant, or close without connecting.",
        scope: { in: [`Push Task branches ${g.branchPrefix}<task> (force-with-lease, each on its own branch)`, `Open pull requests into ${g.base}`], out: [`Merging on GitHub (stays off)`, `Pushing ${g.base} or any branch outside ${g.branchPrefix}`, "Reviews, comments or any other repository"] } },
      zh: { why: `之後 Studio 會把這個專案的任務分支推到 ${g.repository}，並在那裡開 pull request。每個 pull request 的文字仍要你核准。`, how: "核准就寫入簽章授權，或關閉、不連線。",
        scope: { in: [`推送任務分支 ${g.branchPrefix}<task>（force-with-lease，只動各自的分支）`, `開 pull request 到 ${g.base}`], out: ["在 GitHub 合併（維持關閉）", `推送 ${g.base} 或 ${g.branchPrefix} 以外的分支`, "審查、留言或其他儲存庫"] } },
      body: `Project / 專案: ${p.project} (${p.name})\nLocal repository / 本機儲存庫: ${g.localPath}\nOrigin / 遠端: ${p.origin}\nGitHub repository / GitHub 儲存庫: ${g.repository}\nPush URL / 推送網址: ${g.pushUrl}\nBase / 基準分支: ${g.base}\nBranch prefix / 分支前綴: ${g.branchPrefix}\n\nAllowed / 允許: push Task branches (force-with-lease, each on its own branch only) and open pull requests into ${g.base}.\nNot allowed / 不允許: merging on GitHub (off until a separate operations grant enables real writes), pushing ${g.base} or other branches, reviews, comments, other repositories.\nToken / 權杖: Studio's GitHub token (CREW_GITHUB_TOKEN, a token saved in Studio, or gh auth token).`,
      options: [{ id: "approve", label: "Connect to GitHub", labelZh: "連到 GitHub", primary: true }, { id: "close", label: "Close without connecting", labelZh: "關閉，不連線", hold: true }] });
    return { wait: true };
  };
  engine.actions["github.connect-write"] = async (x) => {
    const p = checked(x);
    const card = engine.cards.list({ run: x.run.id }).find((c) => c.node === "connect" && c.status === "answered" && c.answer?.choice === "approve");
    const trusted = engine.trusted(x.run.id);
    if (!card?.captainOnly || !trusted.ok || !trusted.entries.some((e) => e.record === "card-answer" && e.data?.card === card.id && e.data?.choice === "approve") || !engine.owns(x) || x.cancelled()) throw new Error("The captain's approval of this connection is unavailable");
    const record = projects.nativeSnapshot().records.find((r) => r.id === p.project)!, crew = crewBefore(p.project);
    const grant: GitHubProjectGrant = { ...p.grant, approvedAt: card.answer!.at, approvalId: `${x.run.id}/${card.id}` };
    grant.signature = grantSignature(projects.dataDir, { id: record.id, path: record.path, base: record.base }, grant);
    projects.setGitHubGrantCAS(p.registry, p.project, grant);
    projects.assertExecutable({ project: p.project, base: record.base });
    engine.record(x, "github-grant-written", { data: { schema: 1, project: p.project, repository: grant.repository, localPath: realpathSync(grant.localPath), base: grant.base, branchPrefix: grant.branchPrefix, approvalId: grant.approvalId, grant: pin(grant) } } as any);
    let kept = "";
    if (crew) try { const c = carryCrew(x, card, crew); if (c) kept = `; its approved crew (${c.workflow.id} v${c.workflow.version}) carries over`; }
    catch (e: any) { kept = `; its approved crew did not carry over (${String(e?.message ?? e).slice(0, 200)}): confirm staffing again`; }
    x.rn.note = `${p.project} connected to GitHub ${grant.repository}${kept}`; return "ok";
  };
}
