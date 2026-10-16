// Offline native-code gate. HTTP/browser integration remains a separate captain acceptance.
// Unsupported covering suites fail explicitly; they are never silently called proved.
import { basename } from 'node:path';
const suites: Record<string, { argv: string[]; env?: Record<string,string>; explicitOnly?:boolean }> = {
  'tests/code-rescope-preserve.ts': {argv:['bun','tests/code-rescope-preserve.ts'],explicitOnly:true,env:{CREW_TEST_IN_PROCESS:'1'}},
  'tests/pack-genesis-interview.ts': {argv:['bun','tests/pack-genesis-interview.ts'],env:{CREW_TEST_IN_PROCESS:'1'}},
  'tests/pack-genesis-native-ui.mjs': {argv:['bun','tests/pack-genesis-native-ui.mjs'],env:{PG_INTERVIEW_ONLY:'1'},explicitOnly:true},
  'tests/code-task-ordering.ts': {argv:['bun','tests/code-task-ordering.ts'],explicitOnly:true,env:{CREW_TEST_IN_PROCESS:'1'}},
  'tests/firstmate-proposal-revision.ts': {argv:['bun','tests/firstmate-proposal-revision.ts'],explicitOnly:true,env:{CREW_TEST_IN_PROCESS:'1'}},
  'tests/code-blocker-diagnostics.ts': {argv:['bun','tests/code-blocker-diagnostics.ts'],explicitOnly:true,env:{CREW_TEST_IN_PROCESS:'1'}},
  'tests/task-recovery-ui.mjs': {argv:['node','tests/task-recovery-ui.mjs'],explicitOnly:true},
  'tests/captain-labels.mjs': {argv:['node','tests/captain-labels.mjs'],explicitOnly:true},
  'tests/captain-ui.mjs': {argv:['node','tests/captain-ui.mjs'],explicitOnly:true},
  'tests/skins-native.ts': {argv:['bun','tests/skins-native.ts'],explicitOnly:true,env:{CREW_TEST_IN_PROCESS:'1'}},
  'tests/skins.mjs': {argv:['node','tests/skins.mjs'],explicitOnly:true},
  'tests/spec-verification-scope.ts': {argv:['bun','tests/spec-verification-scope.ts'],explicitOnly:true,env:{CREW_TEST_IN_PROCESS:'1'}},
  'tests/done-lines-observable.ts': {argv:['bun','tests/done-lines-observable.ts'],explicitOnly:true,env:{CREW_TEST_IN_PROCESS:'1'}},
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
const selected=names.filter(n=>(!only.length&&!suites[n].explicitOnly)||only.includes(n)||only.includes(basename(n)));
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
