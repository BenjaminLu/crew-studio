// A project's GitHub grant (adapters/github.ts GitHubProjectGrant). Only the captain's
// "Connect to GitHub" card writes one (src/github-connect.ts); it is signed with Studio's
// local key over the project identity it was approved for (id, path, base). Projects
// .assertExecutable checks it before any run on the project uses it: the signature, the
// grant's own shape, its path and base against the registration, and the local
// repository's origin against the granted repository.
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ledgerKey } from "./runtime/checks";
import { validateGitHubGrant, type GitHubProjectGrant } from "./adapters/github";

const canonical = (v: any): string => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v ?? null);

export type GrantProject = { id: string; path: string | null; base: string; github?: GitHubProjectGrant };

/** The signature over the grant and the project it was approved for; the signature field itself is left out. */
export function grantSignature(dataDir: string, project: { id: string; path: string | null; base: string }, grant: GitHubProjectGrant): string {
  const { signature: _, ...g } = grant as GitHubProjectGrant & { signature?: string };
  return createHmac("sha256", ledgerKey(dataDir)).update(canonical({ schema: 1, project: project.id, path: project.path, base: project.base, grant: g })).digest("hex");
}

/** owner/repo of a github.com remote URL (https, ssh or scp form), or null. */
export function githubSlugOf(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const m = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The local repository's origin, read from its Git config file (no Git command, no hook). Config includes and URL rewrites make it unverifiable. */
export function originOf(repoPath: string): { url: string | null; pushUrl: string | null } {
  let git = join(realpathSync(repoPath), ".git");
  if (statSync(git).isFile()) { const t = readFileSync(git, "utf8").trim(); if (!t.startsWith("gitdir: ") || t.includes("\n")) throw new Error("Malformed Git directory reference"); git = resolve(repoPath, t.slice(8)); }
  const commondir = join(git, "commondir"); if (existsSync(commondir)) git = resolve(git, readFileSync(commondir, "utf8").trim());
  const file = join(realpathSync(git), "config"), st = lstatSync(file);
  if (!st.isFile() || st.size > 256 * 1024) throw new Error("Repository Git config is unavailable or oversized");
  let section = "", url: string[] = [], push: string[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const l = raw.trim(); if (!l || l.startsWith("#") || l.startsWith(";")) continue;
    const s = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]$/.exec(l);
    if (s) { section = `${s[1].toLowerCase()}${s[2] !== undefined ? ` ${s[2]}` : ""}`; if (/^include(if)?\b/.test(section) || section.startsWith("url ")) throw new Error("Repository Git config includes other files or rewrites URLs; its origin cannot be verified"); continue; }
    if (section !== 'remote origin') continue;
    const kv = /^([A-Za-z0-9-]+)\s*=\s*(.*)$/.exec(l); if (!kv) continue;
    const key = kv[1].toLowerCase(), value = kv[2].replace(/^"(.*)"$/, "$1").trim();
    if (key === "url") url.push(value); else if (key === "pushurl") push.push(value);
  }
  if (url.length > 1 || push.length > 1) throw new Error("Repository origin has several URLs");
  return { url: url[0] ?? null, pushUrl: push[0] ?? null };
}

/** Throws with the reason when the project's grant is not the one the captain approved for this exact project and repository. */
export function verifyGitHubGrant(dataDir: string, project: GrantProject, base?: string): GitHubProjectGrant {
  const g = project?.github as (GitHubProjectGrant & { signature?: string }) | undefined;
  if (!g) throw new Error("This project has no GitHub grant");
  validateGitHubGrant(g);
  const expected = Buffer.from(grantSignature(dataDir, project, g), "hex"), got = Buffer.from(typeof g.signature === "string" && /^[a-f0-9]{64}$/.test(g.signature) ? g.signature : "", "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new Error("GitHub grant is not signed by this Studio for this project; connect it again from the captain card");
  if (!project.path) throw new Error("GitHub grant names no local repository");
  let local: string, granted: string;
  try { local = realpathSync(project.path); granted = realpathSync(g.localPath); } catch { throw new Error("GitHub grant's local repository is unavailable"); }
  if (local !== granted) throw new Error("GitHub grant names another local repository");
  if (g.base !== project.base || (base !== undefined && base !== project.base)) throw new Error("GitHub grant base does not match the registered base");
  if (g.operations && (g.operations.version !== 1 || g.operations.repository !== g.repository)) throw new Error("GitHub operation grant names another repository");
  const origin = originOf(local);
  if (origin.pushUrl !== null && origin.pushUrl !== origin.url) throw new Error("Repository origin pushes somewhere else than it fetches");
  if (g.mode === "github") { if (githubSlugOf(origin.url)?.toLowerCase() !== g.repository.toLowerCase()) throw new Error(`Repository origin is not github.com/${g.repository}`); }
  else if (!origin.url || resolve(local, origin.url) !== resolve(g.pushUrl)) throw new Error("Repository origin is not the granted simulator repository");
  return g;
}
