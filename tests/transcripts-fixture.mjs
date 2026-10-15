// A temp firstmate state and Studio data folder for the transcripts tests: one
// clean worker round (prompt with every section and a bound brief, a stream,
// a report), one reviewer round with planted secrets, a main session JSONL with
// 50 captain turns, and one Studio agent node run. No real data.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TOKEN = "ghp_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2";
export const BEARER = "c0ffee" + "1234567890abcdef1234567890abcdef12345678";
/** values that only a key names: a redactor that looks at values alone lets them through */
export const KEYED = ["hunter2" + "hunter2", "plain" + "value" + "99", "keyed" + "apikey" + "77", "header" + "secret" + "55"];

export function buildFixture(root) {
  const state = join(root, "state"), data = join(root, "data");
  const head = "34d57976c61a57af043d1536596334043f9afe20";
  const briefText = "# T-900 fix round 2 - one red on CI\n\nShard 1 is red on tests/demo.test.sh:15. Fix the split, and every place with the same cause.";
  const promptClean = [
    "You are explicitly dispatched worker. Canonical crew identity: worker-fix-t900-r1. Task: T-900.",
    "", "---", "name: worker", "description: Implement one task.", "---", "",
    "# Worker", "", "## What you do", "", "Build the task inside the worktree.", "", "---", "",
    "# Approved spec pin", "", "{\"task\": \"T-900\", \"version\": 1}", "",
    "# Your task", "", "```json", "{\"id\":\"T-900\",\"title\":\"Even shards\"}", "```", "", "---", "",
    "# This is not the first round", "", "Build on your branch.", "", "---",
    "# Approved local brief", "", briefText, "",
    "# Context pack", "", "## The required check is red", "", "See the failing log below.", "",
    "# Local review history", "", "(none)", "",
  ].join("\n");
  // worker round, finished, with a report
  const actor = "worker-fix-t900-r1", run = join(state, "runs", actor), att = join(run, "claude-aaa");
  mkdirSync(att, { recursive: true });
  writeFileSync(join(run, "identity.json"), JSON.stringify({ actor, role: "worker", task: "T-900", name: "fix", project: "demo", round: 2, attempt: 1, vendor: "claude", model_requested: "claude-opus-5-5", created: Date.now() / 1000 - 600 }));
  writeFileSync(join(run, "process.json"), JSON.stringify({ actor, pid: 999999 }));
  writeFileSync(join(att, "prompt.md"), promptClean);
  const bigSize = 60_000;
  const lines = [
    "fm-sandbox: a sandbox note",
    "[fm] worker-fix-t900-r1 worker started on T-900 (pid 1)",
    { type: "system", subtype: "init", model: "claude-opus-5-5", session_id: "s1" },
    { type: "assistant", message: { content: [{ type: "text", text: "I will look at the split first." }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls bin/lib", description: "List the library" } }] } },
    { type: "user", timestamp: "2026-10-14T00:44:16.639Z", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "fm_ci_shards.py\nfm_plan.py" }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "bin/lib/fm_ci_shards.py" } }] } },
    { type: "user", timestamp: "2026-10-14T00:44:18.719Z", message: { content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "x".repeat(bigSize) }] } },
    { type: "result", subtype: "success", result: "Fixed the split." },
  ];
  const cliLog = join(att, "cli.log");
  writeFileSync(cliLog, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  writeFileSync(join(att, "final.txt"), "**Fixed the split.** One cause, two places.\n");
  writeFileSync(join(run, "last-result.json"), JSON.stringify({ status: "completed", exit_code: 0 }));
  // the brief record it was bound to, and its source file
  const ev = join(state, "evidence", "demo", "T-900"); mkdirSync(ev, { recursive: true });
  writeFileSync(join(ev, "00000001-brief.json"), JSON.stringify({ project: "demo", task: "T-900", round: 2, actor: "firstmate", kind: "brief", head, authorized: true, time: "2026-10-14T00:40:00Z", text: briefText }));
  writeFileSync(join(ev, "00000002-pack.json"), JSON.stringify({ project: "demo", task: "T-900", round: 2, actor: "firstmate", kind: "pack", head, text: "pack" }));
  mkdirSync(join(state, "briefs"), { recursive: true });
  writeFileSync(join(state, "briefs", "T-900-fix1.md"), briefText + "\n");
  writeFileSync(join(state, "briefs", "T-900-other.md"), "another brief\n");
  // reviewer round with planted secrets in its prompt and stream
  const leak = "reviewer-leak-t900-r1", lrun = join(state, "runs", leak), latt = join(lrun, "claude-bbb");
  mkdirSync(latt, { recursive: true });
  writeFileSync(join(lrun, "identity.json"), JSON.stringify({ actor: leak, role: "reviewer", task: "T-900", name: "leak", project: "demo", round: 1, vendor: "claude", model_requested: "claude-opus-5-5", created: Date.now() / 1000 - 300 }));
  writeFileSync(join(lrun, "process.json"), JSON.stringify({ actor: leak, pid: 999998 }));
  const leakPrompt = `You are explicitly dispatched reviewer. Task: T-900.\n\n# Reviewer\n\nUse the token ${TOKEN} for the API.\ncurl -H "Authorization: Bearer ${BEARER}" https://example.invalid\n`;
  writeFileSync(join(latt, "prompt.md"), leakPrompt);
  writeFileSync(join(latt, "cli.log"), [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `GH_TOKEN=${TOKEN} gh pr view 1` } }] } },
    { type: "user", timestamp: "2026-10-14T00:50:00Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: `token: ${TOKEN}` }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "WebFetch", input: { url: "https://example.invalid", password: KEYED[0], env: { GITHUB_TOKEN: KEYED[1] }, headers: { Authorization: KEYED[3] } } }] } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(latt, "final.txt"), `Done. I used token: ${TOKEN} and Authorization: Bearer ${BEARER}.\n`);
  // the firstmate main session: 50 captain turns, each answered
  const session = join(root, "session.jsonl");
  const sl = [];
  for (let i = 0; i < 50; i++) {
    sl.push({ type: "user", isSidechain: false, timestamp: new Date(Date.UTC(2026, 9, 14, 0, i)).toISOString(), message: { role: "user", content: `turn ${i * 2}` } });
    sl.push({ type: "assistant", isSidechain: false, timestamp: new Date(Date.UTC(2026, 9, 14, 0, i, 30)).toISOString(), message: { role: "assistant", content: [{ type: "text", text: `turn ${i * 2 + 1}` }, { type: "tool_use", id: `tu${i}`, name: "Bash", input: { command: `echo ${i}` } }] } });
    sl.push({ type: "user", isSidechain: true, message: { role: "user", content: "a subagent line" } });
  }
  sl.push({ type: "assistant", isSidechain: false, timestamp: "2026-10-14T01:00:00Z", message: { role: "assistant", content: [{ type: "text", text: `the key is ${TOKEN}` }, { type: "tool_use", id: "tz", name: "Bash", input: { command: "curl", api_key: KEYED[2] } }] } });
  sl.push({ type: "user", isSidechain: false, timestamp: "2026-10-14T01:00:01Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tz", content: `Authorization: Bearer ${BEARER}` }] } });
  writeFileSync(session, sl.map((l) => JSON.stringify(l)).join("\n") + "\n");
  // one Studio agent node run, in the round-record layout (docs/units/round-record.md)
  const node = join(data, "runs", "R-1", "nodes", "build", "1"); mkdirSync(node, { recursive: true });
  const nodeHead = "9f1c2d3e4b5a69788796a5b4c3d2e1f0a9b8c7d6";
  const nodeBody = "# Agent node build\n\nBuild the change.\n\n# Brief\n\nFix the split; round 1.\n";
  const nodePrompt = `---\nrun: "R-1"\nnode: "build"\nround: 1\nhead: "${nodeHead}"\nbrief: "build@1#3"\nledger: [3,4]\nhop: 1\njob: "J1"\nprovider: "stub"\nmodel: null\nsent: "2026-10-14T03:00:00.000Z"\n---\n` + nodeBody;
  // a second node run with a secret in every file of its record
  const leakNode = join(data, "runs", "R-2", "nodes", "build", "1"); mkdirSync(leakNode, { recursive: true });
  writeFileSync(join(leakNode, "prompt.md"), `---\nrun: "R-2"\nnode: "build"\nround: 1\napi_token: "${KEYED[2]}"\n---\nUse ${TOKEN} to call the API.\n`);
  writeFileSync(join(leakNode, "system.md"), `system with Authorization: Bearer ${BEARER}\n`);
  writeFileSync(join(leakNode, "stream.jsonl"), [
    { ts: "2026-10-14T03:10:00Z", type: "tool_call", id: "c1", name: "http", args: { headers: { Authorization: KEYED[3] }, password: KEYED[0] } },
    { ts: "2026-10-14T03:10:01Z", type: "tool_result", id: "c1", result: `token=${TOKEN}` },
    { ts: "2026-10-14T03:10:02Z", type: "status", status: "failed", error: "gave up" },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(leakNode, "report.json"), JSON.stringify({ status: "failed", said: `the key ${TOKEN}`, env: { GITHUB_TOKEN: KEYED[1] } }));
  // a node run that ended (terminal status) without report.json
  const endedNode = join(data, "runs", "R-3", "nodes", "check", "1"); mkdirSync(endedNode, { recursive: true });
  writeFileSync(join(endedNode, "prompt.md"), "---\nrun: \"R-3\"\n---\nCheck it.\n");
  writeFileSync(join(endedNode, "stream.jsonl"), [{ ts: "2026-10-14T03:20:00Z", type: "status", status: "started" }, { ts: "2026-10-14T03:20:05Z", type: "status", status: "cancelled" }].map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(node, "prompt.md"), nodePrompt);
  writeFileSync(join(node, "prompt.hop2.md"), `---\nrun: "R-1"\nnode: "build"\nround: 1\nhop: 2\n---\nhand-off prompt\n`);
  writeFileSync(join(node, "system.md"), "You are the builder.\n");
  writeFileSync(join(node, "stream.jsonl"), [
    { ts: "2026-10-14T03:00:00.100Z", type: "status", status: "started", prompt: "prompt.md", run: "R-1" },
    { ts: "2026-10-14T03:00:01.000Z", type: "message", text: "node says hi" },
    { ts: "2026-10-14T03:00:02.000Z", type: "tool_call", id: "c1", name: "note_write", args: { a: 1 } },
    { ts: "2026-10-14T03:00:03.000Z", type: "tool_result", id: "c1", error: null, rows: 1, result: "written" },
    { ts: "2026-10-14T03:00:04.000Z", type: "status", status: "done", error: null },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(node, "report.json"), JSON.stringify({ job: "J1", status: "done", error: null, said: "node report", tools: 1, cost: 0.01, prompt: "prompt.md" }));
  // a node round retried: attempt 1, attempt 2, and a hand-off in attempt 2 (agent.ts roundRecord names),
  // one shared stream.jsonl split by each invocation's "started" status, report.json naming its prompt
  const retried = join(data, "runs", "R-4", "nodes", "make", "1"); mkdirSync(retried, { recursive: true });
  const hdr = (a, h) => `---\nrun: "R-4"\nnode: "make"\nround: 1\nattempt: ${a}\nhop: ${h}\nhead: "${"a".repeat(40)}"\n---\n`;
  writeFileSync(join(retried, "prompt.md"), hdr(1, 0) + "attempt 1 prompt\n"); writeFileSync(join(retried, "system.md"), "sys a1\n");
  writeFileSync(join(retried, "prompt.attempt2.md"), hdr(2, 0) + "attempt 2 prompt\n"); writeFileSync(join(retried, "system.attempt2.md"), "sys a2\n");
  writeFileSync(join(retried, "prompt.attempt2.hop1.md"), hdr(2, 1) + "attempt 2 hand-off prompt\n"); writeFileSync(join(retried, "system.attempt2.hop1.md"), "sys a2 h1\n");
  writeFileSync(join(retried, "stream.jsonl"), [
    { ts: "2026-10-14T04:00:00Z", type: "status", status: "started", prompt: "prompt.md" }, { ts: "2026-10-14T04:00:01Z", type: "message", text: "a1 says" },
    { ts: "2026-10-14T04:00:02Z", type: "status", status: "failed", error: "timeout" },
    { ts: "2026-10-14T04:01:00Z", type: "status", status: "started", prompt: "prompt.attempt2.md" }, { ts: "2026-10-14T04:01:01Z", type: "message", text: "a2 says" },
    { ts: "2026-10-14T04:01:30Z", type: "status", status: "done" },
    { ts: "2026-10-14T04:02:00Z", type: "status", status: "started", prompt: "prompt.attempt2.hop1.md" }, { ts: "2026-10-14T04:02:01Z", type: "message", text: "a2 h1 says" },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(retried, "report.json"), JSON.stringify({ status: "done", said: "a2 report", prompt: "prompt.attempt2.md" })); // attempt 2 ended, then handed off; the hand-off still runs
  // the engine's state (src/runtime/engine.ts): the run runs, and node make is in its round 1
  writeFileSync(join(data, "runs", "R-4", "run.json"), JSON.stringify({ id: "R-4", status: "running", queue: [], nodes: { make: { state: "running", visits: 1, attempt: 1 } } }));
  // a retried round whose attempts have their own stream and report files
  const split = join(data, "runs", "R-5", "nodes", "make", "1"); mkdirSync(split, { recursive: true });
  writeFileSync(join(split, "prompt.md"), "---\nrun: \"R-5\"\nattempt: 1\n---\nfirst\n"); writeFileSync(join(split, "stream.jsonl"), JSON.stringify({ ts: "2026-10-14T05:00:00Z", type: "message", text: "first stream" }) + "\n");
  writeFileSync(join(split, "report.json"), JSON.stringify({ status: "failed", said: "first report" }));
  writeFileSync(join(split, "prompt.attempt2.md"), "---\nrun: \"R-5\"\nattempt: 2\n---\nsecond\n"); writeFileSync(join(split, "stream.attempt2.jsonl"), JSON.stringify({ ts: "2026-10-14T05:01:00Z", type: "message", text: "second stream" }) + "\n");
  writeFileSync(join(split, "report.attempt2.json"), JSON.stringify({ status: "done", said: "second report" }));
  // a node round for the stale-response test: two attempts, the run still running
  const race = join(data, "runs", "R-7", "nodes", "make", "1"); mkdirSync(race, { recursive: true });
  writeFileSync(join(race, "prompt.md"), "---\nrun: \"R-7\"\nattempt: 1\n---\nA prompt\n");
  writeFileSync(join(race, "prompt.attempt2.md"), "---\nrun: \"R-7\"\nattempt: 2\n---\nB prompt\n");
  writeFileSync(join(race, "stream.jsonl"), [
    { ts: "2026-10-14T07:00:00Z", type: "status", status: "started", prompt: "prompt.md" }, { ts: "2026-10-14T07:00:01Z", type: "message", text: "a says" },
    { ts: "2026-10-14T07:00:02Z", type: "status", status: "failed", error: "x" },
    { ts: "2026-10-14T07:01:00Z", type: "status", status: "started", prompt: "prompt.attempt2.md" }, { ts: "2026-10-14T07:01:01Z", type: "message", text: "b says" },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(data, "runs", "R-7", "run.json"), JSON.stringify({ id: "R-7", status: "running", queue: [], nodes: { make: { state: "running", visits: 1, attempt: 1 } } }));
  // a second finished worker round with a report (for the report modal's stale-response test)
  { const two = "worker-two-t900-r1", r2 = join(state, "runs", two), a2 = join(r2, "claude-two"); mkdirSync(a2, { recursive: true });
    writeFileSync(join(r2, "identity.json"), JSON.stringify({ actor: two, role: "worker", task: "T-900", name: "two", project: "demo", round: 3, vendor: "claude", model_requested: "claude-opus-5-5", created: Date.now() / 1000 - 400 }));
    writeFileSync(join(r2, "process.json"), JSON.stringify({ actor: two, pid: 999997 }));
    writeFileSync(join(a2, "prompt.md"), "# Worker\n\nround three\n"); writeFileSync(join(a2, "cli.log"), JSON.stringify({ type: "result", subtype: "success", result: "done" }) + "\n");
    writeFileSync(join(a2, "final.txt"), "SECOND WORKER REPORT\n"); writeFileSync(join(r2, "last-result.json"), JSON.stringify({ status: "completed", exit_code: 0 })); }
  return { retried, state, data, actor, leak, latt, lrun, head, promptClean, cliLog, bigSize, session, nodePrompt, nodeBody, nodeHead, att };
}
