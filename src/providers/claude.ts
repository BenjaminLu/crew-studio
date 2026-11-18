// Claude provider: `claude -p --output-format stream-json`, with every built-in
// tool removed and only the Studio MCP server loaded.
//   CREW_CLAUDE_BIN   executable (default "claude"); a .mjs/.ts path runs under bun (test stub)
//   CREW_CLAUDE_MODEL model (default claude-sonnet-5-5)
//   CREW_CLAUDE_MAX_OUTPUT_TOKENS  one reply's output cap, handed to the CLI as CLAUDE_CODE_MAX_OUTPUT_TOKENS (default 64000,
//                     4000 to 128000); the CLI's own default (32000 on some models) cuts a large file write mid-way
//   CREW_CLAUDE_INIT_TIMEOUT_MS    how long a round waits for the CLI's init (claudeInitTimeoutMs)
import { blocksText } from "../tool-content";
import { claudeNeeds,claudeOnPath,claudeSettings,type ApprovedClaudeConfig } from "./needs";
import {claudeFailureCode,claudeOutputLimit,nativeClaude} from './claude-native';
import { processSession, type LineParser } from "./proc";
import { redactText } from "../secure";
import { LOGIN_RE, errorOf, rowsOf, type NEvent, type Provider, type ProviderCtx, type ToolSpec, type Usage } from "./types";
import { scriptArgv } from "../self";

/** Claude's result usage: inTokens is input plus cache reads and writes (as Studio counted it), cache reads also apart */
export function claudeUsage(m: any): Usage {
  const u = m?.usage ?? {}, n = (v: unknown) => (typeof v === "number" ? v : 0);
  return { usd: typeof m?.total_cost_usd === "number" ? m.total_cost_usd : null, inTokens: typeof u.input_tokens === "number" ? u.input_tokens + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens) : null,
    outTokens: typeof u.output_tokens === "number" ? u.output_tokens : null, cacheReadTokens: typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : null };
}
export function claudeProvider(model = process.env.CREW_CLAUDE_MODEL ?? "claude-sonnet-5-5", bin = process.env.CREW_CLAUDE_BIN ?? "claude", approved?:ApprovedClaudeConfig): Provider {
  // the CLI itself, never a shell launcher named claude on PATH (claudeOnPath): the round's exec allowlist is made for what runs
  const exe = () => claudeOnPath(bin) ?? bin;
  return {
    id: "claude", model, reasoningEffort:approved?.effort,envKeys: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR"],
    sandboxNeeds: () => claudeNeeds(exe(), ["api.anthropic.com", "console.anthropic.com", "claude.ai", "statsig.anthropic.com", "mcp-proxy.anthropic.com"],approved),
    start(systemPrompt: string, tools: ToolSpec[], ctx: ProviderCtx) {
      if (!ctx.tokenFile) throw new Error("Claude provider requires a private tool-token file");
      if(approved&&!approved.live())throw new Error('Claude native verification expired or was revoked');
      // the token goes to the MCP server through a 0600 file (never this JSON, which is on the CLI's argv): see ProviderCtx.tokenFile
      const mcp = { mcpServers: { studio: { type: "stdio", command: ctx.mcpCommand[0], args: ctx.mcpCommand.slice(1),
        env: { CREW_STUDIO_URL: ctx.studioUrl, CREW_TOOL_TOKEN_FILE: ctx.tokenFile } } } };
      const args = ["-p", "{TEXT}", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model,
        "--tools", "", "--strict-mcp-config", "--mcp-config", JSON.stringify(mcp), "--allowedTools", tools.map((t) => `mcp__studio__${t.name}`).join(","),
        "--system-prompt", systemPrompt, "--disable-slash-commands", "--no-session-persistence", "--restricted",
        // a round may run in the captain's own account context (its sign-in), never in its settings: no user, project or local
        // settings, so none of its CLAUDE.md memory, hooks, plugins or permission rules load (src/providers/needs.ts)
        "--setting-sources", "", "--settings", JSON.stringify(claudeSettings(approved ?? { model, effort: null }))];
      if(approved)args.push('--permission-mode','dontAsk','--permission-prompts','none','--no-chrome',...(approved.effort?['--effort',approved.effort]:[]));
      const run = exe(), cmd = () => scriptArgv(run, args);
      const env={...ctx.env};if(approved){for(const k of['ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','CLAUDE_CODE_EFFORT_LEVEL'])delete env[k];const login=approved.login();if(!login.ok)throw new Error('Claude isolated login unavailable');Object.assign(env,login.env,approved.effort?{CLAUDE_CODE_EFFORT_LEVEL:approved.effort}:{});}
      env.CLAUDE_CODE_MAX_OUTPUT_TOKENS=String(claudeMaxOutputTokens()); // after the login's env: Studio's cap, never the account's
      // the CLI announces itself (its init) within seconds; one that has not within the bound never will (a launcher looping, a
      // start blocked by the round's sandbox): the round fails then, with what the CLI wrote to stderr, never at the round's limit
      const session=processSession(cmd, ctx.cwd, env,()=>parser(approved,tools,[ctx.token]),ctx.sandbox,{requireSuccessfulExit:!!approved,credentialFds:true,
        startDeadline:{ms:claudeInitTimeoutMs(),started:(m)=>m?.type==='system'&&m.subtype==='init',what:'The Claude CLI'}});
      return {interrupt:()=>session.interrupt(),async *send(text:string){try{yield* session.send(text);}finally{session.interrupt();}}};
    },
  };
}

/** One reply's output cap for Studio's rounds: 64000 (CREW_CLAUDE_MAX_OUTPUT_TOKENS, 4000 to 128000). */
export const claudeMaxOutputTokens = () => { const v = Number(process.env.CREW_CLAUDE_MAX_OUTPUT_TOKENS); return Number.isInteger(v) && v >= 4000 && v <= 128_000 ? v : 64_000; };
/** How long a round waits for the CLI's init before it fails: 90 s (CREW_CLAUDE_INIT_TIMEOUT_MS, 1 s to 10 min, for tests). */
export const claudeInitTimeoutMs = () => { const v = Number(process.env.CREW_CLAUDE_INIT_TIMEOUT_MS); return Number.isFinite(v) && v >= 1000 && v <= 600_000 ? v : 90_000; };
const short = (n: string) => n.replace(/^mcp__studio__/, "");
// Why a round failed, in a short line the captain can read beside the canned sentence: built from the CLI's own event (its
// type and subtype, the API status, its error and errors, a result's text) or from the exit code and stderr tail. Every
// piece goes through redactText; a model's or the prompt's text (assistant and user content) is never part of it.
const REASON_MAX = 400;
const tidy = (s: string, secrets: string[] = []) => redactText(s, secrets).replace(/\s+/g, " ").replace(/ \/ /g, "/").trim(); // " / " would split it into two languages in the page
const clipReason = (s: string, secrets: string[] = []) => { const t = tidy(s, secrets); return t.length > REASON_MAX ? `${t.slice(0, REASON_MAX - 1)}…` : t; };
// the fixed sentence in both languages ("en / zh", as the page splits it), the CLI's reason verbatim in each half
const because = (r: string, secrets: string[] = []) => { const c = r ? clipReason(r, secrets) : ""; return (en: string, zh: string) => c ? `${en} Reason: ${c} / ${zh}原因：${c}` : `${en} / ${zh}`; };
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
function eventReason(m: any): string {
  if (!m || typeof m !== "object" || Array.isArray(m)) return "a stream event that is not a JSON object";
  if (!Object.keys(m).length) return "";
  const head = [str(m.type) || "event", str(m.subtype)].filter(Boolean).join(" ");
  if (m.type === "assistant" || m.type === "user") return m.message?.content !== undefined && !Array.isArray(m.message.content) || m.message?.content?.some?.((c: any) => !c || typeof c !== "object" || Array.isArray(c)) ? `${head}: malformed message content` : head;
  const bits: string[] = [];
  if (m.api_error_status !== undefined && m.api_error_status !== null) bits.push(`API status ${str(m.api_error_status) || "?"}`);
  const e = m.error;
  if (typeof e === "string") bits.push(e);
  else if (e && typeof e === "object") bits.push([str(e.type), e.status !== undefined && e.status !== m.api_error_status ? str(e.status) : "", str(e.message)].filter(Boolean).join(" "));
  if (Array.isArray(m.errors)) for (const x of m.errors.slice(0, 3)) bits.push(typeof x === "string" ? x : str(x?.message) || str(x?.type));
  if (m.type === "result" && typeof m.result === "string") bits.push(m.result);
  const rest = bits.filter(Boolean).join("; ");
  return rest ? `${head}: ${rest}` : head;
}
function exitReason(code: number, stderr: string, resultSeen: boolean, secrets: string[] = []): string {
  const tail = [...new Set(String(stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean).reverse())].slice(0, 4).reverse().join(" | ");
  const t = tidy(tail, secrets);
  return `exit ${code}${resultSeen ? "" : ", no result"}; stderr: ${t ? (t.length > 300 ? `…${t.slice(-299)}` : t) : "(none)"}`;
}
/** The stream parser (exported for its tests). */
// secrets: the round's own values (its tool token) that a reason must never carry, beside what redactText knows
export const claudeParser = (approved?: ApprovedClaudeConfig, tools: ToolSpec[] = [], secrets: string[] = []) => parser(approved, tools, secrets);
function parser(approved?:ApprovedClaudeConfig,tools:ToolSpec[]=[],secrets:string[]=[]): LineParser {
  let sawDelta = false, text = "",init=false,failed=false,resultSeen=false,locked=false;
  const refuse=(code:string,m:any,reason=eventReason(m)):NEvent[]=>{failed=true;if(approved)approved.invalidate(code,m);else nativeClaude.invalidate(code,m);return[{type:'turnEnd',status:'error',code,message:code==='quotaExhausted'?'Claude quota is exhausted; wait for reset. Do not sign in again. / Claude 額度已耗盡；請等待重設，不需重新登入。':code==='modelMismatch'?'Claude actual model differs from the approved model; work stopped.':code==='toolsNotLocked'?'The Claude CLI did not confirm the model has Studio\'s tools only (no init listing them, or another tool or MCP server); work stopped. / Claude CLI 未確認模型只有 Studio 的工具（缺少列出工具的 init，或出現其他工具或 MCP server）；已停止工作。':code==='cliError'?because(reason,secrets)('The Claude CLI reported an error; readiness was invalidated.','Claude CLI 回報錯誤；已撤銷就緒狀態。'):code==='notLoggedIn'?because(reason,secrets)('Claude authentication or execution was refused; readiness was invalidated.','Claude 登入或執行被拒；已撤銷就緒狀態。'):'Claude authentication or execution was refused; readiness was invalidated.'}];};
  return {
    line(m: any): NEvent[] {
      if(failed)return[];
      if(!m||typeof m!=='object'||Array.isArray(m)||(m.type==='assistant'||m.type==='user')&&m.message?.content!==undefined&&!Array.isArray(m.message.content))return refuse('cliError',m);
      if((m.type==='assistant'||m.type==='user')&&m.message?.content?.some((c:any)=>!c||typeof c!=='object'||Array.isArray(c)))return refuse('cliError',m);
      // a reply longer than the CLI's output cap ends the turn, but it is no refusal: readiness stays (CLAUDE_NON_REFUSAL). It is
      // decided only after every fail-closed gate below (tool lock, init and model checks, one result), at the result itself
      const denied=claudeFailureCode(m);if(denied&&denied!=='outputLimit')return refuse(denied,m);
      // the model has Studio's tools and nothing else, and the CLI must say so before anything else (fail closed): its init lists
      // its tools and MCP servers; a round with no init, or one announcing any other tool or MCP server, stops at once
      if(m.type==='system'&&m.subtype==='init'){if(!Array.isArray(m.tools)||m.tools.some((t:unknown)=>typeof t!=='string'||!t.startsWith('mcp__studio__'))||m.mcp_servers!==undefined&&(!Array.isArray(m.mcp_servers)||m.mcp_servers.some((x:any)=>x?.name!=='studio')))return refuse('toolsNotLocked',m);locked=true;}
      if(!locked&&['assistant','user','result','stream_event'].includes(m.type))return refuse('toolsNotLocked',m);
      // on every path: a tool call to anything but a Studio tool stops the round (which Studio tools a round may call, its tool
      // token decides on Studio's side)
      if(m.type==='assistant'&&m.message?.content?.some((c:any)=>c?.type==='tool_use'&&!(typeof c.name==='string'&&c.name.startsWith('mcp__studio__'))))return refuse('toolsNotLocked',m);
      if(approved&&m.type==='system'&&m.subtype==='init'){if(init||m.model!==approved.model)return refuse('modelMismatch',m);init=true;}
      if(approved&&(m.type==='assistant'&&(!init||m.message?.model!==approved.model)||m.type==='stream_event'&&m.event?.type==='message_start'&&(!init||m.event?.message?.model!==approved.model)))return refuse('modelMismatch',m);
      if(approved&&m.type==='result'&&(!init||!m.modelUsage||Object.keys(m.modelUsage).length!==1||!Object.hasOwn(m.modelUsage,approved.model)))return refuse('modelMismatch',m);
      {const other=approved&&m.type==='assistant'?m.message.content?.find((c:any)=>c.type==='tool_use'&&!tools.some(t=>c.name===`mcp__studio__${t.name}`)):null;if(other)return refuse('cliError',m,`assistant: a call to ${String(other.name)}, a tool this round was not given`);}
      const out: NEvent[] = [];
      if (m.type === "stream_event") {
        const ev = m.event;
        if (ev?.type === "message_start") sawDelta = false;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) { sawDelta = true; text += ev.delta.text; out.push({ type: "delta", text: ev.delta.text }); }
      } else if (m.type === "assistant") {
        for (const c of m.message?.content ?? []) {
          if (c.type === "tool_use") out.push({ type: "toolStart", id: String(c.id), name: short(String(c.name)), args: c.input ?? {} });
          else if (c.type === "text" && c.text) { if (!sawDelta) { text += c.text; out.push({ type: "delta", text: c.text }); } out.push({ type: "message", text: c.text }); }
        }
      } else if (m.type === "user") {
        for (const c of m.message?.content ?? []) if (c.type === "tool_result") {
          const body = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? blocksText(c.content) : ""; // the CLI saw the picture through MCP; the event keeps a note
          const err = errorOf(body) ?? (c.is_error ? body.slice(0, 200) || "tool error" : null);
          out.push({ type: "toolEnd", id: String(c.tool_use_id), rows: err ? null : rowsOf(body), error: err, result: body });
        }
      } else if (m.type === "result") {
        if(resultSeen)return refuse('cliError',m,'a second result');resultSeen=true;
        if(denied==='outputLimit'){failed=true;const cap=claudeOutputLimit(m);return[{type:'turnEnd',status:'error',code:'outputLimit',message:`The model's reply exceeded the ${cap}-token output limit; write large files in several smaller writes. / 模型的回覆超過 ${cap} token 的輸出上限；大檔案請分幾次寫入。`}];}
        const r = String(m.result ?? "");
        if (m.is_error || m.subtype !== "success") out.push({ type: "turnEnd", status: "error", code: LOGIN_RE.test(r) ? "notLoggedIn" : "cliError", message: r || "the model run failed" });
        else { if (!text.trim() && r) out.push({ type: "delta", text: r }, { type: "message", text: r });
          const u = m.usage ?? {};
          void u; out.push({ type: "turnEnd", status: "ok", usage: claudeUsage(m) }); }
      }
      return out;
    },
    exit: (code,stderr) => stderr==='owned process cleanup unverified'?refuse('cleanupUnverified',{})[0]:failed?null:code!==0||!resultSeen?refuse(LOGIN_RE.test(stderr)?'notLoggedIn':'cliError',{},exitReason(code,stderr,resultSeen,secrets))[0]:null,
  };
}
