// What a stored skill version needs to run (docs/units/skill-packages.md §1-§2): its scripts, the lockfiles that carry its
// dependencies, the runtimes and system programs it asks for, and the hosts its scripts and frontmatter name.
// Read from Studio's own copy of the version (data/skills/_library/<id>/v<N>/), never from the source, never run.
// The result is a reading aid and the input of the approval card; the sandbox is the enforcement.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { checkHost } from "./net";

export type ScriptLang = "python" | "node" | "shell" | "other";
export type ScriptInfo = { path: string; lang: ScriptLang; bytes: number; sha256: string; flags: string[] };
export type NpmLock = { kind: "npm"; dir: string; files: string[] };
export type PyLock = { kind: "uv" | "requirements" | "pep723"; dir: string; files: string[]; script?: string };
export type PackageInfo = {
  schema: 1;
  scripts: ScriptInfo[];
  /** the dependency lockfiles: at most one npm lock and one python lock (others are warned about, never installed) */
  npm: NpmLock | null; python: PyLock | null;
  runtimes: ("node" | "python")[];
  /** system programs the skill asks for: its frontmatter (metadata.requires.bins), named in its scripts or SKILL.md */
  bins: string[];
  /** hosts the version's scripts may reach: proposals from a scan of its scripts and from its frontmatter, never from the files a script reads */
  hosts: { scan: string[]; frontmatter: string[]; refused: string[] };
  warnings: string[];
};
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const SCRIPT_EXT: Record<string, ScriptLang> = { ".py": "python", ".js": "node", ".mjs": "node", ".cjs": "node", ".sh": "shell", ".bash": "shell", ".zsh": "shell", ".rb": "other", ".pl": "other", ".php": "other", ".lua": "other", ".ts": "other" };
/** programs a skill may ask for that Studio knows how to look for (src/skillpkg/recipes.ts) */
export const KNOWN_BINS = ["soffice", "libreoffice", "pdftoppm", "pdftocairo", "pdfinfo", "pdftotext", "gcc", "cc", "clang", "make", "ffmpeg", "ffprobe", "magick", "qpdf", "pandoc", "markitdown", "tesseract", "gs"];
/** XML namespace and schema hosts: identifiers, never contacted (a scan of OOXML tooling finds hundreds) */
const NAMESPACE_HOSTS = new Set(["www.w3.org", "w3.org", "schemas.openxmlformats.org", "schemas.microsoft.com", "purl.org", "ns.adobe.com", "www.xml.org", "xml.org", "schemas.xmlsoap.org", "docs.oasis-open.org", "relaxng.org", "www.example.com", "example.com", "example.org", "localhost"]);
const FLAGS: [string, RegExp][] = [
  ["network", /\b(requests\.|urllib|http\.client|fetch\(|socket\.|https?\.request|axios|curl\b|wget\b)/],
  ["delete-perm", /\b(rm\s+-rf|shutil\.rmtree|chmod|chown|fs\.rm(Sync)?\()/],
  ["env-secret", /(os\.environ|process\.env|~\/\.ssh|\.aws\b|\b[A-Z_]*(TOKEN|SECRET|API_KEY)\b)/],
  ["subprocess", /\b(subprocess|child_process|os\.system|execSync|spawnSync|Popen)\b/],
  ["install", /\b(pip3? install|npm (i|install)\b|brew install|apt(-get)? install|gem install|uv pip install)/],
  ["native", /\b(gcc|clang|LD_PRELOAD|DYLD_[A-Z_]+|ctypes)\b/],
  ["obfuscation", /\b(eval|exec)\s*\(\s*(base64|atob|codecs\.decode|bytes\.fromhex)|[A-Za-z0-9+/=]{1400,}/],
];

/** One stored version: SKILL.md beside a files/ folder holding the rest of the skill. */
export function analyzePackage(versionDir: string, files: string[]): PackageInfo {
  const root = join(versionDir, "files");
  const read = (rel: string) => { try { const st = lstatSync(join(root, rel)); return st.isFile() ? readFileSync(join(root, rel)) : null; } catch { return null; } };
  const skillMd = (() => { try { return readFileSync(join(versionDir, "SKILL.md"), "utf8"); } catch { return ""; } })();
  const warnings: string[] = [];
  const scripts: ScriptInfo[] = [];
  for (const f of [...files].sort()) {
    if (f.split("/").includes("node_modules")) continue;
    const b = read(f); if (!b) continue;
    const ext = extname(f).toLowerCase(), head = b.subarray(0, 200).toString("latin1");
    const shebang = head.startsWith("#!") ? head.split("\n")[0] : "";
    const lang: ScriptLang | null = SCRIPT_EXT[ext] ?? (shebang ? (/python/.test(shebang) ? "python" : /node|bun/.test(shebang) ? "node" : /sh\b/.test(shebang) ? "shell" : "other") : f.startsWith("scripts/") && !/\.(md|txt|json|xml|xsd|ya?ml|toml|lock|cfg|ini|csv)$/i.test(f) ? "other" : null);
    if (!lang) continue;
    const text = b.toString("utf8");
    scripts.push({ path: f, lang, bytes: b.length, sha256: sha(b), flags: FLAGS.filter(([, re]) => re.test(text)).map(([k]) => k) });
  }
  // lockfiles: the shallowest of each kind (a lockfile under node_modules is a dependency's own, never the skill's)
  const depth = (f: string) => f.split("/").length;
  const shallow = (re: RegExp) => files.filter((f) => re.test(basename(f)) && !f.split("/").includes("node_modules")).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  let npm: NpmLock | null = null;
  const npmLocks = shallow(/^package-lock\.json$/).filter((f) => files.includes(join(dirname(f), "package.json").replace(/^\.\//, "")));
  if (npmLocks.length) { const d = dirname(npmLocks[0]) === "." ? "" : dirname(npmLocks[0]); npm = { kind: "npm", dir: d, files: [d ? `${d}/package.json` : "package.json", npmLocks[0]] }; }
  if (npmLocks.length > 1) warnings.push(`more than one package-lock.json: only ${npmLocks[0]} is installed`);
  if (!npm && shallow(/^package\.json$/).length) warnings.push("package.json without a package-lock.json: no dependency is installed (a lockfile is needed)");
  let python: PyLock | null = null;
  const uv = shallow(/^uv\.lock$/)[0];
  if (uv) { const d = dirname(uv) === "." ? "" : dirname(uv); python = { kind: "uv", dir: d, files: [uv] }; }
  if (!python) for (const r of shallow(/^requirements[\w.-]*\.txt$/)) {
    const t = read(r)?.toString("utf8") ?? ""; const reqs = requirementLines(t);
    if (reqs.length && reqs.every((l) => /--hash=sha256:[a-f0-9]{64}/.test(l))) { python = { kind: "requirements", dir: dirname(r) === "." ? "" : dirname(r), files: [r] }; break; }
    if (reqs.length) warnings.push(`${r} pins no hash for every requirement, so it is not a lockfile: nothing from it is installed`);
  }
  if (!python) for (const s of scripts.filter((s) => s.lang === "python")) {
    if (!/^# \/\/\/ script\s*$/m.test(read(s.path)?.toString("utf8") ?? "")) continue;
    if (files.includes(`${s.path}.lock`)) { python = { kind: "pep723", dir: dirname(s.path) === "." ? "" : dirname(s.path), files: [`${s.path}.lock`], script: s.path }; break; }
    warnings.push(`${s.path} declares its dependencies inline (PEP 723) with no ${basename(s.path)}.lock beside it: nothing is installed (uv lock --script makes one)`);
  }
  // modules the scripts import that no lockfile installs: a warning (the scan is approximate)
  const local = new Set(files.flatMap((f) => f.split("/").map((p) => p.replace(/\.py$/, ""))));
  const pyMods = new Set<string>();
  for (const s of scripts.filter((s) => s.lang === "python")) for (const m of (read(s.path)?.toString("utf8") ?? "").matchAll(/^\s*(?:from\s+([A-Za-z_][\w]*)[\w.]*\s+import|import\s+([A-Za-z_][\w]*))/gm)) { const n = m[1] ?? m[2]; if (n && !PY_STDLIB.has(n) && !local.has(n)) pyMods.add(n); }
  if (pyMods.size && !python) warnings.push(`the Python scripts import ${[...pyMods].sort().join(", ")}, and no lockfile installs them: they run only where the runtime already has them`);
  const runtimes = [...new Set([...(npm || scripts.some((s) => s.lang === "node") ? ["node" as const] : []), ...(python || scripts.some((s) => s.lang === "python") ? ["python" as const] : [])])];
  const fm = frontmatter(skillMd);
  // system programs: declared in the frontmatter, or named as a program in a script or the SKILL.md text
  const bins = new Set<string>();
  const declared = (fm?.metadata?.requires?.bins ?? fm?.requires?.bins) as unknown;
  if (Array.isArray(declared)) for (const b of declared) if (typeof b === "string" && /^[a-z0-9][a-z0-9._+-]{0,40}$/.test(b)) bins.add(b);
  const named = (t: string) => { for (const b of KNOWN_BINS) if (new RegExp(`(?:^|[\\s\`'"\\[(,/])${b.replace(/[+]/g, "\\+")}(?=[\\s\`'",)\\]]|$)`, "m").test(t)) bins.add(b); };
  for (const s of scripts) named(read(s.path)?.toString("utf8") ?? ""); named(skillMd.replace(/^---[\s\S]*?\n---/, ""));
  if (bins.has("libreoffice")) { bins.delete("libreoffice"); bins.add("soffice"); }
  // hosts: URLs a script names (an XML namespace is an identifier, not a host), and the frontmatter's
  const scan = new Set<string>(), front = new Set<string>(), refused = new Set<string>();
  const add = (set: Set<string>, h: string) => { const c = checkHost(h); if (c.ok) set.add(c.host); else refused.add(`${h}: ${c.why}`); };
  for (const s of scripts) for (const line of (read(s.path)?.toString("utf8") ?? "").split("\n")) {
    if (/xmlns|namespace|\bNS\b|_NS\b|schema/i.test(line)) continue;
    for (const m of line.matchAll(/(?<![{\w])https?:\/\/([A-Za-z0-9.-]+|\[[0-9a-fA-F:.]+\])(?::\d+)?/g)) { const h = m[1].toLowerCase(); if (!NAMESPACE_HOSTS.has(h)) add(scan, h); }
  }
  const fmHosts: unknown[] = [fm?.metadata?.hosts, fm?.metadata?.network, fm?.metadata?.requires?.hosts, fm?.hosts].flatMap((v) => Array.isArray(v) ? v : typeof v === "string" ? [v] : []);
  for (const h of fmHosts) if (typeof h === "string") add(front, h.replace(/^https?:\/\//, "").replace(/[/:].*$/, ""));
  if (typeof fm?.compatibility === "string") for (const m of fm.compatibility.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) add(front, m[1]);
  return { schema: 1, scripts, npm, python, runtimes, bins: [...bins].sort(), hosts: { scan: [...scan].sort(), frontmatter: [...front].sort(), refused: [...refused].sort() }, warnings };
}
/** The hosts a version proposes: what its approval allows skill_run to reach. */
export const proposedHosts = (p: PackageInfo) => [...new Set([...p.hosts.scan, ...p.hosts.frontmatter])].sort();
/** requirement lines of a requirements file, continuation lines joined (comments and options dropped) */
export function requirementLines(t: string): string[] {
  return t.replace(/\\\r?\n/g, " ").split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, "").trim()).filter((l) => l && !l.startsWith("-"));
}
function frontmatter(text: string): any {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text); if (!m) return null;
  try { const v = (Bun as any).YAML.parse(m[1]); return v && typeof v === "object" ? v : null; } catch { return null; }
}
const PY_STDLIB = new Set(("__future__ abc argparse array ast asyncio base64 binascii bisect builtins bz2 calendar cmath codecs collections colorsys concurrent configparser contextlib copy csv ctypes " +
  "dataclasses datetime decimal difflib dis email enum errno fnmatch fractions functools gc getopt getpass gettext glob gzip hashlib heapq hmac html http imaplib importlib inspect io ipaddress " +
  "itertools json keyword linecache locale logging lzma math mimetypes multiprocessing numbers operator optparse os pathlib pickle platform plistlib posixpath pprint queue random re " +
  "reprlib resource sched secrets select shlex shutil signal site socket sqlite3 ssl stat statistics string struct subprocess sys sysconfig tarfile tempfile textwrap threading time timeit " +
  "token tokenize traceback types typing unicodedata unittest urllib uuid warnings weakref xml zipfile zlib zoneinfo").split(" "));
