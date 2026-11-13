import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Release brief"), the pure part: what a merged pull request asks for before it
// goes live, found by path rules and by the lines its diff adds (each item with the address it came from), the suggested
// alert rule for a metric it adds, its body's rollout section quoted, and the batches (dependent pull requests in
// different batches, independent ones together, a dependency that was not selected added to the batch before).
//   bun tests/pr-watch-release.ts
import { suite } from "./rt-harness";
import * as X from "../src/pr-watch-release";

const { ok, end } = suite("pr-watch-release");
const patch = (start: number, lines: string[]) => [`@@ -0,0 +${start},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n");

// ---------- the diff ----------
{
  const p = X.patchLines("@@ -10,3 +10,4 @@ ctx\n keep\n-old line\n+new line\n+another\n keep2\n\\ No newline at end of file");
  ok(JSON.stringify(p.added) === JSON.stringify([{ line: 11, text: "new line" }, { line: 12, text: "another" }]) && p.removed.join() === "old line", "added lines carry their line in the new file; removed lines their text");
  ok(X.envReads('const a = process.env.API_URL; const b = process.env["VENDOR_KEY"]').join() === "API_URL,VENDOR_KEY", "Node environment reads");
  ok(X.envReads('url := os.Getenv("API_URL")').join() === "API_URL" && X.envReads('x = os.environ.get("DB_HOST")').join() === "DB_HOST" && X.envReads('System.getenv("API_SECRET")').join() === "API_SECRET"
    && X.envReads('@Value("${vendor.timeout:30}")').join() === "vendor.timeout" && X.envReads('ENV.fetch("REDIS_URL")').join() === "REDIS_URL" && X.envReads('env::var("PORT")').join() === "PORT", "Go, Python, Java, Spring, Ruby and Rust reads");
  ok(!X.envReads("const env = processEnv.X; // process.envy").length, "nothing else reads as configuration");
}
// ---------- metrics ----------
{
  const m = (lines: string[]) => X.metricsAdded(lines.map((text, i) => ({ line: i + 1, text })));
  const go = m(['var failures = promauto.NewCounterVec(prometheus.CounterOpts{', '  Name: "vendor_failures_total",', '  Help: "vendor calls that failed",', '}, []string{"op", "reason"})']);
  ok(go.length === 1 && go[0].name === "vendor_failures_total" && go[0].type === "counter" && go[0].labels.join() === "op,reason" && go[0].zero === false && go[0].line === 1, "Go: a labelled counter, its series appear on the first increment", JSON.stringify(go));
  ok(m(['var up = prometheus.NewGauge(prometheus.GaugeOpts{Name: "queue_depth"})'])[0]?.zero === true, "Go: an unlabelled gauge starts at 0");
  const node = m(['const c = new client.Counter({ name: "orders_failed_total", help: "x", labelNames: ["reason"] });']);
  ok(node[0]?.name === "orders_failed_total" && node[0].labels.join() === "reason" && node[0].type === "counter", "Node prom-client", JSON.stringify(node));
  const java = m(['Counter.builder("vendor.failures")', '    .tag("op", op).tag("reason", reason)', '    .register(registry);']);
  ok(java[0]?.name === "vendor.failures" && java[0].labels.join() === "op,reason" && java[0].zero === true, "Java Micrometer: a registered builder starts at 0", JSON.stringify(java));
  const py = m(['FAILS = Counter("export_failures_total", "exports that failed", ["format"])']);
  ok(py[0]?.name === "export_failures_total" && py[0].labels.join() === "format" && py[0].zero === false, "Python prometheus_client", JSON.stringify(py));
  ok(m(['FAILS = Counter("export_failures_total", "x", ["format"])', 'FAILS.labels("csv").inc(0)'])[0].zero === true, "an explicit zero increment initialises the series");
  ok(!m(["const counter = 0; counter++;"]).length, "a variable called counter is no metric");
  const s = X.suggestRule({ name: "vendor_failures_total", type: "counter", labels: ["op", "reason"], zero: true }, "publisher");
  ok(s.expr === 'sum by (op, reason) (increase(vendor_failures_total{job="publisher"}[5m])) > 0' && s.for === "0m" && s.noData === "Alerting" && s.up === 'up{job="publisher"} == 0', "the suggested rule for a counter: increase over 5 minutes, for 0m, no data alerts, and up == 0", JSON.stringify(s));
  ok(/histogram_quantile\(0\.99, sum by \(le\) \(rate\(latency_seconds_bucket/.test(X.suggestRule({ name: "latency_seconds", type: "histogram", labels: [], zero: true }, "api").expr), "a histogram: the 99th percentile");
}
// ---------- the rollout section ----------
{
  ok(X.rolloutSection("Adds a check.\n\n## Rollout\nIf the value equals the old default the service refuses to start: change it first.\n\n## Tests\nunit")?.quote === "If the value equals the old default the service refuses to start: change it first.", "a Rollout heading: its section, quoted as written");
  ok(X.rolloutSection("### 上線注意\n先跑 migration\n再換 image")?.quote === "先跑 migration\n再換 image" && X.rolloutSection("**Deploy notes:** run the backfill first")?.quote === "run the backfill first", "a Chinese heading, and a bold label with text on the same line");
  ok(X.rolloutSection("## Summary\nnothing about it") === null && X.rolloutSection("## Rollout\n<!-- fill in -->\n") === null, "no section, or only a template comment: nothing");
}
// ---------- the items, each with its address ----------
{
  const pr = { id: "o/svc#7", repo: "o/svc", number: 7, mergeSha: "a".repeat(40), body: "## Rollout\nSet VENDOR_KEY before deploying.",
    files: [{ filename: "migrations/0042_orders_cas.sql", status: "added", patch: patch(1, ["ALTER TABLE orders ADD COLUMN cas_version int;"]) },
      { filename: "src/config.ts", status: "modified", patch: "@@ -1,2 +1,3 @@\n-const a = process.env.API_URL;\n+const a = process.env.API_URL;\n+const k = process.env.VENDOR_KEY;\n const b = 1;" },
      { filename: "k8s/app.yaml", status: "modified", patch: patch(20, ["---", "apiVersion: v1", "kind: Secret", "metadata:", "  name: vendor-creds"]) },
      { filename: "src/metrics.go", status: "modified", patch: patch(18, ['var f = promauto.NewCounterVec(prometheus.CounterOpts{Name: "vendor_failures_total"}, []string{"op"})']) },
      { filename: "README.md", status: "modified", patch: patch(1, ["Set process.env.DOCS_ONLY"]) }] };
  const ops = X.opsOf(pr);
  const kinds = ops.map((o) => `${o.kind}:${o.path ?? "body"}${o.line ? `:${o.line}` : ""}${o.names?.length ? `:${o.names.join("|")}` : ""}`);
  ok(kinds.includes("migration:migrations/0042_orders_cas.sql") && kinds.includes("secret:src/config.ts:2:VENDOR_KEY") && !kinds.some((k) => k.includes("API_URL")) && kinds.includes("k8s-secret:k8s/app.yaml:22:vendor-creds") && kinds.includes("metric:src/metrics.go:18") && kinds.includes("rollout:body"), "a migration, a newly read secret (a read that only moved is not new), a Kubernetes Secret, a metric and the rollout section", JSON.stringify(kinds));
  ok(ops.every((o) => o.url.startsWith("https://github.com/o/svc/")) && ops.find((o) => o.kind === "metric")!.url === `https://github.com/o/svc/blob/${"a".repeat(40)}/src/metrics.go#L18` && ops.find((o) => o.kind === "rollout")!.url === "https://github.com/o/svc/pull/7", "every item has the address of the file and line (the body's: the pull request) at the merge commit");
  ok(X.opsOf({ ...pr, files: [{ filename: "db/schema/0001.sql", status: "added", patch: null }] }, { migration: ["/db/schema/"], config: [], secret: [] }).some((o) => o.kind === "migration") && !X.opsOf({ ...pr, body: "", files: [{ filename: "db/schema/0001.sql", status: "added", patch: null }] }, { migration: [], config: [], secret: [] }).length, "the path rules are the captain's: an emptied list finds nothing");
  ok(X.opsOf({ ...pr, files: [{ filename: "deploy/secrets/prod.env", status: "modified", patch: patch(1, ["X=1"]) }] }, { migration: [], config: [], secret: ["/deploy/secrets/"] }).some((o) => o.kind === "secret" && o.path === "deploy/secrets/prod.env"), "a secret path rule");
}
// ---------- batches ----------
{
  const rows = [{ id: "o/gw#209", deps: [] }, { id: "o/gw#211", deps: [{ id: "o/gw#209", state: "merged" }] }, { id: "o/pub#86", deps: [] }, { id: "o/pub#87", deps: [{ id: "o/pub#86", state: "merged" }] }, { id: "o/pub#90", deps: [{ id: "o/pub#89", state: "open" }] }];
  const b = X.batchesOf(["o/gw#209", "o/gw#211", "o/pub#86", "o/pub#87"], rows);
  ok(JSON.stringify(b.batches) === JSON.stringify([["o/gw#209", "o/pub#86"], ["o/gw#211", "o/pub#87"]]) && !b.added.length, "dependent pull requests in different batches; independent ones of different services share one", JSON.stringify(b));
  ok(b.forced.map((f) => `${f.pr}>${f.on}`).join() === "o/gw#211>o/gw#209,o/pub#87>o/pub#86", "each batch knows the dependency that forces it");
  const c = X.batchesOf(["o/gw#211"], rows);
  ok(JSON.stringify(c.batches) === JSON.stringify([["o/gw#209"], ["o/gw#211"]]) && c.added[0]?.id === "o/gw#209" && c.added[0].for === "o/gw#211", "a dependency the captain did not select is added to the batch before, with the reason", JSON.stringify(c));
  ok(X.batchesOf(["o/gw#211"], [{ id: "o/gw#211", deps: [{ id: "o/gw#209", state: "live" }] }]).batches.length === 1, "a dependency already live holds nothing back");
  ok(X.batchesOf(["o/pub#90"], rows).notMerged[0]?.on === "o/pub#89", "a dependency not merged yet is a warning");
  ok(X.batchesOf(["o/a#1", "o/a#2"], [{ id: "o/a#1", deps: [{ id: "o/a#2", state: "merged" }] }, { id: "o/a#2", deps: [{ id: "o/a#1", state: "merged" }] }]).batches.flat().length === 2, "a cycle does not hang: every pull request lands in a batch");
}
end();
