import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A check that allows its gate without running anything (data.status "not-run": the repository declares no test command)
// keeps its pass, but never reads as a plain pass: its check row says "pass (not run: <reason>)" and carries the reason,
// a check node's summary counts what did not run, and the fail-first and CI gates (the merge card's gate list) say so.
import { harness, Y, until, suite } from "./rt-harness";
import { runGateDetail } from "../src/domain/code";

const { ok, end } = suite("not-run-visible");
const H = await harness([Y({ id: "nr", name: "Not run", roles: [], nodes: [
  { id: "ci", kind: "check", label: "CI", checks: [{ use: "t/nat", params: { want: "pass" } }, { use: "t/nat", params: { want: "not-run" } }], x: 0, y: 0 },
  { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["ci", "done", "pass"]] })]);
const E = H.engine, native = E.natives["test-native"];
const REASON = "the repository declares no test command";
E.natives["test-native"] = (i: any, hp: any) => i.params.want === "not-run"
  ? { verdict: "pass", score: 1, findings: [], evidence: [], proves: [], data: { status: "not-run", reason: REASON } } : native(i, hp);
try {
  const r = E.start({ workflow: "nr" });
  await until(() => ["succeeded", "failed"].includes(r.status), 10000);
  const ev = E.events(r.id);
  const rows = ev.filter((e: any) => e.type === "check_result" && e.node === "ci");
  const nr = rows.find((e: any) => e.notRun), plain = rows.find((e: any) => !e.notRun);
  ok(r.status === "succeeded" && r.nodes.ci.outcome === "pass", "the gate semantics stay: a not-run check still passes", `${r.status} ${r.nodes.ci?.outcome}`);
  ok(nr?.verdict === "pass" && nr.notRun === REASON && nr.summary.endsWith(`t/nat: pass (not run: ${REASON})`), "its check row says it was not run, and why", JSON.stringify(rows.map((e: any) => e.summary)));
  ok(!!plain && /t\/nat: pass$/.test(plain.summary), "a check that ran still reads as a plain pass", plain?.summary);
  const done = ev.find((e: any) => e.type === "node_done" && e.node === "ci");
  ok(/2\/2 pass \(1 not run: t\/nat\)/.test(done?.summary ?? ""), "the node summary counts the check that did not run", done?.summary);
  ok((r.nodes.ci.data?.results ?? []).some((x: any) => x.notRun === REASON), "the node's results carry the reason", JSON.stringify(r.nodes.ci.data?.results));
  // the merge card's gate list: the fail-first and CI gates over a not-run check
  const h = "a".repeat(40);
  ok(runGateDetail("fail-first", { verdict: "pass", head: h, data: { status: "not-run", reason: REASON } }) === `fail-first pass at aaaaaaaa (not run: ${REASON})`, "the fail-first gate says fail-first was not run, and why",
    runGateDetail("fail-first", { verdict: "pass", head: h, data: { status: "not-run", reason: REASON } }));
  ok(runGateDetail("CI", { verdict: "pass", head: h, data: { status: "not-run", reason: REASON } }) === `CI pass at aaaaaaaa (not run: ${REASON})`, "the CI gate says CI was not run, and why");
  ok(runGateDetail("CI", { verdict: "pass", head: h, data: { shards: [] } }) === "CI pass at aaaaaaaa" && runGateDetail("fail-first", null) === "fail-first never ran", "a check that ran, or never ran, reads as before");
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { H.stop(); }
end();
