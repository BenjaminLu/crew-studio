// What a CLI provider needs inside a sandboxed round (architecture §10):
// - its own install (the real path of its binary, two folders up, so a package's files resolve), read only;
// - the API hosts it calls (the round's egress list starts from these);
// - a throwaway home for the round: the CLI writes its config, sessions and caches
//   there, never into the user's real config (~/.claude, ~/.codex …), which a later,
//   unsandboxed session would run;
// - its login: read by Studio outside the sandbox and handed in as the vendor's own
//   token, or a login file without its refresh token (src/providers/login.ts, v1 option A);
//   no keychain is reachable from a round;
// - the variables that name the CLI's own temporary folder (set to the round's tmp).
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { claudeLogin, codexLogin, type Login } from "./login";
import { dirname, join } from "node:path";

export type SandboxNeeds = {
  reads: string[]; hosts: string[]; tmpEnv: string[];
  /** a provider that runs in Studio's own process (direct HTTP): nothing to spawn or confine; its requests go through the egress proxy with the round's credential, to its hosts only */
  inProcess?: boolean;
  /** make the round's throwaway home in `dir`; returns the variables that point the CLI at it */
  home(dir: string): Record<string, string>;
  /** the vendor's own login for the round, read by Studio outside the sandbox (src/providers/login.ts) */
  login(dir: string): Login;
};
const which = (bin: string): string | null => {
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  for (const d of (process.env.PATH ?? "").split(":")) { const p = join(d, bin); if (existsSync(p)) return p; }
  return null;
};
const installOf = (bin: string) => { const found = which(bin); if (!found) return []; let r = found; try { r = realpathSync(found); } catch {} return [dirname(r), dirname(dirname(r))]; };

export type ApprovedClaudeConfig = { model: string; effort: string | null; login: () => Login; live: () => boolean; invalidate: (code?: string,event?: unknown) => void };
export const claudeSettings = (approved: Pick<ApprovedClaudeConfig,'model'|'effort'>) => ({model:approved.model,...approved.effort?{effortLevel:approved.effort}:{},availableModels:[approved.model],fallbackModel:[],switchModelsOnFlag:false,disableAllHooks:true,disableAutoMemory:true,disableWorkflows:true,enabledPlugins:{}});
export function claudeNeeds(bin: string, hosts: string[], approved?: ApprovedClaudeConfig): SandboxNeeds {
  // claude's config, sessions and caches live in the round's own home (v1 bin/adapters/claude.sh: CLAUDE_CONFIG_DIR in the round's temp directory)
  return { reads: installOf(bin), hosts, tmpEnv: ["CLAUDE_CODE_TMPDIR"],
    home(dir) { const cfg = join(dir, ".claude-config"); mkdirSync(cfg, { recursive: true }); return { HOME: dir, CLAUDE_CONFIG_DIR: cfg, DISABLE_NONESSENTIAL_TRAFFIC: "1" }; },
    login: () => approved ? approved.live() ? approved.login() : {ok:false,error:'Claude native verification expired or was revoked'} : claudeLogin() };
}
export type ApprovedCodexConfig = { model: string; effort: string | null };
export function codexNeeds(bin: string, hosts: string[], approved?: ApprovedCodexConfig): SandboxNeeds {
  return { reads: installOf(bin), hosts, tmpEnv: [],
    home(dir) { mkdirSync(dir, { recursive: true }); return { HOME: dir }; },
    login: (dir) => {
      if (approved && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(approved.model) || approved.effort !== null && !["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(approved.effort))) return { ok: false, error: "approved Codex model/effort snapshot is invalid" };
      const cfg = join(dir, ".codex"), login = codexLogin(cfg);
      if (login.ok && approved) { mkdirSync(cfg, { recursive: true }); writeFileSync(join(cfg, "crew-native.config.toml"), `model = ${JSON.stringify(approved.model)}\n${approved.effort ? `model_reasoning_effort = ${JSON.stringify(approved.effort)}\n` : ""}`, { mode: 0o600 }); }
      return login;
    } };
}
/** A direct-HTTP provider: in Studio's process, its egress the API host of its base URL only (through the proxy). */
export function httpNeeds(baseUrl: () => string): SandboxNeeds {
  return { reads: [], tmpEnv: [], inProcess: true, get hosts() { try { return [new URL(baseUrl()).hostname]; } catch { return []; } }, home: () => ({}), login: () => ({ ok: true, env: {}, source: "Studio's key store (the request leaves from Studio's process)", warn: null }) };
}
