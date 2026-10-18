// "Grant Studio merge for <owner/repo>": the only writer of a project's merge permission (the operations grant on its GitHub
// grant, adapters/github.ts RemoteOperations). The merge card's missing-grant state links to the project's GitHub settings,
// which propose it; Firstmate (studio_connect_github with merge: true) may propose it too, never answer it. One captain-only card
// says what Studio then does (merges, for this one repository, pull requests it opened, after every gate passed at the head
// and the captain confirms that merge on its own card), what it never does (merge without that confirmation, push the base
// branch, change branch protection), the merge method (one button per method the repository allows, its default first), and
// that it is revocable. Before the card, one read-only request checks the GitHub token's access (adapters/github.ts
// mergeAccess); a token missing what merging needs gets a card that says what is missing, and nothing is granted.
// The captain's grant re-signs the project's grant with the operations added (github-grant.ts grantSignature, the way Connect
// to GitHub signs it), compare-and-set on the registry the card was proposed from, and records grant-merge (repository,
// method, the captain's answer seq). Revoking (the same workflow, action revoke) re-signs it without them and records
// revoke-merge. After either, the open merge cards on that project are prepared again under the new grant (code.ts).
//   workflows/v2/firstmate-grant-merge.wf.yaml
import { createHash } from "node:crypto";
import { bundledText } from "./bundled";
import { normalize } from "./runtime/defs";
import { grantSignature, verifyGitHubGrant } from "./github-grant";
import { findToken } from "./github";
import { GitHubPrAdapter, MERGE_METHODS, type GitHubProjectGrant, type MergeAccess, type MergeMethod } from "./adapters/github";
import type { Engine, X } from "./runtime/engine";
import type { Projects } from "./doors";

export const MERGE_GRANT_WORKFLOW = "firstmate-grant-merge";
const canonical = (v: any): string => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v ?? null);
const pin = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
const CAPTAIN = /^captain\b/i;

export type MergeGrantAction = "grant" | "revoke";
export type MergeGrantProposal = { schema: 1; action: MergeGrantAction; project: string; name: string; repository: string; base: string; branchPrefix: string;
  registry: { exists: boolean; digest: string }; grant: string; current: { method: MergeMethod; approvalId: string; approvedAt: string } | null };

/** What granting (or revoking) Studio's merge for this project would change; throws why it cannot be proposed. */
export function proposeMergeGrant(projects: Projects, id: string, action: MergeGrantAction): MergeGrantProposal {
  if (action !== "grant" && action !== "revoke") throw new Error("Choose grant or revoke");
  const snap = projects.nativeSnapshot(), p = snap.records.find((r) => r.id === id);
  if (!p) throw new Error("Choose a registered project");
  if (!p.github) throw new Error("This project is not connected to GitHub: connect it first (Connect to GitHub)");
  try { verifyGitHubGrant(projects.dataDir, p); } catch (e: any) { throw new Error(`This project's GitHub grant does not verify (${String(e?.message ?? e)}): connect it again first`); }
  const g = p.github, op = g.operations;
  if (action === "grant" && op) throw new Error(`Studio already merges for ${g.repository} (${op.mergeMethod}); revoke it first to change the method`);
  if (action === "revoke" && !op) throw new Error(`Studio does not merge for ${g.repository}; there is nothing to revoke`);
  return { schema: 1, action, project: id, name: p.name, repository: g.repository, base: g.base, branchPrefix: g.branchPrefix, registry: { exists: snap.exists, digest: snap.digest }, grant: pin(g),
    current: op ? { method: op.mergeMethod, approvalId: op.approvalId, approvedAt: op.approvedAt } : null };
}

/** Starts (or returns the open) captain card for granting or revoking Studio's merge on this project. */
export function startMergeGrant(engine: Engine, projects: Projects, id: string, action: MergeGrantAction, by: string) {
  const proposal = proposeMergeGrant(projects, id, action), def = engine.defs.get(MERGE_GRANT_WORKFLOW, 1);
  if (!def) throw new Error("The merge grant workflow is missing");
  const params = { project: id, action, proposal: JSON.stringify(proposal) };
  const open = engine.list().find((r) => r.workflow === MERGE_GRANT_WORKFLOW && r.params.project === id && !["succeeded", "failed", "cancelled"].includes(r.status));
  if (open && open.params.proposal === params.proposal) return open;
  // only the captain replaces an open card with a different proposal; Firstmate's proposal leaves the open one as it is (a card
  // proposed on an older registry refuses its own write and says to propose it again)
  if (open && !CAPTAIN.test(by)) return open;
  if (open) engine.cancel(open.id);
  const verb = action === "grant" ? "Grant" : "Revoke";
  return engine.start({ workflow: MERGE_GRANT_WORKFLOW, version: def.version, text: `${verb} Studio merge for ${proposal.repository}`, title: `${verb} Studio merge for ${id}`, params, by } as any);
}

/** Why the probe could not read the token's access, by class (never GitHub's text, never the token). */
const probeFailure = (e: any, repo: string): { en: string; zh: string } => {
  const m = String(e?.message ?? e ?? "");
  if (/authentication is required/.test(m)) return { en: "a GitHub token: Studio has none (CREW_GITHUB_TOKEN, a token saved in Studio, or gh auth token)", zh: "GitHub 權杖：Studio 沒有任何權杖（CREW_GITHUB_TOKEN、存在 Studio 的權杖，或 gh auth token）" };
  if (/^GitHub 401\b/.test(m)) return { en: "a valid GitHub token: GitHub refused the token (401)", zh: "有效的 GitHub 權杖：GitHub 拒絕了這個權杖（401）" };
  if (/^GitHub (403|404)\b/.test(m)) return { en: `access to ${repo}: GitHub does not show the repository to this token (${m.slice(7, 10)})`, zh: `${repo} 的存取權：GitHub 沒有讓這個權杖看到這個儲存庫（${m.slice(7, 10)}）` };
  if (/another repository/.test(m)) return { en: `the granted repository: GitHub answered for another repository than ${repo}`, zh: `授權的儲存庫：GitHub 回覆的不是 ${repo}` };
  return { en: "an answer from GitHub: it could not be reached (check again later)", zh: "GitHub 的回覆：目前連不上（稍後再檢查）" };
};

export function installMergeGrant(engine: Engine, projects: Projects) {
  const source = normalize(JSON.parse(bundledText(`workflows/v2/${MERGE_GRANT_WORKFLOW}.wf.yaml`) || "null"));
  const checked = (x: X): MergeGrantProposal => {
    if (x.run.def.id !== MERGE_GRANT_WORKFLOW || pin(x.run.def.nodes) !== pin(source.nodes) || pin(x.run.def.edges) !== pin(source.edges)) throw new Error("The installed merge grant workflow changed");
    const asked = JSON.parse(x.run.params.proposal) as MergeGrantProposal, now = proposeMergeGrant(projects, x.run.params.project, asked.action);
    if (asked.project !== x.run.params.project || asked.action !== x.run.params.action || pin(asked) !== pin(now)) throw new Error("The project, its GitHub grant or the registry changed; propose it again");
    return now;
  };
  // only the captain answers this card, every option: Firstmate may propose it, never answer it (nor close it), and an
  // authorization window never answers a captain-only card
  const previous = engine.deps.authorizeAnswer;
  engine.deps.authorizeAnswer = (run: any, card: any, answer: any) => {
    previous?.(run, card, answer);
    if (run?.workflow === MERGE_GRANT_WORKFLOW && card?.node === "card" && !CAPTAIN.test(String(answer?.by ?? ""))) throw new Error("Only the captain grants or revokes Studio merge; Firstmate may only propose it");
  };
  const access = async (x: X, p: MergeGrantProposal): Promise<MergeAccess> => {
    const record = projects.nativeSnapshot().records.find((r) => r.id === p.project)!;
    const { signature: _s, operations: _o, ...plain } = record.github as GitHubProjectGrant;
    const a = new GitHubPrAdapter(plain as GitHubProjectGrant, () => findToken(projects.dataDir).token, 15_000);
    try { return await a.mergeAccess(engine.abortOf?.(x.run)?.signal); }
    catch (e) { return { missing: [probeFailure(e, p.repository)], methods: null, preferred: "squash", role: null, token: "other", scopes: null, unseen: null }; }
  };
  const lines = (xs: { en: string; zh: string }[], l: "en" | "zh") => xs.map((m) => m[l]).join(l === "en" ? "; " : "；");
  engine.actions["github.merge-grant-card"] = async (x) => {
    const p = checked(x), repo = p.repository;
    if (p.action === "revoke") {
      const c = p.current!;
      await engine.card(x, "permission", { captainOnly: true, title: `Revoke Studio merge for ${repo}?`, zhTitle: `撤銷 Studio 對 ${repo} 的合併權限嗎？`,
        en: { why: `Studio then stops merging pull requests in ${repo}: each merge card offers merging on GitHub again. You granted it ${c.approvedAt} with the ${c.method} method. Pushing Task branches and opening pull requests stay as they are.`, how: "Revoke to write the signed grant without the merge permission, or close and keep it." },
        zh: { why: `之後 Studio 不再合併 ${repo} 的 pull request：每張合併卡片會改回請你到 GitHub 合併。你在 ${c.approvedAt} 以 ${c.method} 方式授權。推送任務分支和開 pull request 維持不變。`, how: "撤銷就寫入不含合併權限的簽章授權，或關閉、保留權限。" },
        body: [`Project / 專案: ${p.project} (${p.name})`, `GitHub repository / GitHub 儲存庫: ${repo}`, `Merge method granted / 已授權的合併方式: ${c.method} (${c.approvalId})`, "", "Revoking removes Studio's merge permission for this repository only.", "撤銷只移除 Studio 對這個儲存庫的合併權限。"].join("\n"),
        options: [{ id: "revoke", label: "Revoke Studio merge", labelZh: "撤銷 Studio 合併", primary: true }, { id: "close", label: "Close and keep it", labelZh: "關閉，保留權限", hold: true }] });
      return { wait: true };
    }
    const got = await access(x, p); checked(x);
    if (got.missing.length) {
      const c = await engine.card(x, "permission", { captainOnly: true, title: `Studio cannot get merge permission for ${repo} yet`, zhTitle: `Studio 目前還無法取得 ${repo} 的合併權限`,
        en: { why: `Studio checked the GitHub token with one read-only request to ${repo}. Missing: ${lines(got.missing, "en")}. Nothing was granted.`, how: "Fix it on GitHub (or give Studio another token), then check again. Or close without granting." },
        zh: { why: `Studio 用一次唯讀請求到 ${repo} 檢查了 GitHub 權杖。缺少：${lines(got.missing, "zh")}。沒有授權任何東西。`, how: "到 GitHub 修好（或給 Studio 另一個權杖），再重新檢查。或者關閉、不授權。" },
        body: [`GitHub repository / GitHub 儲存庫: ${repo}`, "", "Missing:", ...got.missing.map((m) => `- ${m.en}`), "缺少：", ...got.missing.map((m) => `- ${m.zh}`), "", "Nothing was granted. 沒有授權任何東西。"].join("\n"),
        options: [{ id: "check", label: "Check again", labelZh: "重新檢查", primary: true }, { id: "close", label: "Close without granting", labelZh: "關閉，不授權", hold: true }] });
      engine.record(x, "merge-access-probe", { data: { schema: 1, card: c.id, project: p.project, repository: repo, missing: got.missing.map((m) => m.en), methods: got.methods, preferred: got.preferred, role: got.role, token: got.token, scopes: got.scopes } } as any);
      return { wait: true };
    }
    const methods = got.methods ?? MERGE_METHODS, order = [got.preferred, ...methods.filter((m) => m !== got.preferred)];
    const shown = got.methods ? `${repo} allows ${methods.join(", ")}; ${got.preferred} is offered first.` : `GitHub did not show which merge methods ${repo} allows; each merge checks it again before it is sent.`;
    const shownZh = got.methods ? `${repo} 允許 ${methods.join("、")}；先列出 ${got.preferred}。` : `GitHub 沒有顯示 ${repo} 允許哪些合併方式；每次合併前都會再檢查一次。`;
    const role = `GitHub shows the token's ${got.role} access to ${repo}${got.scopes ? ` with the ${got.scopes.join(", ")} scope${got.scopes.length === 1 ? "" : "s"}` : ""}.`;
    const roleZh = `GitHub 顯示這個權杖對 ${repo} 有 ${got.role} 權限${got.scopes ? `（scope：${got.scopes.join("、")}）` : ""}。`;
    const c = await engine.card(x, "permission", { captainOnly: true, title: `Grant Studio merge for ${repo}?`, zhTitle: `授權 Studio 合併 ${repo} 嗎？`,
      en: { why: `Studio then merges pull requests it opened in ${repo}, only after every Studio gate passed at the pull request's head and you confirm that merge on its own merge card. ${role}`, how: "Pick the merge method to grant it, or close without granting. You can revoke it any time from the project's GitHub settings.",
        scope: { in: [`Merge pull requests Studio opened in ${repo}, after every gate passed at the head and you confirm each merge on its card`, `With the merge method you pick (${order.join(", ")})`], out: ["Merging without your confirmation on each pull request's merge card", `Pushing to ${p.base}, or pushing anything new: pushes stay as Connect granted them (Task branches under ${p.branchPrefix}, or a branch name you approve on its card)`, "Changing branch protection or repository settings", "Any other repository"] } },
      zh: { why: `之後 Studio 會合併它在 ${repo} 開的 pull request，但只在 Studio 的每一道關卡都在該 PR 的 head 通過、並且你在那張合併卡片上確認之後。${roleZh}`, how: "選一個合併方式來授權，或關閉、不授權。之後隨時可以在專案的 GitHub 設定撤銷。",
        scope: { in: [`合併 Studio 在 ${repo} 開的 pull request：每道關卡在 head 通過，且你在每張合併卡片上確認`, `使用你選的合併方式（${order.join("、")}）`], out: ["沒有你在每個 pull request 合併卡片上的確認就合併", `推送到 ${p.base}，或任何新的推送：推送維持「連到 GitHub」授權的範圍（${p.branchPrefix} 下的任務分支，或你在卡片上核准的分支名稱）`, "更改分支保護或儲存庫設定", "任何其他儲存庫"] } },
      body: [`Project / 專案: ${p.project} (${p.name})`, `GitHub repository / GitHub 儲存庫: ${repo}`, "",
        `Studio will: merge pull requests it opened in ${repo}, after every gate passed at the head and your confirmation on that pull request's merge card.`, `Studio 會：合併它在 ${repo} 開的 pull request，條件是每道關卡在 head 通過，並且你在該 pull request 的合併卡片上確認。`, "",
        `Studio never: merges without your confirmation on each merge card; pushes to ${p.base}; changes branch protection.`, `Studio 不會：沒有你在每張合併卡片上的確認就合併；推送到 ${p.base}；更改分支保護。`, "",
        `Merge method / 合併方式: ${shown}`, shownZh, "", role, roleZh, ...(got.unseen ? [got.unseen.en, got.unseen.zh] : []), "",
        "Revocable: revoke it any time from the project's GitHub settings; each merge card then offers merging on GitHub again.", "可撤銷：隨時可以在專案的 GitHub 設定撤銷；之後每張合併卡片會改回請你到 GitHub 合併。"].join("\n"),
      options: [...order.map((m) => ({ id: `grant-${m}`, label: `Grant merge (${m})`, labelZh: `授權合併（${m}）`, primary: m === got.preferred })), { id: "close", label: "Close without granting", labelZh: "關閉，不授權", hold: true }] });
    engine.record(x, "merge-access-probe", { data: { schema: 1, card: c.id, project: p.project, repository: repo, missing: [], methods: got.methods, preferred: got.preferred, role: got.role, token: got.token, scopes: got.scopes } } as any);
    return { wait: true };
  };
  engine.actionAnswers["github.merge-grant-card"] = async (x, card) => {
    const choice = card.answer?.choice ?? "close";
    // check again: the token read again (read only), and a fresh card
    if (choice === "check") { const r = await engine.actions["github.merge-grant-card"](x); return typeof r === "string" ? { outcome: r } : r; }
    return { outcome: choice.startsWith("grant-") ? "grant" : choice };
  };
  /** The captain's own answer on this run's card, from Studio's signed ledger; throws when it is not there. */
  const captainAnswer = (x: X, ok: (choice: string) => boolean) => {
    const card = engine.cards.list({ run: x.run.id }).filter((c) => c.node === "card" && c.status === "answered").at(-1), trusted = engine.trusted(x.run.id);
    const entry: any = card && trusted.entries.filter((e: any) => e.record === "card-answer" && e.data?.card === card.id).at(-1);
    if (!card?.captainOnly || !trusted.ok || !entry || !ok(entry.data?.choice) || entry.data.choice !== card.answer?.choice || !CAPTAIN.test(String(entry.actor ?? "")) || !CAPTAIN.test(String(card.answer?.by ?? "")) || !engine.owns(x) || x.cancelled())
      throw new Error("The captain's answer on this merge grant card is unavailable");
    return { card, entry, trusted };
  };
  /** The project's grant, signed again over the change, written compare-and-set on the registry the card was proposed from. */
  const write = (p: MergeGrantProposal, next: GitHubProjectGrant) => {
    const record = projects.nativeSnapshot().records.find((r) => r.id === p.project)!;
    const { signature: _s, ...unsigned } = next;
    const grant: GitHubProjectGrant = { ...unsigned, signature: grantSignature(projects.dataDir, { id: record.id, path: record.path, base: record.base }, unsigned) };
    projects.setGitHubGrantCAS(p.registry, p.project, grant);
    projects.assertExecutable({ project: p.project, base: record.base });
    return grant;
  };
  /** The open merge cards on the project, prepared again under the new grant (code.ts); never fails the grant itself. */
  const refresh = async (project: string) => {
    const out: string[] = [];
    for (const h of engine.grantChanged ?? []) try { out.push(...await h(project)); } catch (e: any) { out.push(`merge cards not refreshed (${String(e?.message ?? e).slice(0, 200)})`); }
    return out.length ? `; ${out.join("; ")}` : "";
  };
  engine.actions["github.merge-grant-write"] = async (x) => {
    const p = checked(x), current = projects.nativeSnapshot().records.find((r) => r.id === p.project)!.github!;
    if (p.action === "revoke") {
      const { card, entry } = captainAnswer(x, (c) => c === "revoke");
      const { operations: old, ...rest } = current;
      const grant = write(p, rest as GitHubProjectGrant);
      engine.record(x, "revoke-merge", { actor: String(entry.actor), data: { schema: 1, project: p.project, repository: p.repository, method: old?.mergeMethod ?? null, revoked: old?.approvalId ?? null, card: card.id, answerSeq: entry.seq, grant: pin(grant) } } as any);
      x.rn.note = `Studio no longer merges for ${p.repository}${await refresh(p.project)}`; return "ok";
    }
    const { card, entry, trusted } = captainAnswer(x, (c) => typeof c === "string" && c.startsWith("grant-"));
    const method = String(entry.data.choice).slice("grant-".length) as MergeMethod;
    // the method is one the card offered after a probe that found nothing missing (Studio's own record of that probe)
    const probe: any = trusted.entries.filter((e: any) => e.record === "merge-access-probe" && e.data?.card === card.id).at(-1);
    if (!MERGE_METHODS.includes(method) || !probe || probe.data.missing?.length || (probe.data.methods && !probe.data.methods.includes(method)) || !card.options.some((o) => o.id === `grant-${method}`)) throw new Error("The merge method is not one the token check allowed on this card");
    const grant = write(p, { ...current, operations: { version: 1, repository: current.repository, approvalId: `${x.run.id}/${card.id}`, approvedAt: card.answer!.at, mergeMethod: method, enableRealWrites: true } });
    engine.record(x, "grant-merge", { actor: String(entry.actor), data: { schema: 1, project: p.project, repository: p.repository, method, card: card.id, answerSeq: entry.seq, approvalId: grant.operations!.approvalId, grant: pin(grant) } } as any);
    x.rn.note = `Studio merges for ${p.repository} (${method}) after each merge card's confirmation${await refresh(p.project)}`; return "ok";
  };
}
