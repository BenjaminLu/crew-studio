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
/** Any image a manifest line names, whoever builds it: `image` without its tag, and the template around the tag. */
export type ImageLine = { line: number; text: string; image: string; tag: string; template: string; problem: "not-first" | "control" | null };
const TAGC = "[0-9A-Za-z._-]{1,128}";
// an image reference with its tag on one line: registry/path/name:tag (the tag up to a quote, space, comma or the end)
const INLINE = new RegExp(`(?:^|[\\s"'=\\[,])((?:[A-Za-z0-9.-]+(?::\\d+)?/)?(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+):(${TAGC})(?=$|[\\s"',\\]}])`, "g");
// the image named on one line and its tag on a line after it (Helm values repository/tag, kustomize name/newName/newTag)
const NAMED = /^\s*-?\s*["']?(repository|name|newName|image)["']?\s*:\s*["']?([A-Za-z0-9./_:-]+?)["']?\s*,?\s*$/;
const TAGLINE = new RegExp(`^(\\s*-?\\s*)(["']?(?:tag|newTag|imageTag)["']?\\s*:\\s*)(["']?)(${TAGC})(["']?)\\s*,?\\s*(?:#.*)?$`);

/**
 * Every image a manifest names with its tag: `registry/path/name:tag` on one line, or the name on one line (repository,
 * name, newName, image) and `tag:`/`newTag:` on one of the next four (kustomize images, Helm values; a newName after the
 * name wins). The template runs from the key to the tag, `{tag}` for the tag, the closing quote kept (a comment is not);
 * it is usable only when Studio's own reader (tagAt) finds that very line first and it holds no control character.
 */
export function imagesIn(text: string): ImageLine[] {
  const lines = String(text ?? "").slice(0, 200000).split(/\r?\n/, 5000), out: ImageLine[] = [];
  const add = (n: number, pre: string, image: string, tag: string, post: string) => {
    const template = `${pre}{tag}${post}`; if (R.templateProblem(template)) return;
    if (out.some((f) => f.template === template && f.line === n + 1)) return;
    const at = R.tagAt(text, template);
    out.push({ line: n + 1, text: lines[n].trim().slice(0, 300), image, tag, template, problem: /[\u0000-\u001f]/.test(template) ? "control" : !at || at.line !== n || at.tag !== tag ? "not-first" : null }); };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]; if (line.length > 500) continue;
    for (const m of line.matchAll(INLINE)) {
      const ref = m[1], tag = m[2]; if (/^https?$/i.test(ref) || !ref.includes("/") && !/image/i.test(line)) continue;
      const start = line.length - line.trimStart().length, tagAt = m.index! + m[0].length - tag.length;
      const q = line[tagAt + tag.length], post = q === '"' || q === "'" ? q : "";
      add(n, line.slice(start, tagAt), ref, tag, post);
    }
    const named = NAMED.exec(line); if (!named || named[1] === "newName" || (named[2].split("/").pop() ?? "").includes(":")) continue; // a tag on this line: read above
    let image = named[2];
    for (let k = n + 1; k < Math.min(lines.length, n + 5); k++) {
      const nn = NAMED.exec(lines[k]); if (nn && nn[1] === "newName") { image = nn[2]; continue; }
      const t = TAGLINE.exec(lines[k]); if (!t) { if (nn) break; continue; }
      add(k, t[2] + t[3], image, t[4], t[3] && t[5] === t[3] ? t[3] : ""); break; }
  }
  return out;
}

/**
 * Every line of a manifest that names an image built from the repository by its name alone (imageMatch), with the
 * one-line template around its tag; a tag that does not end in a commit is "no-commit" here (the search also tries
 * the repository's git tags).
 */
export function scanManifest(text: string, repo: string): Finding[] {
  return imagesIn(text).flatMap((x) => { const strength = imageMatch(x.image, repo); return strength ? [{ line: x.line, text: x.text, template: x.template, tag: x.tag, strength, problem: x.problem ?? (R.commitOfTag(x.tag) ? null : "no-commit") }] : []; });
}

/** The words of a name (lower case, split at / - _ . and digits kept): what an image and a repository share. */
const words = (s: string) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
/** How alike an image's name and a repository's name are: shared words, then one name holding the other. Only orders
 *  the repositories Studio checks; never proof on its own. */
export function nameScore(image: string, repo: string): number {
  const parts = String(image).split("/"), path = parts.length > 1 && /[.:]|^localhost$/.test(parts[0]) ? parts.slice(1) : parts;
  const iw = new Set(path.flatMap(words)), rw = words(String(repo).split("/").pop() ?? ""); if (!rw.length) return 0;
  const shared = rw.filter((w) => iw.has(w)).length, last = norm(path.at(-1) ?? ""), name = norm(String(repo).split("/").pop() ?? "");
  return (last === name ? 10 : 0) + shared * 3 + (Math.min(last.length, name.length) >= 4 && (last.includes(name) || name.includes(last)) ? 2 : 0);
}
/** A version-only tag (9.9.9, v1.0.0): looked up among a repository's git tags, with or without the v. */
export const versionTag = (tag: string) => /^v?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.]+)?$/.test(tag) && !R.commitOfTag(tag);
export const tagNames = (tag: string) => [tag, tag.startsWith("v") ? tag.slice(1) : `v${tag}`];

/** What ties an image to a repository: its CI config publishes that image (build), the commit in the image's tag is in
 *  the repository (commit), the version tag is one of its git tags (tag), a Dockerfile label names it (label: supporting
 *  only), or only the names look alike (name: never proof). */
export type Signal = { kind: "build"; path: string; line: number; image: string } | { kind: "label"; path: string; line: number; image: string } | { kind: "commit"; sha: string } | { kind: "tag"; tag: string } | { kind: "name" };
/** Who builds an image: strong when proof points at this repository alone, weak when only names agree or proofs
 *  disagree (the captain picks). */
export type Owner = { repo: string; strength: "strong" | "weak"; signals: Signal[] };
export type Match = { owner(image: string): Owner[]; tagOk(repo: string, tag: string): boolean };
/** Matching by name alone (no GitHub reads): the pure default. */
export const byName = (repos: string[]): Match => ({
  owner: (image) => { let best: Owner[] = [], rank = 0; for (const r of repos) { const m = imageMatch(image, r); const s = m === "strong" ? 2 : m === "weak" ? 1 : 0; if (s > rank) { rank = s; best = [{ repo: r, strength: m!, signals: [{ kind: "name" }] }]; } } return best; },
  tagOk: (_r, tag) => !!R.commitOfTag(tag) });

/** An image without its registry host and tag, lower case: what manifests and CI configs are compared by. */
export const imageKey = (image: string) => { const parts = String(image).toLowerCase().split("/").filter(Boolean); return (parts.length > 1 && /[.:]|^localhost$/.test(parts[0]) ? parts.slice(1) : parts).join("/"); };
/** The same image: the same path (registry ignored), or failing that the same last segment. */
export const sameImage = (a: string, b: string) => { const x = imageKey(a), y = imageKey(b); return !!x && (x === y || x.split("/").at(-1) === y.split("/").at(-1)); };
/** A CI value with its templated parts (${VAR}, ${{ expr }}, $VAR) taken out and its tag dropped: the image-name part. */
export function imageName(v: string, repo?: string): string | null {
  // the repository's own name where a CI variable stands for it, so ${{ github.repository }} stays an image name
  const full = String(repo ?? ""), name = full.split("/").pop() ?? "";
  let t = String(v ?? "").trim().replace(/^["']|["']$/g, "");
  if (full) t = t.replace(/\$\{\{\s*github\.repository\s*\}\}|\$\{DRONE_REPO\}|\$DRONE_REPO(?![A-Z_])/g, full.toLowerCase()).replace(/\$\{\{\s*github\.event\.repository\.name\s*\}\}|\$\{DRONE_REPO_NAME\}|\$DRONE_REPO_NAME(?![A-Z_])/g, name.toLowerCase());
  t = t.replace(/\$\{\{[^}]*\}\}/g, "").replace(/\$\{[^}]*\}/g, "").replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "");
  const segs = t.split("/"), last = segs.at(-1) ?? ""; if (last.includes(":")) segs[segs.length - 1] = last.slice(0, last.indexOf(":")); else if (last.includes("@")) segs[segs.length - 1] = last.slice(0, last.indexOf("@"));
  t = segs.filter(Boolean).join("/").replace(/^[-./]+|[-./]+$/g, "");
  return /^[a-z0-9][a-z0-9._/-]*$/i.test(t) && (t.split("/").at(-1) ?? "").length >= 2 && !/^(plugins|docker|alpine|ubuntu|golang|node|python)$/i.test(t) ? t : null;
}
/**
 * The images a repository's build config publishes, each with its line: Drone plugin steps (`repo:`), `docker build
 * -t`/`--tag`, `docker push`, `docker tag … <image>`, GitHub Actions `tags:`/`images:` (docker/build-push-action,
 * docker/metadata-action; inline, comma separated or a list). A Dockerfile's `org.opencontainers.image.title` label is
 * kept as supporting evidence only (kind label).
 */
export function publishedImages(path: string, text: string, repo?: string): { image: string; line: number; kind: "build" | "label" }[] {
  const out: { image: string; line: number; kind: "build" | "label" }[] = [], lines = String(text ?? "").slice(0, 200000).split(/\r?\n/, 5000);
  const add = (v: string, n: number, kind: "build" | "label" = "build") => { const i = imageName(v, repo); if (i && !out.some((x) => x.image === i)) out.push({ image: i, line: n + 1, kind }); };
  const dockerfile = /(^|\/)Dockerfile[^/]*$|\.dockerfile$/i.test(path);
  for (let n = 0; n < lines.length; n++) { if (lines[n].length > 1000) continue; const line = lines[n].replace(/\$\{\{([^}]*)\}\}/g, (_m, x: string) => "${{" + x.replace(/\s+/g, "") + "}}"); // ${{ a.b }} without its spaces, so it stays one word
    if (dockerfile) { for (const m of line.matchAll(/org\.opencontainers\.image\.title\s*=\s*("[^"]*"|\S+)/g)) add(m[1], n, "label"); continue; }
    let m = /^\s*-?\s*repo\s*:\s*(\S+)/.exec(line); if (m) add(m[1], n);
    for (const b of line.matchAll(/docker\s+(?:buildx\s+)?build\b[^\n]*/g)) for (const t of b[0].matchAll(/(?:^|\s)(?:-t|--tag)(?:=|\s+)(["']?[^\s"']+["']?)/g)) add(t[1], n);
    for (const t of line.matchAll(/docker\s+push\s+(?:--\S+\s+)*(["']?[^\s"']+)/g)) add(t[1], n);
    for (const t of line.matchAll(/docker\s+tag\s+\S+\s+(["']?[^\s"']+)/g)) add(t[1], n);
    m = /^(\s*)(?:tags|images)\s*:\s*(.*)$/.exec(line);
    if (m) { const ind = m[1].length, rest = m[2].trim();
      // an image here has a path (registry/name): a Drone step's tags (latest, 1.2.3) are no image
      const val = (v: string, k: number) => { if (v.replace(/\$\{\{[^}]*\}\}|\$\{[^}]*\}/g, "x").includes("/")) add(v, k); };
      if (rest && !/^[|>][-+]?$/.test(rest)) for (const v of rest.replace(/^\[|\]$/g, "").split(",")) val(v, n);
      else for (let k = n + 1; k < Math.min(lines.length, n + 20); k++) { const l = lines[k]; if (!l.trim()) continue; if (l.length - l.trimStart().length <= ind) break;
        for (const v of l.trim().replace(/^-\s*/, "").split(",")) val(v, k); } }
  }
  return out;
}

// ---------- the proposal ----------
/** One piece of evidence: a manifest line (with what tied that very line's image and tag to the repository, and the
 *  other repositories the same line is proposed or already set for) or a deployment. */
type Ev = { path: string | null; line: number | null; text: string; tw?: string; url: string | null; signals?: Signal[]; alsoFor?: string[]; setFor?: string[] };
export type Candidate = { id: string; source: "deployment" | "file"; detect: R.EnvDetect; strength: "strong" | "weak"; problem: Finding["problem"];
  /** what Studio saw: a deployment's ref and commit (text, and tw in Traditional Chinese), or the manifest line; and
   *  where to see it on GitHub. `more`: the other manifests of a repository deployed as several services. `signals`:
   *  what tied the image to the repository */
  evidence: Ev & { more?: Ev[] } };
export type Group = { id: string; repo: string; env: string; candidates: Candidate[];
  /** ok: one strong usable candidate and nothing set yet (ticked); pick: the captain chooses; set: the settings already detect it this way */
  state: "ok" | "pick" | "set"; current: R.EnvDetect | null };
export type DeploymentSeen = { repo: string; environment: string; sha: string | null; ref: string | null };
/** A manifest read from the config repository at `ref`; `pinned` when the captain named that branch (the detect then
 *  keeps it, so a refresh reads the same branch), otherwise the default branch (the detect follows it). */
export type FileSeen = { repository: string; ref: string; path: string; text: string; pinned?: boolean };
export type Proposal = { groups: Group[]; envs: { name: string; production: boolean; rank: number; existing: boolean }[]; skipped: { path: string; why: "no-environment" | "set-for"; repos?: string[] }[] };

const same = (a: R.EnvDetect | null, b: R.EnvDetect | null) => JSON.stringify(a) === JSON.stringify(b);
const blobUrl = (repository: string, ref: string, path: string, line: number) => `https://github.com/${repository}/blob/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}#L${line}`;
/** At most this many manifests in one repository's detect for one environment. */
export const MAX_FILES = 30;

/**
 * The review table: each watched repository × environment, from its GitHub deployments and the config repository's
 * manifests. An image is tied to a repository by `match` (src/pr-watch.ts checks the tag's commit and the repository's
 * version tags; without it, by name). Every manifest a repository's image is proven to run in for one environment (a
 * repository deployed as several services) makes one candidate together: that environment has a merge when every one
 * of them runs it. A weak or unusable line is a candidate of its own, never ticked.
 */
export function propose(repos: string[], existing: R.EnvSetting[], deployments: DeploymentSeen[], files: FileSeen[], match: Match = byName(repos)): Proposal {
  const groups = new Map<string, Group>(), names = new Map<string, Known>(), skipped: Proposal["skipped"] = [];
  // an environment already set under another name of the same kind (prod for production): proposed under that name, so
  // what is set, the table and Accept agree and no second production is added
  const setAs = new Map<string, R.EnvSetting>();
  for (const e of existing) { const c = envOfName(e.name).name; if (!setAs.has(c)) setAs.set(c, e); if (!setAs.has(e.name)) setAs.set(e.name, e); }
  const groupOf = (repo: string, k0: Known) => { const ex = setAs.get(k0.name), k = ex ? { ...k0, name: ex.name, production: ex.production } : k0; const key = `${repo.toLowerCase()}|${k.name}`; if (!names.has(k.name)) names.set(k.name, k);
    let g = groups.get(key); if (!g) { g = { id: `g${groups.size + 1}`, repo, env: k.name, candidates: [], state: "pick", current: R.envsFor(existing, repo).find((e) => e.name === k.name)?.detect ?? null }; groups.set(key, g); } return g; };
  const add = (g: Group, c: Omit<Candidate, "id">) => { if (!g.candidates.some((x) => same(x.detect, c.detect))) g.candidates.push({ id: `${g.id}c${g.candidates.length + 1}`, ...c }); };
  for (const d of deployments) add(groupOf(d.repo, envOfName(d.environment)), { source: "deployment", detect: { kind: "deployment", environment: d.environment }, strength: "strong", problem: null,
    evidence: { path: null, line: null, text: `GitHub environment ${d.environment}: latest deployment ${d.sha ? d.sha.slice(0, 7) : "?"}${d.ref ? ` (${d.ref.slice(0, 60)})` : ""}`,
      tw: `GitHub 環境 ${d.environment}：最近一次部署 ${d.sha ? d.sha.slice(0, 7) : "?"}${d.ref ? `（${d.ref.slice(0, 60)}）` : ""}`, url: `https://github.com/${d.repo}/deployments` } });
  // the manifests: each image line with its owner, gathered per repository and environment
  type Hit = { f: FileSeen; x: ImageLine; owner: Owner; problem: Finding["problem"] };
  // a line's own evidence: what ties the repository (its CI, a label, its name) and the proof of this line's tag only
  // (its commit, its version tag), never another environment's
  const sigOf = (o: Owner, tag: string) => { const c = R.commitOfTag(tag)?.toLowerCase(), names = tagNames(tag);
    return o.signals.filter((x) => x.kind === "commit" ? !!c && (c.startsWith(x.sha.toLowerCase()) || x.sha.toLowerCase().startsWith(c)) : x.kind === "tag" ? names.includes(x.tag) || x.tag === tag : true); };
  // the manifests the settings already read for a repository: a line set for another one is not proposed again
  const setFor = new Map<string, string[]>();
  for (const e of existing) for (const x of e.each ?? []) for (const f of R.filesOf(x.detect)) { const k = `${f.repository}|${f.path}`.toLowerCase(); setFor.set(k, [...(setFor.get(k) ?? []), x.repo]); }
  const hits = new Map<string, { g: Group; list: Hit[] }>();
  for (const f of files) {
    const k = envOfPath(f.path, repos); let any = false;
    for (const x of imagesIn(f.text)) for (const owner of match.owner(x.image)) {
      if (!k) { any = true; continue; }
      const other = (setFor.get(`${f.repository}|${f.path}`.toLowerCase()) ?? []).filter((r) => !R.sameRepo(r, owner.repo));
      if (other.length) { if (!skipped.some((x) => x.path === f.path && x.why === "set-for")) skipped.push({ path: f.path, why: "set-for", repos: other }); continue; } // already set for another repository: not proposed again
      const g = groupOf(owner.repo, k), h = hits.get(g.id) ?? { g, list: [] }; hits.set(g.id, h);
      h.list.push({ f, x, owner, problem: x.problem ?? (match.tagOk(owner.repo, x.tag) ? null : "no-commit") }); }
    if (any) skipped.push({ path: f.path, why: "no-environment" });
  }
  const fileOf = (h: Hit) => ({ repository: h.f.repository, path: h.f.path, template: h.x.template, ...(h.f.pinned ? { ref: h.f.ref } : {}) });
  // the same line proposed for more than one repository (proofs that disagree): each says which others
  const lineOwners = new Map<string, string[]>();
  for (const { list } of hits.values()) for (const h of list) { const k = `${h.f.path}#${h.x.line}`; lineOwners.set(k, [...new Set([...(lineOwners.get(k) ?? []), h.owner.repo])]); }
  const evOf = (h: Hit): Ev => { const also = (lineOwners.get(`${h.f.path}#${h.x.line}`) ?? []).filter((r) => !R.sameRepo(r, h.owner.repo));
    return { path: h.f.path, line: h.x.line, text: h.x.text, url: blobUrl(h.f.repository, h.f.ref, h.f.path, h.x.line), signals: sigOf(h.owner, h.x.tag), ...(also.length ? { alsoFor: also } : {}) }; };
  for (const { g, list } of hits.values()) {
    const sure = list.filter((h) => h.owner.strength === "strong" && !h.problem).slice(0, MAX_FILES);
    if (sure.length) { const fs = sure.map(fileOf), [first, ...rest] = sure.map(evOf);
      add(g, { source: "file", detect: fs.length === 1 ? { kind: "file", ...fs[0] } : { kind: "files", files: fs }, strength: "strong", problem: null, evidence: { ...first, ...(rest.length ? { more: rest } : {}) } }); }
    for (const h of list.filter((x) => !sure.includes(x)).slice(0, 10)) add(g, { source: "file", detect: { kind: "file", ...fileOf(h) }, strength: h.owner.strength, problem: h.problem, evidence: evOf(h) });
  }
  for (const g of groups.values()) {
    // lines Studio cannot read a commit from (a version tag no git tag has, another line read first) are shown, but do
    // not stand against a candidate that can be read
    const usable = g.candidates.filter((c) => !c.problem), sure = usable.filter((c) => c.strength === "strong");
    if (sure.length && usable.length < g.candidates.length) g.candidates = [...usable, ...g.candidates.filter((c) => c.problem)];
    g.state = g.current && g.candidates.some((c) => same(c.detect, g.current)) ? "set" : !g.current && sure.length === 1 && usable.length === 1 ? "ok" : "pick";
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
