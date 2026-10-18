// Offline stand-in for the installed Claude CLI's free reads: `auth status --json` and the stream-json `initialize`
// control request (the model list). Never holds a credential and never answers a user turn: a user message fails the test.
// State lives in $HOME: .claude-models.json (the list to report), .claude-models-login (signed in), .claude-models-silent
// (an older CLI that does not answer initialize). Every invocation is traced to $HOME/.claude-models-trace.jsonl.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const home = process.env.HOME, args = process.argv.slice(2), trace = (x) => appendFileSync(join(home, ".claude-models-trace.jsonl"), JSON.stringify(x) + "\n");
const put = (x) => process.stdout.write(JSON.stringify(x) + "\n");
if (args.join(" ") === "auth status --json") {
  trace({ kind: "auth" });
  const loggedIn = existsSync(join(home, ".claude-models-login"));
  put(loggedIn ? { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "PRIVATE_ACCOUNT_DO_NOT_RETURN" } : { loggedIn: false, authMethod: "none", apiProvider: "firstParty" });
  process.exit(loggedIn ? 0 : 1);
}
const get = (k) => args[args.indexOf(k) + 1];
// the discovery's authority: print mode over stream-json, no prompt argument, no tools, no MCP, no settings, no session file
if (args[0] !== "-p" || get("--input-format") !== "stream-json" || get("--output-format") !== "stream-json" || get("--tools") !== "" || get("--setting-sources") !== "" || !args.includes("--no-session-persistence") || !args.includes("--restricted") || !args.includes("--strict-mcp-config")) {
  trace({ kind: "refused", args }); process.exit(2);
}
createInterface({ input: process.stdin }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  trace({ kind: m.type === "control_request" ? m.request?.subtype : m.type });
  if (m.type === "user") { put({ type: "result", subtype: "error", is_error: true, result: "a user turn reached the model-list fixture" }); process.exit(3); }
  if (m.type !== "control_request" || m.request?.subtype !== "initialize") return;
  if (existsSync(join(home, ".claude-models-silent"))) process.exit(0);
  const models = JSON.parse(readFileSync(join(home, ".claude-models.json"), "utf8"));
  put({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { models, claude_code_version: "9.9.9-fixture", account: { email: "PRIVATE_ACCOUNT_DO_NOT_RETURN" } } } });
}).on("close", () => process.exit(0));
