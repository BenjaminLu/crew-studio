// Claude accepts credentials through inherited descriptors. Only descriptor numbers
// reach exec's environment; the token never appears in KERN_PROCARGS2.
import { closeSync, mkdtempSync, openSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function claudeCredentialFds(input: Record<string,string>) {
  if (input.ANTHROPIC_AUTH_TOKEN) throw new Error("ANTHROPIC_AUTH_TOKEN has no verified secret-free CLI transport; use supported Claude OAuth or API-key login");
  const env={...input},fds:number[]=[];
  try {
    for(const [key,descriptor] of [['CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'],['ANTHROPIC_API_KEY','CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR']]) {
      const value=env[key];if(!value)continue;
      const dir=mkdtempSync(join(env.TMPDIR||tmpdir(),'crew-cli-auth-'));
      try {
        const path=join(dir,'credential');writeFileSync(path,value,{mode:0o600});
        const fd=openSync(path,'r');fds.push(fd);unlinkSync(path);
        env[descriptor]=String(2+fds.length);delete env[key];
      } finally {rmSync(dir,{recursive:true,force:true});}
    }
    return {env,fds,close(){for(const fd of fds.splice(0))closeSync(fd);}};
  }catch(e){for(const fd of fds)closeSync(fd);throw e;}
}

/** Codex supports API keys in auth.json; no raw key crosses exec, even for direct provider callers. */
export function codexCredentialFiles(input: Record<string,string>, root: string) {
  const env={...input},key=env.CODEX_API_KEY||env.OPENAI_API_KEY;
  if(!key)return{env,close(){}};
  if(env.CODEX_API_KEY&&env.OPENAI_API_KEY&&env.CODEX_API_KEY!==env.OPENAI_API_KEY)throw new Error('Ambiguous Codex API-key credentials');
  if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(key))throw new Error('Codex API-key credential shape is unsupported');
  const dir=mkdtempSync(join(root,'codex-auth-'));
  try {
    writeFileSync(join(dir,'auth.json'),JSON.stringify({auth_mode:'api_key',OPENAI_API_KEY:key}),{mode:0o600});
    delete env.CODEX_API_KEY;delete env.OPENAI_API_KEY;env.CODEX_HOME=dir;
    return{env,close(){rmSync(dir,{recursive:true,force:true});}};
  }catch(error){rmSync(dir,{recursive:true,force:true});throw error;}
}
