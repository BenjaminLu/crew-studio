import "./lib/isolated-env.mjs";
// Real server/Agents/sandbox/MCP with a strict offline CLI fixture; no real account/vendor call.
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync,readdirSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {bootStudio} from './acceptance/studio';import {withSession} from './boot.mjs';import {suite} from './rt-harness';import {CrewStore} from '../src/domain/crew';import {OperatingRules} from '../src/operating-rules';
const {ok,end}=suite('onboarding-team-ui');const dir=mkdtempSync(join(tmpdir(),'crew-team-ui-')),wrapper=join(import.meta.dir,'fixture','.onboarding-team-'+Date.now()+'.mjs');
writeFileSync(wrapper,`process.env.ACCOUNT_FIXTURE_MODELS='[["fixture-model",["low","medium"]]]';await import(${JSON.stringify(join(import.meta.dir,'fixture/codex-account.mjs'))});`);
const studio=await bootStudio('onboarding-team-ui',{codexBin:wrapper,examples:false});let browser:any;
try{
 const rules=new OperatingRules(studio.data);rules.set({},'ONBOARDING-PROBE-RULE: preserve the captain constraints.','captain');const section=rules.section(null);
 const auth=await studio.api('/api/codex/account/verify',{});ok(auth.body.state==='ready','fixture account verifies without new login');
 const primary=await studio.api('/api/main/start',{host:'codex',confirm:true});ok(primary.body.ok,'actual fixture primary starts using its declared identity');
 const unauth=await fetch(studio.base+'/api/team/setup/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expected:null,confirm:true})});ok(unauth.status===403,'unauthenticated page cannot trigger a paid check');
 const cross=await fetch(studio.base+'/api/team/setup/verify',{method:'POST',headers:{'content-type':'application/json','x-crew-session':'acceptance-onboarding-team-ui-session',origin:'https://untrusted.invalid'},body:JSON.stringify({expected:null,confirm:true})});ok(cross.status===403,'cross-site request cannot trigger a paid check');
 const before=await studio.api('/api/wruns');const {chromium}=await import('playwright');browser=withSession(await chromium.launch({headless:true}),studio.base,'acceptance-onboarding-team-ui-session');
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));await page.goto(studio.base+'/#/team');
 await page.locator('[data-crew-setup-fold] > summary').click();const box=page.locator('[data-onboarding-team]');await box.locator('[data-team-setup-verify]').waitFor();await box.locator('[data-team-setup-verify]').click();
 await box.locator('[data-team-setup-save]').waitFor({timeout:70000});ok((await box.innerText()).includes('Native tool check passed'),'inline check executes real sandbox/MCP path and shows success');
 await box.locator('button').filter({hasText:'Cancel',exact:true}).click();ok((await studio.api('/api/team')).body.team===null,'cancel checked plan leaves team unset');
 await box.locator('[data-team-setup-verify]').click();await box.locator('[data-team-setup-save]').waitFor({timeout:70000});await box.locator('[data-team-setup-save]').click();
 await page.getByText('Team settings are saved.',{exact:false}).first().waitFor();const team=new CrewStore(studio.data).current()!;
 ok(team?.version===1&&Object.keys(team.members).length===5,'inline save writes one signed team version with all coding seats');
 ok(Object.values(team.members).every((m:any)=>m.provider==='codex'&&m.model==='fixture-model'&&m.effort==='medium'),'no unverified second model or provider was assigned');
 const receipts=readdirSync(join(studio.data,'onboarding-team','probes')).map(name=>{const path=join(studio.data,'onboarding-team','probes',name);return{system:readFileSync(join(path,'system.md'),'utf8'),prompt:readFileSync(join(path,'prompt.md'),'utf8'),report:JSON.parse(readFileSync(join(path,'report.json'),'utf8'))};});
 ok(receipts.length===2&&receipts.every(r=>r.system.includes(section.text)&&r.system.includes('ONBOARDING-PROBE-RULE:')&&r.prompt.includes(section.hash)&&r.report.operatingRules?.hash===section.hash&&r.report.operatingRules?.project===null&&r.report.status==='done'&&r.report.tools===1),'both actual native sandbox probes receive the captain rules and bind their hash to completed one-tool receipts');
 const after=await studio.api('/api/wruns');ok(after.body.runs.length===before.body.runs.length&&!after.body.cards.some((c:any)=>c.status==='open'),'configuration creates no approval Task or captain card');
 mkdirSync(join(import.meta.dir,'out/onboarding-team'),{recursive:true});await page.screenshot({path:join(import.meta.dir,'out/onboarding-team/desktop-saved.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{localStorage.setItem('crew.lang','zh-TW');});await page.reload();await page.locator('[data-crew-setup-fold] > summary').click();await page.locator('[data-onboarding-team] table').waitFor();await page.getByText('團隊設定已儲存；每個流程執行前仍會檢查確切能力。',{exact:true}).waitFor();
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'inline setup has no horizontal overflow on mobile');
 mkdirSync(join(import.meta.dir,'out/onboarding-team'),{recursive:true});await page.screenshot({path:join(import.meta.dir,'out/onboarding-team/mobile.png'),fullPage:true});ok(errors.length===0,'browser has no uncaught errors '+errors.join(';'));
}finally{await browser?.close();await studio.close();rmSync(wrapper,{force:true});}
end();
