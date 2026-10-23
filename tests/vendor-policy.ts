import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Typed capability facts are strict fake-provider evidence; native callers below
// prove the policy is actually used before any session starts.
import { makeProvider } from "../src/providers";
import { nativeChain, selectNativeProvider, ProviderRefusal, type ProviderCapability, type ProviderSelection } from "../src/providers/policy";
import { harness, suite, Y, until } from "./rt-harness";
const { ok, end }=suite("vendor-policy");
let made:string[]=[],probes:string[]=[];
const make=(id:string,model:string,effort:string|null)=>{made.push(id);return{id,model,reasoningEffort:effort,sandboxFree:true,start(){return{interrupt(){},async *send(){yield{type:"turnEnd" as const,status:"ok" as const};}};}};};
const facts=(id:string,patch:Partial<ProviderCapability>={}):ProviderCapability=>({provider:id,available:true,auth:"verified",quota:"available",models:[{id:id==="codex"?"approved-codex":"approved-claude",efforts:["low","medium"]}],at:Date.now()-10,expires:Date.now()+30_000,...patch});
const input:ProviderSelection={role:"worker",host:"codex",explicit:false,provider:"codex",model:null,configured:{codex:{model:"approved-codex",effort:"low"},claude:{model:"approved-claude"}},fallback:["claude","codex"],known:["claude","codex"]};
const probe=async(id:string)=>{probes.push(id);return facts(id);};
const reset=()=>{made=[];probes=[];};
const refused=async(f:()=>Promise<any>)=>{try{await f();return false;}catch(e){return e instanceof ProviderRefusal;}};
let r=await selectNativeProvider(input,probe,make);ok(r.provider.id==="claude"&&r.provider.model==="approved-claude"&&made.join()==="claude","worker chooses opposite confirmed Codex host with that vendor's configured model");
reset();r=await selectNativeProvider({...input,host:"claude"},probe,make);ok(r.provider.id==="codex"&&r.provider.model==="approved-codex"&&r.evidence.effort==="low","Claude host selects configured Codex model and preserves approved low effort");
reset();r=await selectNativeProvider(input,async id=>facts(id,id==="claude"?{available:false,auth:"missing",models:[],refusal:"unavailable",reason:"adapter unavailable"}:{}),make);ok(r.provider.id==="codex"&&made.join()==="codex"&&r.evidence.unavailable.length===1,"only proven unavailable primary advances to configured fallback with its own model");
reset();r=await selectNativeProvider(input,async id=>facts(id,id==="claude"?{quota:"exhausted",refusal:"exhausted"}:{}),make);ok(r.provider.id==="codex"&&!made.includes("claude"),"exhausted quota never launches primary provider");
reset();ok(await refused(()=>selectNativeProvider(input,async id=>facts(id,id==="claude"?{auth:"unverified"}:{}),make))&&!made.length,"unverified login holds without advancing a fallback provider");
reset();ok(await refused(()=>selectNativeProvider({...input,explicit:true,provider:"claude",model:"approved-claude"},async id=>facts(id,{quota:"unknown"}),make))&&!made.length,"explicit provider with unknown quota refuses, never falls back");
reset();ok(await refused(()=>selectNativeProvider({...input,explicit:true,provider:"codex",model:"unknown-model"},probe,make))&&!made.length,"unknown configured model refuses before any provider session or vendor change");
reset();ok(await refused(()=>selectNativeProvider({...input,explicit:true,provider:"codex",model:"approved-codex",effort:"ultra"},probe,make))&&!made.length,"unsupported approved effort refuses rather than changing effort");
reset();ok(await refused(()=>selectNativeProvider({...input,role:"judge",provider:"claude",model:"approved-claude"},async id=>facts(id,{auth:"missing"}),make))&&!made.length,"judge's explicit vendor cannot use worker fallback");
reset();r=await selectNativeProvider({...input,host:null,fallback:["codex","claude"]},probe,make);ok(r.provider.id==="codex"&&r.evidence.rule.includes("unknown host"),"unknown host follows configured fallback head with an explicit reason");
reset();ok(await refused(()=>selectNativeProvider({...input,fallback:["unknown-vendor"]},probe,make))&&!made.length&&!probes.length,"unknown fallback identity is rejected before capability or launch");
reset();ok(await refused(()=>selectNativeProvider(input,async id=>facts(id,{expires:Date.now()-1}),make))&&!made.length,"stale capability evidence cannot launch a round");
reset();ok(await refused(()=>selectNativeProvider(input,async()=>{throw new Error("probe unavailable");},make))&&!made.length,"probe error is unverified rather than a fallback or successful launch");
reset();ok(await refused(()=>selectNativeProvider(input,probe,(id,model)=>make("codex",model,null)))&&!made.includes("claude"),"actual resolved provider identity must match verified vendor");
// Cursor: a Cursor host's opposite is the first ready of Codex and Claude, else Cursor; the reviewer stands in only when Claude is absent
{ const cfacts=(id:string,patch:Partial<ProviderCapability>={})=>id==="cursor"?facts(id,{models:[{id:"approved-cursor",efforts:[]}],...patch}):facts(id,patch);
  const ci:ProviderSelection={...input,host:"cursor",configured:{...input.configured,cursor:{model:"approved-cursor",effort:null}},fallback:["codex","claude","cursor"],known:["claude","codex","cursor"]};
  const gone={available:false,auth:"unverified" as const,quota:"unknown" as const,models:[],refusal:"unavailable" as const,reason:"not installed"},unverified={available:false,auth:"unverified" as const,quota:"unknown" as const,models:[],refusal:"unverified" as const,reason:"no verified native Codex login"};
  reset();r=await selectNativeProvider(ci,async id=>{probes.push(id);return cfacts(id);},make);ok(r.provider.id==="codex"&&made.join()==="codex"&&r.evidence.rule==="opposite-of-host","Cursor host: a ready Codex is the opposite vendor");
  reset();r=await selectNativeProvider(ci,async id=>cfacts(id,id==="codex"?unverified:{}),make);ok(r.provider.id==="claude"&&made.join()==="claude"&&r.evidence.unavailable[0]?.provider==="codex","Cursor host: an unverified Codex is passed over (not a hold) and a ready Claude is the opposite vendor");
  reset();r=await selectNativeProvider(ci,async id=>cfacts(id,id==="codex"?unverified:id==="claude"?gone:{}),make);ok(r.provider.id==="cursor"&&r.provider.model==="approved-cursor"&&r.evidence.effort===null&&made.join()==="cursor"&&r.evidence.unavailable.length===2,"Cursor host on a Cursor-only machine: neither Codex nor Claude ready, so the round runs on Cursor with effort null");
  reset();ok(await refused(()=>selectNativeProvider(ci,async id=>cfacts(id,id==="cursor"?{auth:"unverified"}:gone),make))&&!made.length,"Cursor host: when Cursor itself is unverified the round holds");
  reset();ok(await refused(()=>selectNativeProvider({...ci,configured:{...ci.configured,codex:{model:null}}},async id=>cfacts(id,id==="claude"?gone:{auth:"unverified"}),make))&&!made.length,"Cursor host: a Codex seat with no configured model is passed over, the chain still holds on an unverified Cursor");
  const rev:ProviderSelection={...ci,role:"reviewer",host:null,explicit:true,provider:"claude",model:"approved-claude",alternates:["codex","claude","cursor"]};
  reset();r=await selectNativeProvider(rev,async id=>cfacts(id,id==="claude"?gone:id==="codex"?unverified:{}),make);ok(r.provider.id==="cursor"&&made.join()==="cursor"&&/stand-in/.test(r.evidence.rule),"reviewer: Claude not installed and Codex unverified, so the configured stand-in Cursor reviews");
  reset();r=await selectNativeProvider(rev,async id=>cfacts(id,id==="claude"?{auth:"missing",refusal:"missing-login",models:[]}:{}),make);ok(r.provider.id==="codex"&&r.provider.model==="approved-codex","reviewer: Claude not signed in, the first ready stand-in (Codex) reviews with its own configured model");
  reset();r=await selectNativeProvider(rev,async id=>{probes.push(id);return cfacts(id);},make);ok(r.provider.id==="claude"&&probes.join()==="claude","reviewer: a ready Claude reviews and no stand-in is probed");
  reset();ok(await refused(()=>selectNativeProvider(rev,async id=>cfacts(id,id==="claude"?{quota:"exhausted",refusal:"exhausted"}:{}),make))&&!made.length,"reviewer: an exhausted Claude holds, never a stand-in");
  reset();ok(await refused(()=>selectNativeProvider(rev,async id=>cfacts(id,id==="claude"?{auth:"unverified"}:{}),make))&&!made.length,"reviewer: an unverified Claude holds, never a stand-in");
  reset();ok(await refused(()=>selectNativeProvider({...rev,alternates:undefined},async id=>cfacts(id,id==="claude"?gone:{}),make))&&!made.length,"reviewer without stand-ins: an unavailable Claude still refuses");
  reset();ok(await refused(()=>selectNativeProvider(rev,async id=>cfacts(id,id==="claude"?gone:unverified),make))&&!made.length,"reviewer: no ready stand-in refuses");
  // the server's chain (src/server.ts nativePick): stand-ins under Cursor only; a chat vendor alone never makes the chain Cursor
  const fb=["codex","claude"],all={codex:"logged-in",claude:"logged-in",cursor:"logged-in"},rv={role:"reviewer",explicit:false,fixture:false,fallback:fb};
  for(const host of ["codex","claude"]){
    const c=nativeChain({...rv,host,logins:all});
    reset();ok(c.chain===host&&c.alternates===undefined&&await refused(()=>selectNativeProvider({...rev,host:c.chain,alternates:c.alternates},async id=>cfacts(id,id==="claude"?gone:{}),make))&&!made.length,`under a ${host} host an unavailable policy reviewer still holds (no stand-in)`);
  }
  ok(JSON.stringify(nativeChain({...rv,host:"cursor",logins:all}).alternates)==='["codex","claude","cursor"]',"under a Cursor host the reviewer's stand-ins are the fallback, then Cursor");
  ok(nativeChain({...rv,host:"cursor",logins:all,explicit:true}).alternates===undefined&&nativeChain({...rv,host:"cursor",logins:all,fixture:true}).alternates===undefined&&nativeChain({...rv,role:"worker",host:"cursor",logins:all}).alternates===undefined,"an explicit pick, the offline fixture and a worker get no stand-ins");
  ok(nativeChain({...rv,role:"worker",host:null,logins:{codex:"logged-in",claude:"not-logged-in",cursor:"logged-in"}}).chain===null&&nativeChain({...rv,role:"worker",host:null,logins:{codex:"not-logged-in",claude:"logged-in",cursor:"logged-in"}}).chain===null,
    "no attached host and Codex or Claude signed in: workers select as before, even with Cursor ready (and whatever the chat vendor)");
  ok(nativeChain({...rv,role:"worker",host:null,logins:{codex:"not-logged-in",claude:"unknown",cursor:"logged-in"}}).chain==="cursor"&&nativeChain({...rv,role:"worker",host:null,logins:{codex:"not-logged-in",claude:"not-logged-in",cursor:"not-logged-in"}}).chain===null,
    "no attached host: Cursor's rules only when Cursor is the one vendor signed in");
  reset();r=await selectNativeProvider({...ci,host:nativeChain({...rv,role:"worker",host:null,logins:{codex:"logged-in",claude:"not-logged-in",cursor:"logged-in"}}).chain,fallback:fb},async id=>cfacts(id,id==="claude"?gone:{}),make);
  ok(r.provider.id==="codex"&&r.evidence.rule.includes("unknown host"),"with Codex signed in and no host, a worker takes the configured fallback, never the Cursor chain"); }
let unknown=false;try{makeProvider("unknown-provider");}catch{unknown=true;}ok(unknown,"public provider factory refuses unknown identities rather than silently choosing Claude");
// Real native Engine selection seam: strict fake capabilities are consumed by
// the actual caller; no synthetic card JSON or callback result is asserted alone.
const flow={id:"vendor-native",name:"Native vendor policy",version:1,roles:[{id:"worker",label:"Worker",skill:"test"}],nodes:[{id:"work",kind:"agent",role:"worker",mode:"probe",label:"Worker",x:0,y:0},{id:"done",kind:"hook",label:"Done",x:1,y:0}],edges:[{from:"work",to:"done"}]};
const H=await harness([Y(flow)]),E=H.engine;let actual:string[]=[],mode="normal",nativeProbes=0;
const nativeMake=(id:string,model:string,effort:string|null)=>({...make(id,model,effort),start(){actual.push(`${id}:${model}:${effort}`);return{interrupt(){},async *send(){yield{type:"turnEnd" as const,status:"ok" as const};}};}});
E.deps.provider=(id?:string,model?:string)=>nativeMake(id??"codex",model??"approved-codex","low");E.deps.defaultProvider=()=>({provider:"codex",model:"approved-codex"});
E.deps.selectProvider=async(x:any,p:any,context?:any)=>{const chosen=await selectNativeProvider({...input,role:context?.role??"worker",explicit:context?.explicit??false,provider:p.provider,model:context?.explicit?p.model:null,configured:{...input.configured,codex:{model:mode==="bad-model"?"unverified-guess":"approved-codex",effort:"low"}}},async id=>{nativeProbes++;return facts(id,mode==="bad-model"&&id==="claude"?{available:false,auth:"missing",models:[],refusal:"missing-login"}:mode==="no-auth"?{auth:"unverified"}:{})},nativeMake);x.engine.record(x,"provider-selection",{data:chosen.evidence});return chosen.provider;};
E.modes.probe={system:()=>"Native test",prompt:()=>"Native test",tools:()=>[],after:()=>"pass"};
const native=E.start({workflow:flow.id});await until(()=>E.get(native.id)!.status==="succeeded");ok(actual.some(s=>s.startsWith("claude:approved-claude"))&&nativeProbes>0&&E.trusted(native.id).entries.some(e=>e.record==="provider-selection"),"real native worker routes opposite host through proven capabilities before launch");
actual=[];mode="no-auth";const noauth=E.start({workflow:flow.id});await until(()=>E.cards.list({run:noauth.id,open:true}).length>0||E.get(noauth.id)!.status==="succeeded");const nc=E.cards.list({run:noauth.id,open:true})[0];ok(!actual.length&&nc?.kind==="scope"&&nc.title["zh-TW"].startsWith("回合無法開始：")&&/Sign in or wait for quota/.test(nc.sections.en.how)&&/Firstmate is not running/.test(nc.body),"actual native unverified login ends on a bilingual capability card (a plain cause and the exact action, after Firstmate) without launching either vendor");E.cancel(noauth.id);
actual=[];mode="bad-model";const badmodel=E.start({workflow:flow.id});await until(()=>E.cards.list({run:badmodel.id,open:true}).length>0||E.get(badmodel.id)!.status==="succeeded");ok(!actual.length&&E.cards.list({run:badmodel.id,open:true})[0]?.kind==="scope","actual native fallback refuses unknown model before provider starts");E.cancel(badmodel.id);
// Explicit diversity operates on actual canonical vendor IDs; independent
// same-vendor fresh-context quorum is a separate declared contract.
mode="normal";E.deps.selectProvider=undefined;const hold=E.start({workflow:flow.id});await until(()=>E.get(hold.id)!.status==="succeeded");const rn=E.get(hold.id)!,x={...E.x(rn,rn.def.nodes[0],rn.nodes.work),run:{...rn,id:"try",status:"running" as const}};
E.deps.provider=(_id?:string,model?:string)=>({id:"codex",model:model??"approved-codex",sandboxFree:true,start(_s:any,_t:any,ctx:any){return{interrupt(){},async *send(){await H.agents.callTool(ctx.token,"judge_report",{verdict:"pass",findings:[]});yield{type:"turnEnd" as const,status:"ok" as const};}};}});
const man:any={id:"agreement",ref:"fixture/agreement",title:{en:"Agreement"},kind:"judged",timeout_s:5,judge:{prompt:"Judge",vendors:["claude","codex"],distinct_providers:true,quorum:{n:2,of:2}}};
// These judged test callers use a fresh live task owner rather than a terminal
// ref: standalone manual sample ownership preserves the actual job route.

const duplicate=await E.judge(x,man,{use:man.ref},{run:"try",artifact:null} as any);ok(duplicate.verdict==="error"&&/duplicate/.test(duplicate.error??""),"two requested vendors resolving to one actual provider cannot prove diversity");
const ordinary=await E.judge(x,{...man,judge:{prompt:"Judge",provider:"codex",quorum:{n:2,of:3}}},{use:man.ref},{run:"try",artifact:null} as any);ok(ordinary.verdict==="pass"&&ordinary.votes?.length===3&&new Set(ordinary.votes.map((v:any)=>v.job)).size===3&&ordinary.votes.every((v:any)=>v.provider==="codex"),"ordinary quorum retains three real independent fresh contexts on same vendor");
H.stop();end();
