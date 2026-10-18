// Claude accepts credentials through inherited descriptors. Only descriptor numbers
// reach exec's environment; the token never appears in KERN_PROCARGS2.
import { closeSync, mkdtempSync, openSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function claudeCredentialFds(input: Record<string,string>) {
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
