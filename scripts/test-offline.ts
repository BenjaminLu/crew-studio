// Offline native-code gate. HTTP/browser integration remains a separate captain acceptance.
// Unsupported covering suites fail explicitly; they are never silently called proved.
import { basename } from 'node:path';
const suites: Record<string, { argv: string[]; env?: Record<string,string> }> = {
  'tests/pack-genesis-interview.ts': {argv:['bun','tests/pack-genesis-interview.ts'],env:{CREW_TEST_IN_PROCESS:'1'}},
  'tests/code-handoff.ts': {argv:['bun','tests/code-handoff.ts']},
  'tests/proposal-state.mjs': {argv:['node','tests/proposal-state.mjs']},
  'tests/onboarding-ui.mjs': {argv:['node','tests/onboarding-ui.mjs']},
  'tests/caller-coverage.mjs': {argv:['node','tests/caller-coverage.mjs']},
  'tests/code-check-config.mjs': {argv:['node','tests/code-check-config.mjs']},
};
const only=(process.env.CREW_TEST_FILES||'').split(',').filter(Boolean);
const names=Object.keys(suites);
const unknown=only.filter(p=>!names.some(n=>n===p||basename(n)===p));
if(unknown.length){for(const p of unknown)console.error(`FAIL ${p}: no offline suite registered; add executable coverage or request captain integration acceptance`);process.exit(1);}
const selected=names.filter(n=>!only.length||only.includes(n)||only.includes(basename(n)));
const shard=Number(process.env.CREW_SHARD||0),shards=Number(process.env.CREW_SHARDS||1);
if(!Number.isInteger(shards)||shards<1||!Number.isInteger(shard)||shard<0||shard>=shards)throw Error('invalid shard');
let failed=0;
for(const [index,name] of selected.entries()){
 if(index%shards!==shard)continue;
 const suite=suites[name];const result=Bun.spawnSync(suite.argv,{cwd:process.cwd(),env:{...process.env,...suite.env},stdout:'pipe',stderr:'pipe'});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);
 if(result.exitCode!==0){failed++;console.error(`FAIL ${name}: exit ${result.exitCode}`);}
}
process.exit(failed?1:0);
