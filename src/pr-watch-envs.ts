// Pull requests (docs/units/pr-watch.md "Find environments automatically"): proposing how each watched repository's
// environments are detected, without typing. Pure functions only: src/pr-watch.ts reads GitHub (read-only, budgeted)
// and passes what it read here. Nothing here writes anything; a proposal becomes settings only when the captain accepts.
//   - a GitHub environment name, or a path segment of a GitOps/config repository, → a named environment (prod,
//     production, prd, live → "production"; stg, stage → "staging"; …), production inferred and editable
//   - a manifest line naming an image built from a repository (the image's name matched against the repository's) → a
//     "file" detect with a one-line template around {tag}, kept only when Studio's own tag reader finds that very line
//   - one review table: each (repository, environment) with its candidates; one strong candidate and nothing set yet is
//     ticked, anything else needs a pick
import * as R from "./pr-watch-rules";

/** A known environment: its name in the settings, whether it is production, where it sits in the order. */
type Known = { name: string; production: boolean; rank: number };
const KNOWN: Record<string, Known> = {};
const norm = (s: string) => s.toLowerCase().replace(/[-_.]/g, "");
const known = (name: string, production: boolean, rank: number, ...aliases: string[]) => { for (const a of [name, ...aliases]) KNOWN[a] = { name, production, rank }; };
known("dev", false, 10, "develop", "development");
known("sandbox", false, 15);
known("test", false, 20, "testing");
known("qa", false, 25);
known("uat", false, 30);
known("staging", false, 40, "stage", "stg");
known("preprod", false, 50, "preproduction", "pre-prod", "pre-production", "pprd");
known("production", true, 90, "prod", "prd", "live");
const UNKNOWN_RANK = 60;

/** A GitHub environment's name as an environment of the settings: a known alias becomes its common name (so one
 *  "production" covers "prod" in one repository and "production" in another); any other name stays as it is, and is
 *  production when a part of it is (eu-prod, production-eu; not pre-prod or nonprod), as a path segment would be. */
export function envOfName(raw: string): Known {
  const k = KNOWN[String(raw ?? "").trim().toLowerCase()];
  return k ? { ...k } : { name: String(raw).trim().slice(0, 40), production: !!envOfPath(String(raw ?? "").replace(/\//g, "-"))?.production, rank: UNKNOWN_RANK };
}
export const rankOf = (name: string) => KNOWN[name.toLowerCase()]?.rank ?? UNKNOWN_RANK;

/** The environment a path names, e.g. overlays/prod/deployment.yaml, values-staging.yaml, envs/pre-prod/app.yaml.
 *  First a directory or file name that is exactly a known environment (the deepest one), so a service named live-feed
 *  or test-runner under staging/ stays staging; only then a part of a name (split at - _ .), with the watched
 *  repositories' names (`repos`, e.g. live-feed) taken out of it first, so values-shop-api-prod is still production.
 *  pre-prod is preprod, not prod; non-prod names nothing (only that part). Null when none does. */
export function envOfPath(path: string, repos: string[] = []): Known | null {
  const segs = String(path ?? "").split("/").filter(Boolean).map((s) => s.toLowerCase());
  if (segs.length) segs[segs.length - 1] = segs[segs.length - 1].replace(/\.(ya?ml|json)$/i, "");
  for (let i = segs.length - 1; i >= 0; i--) if (KNOWN[segs[i]]) return { ...KNOWN[segs[i]] };
  // a repository's name with any of - _ . (or none) between its letters, longest first
  const names = repos.map((r) => norm(String(r).split("/").pop() ?? "")).filter((r) => r.length >= 3).sort((a, z) => z.length - a.length)
    .map((r) => new RegExp([...r].map((c) => c.replace(/[^a-z0-9]/g, "\\$&")).join("[-_.]?"), "g"));
  for (let i = segs.length - 1; i >= 0; i--) {
    let seg = segs[i]; for (const re of names) seg = seg.replace(re, "-");
    seg = seg.replace(/(?:^|[-_.])non-?prod(?:uction)?(?=$|[-_.])/g, "-");
    if (/(?:^|[-_.])pre-?prod(?:uction)?(?:$|[-_.])/.test(seg)) return { ...KNOWN.preprod };
    for (const part of seg.split(/[-_.]/).reverse()) if (KNOWN[part]) return { ...KNOWN[part] };
  }
  return null;
}

/** How well an image reference (registry/path/name, no tag) names a repository: "strong" when its name or a path part
 *  is the repository's name (ignoring - _ . and case), "weak" when one holds the other (4 characters at least). */
export function imageMatch(image: string, repo: string): "strong" | "weak" | null {
  const name = norm(String(repo).split("/").pop() ?? ""); if (name.length < 2) return null;
  const parts = String(image).split("/"), path = parts.length > 1 && /[.:]|^localhost$/.test(parts[0]) ? parts.slice(1) : parts; // the registry host is no name
  const ns = path.map(norm).filter(Boolean); if (!ns.length) return null;
  if (ns.includes(name)) return "strong";
  const last = ns[ns.length - 1];
  if (Math.min(last.length, name.length) >= 4 && (last.includes(name) || name.includes(last))) return "weak";
  return null;
}

/** A manifest line that names an image of the repository: the template Studio would read the tag with. */
export type Finding = { line: number; text: string; template: string; tag: string; strength: "strong" | "weak"; problem: "no-commit" | "not-first" | "control" | null };
const TAGC = "[0-9A-Za-z._-]{1,128}";
// an image reference with its tag on one line: registry/path/name:tag (the tag up to a quote, space, comma or the end)
const INLINE = new RegExp(`(?:^|[\\s"'=\\[,])((?:[A-Za-z0-9.-]+(?::\\d+)?/)?(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+):(${TAGC})(?=$|[\\s"',\\]}])`, "g");
// the image named on one line and its tag on a line after it (Helm values repository/tag, kustomize name/newTag)
const NAMED = /^\s*-?\s*["']?(repository|name|newName|image)["']?\s*:\s*["']?([A-Za-z0-9./_:-]+?)["']?\s*,?\s*$/;
const TAGLINE = new RegExp(`^(\\s*-?\\s*)(["']?(?:tag|newTag|imageTag)["']?\\s*:\\s*)(["']?)(${TAGC})(["']?)\\s*,?\\s*(?:#.*)?$`);

/**
 * Every line of a manifest that names an image built from the repository, with the one-line template around its tag.
 * A template is kept as usable only when Studio's own reader (tagAt) finds that very line first; a tag that does not end
 * in a commit cannot say which commit runs, so it is shown with its problem, never ticked.
 */
export function scanManifest(text: string, repo: string): Finding[] {
  const lines = String(text ?? "").slice(0, 200000).split(/\r?\n/, 5000), out: Finding[] = [];
  const add = (n: number, pre: string, tag: string, post: string, strength: "strong" | "weak") => {
    const template = `${pre}{tag}${post}`; if (R.templateProblem(template)) return;
    const at = R.tagAt(text, template);
    if (out.some((f) => f.template === template && f.line === n + 1)) return;
    out.push({ line: n + 1, text: lines[n].trim().slice(0, 300), template, tag, strength, problem: /[\u0000-\u001f]/.test(template) ? "control" : !at || at.line !== n || at.tag !== tag ? "not-first" : R.commitOfTag(tag) ? null : "no-commit" }); };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]; if (line.length > 500) continue;
    for (const m of line.matchAll(INLINE)) {
      const ref = m[1], tag = m[2]; if (/^https?$/i.test(ref) || !ref.includes("/") && !/image/i.test(line)) continue;
      const strength = imageMatch(ref, repo); if (!strength) continue;
      const start = line.length - line.trimStart().length, tagAt = m.index! + m[0].length - tag.length;
      const q = line[tagAt + tag.length], post = q === '"' || q === "'" ? q : "";
      add(n, line.slice(start, tagAt), tag, post, strength);
    }
    const named = NAMED.exec(line); if (!named || (named[2].split("/").pop() ?? "").includes(":")) continue; // a tag on this line: read above
    const strength = imageMatch(named[2], repo); if (!strength) continue;
    for (let k = n + 1; k < Math.min(lines.length, n + 5); k++) {
      const t = TAGLINE.exec(lines[k]); if (!t) { if (NAMED.test(lines[k])) break; continue; }
      add(k, t[2] + t[3], t[4], t[3] && t[5] === t[3] ? t[3] : "", strength); break; }
  }
  return out;
}

// ---------- the proposal ----------
export type Candidate = { id: string; source: "deployment" | "file"; detect: R.EnvDetect; strength: "strong" | "weak"; problem: Finding["problem"];
  /** what Studio saw: a deployment's ref and commit (text, and tw in Traditional Chinese), or the manifest line; and
   *  where to see it on GitHub */ evidence: { path: string | null; line: number | null; text: string; tw?: string; url: string | null } };
export type Group = { id: string; repo: string; env: string; candidates: Candidate[];
  /** ok: one strong usable candidate and nothing set yet (ticked); pick: the captain chooses; set: the settings already detect it this way */
  state: "ok" | "pick" | "set"; current: R.EnvDetect | null };
export type DeploymentSeen = { repo: string; environment: string; sha: string | null; ref: string | null };
/** A manifest read from the config repository at `ref`; `pinned` when the captain named that branch (the detect then
 *  keeps it, so a refresh reads the same branch), otherwise the default branch (the detect follows it). */
export type FileSeen = { repository: string; ref: string; path: string; text: string; pinned?: boolean };
export type Proposal = { groups: Group[]; envs: { name: string; production: boolean; rank: number; existing: boolean }[]; skipped: { path: string; why: "no-environment" }[] };

const same = (a: R.EnvDetect | null, b: R.EnvDetect | null) => JSON.stringify(a) === JSON.stringify(b);
const blobUrl = (repository: string, ref: string, path: string, line: number) => `https://github.com/${repository}/blob/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}#L${line}`;

/** The review table: each watched repository × environment, from its GitHub deployments and the config repository's files. */
export function propose(repos: string[], existing: R.EnvSetting[], deployments: DeploymentSeen[], files: FileSeen[]): Proposal {
  const groups = new Map<string, Group>(), names = new Map<string, Known>(), skipped: Proposal["skipped"] = [];
  // an environment already set under another name of the same kind (prod for production): proposed under that name, so
  // what is set, the table and Accept agree and no second production is added
  const setAs = new Map<string, R.EnvSetting>();
  for (const e of existing) { const c = envOfName(e.name).name; if (!setAs.has(c)) setAs.set(c, e); if (!setAs.has(e.name)) setAs.set(e.name, e); }
  const groupOf = (repo: string, k0: Known) => { const ex = setAs.get(k0.name), k = ex ? { ...k0, name: ex.name, production: ex.production } : k0; const key = `${repo.toLowerCase()}|${k.name}`; if (!names.has(k.name)) names.set(k.name, k);
    let g = groups.get(key); if (!g) { g = { id: `g${groups.size + 1}`, repo, env: k.name, candidates: [], state: "pick", current: R.envsFor(existing, repo).find((e) => e.name === k.name)?.detect ?? null }; groups.set(key, g); } return g; };
  for (const d of deployments) { const k = envOfName(d.environment), g = groupOf(d.repo, k);
    g.candidates.push({ id: `${g.id}c${g.candidates.length + 1}`, source: "deployment", detect: { kind: "deployment", environment: d.environment }, strength: "strong", problem: null,
      evidence: { path: null, line: null, text: `GitHub environment ${d.environment}: latest deployment ${d.sha ? d.sha.slice(0, 7) : "?"}${d.ref ? ` (${d.ref.slice(0, 60)})` : ""}`,
        tw: `GitHub 環境 ${d.environment}：最近一次部署 ${d.sha ? d.sha.slice(0, 7) : "?"}${d.ref ? `（${d.ref.slice(0, 60)}）` : ""}`, url: `https://github.com/${d.repo}/deployments` } }); }
  for (const f of files) {
    let any = false; const k = envOfPath(f.path, repos);
    for (const repo of repos) for (const x of scanManifest(f.text, repo)) {
      if (!k) { any = true; continue; }
      const g = groupOf(repo, k), detect: R.EnvDetect = { kind: "file", repository: f.repository, path: f.path, template: x.template, ...(f.pinned ? { ref: f.ref } : {}) };
      if (g.candidates.some((c) => same(c.detect, detect))) continue;
      g.candidates.push({ id: `${g.id}c${g.candidates.length + 1}`, source: "file", detect, strength: x.strength, problem: x.problem, evidence: { path: f.path, line: x.line, text: x.text, url: blobUrl(f.repository, f.ref, f.path, x.line) } }); }
    if (any) skipped.push({ path: f.path, why: "no-environment" });
  }
  for (const g of groups.values()) {
    const usable = g.candidates.filter((c) => !c.problem);
    g.state = g.current && g.candidates.some((c) => same(c.detect, g.current)) ? "set" : !g.current && g.candidates.length === 1 && usable.length === 1 && usable[0].strength === "strong" ? "ok" : "pick";
  }
  const envs = [...names.values()].map((k) => { const ex = existing.find((e) => e.name === k.name); return { name: k.name, production: ex ? ex.production : k.production, rank: k.rank, existing: !!ex }; })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const order = (g: Group) => envs.findIndex((e) => e.name === g.env);
  return { groups: [...groups.values()].sort((a, b) => a.repo.localeCompare(b.repo) || order(a) - order(b)), envs, skipped: skipped.slice(0, 50) };
}

export type Pick = { repo: string; env: string; detect: R.EnvDetect };
/**
 * The settings' environments with the accepted picks: each goes into the environment of that name as the repository's
 * own detect (replacing one it had); a name not set yet becomes a new environment, placed by the usual order (dev …
 * staging … production) among the ones there. `production` sets the flag of each environment it names.
 */
export function applyPicks(envs: R.EnvSetting[], picks: Pick[], production: Record<string, boolean>): R.EnvSetting[] {
  const out = structuredClone(envs);
  // only the first environment of a name changes (the one the proposal showed): another of the same name with a
  // different production flag, kept apart when old settings were folded, is left as it is
  for (const p of picks) {
    let e = out.find((x) => x.name === p.env);
    if (!e) { const k = envOfName(p.env); e = { name: p.env, production: production[p.env] ?? k.production, repos: [], each: [] };
      const at = out.findIndex((x) => rankOf(x.name) > rankOf(p.env)); out.splice(at < 0 ? out.length : at, 0, e); }
    e.each = [...(e.each ?? []).filter((x) => !R.sameRepo(x.repo, p.repo)), { repo: p.repo, detect: p.detect }];
  }
  for (const [name, v] of Object.entries(production)) { const e = out.find((x) => x.name === name); if (e) e.production = !!v; }
  return out;
}

/** Names that look like a GitOps/config repository, offered when the captain has not named one. */
export const CONFIG_NAME = /(?:^|[-_.])(?:deploy(?:ment)?s?|config|configs|gitops|inf(?:ra|rastructure)|manifests?|k8s|kube|kubernetes|helm|charts|argo(?:cd)?|flux|clusters?|ops|platform|environments?|envs)(?:$|[-_.])/i;
