import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Execute the real tour controller with a minimal DOM boundary. Chrome covers layout.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/onboarding.js',import.meta.url),'utf8');
function fixture(auto=false){
 const listeners=new Map(),saved=new Map(),reads=[],timers=[],frames=new Map();let serial=0,focus=null,capabilityResolve;
 class Node{
  constructor(tag,attrs={},children=[]){this.tag=tag;this.attrs=attrs;Object.assign(this,attrs);this.style={maxHeight:'',overflow:''};this.children=children.flat().filter(Boolean);this.isConnected=true;this.offsetWidth=340;this.offsetHeight=240;}
  append(...kids){this.children.push(...kids)} replaceChildren(...kids){this.children=kids} remove(){this.isConnected=false;body.children=body.children.filter(x=>x!==this)} focus(){focus=this} scrollIntoView(){}
  querySelector(q){return this.children.find(x=>x?.tag===q)||this.children.map(x=>x?.querySelector?.(q)).find(Boolean)}
  getBoundingClientRect(){return {top:100,bottom:400,left:420,right:1000,width:580,height:300}}
 }
 const body=new Node('body'),main=new Node('main'),view=new Node('view'),target=new Node('target');
 const emit=type=>(listeners.get(type)||[]).forEach(fn=>fn({key:'Escape',preventDefault(){}}));
 const on=(type,fn)=>listeners.set(type,[...(listeners.get(type)||[]),fn]);
 const off=(type,fn)=>listeners.set(type,(listeners.get(type)||[]).filter(f=>f!==fn));
 const doc={body,activeElement:new Node('trigger'),querySelector:q=>q==='#view'?view:q==='#main'?main:q.includes('modal-back')?null:target,addEventListener:on,removeEventListener:off};
 const ctx={T:en=>en,h:(tag,a,...c)=>new Node(tag,a,c),store:{get:(k,d)=>saved.get(k)||d,set:(k,v)=>saved.set(k,v)},routes:{settings:()=>new Node('settings')},S:{route:{name:auto?'board':'settings'}},render(){},document:doc,location:{hash:auto?'#/board':'#/settings'},innerWidth:1200,innerHeight:800,addEventListener:on,removeEventListener:off,setTimeout(fn){timers.push(fn)},requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial},cancelAnimationFrame:id=>frames.delete(id),MutationObserver:class{observe(){}disconnect(){}},getJ:async url=>{reads.push(url);if(url==='/api/session')return {session:true};if(url==='/api/remote/me')return {kind:'desktop'};return new Promise(resolve=>{capabilityResolve=resolve})}};
 ctx.window=ctx;
 const runtime=readFileSync(new URL('../public/runtime.js',import.meta.url),'utf8');ctx.rerender=()=>{};
 runInNewContext(runtime.slice(runtime.indexOf('const RN ='),runtime.indexOf('function viewRuns()'))+';globalThis.draftState=RN;',ctx);
 runInNewContext(source,ctx);
 const all=n=>[n,...n.children.flatMap(x=>x instanceof Node?all(x):[])];
 const button=attr=>all(body).find(n=>Object.hasOwn(n.attrs,attr));
 return {ctx,body,reads,timers,saved,target,main,emit,button,focus:()=>focus,flush:()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn())},resolve:()=>capabilityResolve({state:'ready',model:'fixture'})};
}
const f=fixture();await f.ctx.crewOpenOnboarding();f.emit('hashchange');f.flush();
assert.equal(f.ctx.location.hash,'#/doctor');assert(f.button('data-ob-next').disabled);
f.target.focus();f.resolve();await new Promise(setImmediate);f.flush();
assert.equal(f.focus(),f.target,'metadata completion must not steal focus');assert(!f.button('data-ob-next').disabled);
f.button('data-ob-next').onclick();f.emit('hashchange');f.flush();assert.equal(f.ctx.location.hash,'#/gates');
f.button('data-ob-next').onclick();f.emit('hashchange');f.flush();assert.equal(f.ctx.location.hash,'#/runs');
assert.equal(f.ctx.draftState.draft,'Generate an image of a cute puppy.');assert.equal(f.ctx.draftState.prefill,'images');assert.equal(f.ctx.draftState.provider,'codex');
f.ctx.draftState.draft='My edited task';
f.button('data-ob-back').onclick();f.emit('hashchange');f.flush();assert.equal(f.ctx.location.hash,'#/gates');
f.button('data-ob-next').onclick();f.emit('hashchange');f.flush();f.button('data-ob-next').onclick();
assert.equal(f.body.children.length,0);assert([...f.saved.values()].includes('completed'));assert.equal(f.ctx.draftState.draft,'My edited task');
const existing=fixture();existing.ctx.draftState.draft='Existing task';existing.ctx.crewPrefillFirstTask();assert.equal(existing.ctx.draftState.draft,'Existing task');assert.equal(existing.ctx.draftState.prefill,null);
assert(f.reads.every(url=>['/api/session','/api/remote/me','/api/codex/native/status'].includes(url)),'tour never creates tasks or performs account mutations');
await f.ctx.crewOpenOnboarding();f.emit('hashchange');f.emit('keydown');assert.equal(f.body.children.length,0,'Escape removes tour');
const race=fixture();const opening=race.ctx.crewOpenOnboarding();race.ctx.location.hash='#/runs';race.emit('hashchange');await opening;assert.equal(race.body.children.length,0,'late session reads cannot reopen after navigation');
const phone=fixture();phone.ctx.getJ=async url=>url==='/api/session'?{session:true}:{kind:'phone'};await phone.ctx.crewOpenOnboarding();assert.equal(phone.body.children.length,0);
console.log('onboarding: route steps, readiness, focus, finish, Escape, stale open and phone guard PASS');

const board=fixture(true);for(const timer of board.timers.splice(0))timer();await new Promise(setImmediate);board.flush();
assert.equal(board.ctx.location.hash,'#/board','fresh Board must not be redirected away from its account controls');
assert.equal(board.body.children.length,0,'the legacy quick tour opens only by explicit request');
board.emit('crew:codex-account');board.emit('hashchange');for(const timer of board.timers.splice(0))timer();await new Promise(setImmediate);
assert.equal(board.ctx.location.hash,'#/board','cancel/account and route events cannot steal Board navigation');
console.log('onboarding: passive Board and account events preserve login route PASS');
