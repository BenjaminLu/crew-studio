import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {constructor(tag){this.tag=tag;this.attrs={};this.children=[];this.style={setProperty(){}};this.classList={toggle(){}};}setAttribute(k,v){this.attrs[k]=v}append(...c){this.children.push(...c)}replaceChildren(...c){this.children=c}addEventListener(){}}
const sea=new Node('svg'),nodes={sea,flags:new Node('div'),sub:new Node('span'),log:new Node('footer')};let draw;
runInNewContext(readFileSync(new URL('../skins/voyage/voyage.js',import.meta.url),'utf8'),{document:{getElementById:id=>nodes[id],createElementNS:(_,t)=>new Node(t),createElement:t=>new Node(t),documentElement:new Node('html'),body:new Node('body'),querySelector:()=>new Node('main')},CrewSkin:{onSnapshot:fn=>draw=fn,onEvent(){},ready(){}}});
const flow={nodes:Array.from({length:30},(_,i)=>({id:'n'+i,label:'Long workflow step '+i}))};
draw({flow,tasks:Array.from({length:18},(_,i)=>({id:'R-'+i,node:'n12',status:'needs-you'})),crew:[],pending:[]});
const buoys=sea.children.filter(n=>n.attrs.class==='buoy');const xs=buoys.map(n=>n.children[0].attrs.cx);
assert.equal(xs.length,30);for(let i=1;i<xs.length;i++)assert(xs[i]-xs[i-1]>=160);
const ships=sea.children.filter(n=>n.attrs.class==='ship');assert.equal(ships.length,18,'no hidden fourteen-ship cap');
const ys=ships.map(n=>Number(n.attrs.transform.match(/translate\([^ ]+ ([^)]+)/)[1]));for(let i=1;i<ys.length;i++)assert(Math.abs(ys[i]-ys[i-1])>=140,'same-node ships need separate rows');
const [,,w,h]=sea.attrs.viewBox.split(' ').map(Number);assert(w>1200);assert(h>560);assert(ys.every(y=>y>=0&&y+120<h));
console.log('voyage: 30 nodes and 18 same-node ships fit without overlap PASS');
