import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CheckRegistry } from '../src/runtime/checks';

// Real Node must execute the extracted check under an ESM application root.
const root = mkdtempSync(join(tmpdir(), 'crew-check-module-'));
try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const registry = new CheckRegistry(join(root, 'data'));
  const work = join(root, 'work');
  mkdirSync(work);
  writeFileSync(join(work, 'shared.js'), 'module.exports = 1;');
  writeFileSync(join(work, 'caller.cjs'), 'require("./shared.js");');
  const manifest = registry.get('firstmate/caller-coverage')!;
  assert(manifest);
  const executable = registry.executable(manifest);
  const bytes = readFileSync(executable);
  const check = (scope: string[]) => {
    const result = spawnSync('node', [executable], {
      cwd: work,
      input: JSON.stringify({ workdir: work, artifact: { data: { scope } } }),
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(check(['shared.js']).verdict, 'fail', 'out-of-scope caller still blocks');
  assert.equal(check(['shared.js', 'caller.cjs']).verdict, 'pass');
  assert.deepEqual(readFileSync(executable), bytes, 'module isolation preserves check bytes');
  // An already-extracted cache must receive the boundary too, without altering the script.
  rmSync(join(dirname(executable), 'package.json'), { force: true });
  assert.equal(registry.executable(manifest), executable);
  assert.equal(check(['shared.js', 'caller.cjs']).verdict, 'pass');

  // Explicit ESM and non-Node executables keep their declared runtime.
  const fixture = join(root, 'fixture');
  mkdirSync(fixture);
  for (const [name, source, argv] of [
    ['run.mjs', 'import fs from "node:fs"; console.log(typeof fs.readFileSync);', ['node']],
    ['run.sh', '#!/bin/sh\nprintf shell', ['/bin/sh']],
  ] as const) {
    writeFileSync(join(fixture, name), source);
    const file = registry.executable({ ...manifest, dir: fixture, id: name, run: name });
    const result = spawnSync(argv[0], [file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), name === 'run.mjs' ? 'function' : 'shell');
  }
  console.log('PASS extracted checks under ESM roots: real Node, blocking callers, existing caches, unchanged bytes, explicit ESM and shell');
} finally {
  rmSync(root, { recursive: true, force: true });
}
