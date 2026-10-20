import "./lib/isolated-env.mjs";
import {mkdtempSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {teamVerifier} from '../src/onboarding-team-probe';import {suite} from './rt-harness';
const {ok,end}=suite('onboarding-team-probe');process.env.CREW_CODEX_BIN=join(import.meta.dir,'fixture/codex-account.mjs');
const dataDir=mkdtempSync(join(tmpdir(),'crew-team-probe-')),pick={provider:'codex' as const,model:'fixture',effort:'medium'};let mode='success',work='',seen:any;
const agents={async run(o:any){seen=o;work=o.sandbox.cwd;const nonce=/nonce ([a-f0-9]+)/.exec(o.text)![1];let answer='not observed';if(mode!=='no-tool'){const response=await o.tools[0].run({nonce:mode==='wrong-nonce'?'wrong':nonce});answer=response.challenge;}return{id:'J-fixture-probe',status:mode==='failed'?'failed':'done',provider:'codex',model:mode==='wrong-model'?'wrong':pick.model,reasoningEffort:'medium',executionMode:'default',tools:mode==='no-tool'?0:1,said:answer};}};
const verify=teamVerifier({dataDir,agents:agents as any,select:async()=>({id:'codex',model:pick.model,reasoningEffort:'medium'} as any)});
const result=await verify(pick);ok(result.toolVerified&&result.executionMode==='sandboxed'&&result.requested.model==='fixture','receipt requires successful observed tool result and configured pair');
ok(seen.timeoutMs===60000&&seen.maxTools===1&&seen.tools.length===1&&seen.sandbox.writes.length===1,'native job has bounded deadline, one tool and owned temporary scope');
ok(!existsSync(work),'owned fixture removed after successful check');
for(mode of ['no-tool','wrong-nonce','wrong-model','failed']){let rejected=false;try{await verify(pick);}catch{rejected=true;}ok(rejected&&!existsSync(work),`${mode} cannot mint a successful receipt and cleans owned fixture`);}
const abort=new AbortController();abort.abort();let rejected=false;try{await verify(pick,abort.signal);}catch{rejected=true;}ok(rejected,'cancelled request cannot launch a verification job');
end();
