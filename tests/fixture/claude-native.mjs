// Strict offline installed-CLI stand-in. Never contains a real credential.
import{appendFileSync,readFileSync,writeFileSync}from'node:fs';import{dirname,join,basename}from'node:path';
const root=dirname(process.argv[1]),mode=basename(process.argv[1]).replace('.mjs',''),args=process.argv.slice(2),trace=join(root,'trace.jsonl');
const put=x=>process.stdout.write(JSON.stringify(x)+'\n');
appendFileSync(trace,JSON.stringify({mode,phase:args[0]==='auth'?'auth':'model',home:process.env.HOME,config:process.env.CLAUDE_CONFIG_DIR,credentialKeys:['CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'].filter(k=>process.env[k]),effort:args[args.indexOf('--effort')+1],settings:args.includes('--settings')?JSON.parse(args[args.indexOf('--settings')+1]):null})+'\n');
if(JSON.stringify(args)==='["auth","status","--json"]'){
 if(mode==='auth-unknown'){put({loggedIn:'true',authMethod:'oauth_token',apiProvider:'firstParty'});process.exit(0);}
 if(mode==='missing'){put({loggedIn:false,authMethod:'none',apiProvider:'firstParty',configDirectory:root});process.exit(1);}
 put({loggedIn:true,authMethod:'claude.ai',apiProvider:mode==='third-party'?'bedrock':'firstParty',configDirectory:root,email:'PRIVATE_ACCOUNT_DO_NOT_RETURN'});process.exit(0);
}
if(args[0]!=='-p'||args[2]!=='--output-format'||args[3]!=='stream-json'||!args.includes('--restricted')||args.includes('--dangerously-skip-permissions')||args.includes('--bare'))throw Error('unsupported invocation');
const model=args[args.indexOf('--model')+1],get=k=>args[args.indexOf(k)+1];
const canary=args.includes('--max-turns');
if(canary&&(get('--max-turns')!=='1'||get('--tools')!==''||get('--permission-prompts')!=='none'||get('--setting-sources')!==''||JSON.parse(get('--mcp-config')).mcpServers&&Object.keys(JSON.parse(get('--mcp-config')).mcpServers).length))throw Error('canary authority widened');
if(mode==='unsupported')process.exit(2);
if(mode==='hang'){writeFileSync(join(root,'hang.pid'),String(process.pid));setInterval(()=>{},1000);await new Promise(()=>{});}
const actual=mode==='mismatch'?'claude-opus-5-5':model;
put({type:'system',subtype:'init',model:actual,tools:mode==='tool'?['Bash']:[]});
if(!canary&&mode==='worker-tool'){
 const mcp=JSON.parse(get('--mcp-config')).mcpServers.studio;
 if(get('--allowedTools')!=='mcp__studio__worker_report'||get('--tools')!=='')throw Error('worker tool authority widened');
 put({type:'assistant',message:{model:actual,content:[{type:'tool_use',id:'owned-tool',name:'mcp__studio__worker_report',input:{summary:'offline worker'}}]}});
 const response=await fetch(mcp.env.CREW_STUDIO_URL+'/api/tools/worker_report',{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':mcp.env.CREW_TOOL_TOKEN},body:'{"summary":"offline worker"}'});
 if(!response.ok)throw Error('source tool endpoint refused');
 put({type:'user',message:{content:[{type:'tool_result',tool_use_id:'owned-tool',content:await response.text()}]}});
}
if(mode==='exhausted'||!canary&&mode==='runtime-denial')put({type:'rate_limit_event',rate_limit_info:{status:'rejected'}});
if(mode==='auth-denial')put({type:'assistant',error:'authentication_error'});
put({type:'assistant',message:{model:actual,content:mode==='tool'?[{type:'tool_use',id:'bad',name:'Bash',input:{}}]:[{type:'text',text:'OK'}]}});
if(mode!=='no-result'&&!(!canary&&mode==='runtime-no-result'))put({type:'result',subtype:'success',is_error:false,result:'OK',modelUsage:{[actual]:{inputTokens:1,outputTokens:1}},...(mode==='errors'?{errors:['unexpected execution error']}:{})});

if(!canary&&mode==='runtime-exit1')process.exitCode=1;
