// Run the package's real commands independently: one red must not hide later failures.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function commands(scripts, mode, stack = []) {
  const key = mode === 'full' ? 'test' : mode === 'core' ? 'test:core' : mode;
  if (!scripts[key]) throw new Error(`Missing script: ${key}`);
  if (stack.includes(key)) throw new Error(`Recursive script: ${key}`);
  return scripts[key].split(/\s*&&\s*/).flatMap(command => {
    const alias = /^bun run ([\w:-]+)$/.exec(command);
    return alias ? commands(scripts, alias[1], [...stack, key]) : [command];
  });
}
export function testEnv(source) {
  const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM',
    'PLAYWRIGHT_MODULE', 'PLAYWRIGHT_BROWSERS_PATH'];
  return { ...Object.fromEntries(keep.filter(k => source[k] !== undefined).map(k => [k, source[k]])),
    CI: 'true', BUN_OPTIONS: '--no-env-file' };
}
export async function run(command, logPath, timeoutMs, env) {
  const log = createWriteStream(logPath);
  const start = Date.now();
  const child = spawn('/bin/bash', ['-c', command], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const kill = signal => { try { process.kill(-child.pid, signal); } catch {} };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; kill('SIGKILL'); }, timeoutMs);
  const result = await new Promise(resolve => {
    child.on('error', error => resolve({ code: null, error: error.message }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer); kill('SIGKILL');
  await new Promise(resolve => log.end(resolve));
  return { command, ...result, timedOut, durationMs: Date.now() - start, log: logPath };
}
async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const mode = option('--mode', 'core');
  const shard = option('--shard', '1/1');
  if (!/^\d+\/\d+$/.test(shard)) throw new Error('Shard must be N/TOTAL');
  const [index, total] = shard.split('/').map(Number);
  if (index < 1 || total < index || total > 64) throw new Error('Invalid shard range');
  const timeoutMs = Number(option('--timeout-ms', '600000'));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Invalid timeout');
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  const all = commands(scripts, mode);
  const selected = all.map((command, i) => ({ command, i })).filter(({ i }) => i % total === index - 1);
  if (!selected.length) throw new Error('Empty shard');
  if (args.includes('--list')) { console.log(selected.map(x => x.command).join('\n')); return; }
  const out = resolve(option('--output', `ci-results/${mode}-${index}`));
  mkdirSync(out, { recursive: true });
  const results = [];
  const save = () => writeFileSync(`${out}/results.json`, JSON.stringify({ mode, shard, inventory: all.length, results }, null, 2));
  save();
  for (const { command, i } of selected) {
    console.log(`[${i + 1}/${all.length}] ${command}`);
    const result = await run(command, `${out}/${String(i + 1).padStart(3, '0')}.log`, timeoutMs, testEnv(process.env));
    results.push(result); save();
    console.log(`${result.code === 0 && !result.timedOut ? 'PASS' : 'FAIL'} (${Math.round(result.durationMs / 1000)}s) ${command}`);
  }
  const failures = results.filter(x => x.code !== 0 || x.timedOut);
  const summary = `${results.length - failures.length}/${results.length} commands passed (${mode}, shard ${shard}).\n` + failures.map(x => `- ${x.timedOut ? 'TIMEOUT' : 'FAIL'}: ${x.command}`).join('\n') + '\n';
  writeFileSync(`${out}/summary.md`, summary); console.log(summary);
  process.exitCode = failures.length ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
