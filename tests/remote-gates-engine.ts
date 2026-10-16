import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { harness, Y, until, sleep, suite } from "./rt-harness";
const {ok,end}=suite("remote-gates-engine");
for(const scenario of ["success","cancel","head-change","replace-owner"]){
 const H=await harness([Y({id:"edge-owned",name:"edge-owned",roles:[],nodes:[{id:"start",kind:"hook",label:"Start",do:"set",args:{key:"head",value:"a".repeat(40)},x:0,y:0},{id:"done",kind:"hook",label:"Done",x:1,y:0}],edges:[["start","done",null,{checks:[{use:"t/nat"}]}]]})]);
 const E=H.engine;let release!:()=>void;const gate=new Promise<void>(r=>release=r);let calls=0;let started=false,ownedBefore=false,ownedAfter=false;
 E.natives["test-native"]=async(_input,{x})=>{calls++;if(calls>1)return {verdict:"pass",findings:[]};started=true;ownedBefore=E.owns(x);await gate;ownedAfter=E.owns(x);return {verdict:"pass",findings:[]};};
 const r=E.start({workflow:"edge-owned"});await until(()=>started,8000);ok(started&&ownedBefore&&r.nodes.start.state==="passed",`${scenario}: edge has explicit authority while source has passed`);
 if(scenario==="cancel")E.cancel(r.id);if(scenario==="head-change")r.ctx.head="b".repeat(40);if(scenario==="replace-owner"){E.load();await until(()=>E.get(r.id)?.status==="succeeded",8000);}release();await until(()=>!E.busy(r.id),8000);
 if(scenario==="success")ok(ownedAfter&&r.status==="succeeded"&&E.ledger(r.id).some(e=>e.check==="t/nat"&&e.verdict==="pass"),"owned successful edge records and routes normally");
 else if(scenario==="replace-owner"){ok(!ownedAfter&&E.get(r.id)?.status==="succeeded"&&!E.events(r.id).some(e=>e.type==="failed")&&E.ledger(r.id).filter(e=>e.check==="t/nat").length===1,"late pre-recovery edge cannot overwrite current owner journal or duplicate checks");}
 else ok(!ownedAfter&&r.nodes.done.visits===0&&!E.ledger(r.id).some(e=>e.check==="t/nat"),`${scenario}: stale edge cannot write a check or deliver destination`);
 if(scenario!=="replace-owner"&&r.status!=="succeeded"&&r.status!=="cancelled"&&r.status!=="failed")E.cancel(r.id);await until(()=>!E.busy(r.id),8000);H.stop();
}
end();
