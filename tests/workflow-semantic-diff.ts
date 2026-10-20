import "./lib/isolated-env.mjs";
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WorkflowDefs,diff,type WDef} from '../src/runtime/defs';
import {suite} from './rt-harness';
const {ok,end}=suite('workflow-semantic-diff');
const base:WDef={id:'semantic-proof',name:'Semantic proof',version:1,roles:[{id:'writer',label:'Writer',skill:'bundled:writer.md'},{id:'reviewer',label:'Reviewer',skill:'bundled:reviewer.md'}],nodes:[{id:'start',kind:'card',label:'Start',x:80,y:100,card:{title:'Continue?',options:[{id:'yes',label:'Yes'}]}},{id:'done',kind:'hook',label:'Done',x:340,y:100}],edges:[{from:'start',to:'done',when:'yes'}]};
const values={seats:[{id:'auditor',label:'Auditor',labelZh:'稽核'}],intent:{keywords:['audit'],examples:['Review the release']},card_checks:['core/ste-wording'],compare:[['writer','reviewer']],kind:'semantic-fixture'};
for(const [field,value]of Object.entries(values)){
 const next={...structuredClone(base),[field]:value};
 ok(diff(base,next).meta.includes(field as any),`${field}-only edit appears in the saved semantic diff`);
 const data=mkdtempSync(join(tmpdir(),'crew-semantic-'));try{
  const defs=new WorkflowDefs(data);defs.createDrafted(base.id,base,'captain',{schema:1,source:'starter'});
  let saved:WDef|undefined,error='';try{saved=defs.save(base.id,{base:1,[field]:value},'captain');}catch(e:any){error=e.message;}
  ok(saved?.version===2&&saved.diff?.meta.includes(field as any),`${field}-only edit saves a new version rather than disappearing`,error);
  ok(defs.get(base.id,1)?.[field as keyof WDef]===undefined,`${field}-only save preserves the earlier version`);
 }finally{rmSync(data,{recursive:true,force:true});}
}
ok(diff(base,{...base,nodes:base.nodes.map(n=>({...n,x:n.x+50,y:n.y+20}))}).meta.length===0,'layout-only movement does not invent a semantic metadata change');
ok(diff(base,{...base,version:8,by:'another captain',note:'record only'}).meta.length===0,'version-record metadata does not invent execution changes');
end();
