// The trivial lane (M3): "Use in repo" recipes. An APPROVED artifact goes into
// a repository by deterministic code (no agent, no model). Studio makes a
// branch and one commit in a temporary worktree, pushes it when the repo has a
// remote, opens a PR through GitHub's REST API when the repo is on GitHub, and
// raises ONE Studio card with a rendered README preview. Script checks gate it;
// any failed check makes the card a fallback ("needs the normal two-way path")
// and nothing merges. Merge happens only on the captain's click.
//   CREW_DATA/repos.json        repos Studio may write branches to: {id, name, path, base, remote, github}
//   CREW_DATA/lane/<card>.json  one card per recipe run
//   CREW_DATA/repo-refs.jsonl   what a merged card put where (for update proposals)
//   CREW_LANE_MAX_LINES  diff budget in text lines (default 20)
import { addPaths, git, must } from "./git";
import { assertSharedGitConfig } from "./git-config-health";
import { randomBytes } from "node:crypto";
import { realpathSync, appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, normalize, posix } from "node:path";
import type { Artifact, ArtifactStore, Version } from "./artifacts";
import { sha256File } from "./artifacts";
import { findToken } from "./github";

export type Repo = { id: string; name: string; path: string; base: string; remote: string | null; github: string | null };
export type Check = { id: string; label: string; ok: boolean | null; detail: string };
export type RecipePin = { repo: string; path: string; remote: string | null; github: string | null; base: string; baseCommit: string; branch: string; commit: string; artifact: string; version: number; sha256: string };
export type Card = {
  /** Set when a recipe is checked, never synthesized for old ready cards. */
  pin?: RecipePin;
  id: string; kind: "add" | "update"; recipe: "readme-image" | "replace-image"; artifact: string; title: string; version: number; sha256: string;
  repo: string; base: string; branch: string | null; commit: string | null; baseCommit: string | null; asset: string; pr: { number: number; url: string } | null;
  checks: Check[]; ok: boolean; state: "draft" | "ready" | "fallback" | "merged" | "closed" | "error"; error: string | null;
  createdAt: string; mergedAt: string | null; mergedBy: string | null; readme: string | null; diff: string | null; replaces: { version: number; sha256: string } | null;
};

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const now = () => new Date().toISOString();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "artifact";

/** Links and images in markdown: inline [t](u), ![a](u) and reference definitions [x]: u. */
export function mdLinks(md: string): { url: string; image: boolean }[] {
  const out: { url: string; image: boolean }[] = [];
  const noCode = md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const m of noCode.matchAll(/(!?)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ url: m[2], image: m[1] === "!" });
  for (const m of noCode.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) out.push({ url: m[1], image: false });
  for (const m of noCode.matchAll(/<img\s[^>]*src="([^"]+)"/gi)) out.push({ url: m[1], image: true });
  return out;
}
/** A small, safe markdown renderer for the card preview (no raw HTML passes through). */
export function mdToHtml(md: string, img: (src: string) => string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const inline = (s: string) => esc(s)
    .replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\s*\)/g, (_, a, u) => `<img alt="${a}" src="${esc(img(u.replace(/&amp;/g, "&")))}">`)
    .replace(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g, (_, t, u) => /^https?:|^#|^mailto:/.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `<a>${t}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  const out: string[] = []; let para: string[] = []; let list: string[] = []; let code: string[] | null = null;
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`); list = []; };
  for (const line of md.split("\n")) {
    if (code) { if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { flush(); code = []; continue; }
    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hd) { flush(); out.push(`<h${hd[1].length}>${inline(hd[2])}</h${hd[1].length}>`); continue; }
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (li) { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } list.push(li[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list.length) flush();
    para.push(line.trim());
  }
  flush(); if (code) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  return out.join("\n");
}

export class Lane {
  private dir: string;
  onChange: () => void = () => {};
  constructor(readonly dataDir: string, readonly store: ArtifactStore, readonly api = (process.env.CREW_GITHUB_API ?? "https://api.github.com").replace(/\/$/, "")) {
    this.dir = join(dataDir, "lane"); mkdirSync(this.dir, { recursive: true });
  }
  readonly maxLines = Number(process.env.CREW_LANE_MAX_LINES ?? 20);

  // --- repos ---
  repos(): Repo[] { try { const a = JSON.parse(readFileSync(join(this.dataDir, "repos.json"), "utf8")); return Array.isArray(a) ? a : []; } catch { return []; } }
  repo(id: string) { return this.repos().find((r) => r.id === id) ?? null; }
  addRepo(o: { path: string; name?: string; base?: string; github?: string | null }): Repo {
    const path = normalize(String(o.path ?? "").trim());
    if (!path.startsWith("/")) throw new Error("give the repository's absolute path");
    const top = git(path, ["rev-parse", "--show-toplevel"]);
    if (!top.ok) throw new Error(`not a git repository: ${path}`);
    const base = o.base?.trim() || git(path, ["symbolic-ref", "--short", "HEAD"]).out || "main";
    if (!git(path, ["rev-parse", "--verify", `${base}^{commit}`]).ok) throw new Error(`no branch ${base} in ${path}`);
    const remote = git(path, ["remote"]).out.split("\n").includes("origin") ? "origin" : null;
    const gh = o.github?.trim() || null;
    if (gh && !/^[\w.-]+\/[\w.-]+$/.test(gh)) throw new Error("GitHub repository must look like owner/name");
    const repo: Repo = { id: slug(o.name || basename(top.out)), name: o.name || basename(top.out), path: top.out, base, remote, github: gh };
    const all = this.repos().filter((r) => r.id !== repo.id).concat(repo);
    writeFileSync(join(this.dataDir, "repos.json"), JSON.stringify(all, null, 2));
    this.onChange();
    return repo;
  }

  // --- cards ---
  cards(): Card[] {
    return readdirSync(this.dir).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(this.dir, f), "utf8")); } catch { return null; } })
      .filter(Boolean).sort((a: Card, b: Card) => b.createdAt.localeCompare(a.createdAt));
  }
  card(id: string): Card | null { try { return JSON.parse(readFileSync(join(this.dir, `${id.replace(/[^\w-]/g, "")}.json`), "utf8")); } catch { return null; } }
  private save(c: Card) { const f = join(this.dir, `${c.id}.json`); writeFileSync(f + ".tmp", JSON.stringify(c, null, 2)); renameSync(f + ".tmp", f); this.onChange(); }
  refs(): any[] { const f = join(this.dataDir, "repo-refs.jsonl"); if (!existsSync(f)) return []; return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

  private imageOf(a: Artifact, v: Version) {
    const prim = v.primary ? this.store.file(a.id, v.n, v.primary) : null;
    if (!prim || !IMAGE.has(extname(prim).toLowerCase())) throw new Error("this recipe needs an image artifact (png, jpg, gif, webp or svg)");
    return prim;
  }

  /** Run a recipe: branch + commit in a temporary worktree, checks, push and PR when possible. */
  run(o: { artifact: string; version?: number; repo: string; name?: string; kind?: "add" | "update"; replaces?: Card["replaces"]; asset?: string }): Card {
    const a = this.store.get(o.artifact); if (!a) throw new Error("no such artifact");
    const v = o.version ? this.store.version(a.id, o.version) : this.store.approved(a.id);
    if (!v) throw new Error("approve a version first: only an approved version can go into a repo");
    if (v.status !== "approved") throw new Error(`v${v.n} is not approved`);
    const repo = this.repo(o.repo); if (!repo) throw new Error("no such repository");
    const img = this.imageOf(a, v);
    const kind = o.kind ?? "add";
    const asset = o.asset ?? `assets/${slug(o.name || a.id)}${extname(img).toLowerCase()}`;
    if (!/^assets\/[\w.-]+$/.test(asset)) throw new Error("the image goes to assets/<name>");
    const card: Card = { id: `L${Date.now().toString(36)}${randomBytes(2).toString("hex")}`, kind, recipe: kind === "add" ? "readme-image" : "replace-image",
      artifact: a.id, title: a.title, version: v.n, sha256: v.sha256!, repo: repo.id, base: repo.base, branch: null, commit: null, baseCommit: null, asset, pr: null,
      checks: [], ok: false, state: "error", error: null, createdAt: now(), mergedAt: null, mergedBy: null, readme: null, diff: null, replaces: o.replaces ?? null };
    const wt = mkdtempSync(join(tmpdir(), "crew-lane-"));
    rmSync(wt, { recursive: true, force: true });
    try {
      card.baseCommit = must(repo.path, ["rev-parse", `${repo.base}^{commit}`]);
      let branch = `crew/${slug(a.id)}-v${v.n}`;
      for (let i = 2; git(repo.path, ["rev-parse", "--verify", `refs/heads/${branch}`]).ok; i++) branch = `crew/${slug(a.id)}-v${v.n}-${i}`;
      assertSharedGitConfig(repo.path); must(repo.path, ["worktree", "add", "-q", "-b", branch, wt, card.baseCommit]);
      card.branch = branch;
      mkdirSync(join(wt, "assets"), { recursive: true });
      copyFileSync(img, join(wt, asset));
      if (kind === "add") {
        const readmeP = join(wt, "README.md");
        if (!existsSync(readmeP)) throw new Error("the repository has no README.md");
        const text = readFileSync(readmeP, "utf8");
        const line = `![${a.title.replace(/[\[\]]/g, "")}](${asset})`;
        writeFileSync(readmeP, text.includes(`](${asset})`) ? text : `${line}\n\n${text}`);
      }
      addPaths(wt, kind === "add" ? [asset, "README.md"] : [asset]);
      must(wt, ["commit", "-q", "-m", kind === "add" ? `Add ${a.title} to the README` : `Update ${asset} to ${a.id} v${v.n}`, "-m", `From Crew Studio: artifact ${a.id} v${v.n} (sha256 ${v.sha256}).`]);
      card.commit = must(wt, ["rev-parse", "HEAD"]);
      card.diff = git(repo.path, ["diff", "--stat", card.baseCommit, card.commit]).out.slice(0, 2000);
      card.readme = git(repo.path, ["show", `${card.commit}:README.md`]).out.slice(0, 60_000) || null;
      card.checks = this.check(repo, card);
      card.ok = card.checks.every((c) => c.ok !== false);
      card.state = card.ok ? "ready" : "fallback";
      if (card.ok) card.pin = this.identity(repo, card);
      if (card.ok && repo.remote) {
        const p = git(repo.path, ["push", "-q", repo.remote, `${branch}:${branch}`]);
        if (!p.ok) { card.checks.push({ id: "push", label: "Branch pushed", ok: false, detail: p.err.slice(0, 300) }); card.ok = false; card.state = "fallback"; }
        else card.checks.push({ id: "push", label: "Branch pushed", ok: true, detail: `${repo.remote}/${branch}` });
      }
    } catch (e: any) { card.state = "error"; card.error = String(e?.message ?? e); }
    finally { git(repo.path, ["worktree", "remove", "--force", wt]); rmSync(wt, { recursive: true, force: true }); }
    this.save(card);
    return card;
  }

  /** The script checks. Each is pass/fail with a detail; null = not applicable or not available. */
  check(repo: Repo, c: Card): Check[] {
    const out: Check[] = [];
    const files = git(repo.path, ["diff", "--name-only", c.baseCommit!, c.commit!]).out.split("\n").filter(Boolean);
    const allowed = c.kind === "add" ? (f: string) => f === "README.md" || f.startsWith("assets/") : (f: string) => f === c.asset;
    const extra = files.filter((f) => !allowed(f));
    out.push({ id: "paths", label: c.kind === "add" ? "Only README.md and assets/" : `Only ${c.asset}`, ok: !extra.length, detail: extra.length ? `also changes ${extra.join(", ")}` : files.join(", ") });
    let lines = 0;
    for (const row of git(repo.path, ["diff", "--numstat", c.baseCommit!, c.commit!]).out.split("\n").filter(Boolean)) { const [ad, de] = row.split("\t"); if (ad !== "-") lines += Number(ad) + Number(de); }
    out.push({ id: "size", label: `Diff within ${this.maxLines} text lines`, ok: lines <= this.maxLines, detail: `${lines} text line${lines === 1 ? "" : "s"} changed` });
    const blob = git(repo.path, ["show", `${c.commit}:${c.asset}`]);
    const got = blob.ok ? new Bun.CryptoHasher("sha256").update(blob.bytes).digest("hex") : null;
    out.push({ id: "sha", label: "Image is the approved version", ok: got === c.sha256, detail: got === c.sha256 ? `sha256 ${c.sha256.slice(0, 12)}… = ${c.artifact} v${c.version}` : `sha256 ${got?.slice(0, 12) ?? "missing"}… ≠ approved ${c.sha256.slice(0, 12)}…` });
    const md = git(repo.path, ["show", `${c.commit}:README.md`]);
    if (!md.ok) out.push({ id: "readme", label: "README renders, links resolve", ok: false, detail: "no README.md" });
    else {
      const tree = new Set(git(repo.path, ["ls-tree", "-r", "--name-only", c.commit!]).out.split("\n"));
      const broken: string[] = []; let external = 0;
      for (const l of mdLinks(md.out)) {
        if (/^(https?:|mailto:|#)/i.test(l.url)) { external++; continue; }
        const path = posix.normalize(decodeURIComponent(l.url.split("#")[0].split("?")[0]).replace(/^\.\//, "").replace(/^\//, ""));
        if (path && !tree.has(path) && ![...tree].some((t) => t.startsWith(path.replace(/\/$/, "") + "/"))) broken.push(l.url);
      }
      let html = ""; try { html = mdToHtml(md.out, (u) => u); } catch {}
      out.push({ id: "readme", label: "README renders, links resolve", ok: !!html && !broken.length,
        detail: broken.length ? `broken: ${broken.join(", ")}` : `renders; ${mdLinks(md.out).length - external} local link${mdLinks(md.out).length - external === 1 ? "" : "s"} resolve${external ? `, ${external} external not fetched` : ""}` });
    }
    out.push({ id: "ci", label: "Repository CI", ok: null, detail: repo.github ? "shown once the PR exists" : "no GitHub remote: CI not available" });
    return out;
  }

  private headers() { const t = findToken(this.dataDir).token; return t ? { authorization: `Bearer ${t}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" } : null; }

  /** Open the PR on GitHub (REST). Only for a ready card on a GitHub repo with a token. */
  async openPr(id: string): Promise<Card> {
    const c = this.card(id); if (!c) throw new Error("no such card");
    const repo = this.repo(c.repo)!;
    if (c.state !== "ready" || c.pr) return c;
    if (!repo.github) throw new Error("this repository is not on GitHub");
    const h = this.headers(); if (!h) throw new Error("GitHub not connected");
    const r = await fetch(`${this.api}/repos/${repo.github}/pulls`, { method: "POST", headers: h, body: JSON.stringify({ title: c.kind === "add" ? `Add ${c.title} to the README` : `Update ${c.asset}`,
      head: c.branch, base: c.base, body: `From Crew Studio's trivial lane: ${c.artifact} v${c.version} (sha256 ${c.sha256}).\n\n${c.checks.map((x) => `- ${x.ok === false ? "✗" : x.ok ? "✓" : "·"} ${x.label}: ${x.detail}`).join("\n")}` }) });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`GitHub refused the PR (${r.status}): ${body?.message ?? ""}`);
    c.pr = { number: body.number, url: body.html_url };
    this.save(c);
    return c;
  }

  /** CI state for the card's commit (GitHub check runs); updates the ci check. */
  async refreshCi(id: string): Promise<Card> {
    const c = this.card(id); if (!c) throw new Error("no such card");
    const repo = this.repo(c.repo)!; const h = this.headers();
    if (!repo.github || !h || !c.commit) return c;
    try {
      const r = await fetch(`${this.api}/repos/${repo.github}/commits/${c.commit}/check-runs?per_page=100`, { headers: h });
      const body: any = await r.json();
      const runs: any[] = body?.check_runs ?? [];
      const fail = runs.filter((x) => x.status === "completed" && !["success", "neutral", "skipped"].includes(x.conclusion));
      const pending = runs.filter((x) => x.status !== "completed");
      const ci = c.checks.find((x) => x.id === "ci")!;
      if (!runs.length) { ci.ok = null; ci.detail = "no checks reported yet"; }
      else if (fail.length) { ci.ok = false; ci.detail = `failing: ${fail.map((x) => x.name).join(", ")}`; }
      else if (pending.length) { ci.ok = null; ci.detail = `running: ${pending.length} of ${runs.length}`; }
      else { ci.ok = true; ci.detail = `${runs.length} check${runs.length === 1 ? "" : "s"} passed`; }
      c.ok = c.checks.every((x) => x.ok !== false);
      if (!c.ok && c.state === "ready") c.state = "fallback";
      this.save(c);
    } catch {}
    return c;
  }

  /** Merge on the captain's click: checks re-run on the same commit; GitHub REST for a GitHub repo, else a fast-forward of the base. */
  identity(repo: Repo, c: Card): RecipePin {
    if (!c.commit || !c.baseCommit || !c.branch) throw new Error("recipe has no pinned commit");
    return { repo: c.repo, path: realpathSync(repo.path), remote: repo.remote, github: repo.github, base: c.base, baseCommit: c.baseCommit, branch: c.branch, commit: c.commit, artifact: c.artifact, version: c.version, sha256: c.sha256 };
  }
  assertPin(c: Card, expected: RecipePin | undefined, replay = false) {
    const repo = this.repo(c.repo); if (!repo || !expected || !c.pin || JSON.stringify(this.identity(repo, c)) !== JSON.stringify(expected) || JSON.stringify(c.pin) !== JSON.stringify(expected) || repo.base !== expected.base) throw new Error("recipe identity changed or predates pinning; prepare a fresh card");
    const branch = git(repo.path, ["rev-parse", `refs/heads/${expected.branch}^{commit}`]);
    const base = git(repo.path, ["rev-parse", `refs/heads/${expected.base}^{commit}`]);
    if (!branch.ok || branch.out !== expected.commit || !base.ok || (base.out !== expected.baseCommit && !(replay && base.out === expected.commit))) throw new Error("recipe branch or base moved after review");
    if (!git(repo.path, ["merge-base", "--is-ancestor", expected.baseCommit, expected.commit]).ok) throw new Error("pinned recipe is not a fast-forward of its reviewed base");
    if (c.state === "merged" && base.out !== expected.commit) throw new Error("recorded merge is not the actual pinned base head");
    return repo;
  }
  async merge(id: string, by: string): Promise<Card> {
    const c = this.card(id); if (!c) throw new Error("no such card");
    if (c.state !== "ready") throw new Error(c.state === "fallback" ? "this change needs the normal two-way path; nothing merges here" : `the card is ${c.state}`);
    const repo = this.assertPin(c, c.pin, true);
    const again = this.check(repo, c);
    if (again.some((x) => x.ok === false)) { c.checks = again; c.ok = false; c.state = "fallback"; this.save(c); throw new Error("a check no longer passes; the card fell back to the normal path"); }
    const ci = c.checks.find((x) => x.id === "ci");
    if (repo.github) {
      if (ci?.ok === null && ci.detail.startsWith("running")) throw new Error("CI is still running");
      if (!c.pr) throw new Error("open the PR first");
      const h = this.headers(); if (!h) throw new Error("GitHub not connected");
      const r = await fetch(`${this.api}/repos/${repo.github}/pulls/${c.pr.number}/merge`, { method: "PUT", headers: h, body: JSON.stringify({ merge_method: "squash", sha: c.commit }) });
      const body: any = await r.json().catch(() => ({}));
      if (!r.ok || body?.merged === false) throw new Error(`GitHub did not merge (${r.status}): ${body?.message ?? ""}`);
    } else {
      // local: fast-forward the base only; the captain's working tree is left alone unless it sits on the base and is clean
      const head = git(repo.path, ["symbolic-ref", "--short", "-q", "HEAD"]).out;
      if (head === c.base) {
        if (git(repo.path, ["status", "--porcelain"]).out) throw new Error(`${repo.path} has uncommitted changes on ${c.base}; commit or stash them first`);
        must(repo.path, ["merge", "--ff-only", "-q", c.commit!]);
      } else {
        if (git(repo.path, ["worktree", "list", "--porcelain"]).out.split("\n").includes(`branch refs/heads/${c.base}`)) throw new Error(`${c.base} is checked out in another worktree`);
        if (must(repo.path, ["rev-parse", `refs/heads/${c.base}^{commit}`]) !== c.commit) must(repo.path, ["update-ref", `refs/heads/${c.base}`, c.commit!, c.baseCommit!]);
      }
      if (repo.remote) { const p = git(repo.path, ["push", "-q", repo.remote, `${c.base}:${c.base}`]); if (!p.ok) throw new Error(`merged locally, but pushing ${c.base} failed: ${p.err}`); }
    }
    if (!repo.github && must(repo.path, ["rev-parse", `refs/heads/${c.base}^{commit}`]) !== c.commit) throw new Error("local merge head differs from pinned commit");
    c.state = "merged"; c.mergedAt = now(); c.mergedBy = by;
    this.save(c);
    appendFileSync(join(this.dataDir, "repo-refs.jsonl"), JSON.stringify({ repo: c.repo, artifact: c.artifact, version: c.version, sha256: c.sha256, path: c.asset, card: c.id, commit: c.commit, base: c.base, baseCommit: c.baseCommit, ts: c.mergedAt }) + "\n");
    return c;
  }
  close(id: string) { const c = this.card(id); if (!c) throw new Error("no such card"); if (c.state === "merged") throw new Error("already merged"); c.state = "closed"; this.save(c); return c; }

  /** A new approved version: propose an update card for every repo that holds an older version (draft until prepared). */
  proposeUpdates(a: Artifact, v: Version): Card[] {
    const latest = new Map<string, any>();
    for (const r of this.refs().filter((x) => x.artifact === a.id)) latest.set(`${r.repo}|${r.path}`, r);
    const made: Card[] = [];
    for (const r of latest.values()) {
      if (r.sha256 === v.sha256) continue;
      if (this.cards().some((c) => c.kind === "update" && c.repo === r.repo && c.asset === r.path && c.version === v.n && c.state !== "closed")) continue;
      const c: Card = { id: `L${Date.now().toString(36)}${randomBytes(2).toString("hex")}`, kind: "update", recipe: "replace-image", artifact: a.id, title: a.title, version: v.n, sha256: v.sha256!,
        repo: r.repo, base: this.repo(r.repo)?.base ?? "main", branch: null, commit: null, baseCommit: null, asset: r.path, pr: null, checks: [], ok: false, state: "draft", error: null,
        createdAt: now(), mergedAt: null, mergedBy: null, readme: null, diff: null, replaces: { version: r.version, sha256: r.sha256 } };
      this.save(c); made.push(c);
    }
    return made;
  }
  /** Prepare a draft update card: run the replace recipe into a fresh card and close the draft. */
  prepare(id: string): Card {
    const d = this.card(id); if (!d || d.state !== "draft") throw new Error("no such draft");
    const c = this.run({ artifact: d.artifact, version: d.version, repo: d.repo, kind: "update", replaces: d.replaces, asset: d.asset });
    d.state = "closed"; d.error = `prepared as ${c.id}`; this.save(d);
    return c;
  }

  /** A file from the card's commit, for the README preview (images only). */
  blob(id: string, path: string): { bytes: Uint8Array; type: string } | null {
    const c = this.card(id); if (!c?.commit) return null;
    const repo = this.repo(c.repo); if (!repo) return null;
    const p = posix.normalize(path.replace(/^\.\//, ""));
    if (p.startsWith("..") || !IMAGE.has(extname(p).toLowerCase())) return null;
    const r = git(repo.path, ["show", `${c.commit}:${p}`]);
    if (!r.ok) return null;
    const type = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" }[extname(p).toLowerCase()]!;
    return { bytes: r.bytes, type };
  }
}

export const imageSha = (p: string) => sha256File(p);
