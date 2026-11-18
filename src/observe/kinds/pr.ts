// Pull requests (pr:owner/repo#1645): Studio's pull request list as the board's #/prs page reads it (prWatch.view(), the
// /api/prs route's own shaping), open ones in the captain's order and merged ones followed until production. Reading never
// asks GitHub: it is the last snapshot. Nothing here writes to GitHub, nor to Studio's own list.
import { refOf, registerKind, seqCursor, type Entity, type Sources } from "../registry";
import { eventView, readEvents, retroStore } from "../events";

const viewOf = (s: Sources): any => { try { return s.prs?.()?.view() ?? null; } catch { return null; } };
const snapOf = (s: Sources): any => { try { return (s.prs?.() as any)?.snapshot ?? null; } catch { return null; } };
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function openData(r: any) {
  return { id: r.id, repo: r.repo, number: r.number, url: r.url, tab: "open", draft: r.draft, base: r.base, author: r.author, position: r.position, group: r.group ?? null, project: r.project?.id ?? null,
    ci: r.ci ?? null, next: r.next, approvals: r.approvals ? { readable: r.approvals.readable, required: r.approvals.required, counted: r.approvals.counted, missing: r.approvals.missing, blocked: !!r.approvals.blocked } : null,
    reviews: (r.reviews ?? []).map((x: any) => ({ login: x.login, state: x.state, stale: x.stale })), evidence: r.evidence ?? null, envs: r.envs ?? [], deps: r.deps?.on ?? [], createdAt: r.createdAt ?? null, title: r.title };
}
function mergedData(r: any) {
  return { id: r.id, repo: r.repo, number: r.number, url: r.url, tab: r.tab, base: r.base, author: r.author, project: r.project?.id ?? null, mergedAt: r.mergedAt, mergeSha: r.mergeSha,
    ship: r.ship ? { live: r.ship.live, waits: r.ship.waits, noProduction: r.ship.noProduction, liveAt: r.ship.liveAt, manual: !!r.ship.manual } : null,
    envs: (r.envs ?? []).map((e: any) => ({ name: e.name, on: e.on, production: e.production, pods: (e.pods ?? []).map((p: any) => ({ service: p.service, repository: p.repository, path: p.path, tag: p.tag, on: p.on })) })),
    deps: r.deps ?? [], ops: (r.ops ?? []).map((o: any) => ({ kind: o.kind, path: o.path, url: o.url, quote: o.quote ?? o.heading ?? null })), title: r.title };
}
/** Where a merged pull request waits before production, as one Studio line: the environment and the pods not yet on it. */
export function waitsAt(d: any): string | null {
  if (!d?.ship || d.ship.live) return null; const env = (d.envs ?? []).find((e: any) => e.name === d.ship.waits); if (!env) return d.ship.noProduction ? "no production environment is set" : null;
  const off = (env.pods ?? []).filter((p: any) => p.on !== true).map((p: any) => `${p.service}${p.tag ? ` (${p.tag})` : ""}`);
  return `${env.name}${off.length ? `: ${off.join(", ")}` : ""}`;
}
const entity = (s: Sources, d: any): Entity => ({ id: d.id, title: `${d.id} (${d.tab})`, updatedAt: d.mergedAt ?? d.createdAt ?? null, project: d.project ?? null,
  data: { ...d, ...(d.tab !== "open" ? { waitsAt: waitsAt(d) } : {}) },
  full: () => { const raw = (snapOf(s)?.rows ?? []).find((x: any) => eq(x.id, d.id)) ?? (snapOf(s)?.merged ?? []).find((x: any) => eq(x.id, d.id));
    return { ...d, ...(d.tab !== "open" ? { waitsAt: waitsAt(d) } : {}), body: raw?.facts?.body ?? raw?.body ?? null, labels: raw?.labels ?? [], headRef: raw?.headRef ?? null }; } });
const all = (s: Sources): any[] => { const v = viewOf(s); if (!v) return []; return [...(v.rows ?? []).map(openData), ...(v.merged ?? []).map(mergedData)]; };

registerKind({
  kind: "pr", route: "#/prs", listRoute: "#/prs", idPattern: /^[\w.-]+\/[\w.-]+#\d+$/, idExample: "owner/repo#1645",
  about: "A watched pull request: CI, approvals, reviews, evidence, dependencies and the next step; a merged one until production, with the environment and pods it waits on. Studio's last snapshot; never reads GitHub.",
  scope: (e) => e.project ?? null, grantable: true, viewer: "desktop",
  filters: { tab: { type: "string", description: "open, merged (merged but not live), live or all (default)", enum: ["open", "merged", "live", "all"] }, repo: { type: "string", description: "owner/repo" } },
  fields: [
    ...["id", "repo", "number", "url", "tab", "draft", "base", "author", "position", "group", "project", "ci", "next", "approvals", "reviews", "evidence", "envs", "deps", "createdAt",
      "mergedAt", "mergeSha", "ship", "waitsAt", "ops[].kind", "ops[].path", "ops[].url", "headRef", "withheld"].map((path) => ({ path, trust: "studio" as const })),
    { path: "title", trust: "untrusted", source: "the pull request's title (GitHub)" },
    { path: "body", trust: "untrusted", source: "the pull request's description (GitHub)" },
    { path: "labels", trust: "untrusted", source: "the pull request's labels (GitHub)" },
    { path: "ops[].quote", trust: "untrusted", source: "a line of the pull request's description (GitHub)" },
  ],
  // studio_logs pr:…: its go-live timeline in Studio's log (merged, live or partly live per environment, drift, the captain's
  // marks and incidents), oldest first, after `since`
  logs: (s, id, o) => { const d = all(s).find((x) => eq(x.id, id)); if (!d) return null;
    const { hits } = readEvents(s, { since: o.since, kinds: null, ref: refOf("pr", d.id) }), store = retroStore(s);
    return { cursor: hits.length ? seqCursor(hits.at(-1)!.seq) : o.since, updatedAt: d.mergedAt ?? null, data: { tab: d.tab, waitsAt: d.tab !== "open" ? waitsAt(d) : null, events: hits.slice(-o.tail).map((e) => eventView(s, e, store)), total: hits.length } }; },
  logFields: ["tab", "waitsAt", "events", "total"].map((path) => ({ path, trust: "studio" as const })),
  list: (s, filter) => all(s).filter((d) => (!filter.tab || filter.tab === "all" || d.tab === filter.tab) && (!filter.repo || eq(d.repo, String(filter.repo)))).map((d) => entity(s, d)),
  get: (s, id) => { const d = all(s).find((x) => eq(x.id, id)); return d ? entity(s, d) : null; },
});
