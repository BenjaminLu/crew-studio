import {strict as assert}from'node:assert';import{readFileSync,mkdtempSync,rmSync,writeFileSync,unlinkSync,symlinkSync,linkSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{validateCoffeeDesign,storeCoffeeDesign,loadCoffeeDesign,coffeeContent,coffeeDesignJSON,coffeeDesignHash,coffeeDesignSummary}from'../src/domain/coffee-design';
const p=JSON.parse(readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8'));let pass=0;
const ok=(name:string,fn:()=>void)=>{fn();pass++;console.log('PASS '+name);};
ok('explicit discussed plan validates without production defaults',()=>assert.equal(validateCoffeeDesign(p).clarifications.length,2));
ok('canonical nested order preserves full design identity',()=>assert.equal(coffeeDesignHash(p),coffeeDesignHash(JSON.parse(JSON.stringify(p,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v)))));
for(const mutate of [(v:any)=>v.video.beats[1].caption+=' revised',(v:any)=>v.image.composition+=' revised',(v:any)=>v.website.sections[0].body+=' revised',(v:any)=>v.brand.palette[2]='#112233',(v:any)=>v.integration.mobileCrop='left'])ok('full plan hash binds independently changed production field '+pass,()=>{const x=structuredClone(p);mutate(x);assert.notEqual(coffeeDesignHash(p),coffeeDesignHash(x));});
for(const [name,mutate]of [['unknown version',(x:any)=>x.version=2],['no actual discussion',(x:any)=>x.clarifications=[]],['missing image',(x:any)=>delete x.image],['storyboard gap',(x:any)=>x.video.beats[1].start=5],['unknown motion',(x:any)=>x.video.beats[0].motion='execute-shell'],['external CTA',(x:any)=>x.website.cta.target='javascript:alert(1)'],['missing reduced motion',(x:any)=>x.integration.reducedMotion='ignore'],['unknown authority field',(x:any)=>x.grant='all'],['unbounded text',(x:any)=>x.brief='x'.repeat(2001)] ]as const)ok('refuse '+name,()=>{const x=structuredClone(p);mutate(x);assert.throws(()=>validateCoffeeDesign(x));});
ok('malformed/missing plan never becomes implicit starter',()=>{assert.throws(()=>validateCoffeeDesign(undefined));assert.throws(()=>validateCoffeeDesign('{'));});
ok('human summary includes complete screenplay and shared identity',()=>{const summary=coffeeDesignSummary(p);assert(summary.includes('0–4s')&&summary.includes('4–8s')&&summary.includes('8–12s')&&summary.includes(p.image.composition)&&summary.includes(coffeeDesignHash(p)));});
ok('returned plan is detached from mutable draft',()=>{const plan=validateCoffeeDesign(p);plan.video.beats[0].caption='Other';assert.notEqual(plan.video.beats[0].caption,p.video.beats[0].caption);});
const data=mkdtempSync(join(tmpdir(),'coffee-design-cas-'));
try{
 const ref=storeCoffeeDesign(data,p),path=join(data,'coffee-designs',ref.split(':').at(-1)+'.json');
 ok('immutable short design transport preserves exact full plan',()=>{assert(ref.length<100);assert.deepEqual(loadCoffeeDesign(data,ref),validateCoffeeDesign(p));assert.equal(storeCoffeeDesign(data,p),ref);});
 ok('model supplied references do not validate as raw plans',()=>assert.throws(()=>validateCoffeeDesign(ref)));
 ok('unknown reference and alias refuse',()=>{assert.throws(()=>loadCoffeeDesign(data,ref.replace(/.$/,'z')));assert.throws(()=>loadCoffeeDesign(data,'coffee-design-v2:sha256:'+'a'.repeat(64)));});
 ok('replaced immutable content refuses instead of reinterpretation',()=>{writeFileSync(path,'{}');assert.throws(()=>loadCoffeeDesign(data,ref));assert.throws(()=>storeCoffeeDesign(data,p));});
 unlinkSync(path);const outside=join(data,'outside');writeFileSync(outside,coffeeDesignJSON(p));symlinkSync(outside,path);
 ok('symlink transport refuses even exact valid target bytes',()=>assert.throws(()=>loadCoffeeDesign(data,ref)));
 unlinkSync(path);linkSync(outside,path);
 ok('hardlink alias refuses even exact valid bytes',()=>assert.throws(()=>loadCoffeeDesign(data,ref)));
 ok('legacy raw plan remains byte-independent and unrewritten',()=>assert.deepEqual(loadCoffeeDesign(data,JSON.stringify(p)),validateCoffeeDesign(p)));
 ok('proposal store enforces independent full digest and bound',()=>{const v=JSON.stringify({schema:1,target:p}),r=coffeeContent(data,'proposal',v);assert.equal(coffeeContent(data,'proposal',undefined,r),v);assert.throws(()=>coffeeContent(data,'proposal','x'.repeat(24577)));});
}finally{rmSync(data,{recursive:true,force:true});}
console.log(`native-coffee-design: ${pass} passed, 0 failed`);
