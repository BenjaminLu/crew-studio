import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'crew-check-config-'));
try {
 const script=join(dir,'check.cjs');
 writeFileSync(script,readFileSync('packs/firstmate/checks/covering-suites/run'));
 const run=cfg=>{const r=spawnSync(process.execPath,[script],{input:JSON.stringify({workdir:dir,out:dir,repo_cfg:cfg,diff:{paths:[]}}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const missing=run({});assert.equal(missing.verdict,'pass');assert.equal(missing.data.status,'not-run');assert.deepEqual(missing.evidence,[]);assert.deepEqual(missing.proves,[]);
 assert.equal(run({test:[process.execPath,'--version'],testFiles:[]}).verdict,'pass');
 const noInventory=run({test:[process.execPath,'--version']});assert.equal(noInventory.verdict,'fail');assert.equal(noInventory.findings[0].class,'test-inventory');
 console.log('PASS no command allows the gate with not-run status and no proof; declared commands require host test inventory');
} finally {rmSync(dir,{recursive:true,force:true});}
