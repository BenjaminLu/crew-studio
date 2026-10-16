import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness';
import {ArtifactStore,websiteHref} from '../src/artifacts';
import {installHelloWeb} from '../src/domain/hello-web';
const source=JSON.parse(readFileSync(join(import.meta.dir,'../workflows/v2/hello-crew-studio.wf.yaml'),'utf8'));
const h=await harness([Y(source)]),e=h.engine,store=new ArtifactStore(h.data);installHelloWeb(e,store);
try{
 const run=e.start({workflow:source.id,params:{heading:'Hello Crew Studio'}});
 assert(await until(()=>e.cards.list({run:run.id,open:true}).length===1&&!e.busy(run.id)));
 const pin=run.ctx.deliver.build,v=store.version(pin.id,pin.n)!;assert.equal(v.status,'in-review');assert.deepEqual(store.verify(pin.id,pin.n),[]);
 const html=readFileSync(store.file(pin.id,pin.n,'index.html')!,'utf8');assert.match(html,/<h1>Hello Crew Studio<\/h1>/);assert.match(html,/name="viewport"/);assert.equal(h.agents.jobs.size,0);
 const c=e.cards.list({run:run.id,open:true})[0];assert.equal(c.links[0].href,websiteHref(store.get(pin.id),v));assert.equal(c.captainOnly,true);
 await e.answer(c.id,{choice:'approve',by:'fixture captain'});assert(await until(()=>run.status==='succeeded'));assert.equal(store.version(pin.id,pin.n)?.status,'approved');
 const escaped=e.start({workflow:source.id,params:{heading:'<script>bad</script>'}});assert(await until(()=>!!escaped.ctx.deliver));assert.match(readFileSync(store.file(escaped.ctx.deliver.build.id,1,'index.html')!,'utf8'),/&lt;script&gt;bad&lt;\/script&gt;/);
 console.log('PASS Hello web creates an intact responsive HTML artifact with no model, previews before approval, completes and escapes user text');
}finally{for(const r of e.list())if(!['succeeded','failed','cancelled'].includes(r.status))await e.cancel(r.id);h.stop();}
