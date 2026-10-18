// Claude provider: `claude -p --output-format stream-json`, with every built-in
// tool removed and only the Studio MCP server loaded.
//   CREW_CLAUDE_BIN   executable (default "claude"); a .mjs/.ts path runs under bun (test stub)
//   CREW_CLAUDE_MODEL model (default claude-sonnet-5-5)
import { blocksText } from "../tool-content";
import { claudeNeeds,claudeSettings,type ApprovedClaudeConfig } from "./needs";
import {claudeFailureCode,nativeClaude} from './claude-native';
import { processSession, type LineParser } from "./proc";
import { LOGIN_RE, errorOf, rowsOf, type NEvent, type Provider, type ProviderCtx, type ToolSpec } from "./types";

export function claudeProvider(model = process.env.CREW_CLAUDE_MODEL ?? "claude-sonnet-5-5", bin = process.env.CREW_CLAUDE_BIN ?? "claude", approved?:ApprovedClaudeConfig): Provider {
  return {
    id: "claude", model, reasoningEffort:approved?.effort,envKeys: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR"],
    sandboxNeeds: () => claudeNeeds(bin, ["api.anthropic.com", "console.anthropic.com", "claude.ai", "statsig.anthropic.com", "mcp-proxy.anthropic.com"],approved),
    start(systemPrompt: string, tools: ToolSpec[], ctx: ProviderCtx) {
      if(approved&&!approved.live())throw new Error('Claude native verification expired or was revoked');
      // the token goes to the MCP server through a 0600 file (never this JSON, which is on the CLI's argv): see ProviderCtx.tokenFile
      const mcp = { mcpServers: { studio: { type: "stdio", command: ctx.mcpCommand[0], args: ctx.mcpCommand.slice(1),
        env: { CREW_STUDIO_URL: ctx.studioUrl, ...(ctx.tokenFile ? { CREW_TOOL_TOKEN_FILE: ctx.tokenFile } : { CREW_TOOL_TOKEN: ctx.token }) } } } };
      const args = ["-p", "{TEXT}", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model,
        "--tools", "", "--strict-mcp-config", "--mcp-config", JSON.stringify(mcp), "--allowedTools", tools.map((t) => `mcp__studio__${t.name}`).join(","),
        "--system-prompt", systemPrompt, "--disable-slash-commands", "--no-session-persistence", "--restricted"];
      if(approved)args.push('--setting-sources','','--settings',JSON.stringify(claudeSettings(approved)),'--permission-mode','dontAsk','--permission-prompts','none','--no-chrome',...(approved.effort?['--effort',approved.effort]:[]));
      const cmd = () => (/\.(mjs|js|ts)$/.test(bin) ? [process.execPath, bin, ...args] : [bin, ...args]);
      const env={...ctx.env};if(approved){for(const k of['ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','CLAUDE_CODE_EFFORT_LEVEL'])delete env[k];const login=approved.login();if(!login.ok)throw new Error('Claude isolated login unavailable');Object.assign(env,login.env,approved.effort?{CLAUDE_CODE_EFFORT_LEVEL:approved.effort}:{});}
      const session=processSession(cmd, ctx.cwd, env,()=>parser(approved,tools),ctx.sandbox,{requireSuccessfulExit:!!approved,credentialFds:true});
      return {interrupt:()=>session.interrupt(),async *send(text:string){try{yield* session.send(text);}finally{session.interrupt();}}};
    },
  };
}

const short = (n: string) => n.replace(/^mcp__studio__/, "");
function parser(approved?:ApprovedClaudeConfig,tools:ToolSpec[]=[]): LineParser {
  let sawDelta = false, text = "",init=false,failed=false,resultSeen=false;
  const refuse=(code:string,m:any):NEvent[]=>{failed=true;if(approved)approved.invalidate(code,m);else nativeClaude.invalidate(code,m);return[{type:'turnEnd',status:'error',code,message:code==='quotaExhausted'?'Claude quota is exhausted; wait for reset. Do not sign in again. / Claude 額度已耗盡；請等待重設，不需重新登入。':code==='modelMismatch'?'Claude actual model differs from the approved model; work stopped.':'Claude authentication or execution was refused; readiness was invalidated.'}];};
  return {
    line(m: any): NEvent[] {
      if(failed)return[];
      if(!m||typeof m!=='object'||Array.isArray(m)||(m.type==='assistant'||m.type==='user')&&m.message?.content!==undefined&&!Array.isArray(m.message.content))return refuse('cliError',m);
      if((m.type==='assistant'||m.type==='user')&&m.message?.content?.some((c:any)=>!c||typeof c!=='object'||Array.isArray(c)))return refuse('cliError',m);
      const denied=claudeFailureCode(m);if(denied)return refuse(denied,m);
      if(approved&&m.type==='system'&&m.subtype==='init'){if(init||m.model!==approved.model)return refuse('modelMismatch',m);init=true;}
      if(approved&&(m.type==='assistant'&&(!init||m.message?.model!==approved.model)||m.type==='stream_event'&&m.event?.type==='message_start'&&(!init||m.event?.message?.model!==approved.model)))return refuse('modelMismatch',m);
      if(approved&&m.type==='result'&&(!init||!m.modelUsage||Object.keys(m.modelUsage).length!==1||!Object.hasOwn(m.modelUsage,approved.model)))return refuse('modelMismatch',m);
      if(approved&&m.type==='assistant'&&m.message.content?.some((c:any)=>c.type==='tool_use'&&!tools.some(t=>c.name===`mcp__studio__${t.name}`)))return refuse('cliError',m);
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
        if(resultSeen)return refuse('cliError',m);resultSeen=true;
        const r = String(m.result ?? "");
        if (m.is_error || m.subtype !== "success") out.push({ type: "turnEnd", status: "error", code: LOGIN_RE.test(r) ? "notLoggedIn" : "cliError", message: r || "the model run failed" });
        else { if (!text.trim() && r) out.push({ type: "delta", text: r }, { type: "message", text: r });
          const u = m.usage ?? {};
          out.push({ type: "turnEnd", status: "ok", usage: { usd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : null,
            inTokens: typeof u.input_tokens === "number" ? u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null, outTokens: typeof u.output_tokens === "number" ? u.output_tokens : null } }); }
      }
      return out;
    },
    exit: (code,stderr) => stderr==='owned process cleanup unverified'?refuse('cleanupUnverified',{})[0]:failed?null:code!==0||!resultSeen?refuse(stderr==='owned process cleanup unverified'?'cleanupUnverified':LOGIN_RE.test(stderr)?'notLoggedIn':'cliError',{})[0]:null,
  };
}
