import './lib/isolated-env.mjs';
// A browser cookie jar is host-scoped, not port-scoped. Two independent local
// Studios must remain authenticated after both official session links are opened.
import {sessionCookie, hasSession, hasSessionCookie, guardWrite} from '../src/csrf';
import {suite} from './rt-harness';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freePort,waitUp} from './boot.mjs';
const {ok,end}=suite('session-cookie-isolation');
const a='fixture-session-a',b='fixture-session-b';
const pair=(token:string)=>sessionCookie(token).split(';')[0];
const name=(token:string)=>pair(token).split('=')[0];
const request=(cookie:string,extras:Record<string,string>={})=>new Request('http://127.0.0.1:4210/api/example',{method:'POST',headers:{cookie,origin:'http://127.0.0.1:4210','sec-fetch-site':'same-origin','content-type':'application/json',...extras}});
// Model the real host cookie replacement rule: setting the same name/path would
// overwrite the first Studio even though the second server uses another port.
const jar=new Map<string,string>();for(const token of [a,b])jar.set(name(token),pair(token));
const both=[...jar.values()].join('; ');
ok(jar.size===2,'independent Studio tokens use distinct host cookie names');
ok(hasSessionCookie(request(both),a)&&hasSessionCookie(request(both),b),'both page sessions survive opening both session links');
ok(guardWrite(request(both),new URL('http://127.0.0.1:4210/api/example'),a,false)===null,'original page still passes same-origin write guard');
ok(!hasSessionCookie(request(pair(b)),a),'another instance cookie cannot authenticate this instance');
ok(!hasSessionCookie(request(`${name(a)}=${b}`),a),'correct namespace with wrong token is refused');
ok(!hasSessionCookie(request(`crew_session=${a}`),a),'legacy unscoped cookie does not bypass namespace');
ok(!hasSessionCookie(request(`${pair(a)}; ${pair(a)}`),a),'ambiguous duplicate session cookie is refused');
ok(!hasSessionCookie(request(`${pair(a)}; ${name(a)}=wrong`),a),'mixed duplicate values are refused');
ok(hasSession(request('',{'x-crew-session':a}),a),'existing local script header remains supported');
ok(!hasSessionCookie(request('',{'x-crew-session':a}),a),'header is never accepted as captain page cookie');
ok(guardWrite(request(both,{origin:'http://127.0.0.1:49319'}),new URL('http://127.0.0.1:4210/api/example'),a,false)?.code==='crossSite','another local port still cannot write cross-origin');
ok(guardWrite(request(both,{'sec-fetch-site':'cross-site'}),new URL('http://127.0.0.1:4210/api/example'),a,false)?.code==='crossSite','cross-site write remains blocked');
const header=sessionCookie(a);ok(/; Path=\/; HttpOnly; SameSite=Strict$/.test(header),'cookie retains path HttpOnly SameSite protections');
ok(!/Domain=/.test(header),'cookie remains host-only');
// Two actual src/server.ts instances use temporary homes/data and no vendor CLI.
// A separate headless Chromium context receives cookies only via official links.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const temp=mkdtempSync(join(tmpdir(),'crew-session-ports-'));const apps:ReturnType<typeof spawn>[]=[];
const server=async(label:string,token:string)=>{const port=await freePort(),base=`http://127.0.0.1:${port}`,dir=join(temp,label);for(const child of ['home','data','state','project'])mkdirSync(join(dir,child),{recursive:true});const app=spawn('bun',['src/server.ts'],{cwd:join(import.meta.dir,'..'),stdio:['ignore','pipe','pipe'],env:{...process.env,CREW_SESSION_TOKEN:token,CREW_PORT:String(port),CREW_DATA:join(dir,'data'),HOME:join(dir,'home'),CREW_FM_STATE:join(dir,'state'),CREW_MAIN_PROJECT:join(dir,'project'),CREW_FILE_ALLOW:dir,CREW_GH:'0',CREW_GH_NO_CLI:'1',CREW_CHAT_PROVIDER:'stub',CREW_SANDBOX:'0',CREW_RETRO_AUTO:'0',CREW_INSTALL_RUNNER:'mock',CREW_NO_REAL_INSTALL:'1'}});apps.push(app);app.stdout!.resume();await waitUp(base,app);return base;};
let browser;
try {const baseA=await server('a',a),baseB=await server('b',b);
browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();
 await page.goto(`${baseA}/session?t=${a}`);await page.goto(`${baseB}/session?t=${b}`);await page.goto(baseA);
 ok(await page.evaluate(async()=> (await fetch('/api/main')).status)===200,'real browser retains first port session after second port login');
 ok(await page.evaluate(async()=> (await fetch('/api/main/locale',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({locale:'en'})})).status)===200,'real browser first port same-origin write still works');
 await page.goto(baseB);ok(await page.evaluate(async()=> (await fetch('/api/main')).status)===200,'real browser retains second port session');
 const cookies=await context.cookies();ok(cookies.filter(c=>[name(a),name(b)].includes(c.name)).length===2,'real Chromium stores both instance cookies simultaneously');
 ok(cookies.filter(c=>[name(a),name(b)].includes(c.name)).every(c=>c.httpOnly&&c.sameSite==='Strict'&&c.path==='/'),'real browser cookies retain HttpOnly Strict and root path');
 await context.close();
}finally{await browser?.close();for(const app of apps){if(app.exitCode!==null||app.signalCode!==null)continue;const ended=new Promise(resolve=>app.once('exit',resolve));app.kill();await ended;}rmSync(temp,{recursive:true,force:true});}
end();
