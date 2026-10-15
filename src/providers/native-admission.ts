import type {Provider} from "../providers";
import {ProviderRefusal,type ProviderSelection} from "./policy";
export type NativeCertificate={input:ProviderSelection;expires:number;x?:any};
/** The server resolver runs after Agents acquires its queue slot. */
export function createNativeProviderAdmission(d:{certified:WeakMap<object,NativeCertificate>;engine:()=>any;select:(input:ProviderSelection,x?:any)=>Promise<Provider>;pick:(x:any,pick:any,context:any)=>Promise<Provider>}){
 const {certified}=d;const nativeSelection=d.select,nativePick=d.pick;
 return async(provider:Provider,o:any):Promise<Provider>=>{

  if (o.signal?.aborted || o.owns && !o.owns()) throw new ProviderRefusal("native round owner ended during capability admission");
  const previous=certified.get(provider),engine=d.engine(),task=o.ref&&engine?.get(o.ref);
  const bound=previous?.x&&previous.x.engine.get(previous.x.run.id);if(bound&&bound!==task)throw new ProviderRefusal("certified job task identity changed");
  const validate=(selected:Provider,phase:'before'|'launch')=>{if(task)engine.deps.authorizeProviderJob?.(task,selected,o,phase);};
  validate(provider,'before');
  if(previous?.x&&!previous.x.engine.owns(previous.x))throw new ProviderRefusal("certified native owner ended");
  let selected=provider;
  if(previous){if(previous.expires<=Date.now())selected=await nativeSelection(previous.input,previous.x);}
  else if(task)selected=await nativePick(engine.x(task,task.def.nodes.find((n:any)=>n.id===o.record?.header?.node)??task.def.nodes[0],task.nodes[o.record?.header?.node]??task.nodes[task.def.nodes[0].id]),{provider:provider.id,model:provider.model,effort:provider.reasoningEffort??null},{role:o.kind.startsWith("judge:")?"judge":"worker",explicit:true});
  if(o.signal?.aborted||o.owns&&!o.owns())throw new ProviderRefusal("native round owner ended during capability admission");
  validate(selected,'launch');
  return selected;

 };
}
