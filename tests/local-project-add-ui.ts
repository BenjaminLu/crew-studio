import "./lib/isolated-env.mjs";
import {readFileSync,readdirSync,mkdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {projectFixture} from './lib/firstmate-project-fixture';
import {withSession} from './boot.mjs';
const f=await projectFixture();const record=readdirSync(join(f.root,'runtime')).find(x=>x.endsWith('.json'))!;const base=JSON.parse(readFileSync(join(f.root,'runtime',record),'utf8')).origin;
let pass=0,fail=0;const ok=(v:unknown,n:string)=>{console.log((v?'ok ':'FAIL ')+n);v?pass++:fail++;};
const browser=withSession(await chromium.launch({headless:true}),base,'offline-project-session');
try{
 for(const [width,lang,theme] of [[1280,'en','light'],[390,'zh-TW','dark']] as const){
 const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:theme});const page=await ctx.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(([lang,theme])=>{localStorage.setItem('crew.lang',lang);localStorage.setItem('crew.theme',theme);localStorage.setItem('crew.chatOpen','0');},[lang,theme]);
 await page.goto(base+'/#/projects');await page.locator('[data-add-local-project]').click();await page.locator('#project-local-path').fill('/missing-fixture-path');await page.locator('[data-local-project-form] button[type=submit]').click();await page.locator('[data-local-project-form] [role=alert]').waitFor();ok((await page.locator('[data-local-project-form] [role=alert]').innerText()).includes(lang==='en'?'unavailable':'無法使用'),`${width}: missing path has actionable localized error`);
 await page.locator('[data-local-project-form] button[type=button]').click();ok(await page.locator('[data-local-project-form]').count()===0,`${width}: cancel closes form`);
 await page.locator('[data-add-local-project]').click();await page.locator('#project-local-path').fill(f.repo);await page.locator('#project-local-name').fill('Browser fixture');
 const screenshots=join(import.meta.dir,'out/local-project-add');mkdirSync(screenshots,{recursive:true});await page.screenshot({path:join(screenshots,`${width}-${lang}-${theme}-form.png`),fullPage:true});
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: no horizontal overflow`);
 await page.locator('[data-local-project-form] button[type=submit]').click();await page.waitForURL(/#\/run\/R-/);await page.locator('[data-scard][data-card-status=open]').waitFor();
 ok((await page.locator('[data-scard][data-card-status=open]').innerText()).includes(f.repo),`${width}: normal UI opens real repository confirmation`);
 const card=page.locator('[data-scard][data-card-status=open]');await page.screenshot({path:join(screenshots,`${width}-${lang}-${theme}-card.png`),fullPage:true});await card.locator('button[data-option=close]').click();ok((await f.api('/api/projects')).body.every((p:any)=>p.path!==realpathSync(f.repo)),`${width}: cancel card does not register`);ok(!errors.length,`${width}: no page errors`);await ctx.close();
 }
 {// the sidebar's + opens the form from any page, without a stop at the projects index
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});const page=await ctx.newPage();await page.addInitScript(()=>{localStorage.setItem('crew.lang','en');localStorage.setItem('crew.chatOpen','0');});await page.goto(base+'/#/board');
 const plus=page.locator('[data-projects-nav] [data-side-add-project]');await plus.waitFor();ok(await plus.isVisible(),'sidebar Projects heading carries a visible add button');
 await plus.click();await page.waitForURL(/#\/projects$/);await page.locator('[data-local-project-form]').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='project-local-path',null,{timeout:3000}).catch(()=>{});ok(await page.evaluate(()=>document.activeElement?.id==='project-local-path'),'sidebar add from the board opens the form with the path field focused');
 await page.locator('[data-local-project-form] button[type=button]').click();await plus.click();ok(await page.locator('[data-local-project-form]').count()===1,'sidebar add on the projects index itself opens the form');await ctx.close();}
 const ctx=await browser.newContext();const page=await ctx.newPage();await page.addInitScript(()=>{localStorage.setItem('crew.lang','en');localStorage.setItem('crew.chatOpen','0');});await page.goto(base+'/#/projects');await page.locator('[data-add-local-project]').click();await page.locator('#project-local-path').fill(f.repo);await page.locator('[data-local-project-form] button[type=submit]').click();await page.waitForURL(/#\/run\/R-/);await page.locator('[data-scard][data-card-status=open] button[data-option=approve]').click();await f.until(async()=>(await f.api('/api/projects')).body.some((p:any)=>p.path===realpathSync(f.repo)));ok((await f.api('/api/projects')).body.some((p:any)=>p.path===realpathSync(f.repo)),'actual browser captain confirmation adds project');await page.goto(base+'/#/projects');const added=(await f.api('/api/projects')).body.find((p:any)=>p.path===realpathSync(f.repo));await page.locator('[data-project-card="'+added.id+'"]').waitFor();ok(!(await f.api('/api/wruns')).body.runs.some((r:any)=>r.workflow==='code-firstmate'),'browser registration starts no coding task');await ctx.close();
}finally{await browser.close();await f.close();}
console.log(`local-project-add-ui: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
