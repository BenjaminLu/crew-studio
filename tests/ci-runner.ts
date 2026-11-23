import "./lib/isolated-env.mjs";
import { artifactName, commands, failureBlock, logTail, run, testEnv } from '../scripts/ci-tests.mjs';
import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { checkedTempDir } from './lib/git-hygiene.mjs';
import { join } from 'node:path';
const temp = checkedTempDir('crew-ci-runner-');
let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok ${name}`); };
try {
  check('nested aliases preserve every command and variant', () => assert.deepEqual(commands({test: 'bun a && bun run test:x && X=1 node c', 'test:x': 'node b && bun d'}, 'full'), ['bun a', 'node b', 'bun d', 'X=1 node c']));
  check('recursive aliases fail instead of losing coverage', () => assert.throws(() => commands({test:'bun run test'}, 'full'), /Recursive/));
  check('script aliases produce portable artifact paths', () => assert.equal(artifactName('test:ci:portable'), 'test-ci-portable'));
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  check('core and full CI run the plain acceptance suite on the Cursor stub too', () => { for (const mode of ['core', 'full']) assert(commands(scripts, mode).includes('ACCEPTANCE_PROVIDER=cursor bun tests/acceptance.ts'), mode); });
  check('missing scripts fail', () => assert.throws(() => commands({}, 'core'), /Missing/));
  const env = testEnv({...process.env, GITHUB_TOKEN:'fake-secret', ACTIONS_RUNTIME_TOKEN:'fake-runtime', CREW_DATA:'/forbidden', CREW_LOCAL_UNRESTRICTED:'1'});
  check('runner drops inherited credentials and operator settings', () => assert(!('GITHUB_TOKEN' in env) && !('ACTIONS_RUNTIME_TOKEN' in env) && !('CREW_DATA' in env) && !('CREW_LOCAL_UNRESTRICTED' in env)));
  const failed = await run('printf fixture-output; exit 7', join(temp,'failed.log'), 2000, env);
  check('nonzero exit and exact log survive', () => { assert.equal(failed.code,7); assert.equal(readFileSync(join(temp,'failed.log'),'utf8'),'fixture-output'); });
  check('a failed command shows its log tail, with the count of lines left out', () => {
    writeFileSync(join(temp,'long.log'), Array.from({length: 100}, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    const tail = logTail(join(temp,'long.log'), 3).split('\n');
    assert.deepEqual(tail.slice(1), ['line 98', 'line 99', 'line 100']); assert.match(tail[0], /^… 97 earlier line\(s\) in /);
    assert.equal(logTail(join(temp,'failed.log')), 'fixture-output'); assert.match(logTail(join(temp,'missing.log')), /^\(no log at /); });
  // GitHub runs `::` workflow commands it reads on a job's stdout: the tail sits between ::stop-commands::<token> and ::<token>::
  const inert = (out: string, lines: string[]) => {
    const all = out.split('\n'), g = all.findIndex(l => l.startsWith('::group::last lines of ')), stop = all.findIndex(l => /^::stop-commands::[A-Za-z0-9]{16,}$/.test(l));
    const token = stop >= 0 ? all[stop].slice('::stop-commands::'.length) : '', resume = all.indexOf(`::${token}::`), endg = all.lastIndexOf('::endgroup::');
    assert(g >= 0 && g < stop && stop < resume && resume < endg, `group, stop, resume, endgroup in that order: ${JSON.stringify([g, stop, resume, endg])}`);
    for (const l of lines) { const at = all.indexOf(l); assert(at > stop && at < resume, `${l} printed between the stop markers`); }
    assert.equal(all.filter(l => l === '::endgroup::').length, lines.includes('::endgroup::') ? 2 : 1);
  };
  writeFileSync(join(temp,'commands.log'), 'ok line\n::endgroup::\n::error::x\n::add-mask::y\n');
  check('a failed command\'s tail is printed with workflow commands stopped', () => {
    const a = failureBlock('bun t', join(temp,'commands.log')), b = failureBlock('bun t', join(temp,'commands.log'));
    inert(a, ['::endgroup::', '::error::x', '::add-mask::y']); assert.notEqual(a.split('\n')[1], b.split('\n')[1], 'each block has its own token'); });
  check('the runner prints that block under a failed command\'s FAIL line', () => {
    const repo = join(temp, 'repo'); mkdirSync(repo);
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { 'test:fixture': "printf 'before\\n::endgroup::\\n::error::x\\n'; exit 3" } }));
    const r = spawnSync(process.execPath, [new URL('../scripts/ci-tests.mjs', import.meta.url).pathname, '--mode', 'test:fixture', '--output', join(repo, 'out')], { cwd: repo, encoding: 'utf8', env: testEnv(process.env), timeout: 30000 });
    assert.equal(r.status, 1, r.stderr); assert.match(r.stdout, /^FAIL \(\d+s\) printf/m);
    assert(r.stdout.indexOf('FAIL (') < r.stdout.indexOf('::group::last lines of printf'), 'the block follows the FAIL line');
    inert(r.stdout, ['before', '::endgroup::', '::error::x']); });
  const timed = await run('sleep 20', join(temp,'timeout.log'), 50, env);
  check('hung command times out with a failing result', () => { assert(timed.timedOut); assert.notEqual(timed.code,0); assert(timed.durationMs < 5000); });
  const detachedLog = join(temp, 'detached.log');
  const escaped = await run(`node -e 'const p=require("node:child_process").spawn(process.execPath,["-e","setTimeout(()=>{},20000)"],{detached:true,stdio:"inherit"}); console.log(p.pid); p.unref()'`, detachedLog, 1000, env);
  const escapedPid = Number(readFileSync(detachedLog, 'utf8').trim());
  try {
    check('detached fixture holding pipes cannot defeat the timeout', () => { assert(escaped.timedOut); assert(escaped.durationMs < 5000); assert(Number.isInteger(escapedPid) && escapedPid > 1); });
  } finally { if (Number.isInteger(escapedPid) && escapedPid > 1) try { process.kill(-escapedPid, 'SIGKILL'); } catch {} }
  const after = await run('exit 0', join(temp,'after.log'), 2000, env);
  check('later command still runs after a failure', () => assert.equal(after.code,0));
  console.log(`ci-runner: ${passed} passed, 0 failed`);
} finally { rmSync(temp,{recursive:true,force:true}); }
