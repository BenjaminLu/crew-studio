// Firstmate and the Studio team (docs/design/crew-seats.md): Firstmate reads who runs what (studio_crew_assignments) and
// proposes a change (studio_propose_crew_change), which opens one captain card; only the captain's approval writes the
// team. The same card is raised when a workflow needs a seat nobody fills (a specialist seat, or a role a workflow upgrade
// added), with a suggestion filtered by the capabilities the seat needs; when no model qualifies, the card says which
// capability is missing and where to add an account, and offers nothing to approve.
import {createHash} from 'node:crypto';
import {withJudges,isJudgeRow,type JudgeSlot,CrewStore,resolveCrew,applyChange,validateChange,changeImpact,crewBadge,teamBody,emptyTeam,slotsOf,declaredSeats,seatLabel,seatUses,capabilitiesOf,projectLayer,reviewingSeat,IMAGE_SEAT,CAP_LABELS,BUILTIN_SEATS,EFFORTS,type CrewChange,type Team,type SeatDecl,type Member} from './domain/crew';
import {staffingApplies,staffingHash} from './domain/staffing';
import {crewApplies,judgeSlots} from './crew-guard';
import {crewWorkflows,roleSkillLabel,checkPins} from './crew-routes';
import {withRoleNodes} from './crew-staffing';
import {NativeToolFailure,type NativeMainTools} from './host/types';
import {normalize,defBody,installedSource} from './runtime/defs';
import {bundledText} from './bundled';
import type {Engine} from './runtime/engine';

type Facts={provider:string;support?:string;auth?:string;models:{id:string;efforts:string[];tags?:string[]}[]}[];
const SOURCE='crew-change';
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const pickLine=(m:{provider:string|null;model:string|null;effort:string|null}|null|undefined)=>m?.provider?`${m.provider} ${m.model} · ${m.effort??'default'}`:'—';
/** A change in the captain's words (en and zh-TW). */
export function describeChange(c:CrewChange,team:Team,def?:any):{en:string;zh:string}{
 const lab=(id:string)=>seatLabel(team,id,def);
 if(c.kind==='member'){const s=c.set,parts=[s.provider||s.model?`model ${s.provider??team.members[c.seat]?.provider} ${s.model??team.members[c.seat]?.model}`:'',Object.hasOwn(s,'effort')?`effort ${s.effort??'default'}`:'',s.skills?`skills ${s.skills.map(p=>`${p.id}@v${p.v}`).join(', ')||'none'}`:''].filter(Boolean);
  const zh=[s.provider||s.model?`模型 ${s.provider??team.members[c.seat]?.provider} ${s.model??team.members[c.seat]?.model}`:'',Object.hasOwn(s,'effort')?`effort ${s.effort??'預設'}`:'',s.skills?`skills ${s.skills.map(p=>`${p.id}@v${p.v}`).join('、')||'無'}`:''].filter(Boolean);
  return{en:`the whole “${lab(c.seat).en}”: ${parts.join(', ')}`,zh:`整個「${lab(c.seat).zh}」：${zh.join('、')}`};}
 if(c.kind==='node'){const s=c.set,n=slotsOf(def).find(x=>x.node===c.node)?.label??c.node;
  const en=[s.seat?`member ${lab(s.seat).en}`:'',s.provider||s.model?`model ${s.provider??''} ${s.model??''}`.trim():'',Object.hasOwn(s,'effort')?`effort ${s.effort??'default'}`:'',c.addSkill?`add skill ${c.addSkill.id}@v${c.addSkill.v}`:'',c.removeSkill?`remove skill ${c.removeSkill}`:''].filter(Boolean);
  const zh=[s.seat?`成員改為${lab(s.seat).zh}`:'',s.provider||s.model?`模型 ${s.provider??''} ${s.model??''}`.trim():'',Object.hasOwn(s,'effort')?`effort ${s.effort??'預設'}`:'',c.addSkill?`加上 skill ${c.addSkill.id}@v${c.addSkill.v}`:'',c.removeSkill?`移除 skill ${c.removeSkill}`:''].filter(Boolean);
  return{en:`${def?.name??c.workflow} · ${n}: ${en.join(', ')}, only in this workflow`,zh:`${def?.name??c.workflow} · ${n}：${zh.join('、')}，只在這個 workflow`};}
 if(c.kind==='restore')return{en:`${c.workflow}${c.node?` · ${c.node}`:''}: back to the team`,zh:`${c.workflow}${c.node?` · ${c.node}`:''}：恢復成團隊設定`};
 if(c.kind==='project'){const s=c.set,en=[s.provider||s.model?`model ${s.provider??team.members[c.seat]?.provider} ${s.model??team.members[c.seat]?.model}`:'',Object.hasOwn(s,'effort')?`effort ${s.effort??'default'}`:'',s.skills?`skills ${s.skills.map(p=>`${p.id}@v${p.v}`).join(', ')||'none'}`:''].filter(Boolean);
  const zh=[s.provider||s.model?`模型 ${s.provider??team.members[c.seat]?.provider} ${s.model??team.members[c.seat]?.model}`:'',Object.hasOwn(s,'effort')?`effort ${s.effort??'預設'}`:'',s.skills?`skills ${s.skills.map(p=>`${p.id}@v${p.v}`).join('、')||'無'}`:''].filter(Boolean);
  return{en:`“${lab(c.seat).en}”: ${en.join(', ')}, only in project ${c.project}`,zh:`「${lab(c.seat).zh}」：${zh.join('、')}，只在專案 ${c.project}`};}
 if(c.kind==='project-restore')return{en:`project ${c.project}${c.seat?` · ${lab(c.seat).en}`:''}: back to the team`,zh:`專案 ${c.project}${c.seat?` ·「${lab(c.seat).zh}」`:''}：恢復成團隊設定`};
 if(c.kind==='seat')return{en:`add the seat “${c.seat.label}” with ${pickLine(c.member)}`,zh:`新增「${c.seat.labelZh}」這個位置，由 ${pickLine(c.member)} 擔任`};
 return{en:`every member's effort: the ${c.preset} preset`,zh:`所有成員的 effort 改用「${c.preset}」組合`};
}
/** The verified models that can do everything a seat needs (its suggestion first). */
export function seatCandidates(seat:Pick<SeatDecl,'needs'|'suggest'>,facts:Facts){
 const out:{provider:'codex'|'claude';model:string;efforts:string[]}[]=[];
 for(const f of facts){if(f.support&&f.support!=='supported'||f.auth&&f.auth!=='verified')continue;if(f.provider!=='codex'&&f.provider!=='claude')continue;for(const m of f.models)if((seat.needs??[]).every(t=>capabilitiesOf(f.provider,m.id,facts as any).includes(t)))out.push({provider:f.provider,model:m.id,efforts:m.efforts});}
 const s=seat.suggest;return out.sort((a,b)=>Number(!!s&&(b.provider===s.provider)&&(!s.model||b.model===s.model))-Number(!!s&&(a.provider===s.provider)&&(!s.model||a.model===s.model)));
}
/** What a seat needs that no verified model has. */
export function unmetCapabilities(seat:Pick<SeatDecl,'needs'>,facts:Facts){return(seat.needs??[]).filter(t=>!facts.some(f=>(f.provider==='codex'||f.provider==='claude')&&(!f.auth||f.auth==='verified')&&f.models.some(m=>capabilitiesOf(f.provider,m.id,facts as any).includes(t))));}

export function installCrewTools(engine:Engine,store:CrewStore,o:{facts:()=>Promise<Facts>;send?:(t:string,d:unknown)=>void}){
 const source=normalize(JSON.parse(bundledText(`workflows/v2/${SOURCE}.wf.yaml`)||'null'));
 const installed=()=>installedSource(engine.defs,source,(a,b)=>staffingHash(a)===staffingHash(b));
 const bound=(def:any)=>{if(staffingHash(defBody(def))!==staffingHash(defBody(source)))throw new NativeToolFailure('target_changed','The team change workflow changed; restart Studio so it installs its built-in workflows','團隊變更流程已改變；請重新啟動 Studio 以安裝內建流程。','read_current_state');};
 const now=()=>{const c=store.current();return{cfg:c,team:c?teamBody(c):emptyTeam()};};
 const parse=(run:any)=>{bound(run.def);let c:any;try{c=JSON.parse(run.params.change);validateChange(c);}catch(e:any){throw new NativeToolFailure('crew_change_invalid',`This team change cannot be read: ${e?.message??e}`,'無法讀取這個團隊變更。','read_current_state');}return c as CrewChange;};
 /** Start (or find) the one card for this change. */
 function propose(change:CrewChange,reason:'change'|'seat'|'seat-unmet'|'new-role',key:string,context:Record<string,unknown>={}){
  const inst=installed();if(!inst)throw new NativeToolFailure('configuration_missing','Studio\'s team change workflow is not installed with its built-in content; restart Studio so it installs its built-in workflows.','Studio 的團隊變更流程沒有以內建內容安裝；請重新啟動 Studio。','captain_review');bound(inst);
  const sourceKey=sha({key,change,reason});const open=engine.list().find(r=>r.workflow===SOURCE&&r.params.source===sourceKey&&!['succeeded','failed','cancelled'].includes(r.status));if(open)return open;
  return engine.start({workflow:SOURCE,version:inst.version,title:reason==='change'?'Team change':'Team seat',text:reason==='change'?'Confirm a change to the Studio team':'Fill a team seat a workflow needs',params:{source:sourceKey,change:JSON.stringify(change),expected:now().cfg?.hash??'',reason,context:JSON.stringify(context).slice(0,4000)}});
 }
 engine.actions['crew.confirm']=async x=>{
  const change=parse(x.run),{cfg,team}=now();if((cfg?.hash??'')!==(x.run.params.expected??""))throw new NativeToolFailure('target_changed','The team changed after this card was prepared; ask Firstmate to propose it again','團隊在這張卡準備好之後改了；請 Firstmate 重新提出。','read_current_state');
  const reason=x.run.params.reason,ctx=JSON.parse(x.run.params.context||'{}'),def=change.kind==='node'?engine.defs.get(change.workflow):ctx.workflow?engine.defs.get(ctx.workflow):undefined;
  const wfs=crewWorkflows(engine.defs);
  if(reason==='seat-unmet'){
   const seat:SeatDecl=ctx.seat,caps=(ctx.unmet as string[]).map(t=>CAP_LABELS[t]??{en:t,zh:t});
   await engine.card(x,'question',{captainOnly:true,title:`“${seat.label}” needs a model that can ${caps.map(c=>c.en).join(' and ')}`,zhTitle:`「${seat.labelZh}」需要能${caps.map(c=>c.zh).join('、')}的模型`,
    body:`${def?.name??ctx.workflow} needs the team seat “${seat.label}”. None of your verified accounts has a model that can ${caps.map(c=>c.en).join(' and ')}, so Studio will not send a model that cannot do the work.\nAdd an account that can: Settings → Accounts (sign in to Codex or Claude), then ask Firstmate to propose the work again.\n\n${def?.name??ctx.workflow} 需要團隊的「${seat.labelZh}」位置。你目前已驗證的帳號都沒有能${caps.map(c=>c.zh).join('、')}的模型，所以 Studio 不會派一個做不到的模型去做。\n請到「設定 → 帳號」加一個做得到的帳號（登入 Codex 或 Claude），再請 Firstmate 重新提出這項工作。`,
    en:{intent:`Find a model for “${seat.label}”`,why:`No verified model can ${caps.map(c=>c.en).join(' and ')}.`,how:'Add an account in Settings → Accounts, then ask again.'},zh:{intent:`幫「${seat.labelZh}」找模型`,why:`目前沒有已驗證的模型能${caps.map(c=>c.zh).join('、')}。`,how:'到「設定 → 帳號」加帳號，再問一次。'},
    options:[{id:'close',label:'OK',labelZh:'知道了',primary:true,hold:true}]});return{wait:true};}
  let after:Team;try{after=applyChange(team,change,def);}catch(e:any){throw new NativeToolFailure('crew_change_invalid',`This team change does not apply: ${e?.message??e}`,'這個團隊變更無法套用。','read_current_state');}
  // a project change reaches that project's nodes only: its impact and notes are read in that project
  const project=change.kind==='project'||change.kind==='project-restore'?change.project:null;
  const impact=changeImpact(team,after,wfs,project),said=describeChange(change,team,def);
  const notes=wfs.flatMap(d=>resolveCrew(after,d,{},null,project).nodes.filter(n=>impact.some(i=>i.workflow===d.id&&i.node===n.node)).flatMap(n=>n.notes.map(m=>`${d.id} · ${n.node}: ${m.en} / ${m.zh}`)));
  const reach=impact.length?impact.map(i=>`  ${i.workflow} · ${i.label}: ${i.before} → ${i.after}`).join('\n'):'  (no node changes)';
  let title=`Change the team: ${said.en}?`,zhTitle=`改團隊：${said.zh}？`,head='';
  if(change.kind==='seat'||reason==='seat'||reason==='new-role'){
   const id=change.kind==='seat'?change.seat.id:change.kind==='member'?change.seat:'',lab=change.kind==='seat'?{en:change.seat.label,zh:change.seat.labelZh}:seatLabel(team,id,def),decl:any=change.kind==='seat'?change.seat:null;
   const member=change.kind==='seat'?change.member:change.kind==='member'?{provider:change.set.provider,model:change.set.model,effort:change.set.effort??null}:null;
   if(reason==='new-role'){title=`${def?.name??ctx.workflow} v${ctx.from} → v${ctx.to} adds “${ctx.label}”: let ${pickLine(member as any)} run it as “${lab.en}”?`;zhTitle=`${def?.name??ctx.workflow} v${ctx.from} → v${ctx.to} 多了「${ctx.label}」，用 ${pickLine(member as any)} 擔任「${lab.zh}」嗎？`;}
   else if(decl){title=`Add “${lab.en}” to the team?`;zhTitle=`團隊要新增「${lab.zh}」這個位置嗎？`;}
   else{title=`Who fills “${lab.en}”: ${pickLine(member as any)}?`;zhTitle=`「${lab.zh}」由 ${pickLine(member as any)} 擔任嗎？`;}
   head=[decl?.reviews?`Reviews: ${seatLabel(team,decl.reviews,def).en} (so it runs on another model) / 審查誰：${seatLabel(team,decl.reviews,def).zh}（所以要跟它用不同模型）`:'',decl?.needs?.length?`Needs: ${decl.needs.map((t:string)=>`${(CAP_LABELS[t]??{en:t}).en} ✓`).join(', ')} / 需要能力：${decl.needs.map((t:string)=>`${(CAP_LABELS[t]??{zh:t}).zh} ✓`).join('、')}`:'',
    `Suggested (only models with these capabilities): ${pickLine(member as any)} / 建議人選（只列出有這些能力的模型）：${pickLine(member as any)}`,ctx.others?.length?`Also possible / 也可以：${ctx.others.join(', ')}`:''].filter(Boolean).join('\n')+'\n\n';}
  await engine.card(x,'permission',{captainOnly:true,title,zhTitle,
   body:`${head}Change / 變更: ${said.en} / ${said.zh}\n\nWhat it reaches / 會影響:\n${reach}${notes.length?`\n\nAdjusted by the team rules / 團隊規則自動調整:\n${notes.map(n=>'  '+n).join('\n')}`:''}\n\nOnly your approval changes the team; a running Task keeps the crew it started with. / 只有你的核准會改團隊；已經在跑的任務維持原本的人員。`,
   en:{intent:`Change the Studio team: ${said.en}`,why:`${impact.length} node${impact.length===1?'':'s'} change. Firstmate proposed this; nothing changes until you approve.`,scope:{in:impact.length?impact.slice(0,12).map(i=>`${i.workflow} · ${i.label}`):['No node changes'],out:['Running Tasks','Accounts and global settings']},how:'Approve to change the team, or keep it as it is.'},
   zh:{intent:`改 Studio 團隊：${said.zh}`,why:`${impact.length} 個節點會變。這是 Firstmate 提出的；你核准前什麼都不會變。`,scope:{in:impact.length?impact.slice(0,12).map(i=>`${i.workflow} · ${i.label}`):['沒有節點會變'],out:['已經在跑的任務','帳號與全域設定']},how:'核准就改團隊，或維持現狀。'},
   options:[{id:'approve',label:change.kind==='seat'?`Add “${change.seat.label}”`:'Approve team change',labelZh:change.kind==='seat'?`新增「${change.seat.labelZh}」`:'核准團隊變更',primary:true},{id:'close',label:'Not now',labelZh:'先不用',hold:true}]});
  return{wait:true};};
 engine.actions['crew.apply']=async x=>{
  const change=parse(x.run),card=engine.cards.list({run:x.run.id}).find(c=>c.node==='confirm'&&c.captainOnly&&c.status==='answered'&&c.answer?.choice==='approve');
  const answer=engine.trusted(x.run.id).entries.find(e=>e.record==='card-answer'&&e.data?.card===card?.id&&e.data?.choice==='approve');
  if(!card||!answer||!engine.trusted(x.run.id).ok||!engine.owns(x)||!/^captain\b/i.test(String(card.answer?.by??'')))throw new NativeToolFailure('captain_confirmation_required','The captain\'s approval of this team change is missing','需要船長核准這個團隊變更。','captain_review');
  const {cfg,team}=now();if(cfg?.approval.card===card.id&&cfg.approval.run===x.run.id)return'ok';
  if((cfg?.hash??'')!==(x.run.params.expected??""))throw new NativeToolFailure('target_changed','The team changed after this card was shown; ask Firstmate to propose it again','團隊在這張卡顯示之後改了；請 Firstmate 重新提出。','read_current_state');
  const def=change.kind==='node'?engine.defs.get(change.workflow):undefined;
  const written=store.write(applyChange(team,change,def),cfg?.hash??null,{by:'captain (card)',via:'card',card:card.id,run:x.run.id,answerSeq:answer.seq});
  engine.record(x,'crew-approved',{data:{schema:1,team:written.hash,version:written.version,card:card.id}});try{o.send?.('team',{version:written.version});}catch{}return'ok';};
 /** A workflow that needs a seat the team does not fill: raise its card (once) and refuse the proposal, naming the seat and the card.
  *  Nothing for a Studio without a team (the per-project staffing flow applies) or a workflow the team covers. Read in the work's project. */
 async function seatGate(def:any,owner:{key:string},project?:string|null){
  const cfg=store.current();if(!cfg||!(crewApplies(def)||staffingApplies(def)))return;const team=teamBody(cfg);
  const res=resolveCrew(team,staffingApplies(def)?withRoleNodes(def):def,{},cfg.hash,project||null);if(!res.missing.length)return;
  const id=res.missing[0],decl=team.seats[id]??declaredSeats(def).find(s=>s.id===id)??(id===IMAGE_SEAT.id?IMAGE_SEAT:null),lab=seatLabel(team,id,def);
  const facts=await o.facts().catch(()=>[] as Facts),need:SeatDecl=decl??{id,label:lab.en,labelZh:lab.zh};
  const cands=seatCandidates(need,facts),unmet=unmetCapabilities(need,facts);
  // a role a workflow upgrade added: name it and the versions
  const prev=engine.defs.versions(def.id).filter((d:any)=>d.version<def.version).at(-1),added=prev&&!slotsOf(prev).some(s=>s.seat===id)?slotsOf(def).find(s=>s.seat===id):null;
  const ctx:any={workflow:def.id,seat:need,unmet,others:cands.slice(1,4).map(c=>`${c.provider} ${c.model}`),...(added?{from:prev!.version,to:def.version,label:added.label}:{})};
  let run;
  if(!cands.length)run=propose({kind:'restore',workflow:def.id},'seat-unmet',owner.key,{...ctx,unmet:unmet.length?unmet:(need.needs?.length?need.needs:['tools'])});
  else{const c=cands[0],effort=need.suggest?.effort!==undefined&&need.suggest.effort!==null&&c.efforts.includes(need.suggest.effort)?need.suggest.effort:c.efforts.includes('medium')?'medium':c.provider==='claude'?null:c.efforts[0]??'medium';
   const member:Member={provider:c.provider,model:c.model,effort,skills:[]};
   run=propose(decl&&!(BUILTIN_SEATS as readonly string[]).includes(id)?{kind:'seat',seat:structuredClone(decl),member}:{kind:'member',seat:id,set:{provider:c.provider,model:c.model,effort}},added?'new-role':'seat',owner.key,ctx);}
  throw new NativeToolFailure('crew_seat_missing',`${def.name} needs the team seat “${lab.en}”, which nobody fills yet. Studio raised card ${run.id} for the captain${cands.length?` (suggesting ${cands[0].provider} ${cands[0].model})`:' (no verified model can do it; it says which account to add)'}; propose the work again once the captain approves it. Do not propose staffing.`,`${def.name} 需要團隊的「${lab.zh}」位置，目前沒有人。Studio 已開卡 ${run.id} 給船長${cands.length?`（建議 ${cands[0].provider} ${cands[0].model}）`:'（目前沒有模型做得到，卡上會說要加哪個帳號）'}；船長核准後再重新提出這項工作。`,'captain_review');
 }
 /** The crew line a dispatch card shows (in the work's project, its project layer included), and the efforts the captain may change for
  *  this run only (staffed workflows too: on top of their signed staffing). A reviewing seat is offered medium or more only. */
 function dispatchCrew(def:any,project?:string|null){
  const cfg=store.current();if(!cfg||!(crewApplies(def)||staffingApplies(def)))return null;const team=teamBody(cfg),res=resolveCrew(team,def,{},cfg.hash,project||null);if(res.missing.length)return null;
  const rows=res.nodes,makers=rows.filter(r=>r.seat==='maker'||r.seat==='alt-maker'),models=new Set(makers.map(r=>`${r.provider}/${r.model}`)),reviewers=rows.filter(r=>r.seat==='reviewer'||r.seat==='design-reviewer');
  const en=[`${rows.length} agent${rows.length===1?'':'s'}`,makers.length>1&&models.size>1?'A and B on different models':'',reviewers.length&&reviewers.every(r=>!models.has(`${r.provider}/${r.model}`))?'review independent':''].filter(Boolean),zh=[`${rows.length} 個 agent`,makers.length>1&&models.size>1?'A、B 不同模型':'',reviewers.length&&reviewers.every(r=>!models.has(`${r.provider}/${r.model}`))?'審查獨立':''].filter(Boolean);
  const custom=rows.filter(r=>r.custom).length;
  return{team:cfg.hash,summary:{en:`Team${custom?` (${custom} custom here)`:''} · ${en.join(' · ')}`,zh:`團隊${custom?`（這裡自訂 ${custom} 項）`:''} · ${zh.join(' · ')}`},
   nodes:rows.map(r=>({node:r.node,label:r.label,seat:r.seat,seatLabel:seatLabel(team,r.seat,def),provider:r.provider,model:r.model,effort:r.effort,efforts:(()=>{const list=reviewingSeat(team,r.seat,def)?EFFORTS.slice(3,6):EFFORTS.slice(2,6);return r.provider==='claude'?[null,...list]:list;})()}))};
 }
 const ID=/^[a-z0-9][a-z0-9-]{0,40}$/;
 // each row names its role skill (as its agents receive it), the member's skills, then the node's own (a judge row: its check's duty skills)
 const roleLine=(def:any,role:string|null)=>{try{const u=engine.roleSkillUse(def,role);return u?`${roleSkillLabel(u as any)}${u.version!=null?` v${u.version}`:''} · ${String(u.sha256).slice(0,12)}`:null;}catch{return null;}};
 const view=(r:any,team:Team,def:any,slots:JudgeSlot[]=[])=>{const j=isJudgeRow(r.node)?slots[Number(/--(\d+)$/.exec(r.node)?.[1])]??null:null;
  return{node:r.node,label:r.label,member:seatLabel(team,r.seat).en,seat:r.seat,provider:r.provider,model:r.model,effort:r.effort,roleSkill:roleLine(def,j?j.role??null:r.role),
   skills:j?checkPins(def,j.node,j.check).map(p=>`${p.id}@v${p.v} (check)`):r.skills.map((p:any)=>`${p.id}@v${p.v}${p.from==='member'?' (member)':''}`),source:r.source,...(r.notes.length?{notes:r.notes.map((n:any)=>n.en)}:{})};};
 const tools:NativeMainTools={specs:[
  {type:'function',name:'studio_crew_assignments',description:'Read who runs each workflow\'s agent nodes (the Studio team, docs: studio_manual section crew). No arguments: the members, the project layer (team.projects: each project\'s own seat changes) and each workflow\'s badge. workflow: that workflow\'s final crew per node (member, provider, model, effort, its role skill (name, Studio version, sha256 prefix), skills with versions in the order agents load them (the member\'s, then the node\'s own; a judge row: its check\'s), source: team / project / workflow / definition / missing, and any rule notes). member: every node that member runs. diff: true lists only what differs from the team, and empty seats. project: read all of the above in that project (its project layer applied). change: a hypothetical change (the same shape studio_propose_crew_change takes) answers which nodes it would change, without changing anything. Read-only.',
   inputSchema:{type:'object',properties:{workflow:{type:'string'},member:{type:'string'},diff:{type:'boolean'},project:{type:'string'},change:{type:'object'}},additionalProperties:false}},
  {type:'function',name:'studio_propose_crew_change',description:'Propose one change to the Studio team; it opens one captain card that shows the change and every node it reaches. You never apply it: only the captain\'s approval writes the team. change is one of: {kind:"member",seat,set:{provider?,model?,effort?,skills?}} (the whole member, every node that follows the team); {kind:"node",workflow,node,set:{seat?,provider?,model?,effort?},addSkill?:{id,v,sha256},removeSkill?:id} (only this workflow\'s node); {kind:"project",project,seat,set:{provider?,model?,effort?,skills?}} (only this project: that seat\'s member in every workflow of the project); {kind:"restore",workflow,node?}; {kind:"project-restore",project,seat?}; {kind:"seat",seat:{id,label,labelZh,reviews?,needs?},member}; {kind:"preset",preset:"save"|"balanced"|"quality"}. Read studio_crew_assignments first; library skill pins come from it.',
   inputSchema:{type:'object',properties:{change:{type:'object'}},required:['change'],additionalProperties:false}}],
  async call(name,args,owner){
   if(!owner.live())throw new NativeToolFailure('owner_ended','The primary request ended.','主要對話請求已結束。','read_current_state');
   const {cfg,team}=now(),wfs=crewWorkflows(engine.defs);
   if(name==='studio_crew_assignments'){
    if(!args||typeof args!=='object'||Object.keys(args).some(k=>!['workflow','member','diff','project','change'].includes(k)))throw new NativeToolFailure('invalid_params','Use workflow, member, diff, project or change.','請使用 workflow、member、diff、project 或 change。','read_current_state');
    if(args.project!==undefined&&(typeof args.project!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(args.project)))throw new NativeToolFailure('invalid_params','project is a project id (studio_list_projects).','project 是專案 id。','list_projects');
    const project:string|null=args.project??null;
    const base={team:cfg?{version:cfg.version,members:Object.fromEntries(Object.entries(team.members).map(([id,m])=>[id,{label:seatLabel(team,id).en,provider:m.provider,model:m.model,effort:m.effort,skills:m.skills.map(p=>`${p.id}@v${p.v}`)}])),projects:projectLayer(team)}:null,...(project?{project}:{}),...(cfg?{}:{note:'No team yet: workflows run on Studio\'s default model. Propose seats with studio_propose_crew_change ({kind:"member",seat,set:{provider,model,effort}}).'})};
    if(args.change!==undefined){let c:CrewChange;try{validateChange(args.change);c=args.change;}catch(e:any){throw new NativeToolFailure('crew_change_invalid',`This change is malformed: ${e?.message??e}`,'這個變更格式不對。','read_current_state');}
     let after:Team;try{after=applyChange(team,c,c.kind==='node'?engine.defs.get(c.workflow):undefined);}catch(e:any){throw new NativeToolFailure('crew_change_invalid',`This change does not apply: ${e?.message??e}`,'這個變更無法套用。','read_current_state');}
     const impact=changeImpact(team,after,wfs,c.kind==='project'||c.kind==='project-restore'?c.project:project);return{...base,hypothetical:true,change:describeChange(c,team,c.kind==='node'?engine.defs.get(c.workflow):undefined).en,reaches:impact,count:impact.length,note:'Nothing changed. To make it, call studio_propose_crew_change with the same change (the captain approves it on a card).'};}
    if(typeof args.workflow==='string'){const def=wfs.find(d=>d.id===args.workflow);if(!def)throw new NativeToolFailure('workflow_missing',`No workflow ${args.workflow} with agent nodes; read studio_list_workflows.`,'沒有這個有 agent 節點的 workflow。','list_workflows');const slots=judgeSlots(engine,def),res=resolveCrew(team,withJudges(def,slots),{},cfg?.hash??null,project);return{...base,workflow:{id:def.id,name:def.name,version:def.version,badge:crewBadge(res),missing:res.missing,nodes:res.nodes.filter(r=>!args.diff||r.custom||r.source==='missing').map(r=>view(r,team,def,slots))}};}
    if(typeof args.member==='string'){if(!ID.test(args.member))throw new NativeToolFailure('invalid_params','member is a seat id (maker, reviewer …)','member 是位置 id。','read_current_state');return{...base,member:args.member,nodes:seatUses(team,args.member,wfs,undefined,project)};}
    const all=wfs.map(def=>{const res=resolveCrew(team,def,{},cfg?.hash??null,project);return{id:def.id,name:def.name,version:def.version,badge:crewBadge(res),missing:res.missing,...(args.diff?{differs:res.nodes.filter(r=>r.custom||r.source==='missing').map(r=>view(r,team))}:{})};});
    return{...base,workflows:args.diff?all.filter(w=>w.badge.state!=='team'):all};}
   if(name==='studio_propose_crew_change'){
    if(!owner.captain||!owner.text.trim())throw new NativeToolFailure('captain_confirmation_required','Only a current captain request can propose a team change.','只有目前的船長請求可提出團隊變更。','captain_review');
    if(!args||Object.keys(args).some(k=>k!=='change'))throw new NativeToolFailure('invalid_params','Give one change.','請給一個變更。','read_current_state');
    let c:CrewChange;try{validateChange(args.change);c=args.change;applyChange(team,c,c.kind==='node'?engine.defs.get(c.workflow):undefined);}catch(e:any){throw new NativeToolFailure('crew_change_invalid',`This team change does not apply: ${e?.message??e}. Read studio_crew_assignments for the seats, nodes and skill pins.`,'這個團隊變更無法套用；請先讀取 studio_crew_assignments。','read_current_state');}
    const run=propose(c,'change',owner.key);return{proposal:run.id,status:'captain-approval-required',href:`#/run/${run.id}`,note:'A captain card shows the change and what it reaches. Nothing changes until the captain approves it.'};}
   throw new NativeToolFailure('invalid_params','Unknown crew tool','未知的團隊工具。','read_current_state');}};
 return{...tools,seatGate,dispatchCrew,propose};
}
