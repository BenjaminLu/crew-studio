import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=process.cwd();
const csp="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'";
const server=createServer((q,r)=>{if(q.url==='/'){r.setHeader('Content-Type','text/html');r.end('<iframe sandbox="allow-scripts" src="/skin/captain/index.html" style="width:100%;height:850px"></iframe><script>window.messages=[];onmessage=e=>messages.push(e.data)</script>');return;}try{const file=q.url==='/skin/_kit/skin-kit.js'?'skins/kit/skin-kit.js':q.url.replace('/skin/','skins/');r.setHeader('Content-Security-Policy',csp);r.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');r.end(readFileSync(root+'/'+file));}catch{r.statusCode=404;r.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN ? {executablePath:process.env.CHROME_BIN} : {})});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>messages.some(m=>m.type==='crew:ready'),{timeout:15000});
 const frame=page.frames()[1];
 const snap={tasks:[{id:'one',title:'Sample task',status:'failed'}],crew:[{name:'worker',role:'worker',alive:true,task:'one'}],pending:[{id:'card1',task:'one',title:'Open decision'}],lang:'zh-TW',at:new Date().toISOString()};
 await page.evaluate(s=>document.querySelector('iframe').contentWindow.postMessage({type:'crew:snapshot',snapshot:s},'*'),snap);
 await frame.locator('#captain-cards button').click();
 await page.waitForFunction(()=>messages.some(m=>m.type==='crew:openCard'&&m.id==='card1'));
 const initial = await frame.evaluate(()=>({ready:__G.ready,errors:__G.errors,arms:__voyageLive.view.kraken.arms,crew:__voyageLive.view.crew.map(c=>c.model)}));
 if(initial.arms.length !== 1 || !initial.crew.includes('captain')) throw Error('missing kraken or captain');

 await frame.evaluate(() => { window.salvos = 0; __voyageLive.subscribe((view, events) => { window.salvos += events.filter(e => e.type === 'merged').length; }); });
 snap.tasks[0].status='succeeded';snap.pending=[];
 await page.evaluate(s=>document.querySelector('iframe').contentWindow.postMessage({type:'crew:snapshot',snapshot:s},'*'),snap);
 await page.waitForTimeout(1500);
 await page.setViewportSize({width:390,height:844});

 await page.evaluate(s=>document.querySelector('iframe').contentWindow.postMessage({type:'crew:snapshot',snapshot:s},'*'),snap);
 await frame.waitForFunction(() => window.salvos === 1);
 const state=await frame.evaluate(()=>({errors:__G.errors,arms:__voyageLive.view.kraken.arms,done:__voyageLive.view.tasks[0].lane}));
 console.log(state,errors);if(errors.length||state.errors.length||state.arms.length||state.done!=='merged')throw Error('renderer failed');
}finally{await browser.close();server.close();}
