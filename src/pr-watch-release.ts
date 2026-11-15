// Pull requests (docs/units/pr-watch.md "Release brief"): the deterministic part of a release brief. What a merged pull
// request asks for before it goes live (上線前要處理), found by the captain's path rules and by scanning the lines its diff
// adds: database migrations, configuration and secrets it newly reads, Kubernetes ConfigMaps and Secrets, metrics it adds
// (with a suggested alert rule), and the rollout section of its own body, quoted. Every item names the file (and line) it
// came from: no link, no item. Then the batches: pull requests that depend on each other go in different batches, one
// deploy pull request and one brief each. No model, no network, no clock.
import { globMatch } from "./pr-watch-rules";

export type OpKind = "migration" | "config" | "secret" | "k8s-configmap" | "k8s-secret" | "metric" | "rollout";
export type Metric = { name: string; type: "counter" | "gauge" | "histogram" | "summary"; labels: string[];
  /** true: the series exist at 0 from the start (no labels, an explicit zero, or a registered builder); false: a labelled
   *  series appears only on its first increment */
  zero: boolean };
export type Op = { kind: OpKind; pr: string; path: string | null; line: number | null; url: string; names?: string[]; metric?: Metric; quote?: string; heading?: string };
/** Paths the captain marks: each list holds CODEOWNERS-style patterns (`migrations/`, `*.sql`, `/deploy/secrets/`). */
export type OpsRules = { migration: string[]; config: string[]; secret: string[] };
export const DEFAULT_OPS_RULES: OpsRules = { migration: ["migrations/", "migrate/", "*.sql"], config: [], secret: [] };
export type ChangedFile = { filename: string; status: string; patch: string | null };

const MAX_PATCH = 200_000, MAX_LINE = 500;
/** The lines a file's patch adds (with their line in the new file) and the text of the lines it removes. */
export function patchLines(patch: string | null): { added: { line: number; text: string }[]; removed: string[] } {
  const added: { line: number; text: string }[] = [], removed: string[] = []; let n = 0;
  for (const l of String(patch ?? "").slice(0, MAX_PATCH).split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l); if (h) { n = Number(h[1]); continue; }
    if (l.startsWith("+")) { if (l.length <= MAX_LINE) added.push({ line: n, text: l.slice(1) }); n++; }
    else if (l.startsWith("-")) { if (l.length <= MAX_LINE) removed.push(l.slice(1)); }
    else if (!l.startsWith("\\")) n++;
  }
  return { added, removed };
}

const VAR = "([A-Za-z_][A-Za-z0-9_.-]{0,80})";
/** Configuration a line reads by name: environment variables in the common languages, and Spring's @Value("${…}"). */
const ENV_READS = [
  new RegExp(String.raw`\b(?:process|Bun|Deno)\.env\.${VAR.replace("_.-", "_")}`, "g"), new RegExp(String.raw`\b(?:process|Bun)\.env\[\s*["'\`]${VAR}["'\`]\s*\]`, "g"),
  new RegExp(String.raw`\bDeno\.env\.get\(\s*["']${VAR}["']`, "g"), new RegExp(String.raw`\bos\.(?:Getenv|LookupEnv)\(\s*"${VAR}"`, "g"),
  new RegExp(String.raw`\bos\.environ(?:\.get)?\s*[\[(]\s*["']${VAR}["']`, "g"), new RegExp(String.raw`\bos\.getenv\(\s*["']${VAR}["']`, "g"),
  new RegExp(String.raw`\bSystem\.getenv\(\s*"${VAR}"`, "g"), new RegExp(String.raw`\bENV(?:\.fetch\(|\[)\s*["']${VAR}["']`, "g"),
  new RegExp(String.raw`\benv::var\(\s*"${VAR}"`, "g"), new RegExp(String.raw`@Value\(\s*"\$\{${VAR}(?::[^}]*)?\}"`, "g"),
  new RegExp(String.raw`\bgetenv\(\s*"${VAR}"`, "g"),
];
const SECRETY = /secret|token|password|passwd|credential|private[_-]?key|api[_-]?key|(?:^|[_.-])key$/i;
export function envReads(text: string): string[] {
  const out = new Set<string>();
  for (const re of ENV_READS) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

const METRIC_TYPES: Record<string, Metric["type"]> = { counter: "counter", gauge: "gauge", histogram: "histogram", summary: "summary", timer: "histogram", distributionsummary: "summary", upDownCounter: "gauge" };
const typeOf = (w: string): Metric["type"] | null => METRIC_TYPES[w.replace(/^New|Vec$|Opts$/g, "").replace(/^(.)/, (c) => c.toLowerCase())] ?? METRIC_TYPES[w.toLowerCase()] ?? null;
const strings = (s: string) => [...s.matchAll(/["'`]([A-Za-z_:][A-Za-z0-9_:.-]{0,100})["'`]/g)].map((m) => m[1]);
/**
 * The metrics a file's added lines create, from the common client libraries (Prometheus for Go, Python, Node and Java's
 * Micrometer): name, type, labels, and whether the series start at 0. Read from the added text in windows of a few lines
 * (a constructor often spans several), each window at most 600 characters.
 */
export function metricsAdded(added: { line: number; text: string }[]): (Metric & { line: number })[] {
  const out: (Metric & { line: number })[] = [], seen = new Set<string>();
  const all = added.map((a) => a.text).join("\n"), explicitZero = /\.(?:inc|add|Add|increment)\(\s*0\s*\)|WithLabelValues\([^)]*\)\.Add\(\s*0\s*\)/.test(all);
  for (let i = 0; i < added.length; i++) {
    const win = added.slice(i, i + 6).map((a) => a.text).join("\n").slice(0, 600), line = added[i].line;
    const push = (name: string, type: Metric["type"] | null, labels: string[], zero: boolean) => { if (!type || !name || seen.has(name)) return; seen.add(name); out.push({ name, type, labels: [...new Set(labels)].slice(0, 10), zero, line }); };
    let m: RegExpExecArray | null;
    // Go: prometheus.NewCounterVec(prometheus.CounterOpts{Name: "x", …}, []string{"a", "b"}) (also promauto)
    if ((m = /^(?:[^\n]*?)\b(?:prometheus|promauto|factory)\.(New(?:Counter|Gauge|Histogram|Summary)(?:Vec)?)\(\s*(?:prometheus\.)?\w*Opts\{([\s\S]*?)\}\s*(?:,\s*\[\]string\{([^}]*)\})?/.exec(win)) && m.index === 0) {
      const name = /Name:\s*"([^"]+)"/.exec(m[2])?.[1] ?? "", labels = m[3] ? strings(m[3]) : []; push(name, typeOf(m[1].replace(/^New/, "").replace(/Vec$/, "")), labels, !labels.length || explicitZero); continue; }
    // Node (prom-client): new Counter({ name: "x", help: "…", labelNames: ["a"] })
    if ((m = /^(?:[^\n]*?)\bnew\s+(?:\w+\.)?(Counter|Gauge|Histogram|Summary)\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(win)) && m.index === 0 && /\bname\s*:/.test(m[2])) {
      const name = /\bname\s*:\s*["'`]([^"'`]+)["'`]/.exec(m[2])?.[1] ?? "", labels = /\blabelNames\s*:\s*\[([^\]]*)\]/.exec(m[2]); const ls = labels ? strings(labels[1]) : []; push(name, typeOf(m[1]), ls, !ls.length || explicitZero); continue; }
    // Java (Micrometer): Counter.builder("x").tag("op", …).register(registry): registered at 0
    if ((m = /^(?:[^\n]*?)\b(Counter|Gauge|Timer|DistributionSummary)\.builder\(\s*"([^"]+)"([\s\S]*)/.exec(win)) && m.index === 0) {
      const ls = [...m[3].matchAll(/\.tag\(\s*"([^"]+)"/g)].map((x) => x[1]); push(m[2], typeOf(m[1]), ls, /\.register\(/.test(m[3])); continue; }
    // Java (Micrometer): registry.counter("x", "op", op) / Metrics.counter(…): tag keys at the odd places
    if ((m = /^(?:[^\n]*?)\b(?:registry|meterRegistry|Metrics)\.(counter|gauge|timer|summary)\(\s*"([^"]+)"((?:\s*,\s*[^,)]+)*)\)/.exec(win)) && m.index === 0) {
      const args = m[3].split(",").map((x) => x.trim()).filter(Boolean), ls = args.filter((_, k) => k % 2 === 0).map((x) => /^"([^"]+)"$/.exec(x)?.[1]).filter((x): x is string => !!x); push(m[2], typeOf(m[1]), ls, true); continue; }
    // Python (prometheus_client): Counter("x", "help", ["a", "b"]) / labelnames=[…]
    if ((m = /^(?:[^\n]*?)(?:^|[\s=(])(?:prometheus_client\.)?(Counter|Gauge|Histogram|Summary)\(\s*["']([A-Za-z_:][A-Za-z0-9_:]*)["']\s*,\s*["'][^"']*["']\s*(?:,\s*(?:labelnames\s*=\s*)?[[(]([^\])]*)[\])])?/.exec(win)) && m.index === 0) {
      const ls = m[3] ? strings(m[3]) : []; push(m[2], typeOf(m[1]), ls, !ls.length || explicitZero); continue; }
  }
  return out;
}

/** A suggested alert rule for a metric the diff adds: Studio cannot read the team's alert configuration, so this is a
 *  suggestion worked out from the metric alone. */
export function suggestRule(m: Metric, job: string): { expr: string; for: string; noData: "Alerting"; up: string } {
  const sel = `${m.name}{job="${job}"}`, by = m.labels.length ? `sum by (${m.labels.join(", ")}) ` : "sum ";
  const expr = m.type === "counter" ? `${by}(increase(${sel}[5m])) > 0`
    : m.type === "histogram" ? `histogram_quantile(0.99, sum by (le${m.labels.length ? `, ${m.labels.join(", ")}` : ""}) (rate(${m.name}_bucket{job="${job}"}[5m]))) > <threshold>`
    : m.type === "summary" ? `${by}(rate(${m.name}_count{job="${job}"}[5m])) > <threshold>`
    : `${sel} > <threshold>`;
  return { expr, for: m.type === "counter" ? "0m" : "5m", noData: "Alerting", up: `up{job="${job}"} == 0` };
}

/** The rollout section of a pull request body, quoted as written: a heading (or a bold or labelled line) naming the
 *  rollout, deploy or release, up to the next heading; at most 600 characters. */
export function rolloutSection(body: string): { heading: string; quote: string } | null {
  const lines = String(body ?? "").slice(0, 65536).replace(/\r\n/g, "\n").split("\n");
  const NAMED = /^(rollout|roll-out|deploy(?:ment)?(?: notes)?|release notes?|before (?:deploy|release)|上線(?:注意)?|上线(?:注意)?|部署(?:注意)?|發布|发布)(?=$|[\s:：(（\-])/i;
  const BOLD = /^\*\*([^*]+?)\s*[:：]?\s*\*\*\s*[:：]?\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim(), hd = /^#{1,6}\s+(.+?)\s*#*$/.exec(t), bd = hd ? null : BOLD.exec(t);
    const m = NAMED.exec(hd ? hd[1] : bd ? bd[1] : ""); if (!m) continue;
    const rest: string[] = bd && bd[2] ? [bd[2]] : [];
    for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]) && !BOLD.test(lines[j].trim()); j++) rest.push(lines[j]);
    const quote = rest.join("\n").trim().replace(/<!--[\s\S]*?-->/g, "").trim();
    if (quote) return { heading: m[1], quote: quote.length > 600 ? `${quote.slice(0, 600)}…` : quote };
  }
  return null;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
/** Every item a merged pull request asks for before it goes live, each with the address of the file (and line) or of the
 *  pull request it comes from. Addresses are built here from the validated repository, merge commit and path. */
export function opsOf(pr: { id: string; repo: string; number: number; mergeSha: string; body: string; files: ChangedFile[] }, rules: OpsRules = DEFAULT_OPS_RULES): Op[] {
  const out: Op[] = [], at = (path: string, line: number | null) => `https://github.com/${pr.repo}/blob/${pr.mergeSha}/${enc(path)}${line ? `#L${line}` : ""}`;
  const matches = (list: string[], path: string) => list.some((p) => globMatch(p, path) === true);
  for (const f of pr.files.slice(0, 300)) {
    if (!f.filename || f.status === "removed") continue;
    const path = f.filename, { added, removed } = patchLines(f.patch);
    if (matches(rules.migration, path) && f.status === "added" || matches(rules.migration, path) && added.length) out.push({ kind: "migration", pr: pr.id, path, line: null, url: at(path, null) });
    else if (matches(rules.secret, path)) out.push({ kind: "secret", pr: pr.id, path, line: null, url: at(path, null) });
    else if (matches(rules.config, path)) out.push({ kind: "config", pr: pr.id, path, line: null, url: at(path, null) });
    // configuration newly read: names on added lines that no removed line of the same file read
    const before = new Set(removed.flatMap(envReads)), seen = new Map<string, number>();
    for (const a of added) for (const n of envReads(a.text)) if (!before.has(n) && !seen.has(n)) seen.set(n, a.line);
    const names = [...seen.keys()], secret = names.filter((n) => SECRETY.test(n)), plain = names.filter((n) => !SECRETY.test(n));
    if (secret.length) out.push({ kind: "secret", pr: pr.id, path, line: seen.get(secret[0])!, url: at(path, seen.get(secret[0])!), names: secret });
    if (plain.length) out.push({ kind: "config", pr: pr.id, path, line: seen.get(plain[0])!, url: at(path, seen.get(plain[0])!), names: plain });
    // Kubernetes objects the diff adds
    if (/\.ya?ml$/i.test(path)) for (let i = 0; i < added.length; i++) { const k = /^\s*kind:\s*(ConfigMap|Secret)\s*$/.exec(added[i].text); if (!k) continue;
      const name = added.slice(i + 1, i + 8).map((a) => /^\s+name:\s*["']?([A-Za-z0-9._-]{1,100})["']?\s*$/.exec(a.text)?.[1]).find(Boolean);
      out.push({ kind: k[1] === "Secret" ? "k8s-secret" : "k8s-configmap", pr: pr.id, path, line: added[i].line, url: at(path, added[i].line), names: name ? [name] : [] }); }
    for (const m of metricsAdded(added)) { const { line, ...metric } = m; out.push({ kind: "metric", pr: pr.id, path, line, url: at(path, line), metric }); }
  }
  const r = rolloutSection(pr.body); if (r) out.push({ kind: "rollout", pr: pr.id, path: null, line: null, url: `https://github.com/${pr.repo}/pull/${pr.number}`, quote: r.quote, heading: r.heading });
  return out;
}

/**
 * The selected merged pull requests in batches: one that depends on another selected one goes in a later batch than it
 * (a batch is one deploy pull request and one brief, the next opened only once the one before runs in production).
 * Independent pull requests, of any repository, share a batch. A dependency that is merged but not live and was not
 * selected is added to the batch before, with the reason; one that is not merged yet is a warning.
 */
export function batchesOf(selected: string[], rows: { id: string; deps: { id: string; state: string }[] }[]): { batches: string[][]; added: { id: string; for: string }[]; notMerged: { id: string; on: string }[]; forced: { pr: string; on: string }[] } {
  const low = (x: string) => x.toLowerCase(), byId = new Map(rows.map((r) => [low(r.id), r]));
  const set = new Map<string, string>(), added: { id: string; for: string }[] = [], notMerged: { id: string; on: string }[] = [];
  for (const id of selected) { const r = byId.get(low(id)); if (r) set.set(low(r.id), r.id); }
  // the dependencies the captain did not select, as far as they go (a dependency's own dependencies too)
  for (let grew = true, guard = 0; grew && guard < 50; guard++) { grew = false;
    for (const id of [...set.values()]) for (const dp of byId.get(low(id))!.deps) {
      if (set.has(low(dp.id))) continue;
      if (dp.state === "merged" && byId.has(low(dp.id))) { const r = byId.get(low(dp.id))!; set.set(low(r.id), r.id); added.push({ id: r.id, for: id }); grew = true; }
      else if (dp.state === "open" || dp.state === "other") { if (!notMerged.some((x) => x.id === id && x.on === dp.id)) notMerged.push({ id, on: dp.id }); } } }
  const forced: { pr: string; on: string }[] = [], depth = new Map<string, number>();
  const level = (id: string, path: string[] = []): number => { const k = low(id); if (depth.has(k)) return depth.get(k)!; if (path.includes(k)) return 0; // a cycle: broken where it closes
    const on = byId.get(k)!.deps.filter((dp) => set.has(low(dp.id)));
    const d = on.length ? 1 + Math.max(...on.map((dp) => level(set.get(low(dp.id))!, [...path, k]))) : 0; depth.set(k, d); return d; };
  for (const id of set.values()) { level(id); for (const dp of byId.get(low(id))!.deps) if (set.has(low(dp.id))) forced.push({ pr: id, on: set.get(low(dp.id))! }); }
  const batches: string[][] = [];
  for (const id of set.values()) (batches[depth.get(low(id))!] ??= []).push(id);
  return { batches: batches.filter((b) => b?.length), added, notMerged, forced };
}
