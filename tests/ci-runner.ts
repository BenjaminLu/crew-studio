import "./lib/isolated-env.mjs";
import { commands, run, testEnv } from '../scripts/ci-tests.mjs';
import { strict as assert } from 'node:assert';
import { readFileSync, rmSync } from 'node:fs';
import { checkedTempDir } from './lib/git-hygiene.mjs';
import { join } from 'node:path';
const temp = checkedTempDir('crew-ci-runner-');
let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok ${name}`); };
try {
  check('nested aliases preserve every command and variant', () => assert.deepEqual(commands({test: 'bun a && bun run test:x && X=1 node c', 'test:x': 'node b && bun d'}, 'full'), ['bun a', 'node b', 'bun d', 'X=1 node c']));
  check('recursive aliases fail instead of losing coverage', () => assert.throws(() => commands({test:'bun run test'}, 'full'), /Recursive/));
  check('missing scripts fail', () => assert.throws(() => commands({}, 'core'), /Missing/));
  const env = testEnv({...process.env, GITHUB_TOKEN:'fake-secret', ACTIONS_RUNTIME_TOKEN:'fake-runtime', CREW_DATA:'/forbidden', CREW_LOCAL_UNRESTRICTED:'1'});
  check('runner drops inherited credentials and operator settings', () => assert(!('GITHUB_TOKEN' in env) && !('ACTIONS_RUNTIME_TOKEN' in env) && !('CREW_DATA' in env) && !('CREW_LOCAL_UNRESTRICTED' in env)));
  const failed = await run('printf fixture-output; exit 7', join(temp,'failed.log'), 2000, env);
  check('nonzero exit and exact log survive', () => { assert.equal(failed.code,7); assert.equal(readFileSync(join(temp,'failed.log'),'utf8'),'fixture-output'); });
  const timed = await run('sleep 20', join(temp,'timeout.log'), 50, env);
  check('hung command times out with a failing result', () => { assert(timed.timedOut); assert.notEqual(timed.code,0); assert(timed.durationMs < 5000); });
  const after = await run('exit 0', join(temp,'after.log'), 2000, env);
  check('later command still runs after a failure', () => assert.equal(after.code,0));
  console.log(`ci-runner: ${passed} passed, 0 failed`);
} finally { rmSync(temp,{recursive:true,force:true}); }
