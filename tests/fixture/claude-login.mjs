// Offline stand-in for `claude auth login` / `claude auth status --json`. Never holds a real credential.
// Mode comes from $HOME/.claude-login-mode: success | fail | hang. A login marker in $HOME stands for the Keychain item,
// which (like the real CLI on macOS) is only found when USER and LOGNAME are set.
import{appendFileSync,existsSync,readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';
const home=process.env.HOME,args=process.argv.slice(2),marker=join(home,'.claude-login-marker');
const mode=existsSync(join(home,'.claude-login-mode'))?readFileSync(join(home,'.claude-login-mode'),'utf8').trim():'success';
appendFileSync(join(home,'.claude-login-trace.jsonl'),JSON.stringify({args,pid:process.pid,user:!!process.env.USER&&!!process.env.LOGNAME,credentialKeys:['CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'].filter(k=>process.env[k])})+'\n');
if(args.join(' ')==='auth status --json'){
 const loggedIn=existsSync(marker)&&!!process.env.USER&&!!process.env.LOGNAME;
 process.stdout.write(JSON.stringify(loggedIn?{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:'PRIVATE_ACCOUNT_DO_NOT_RETURN'}:{loggedIn:false,authMethod:'none',apiProvider:'firstParty'})+'\n');process.exit(loggedIn?0:1);
}
if(args.join(' ')==='auth login'){
 process.stdout.write('Opening browser to sign in… PRIVATE_OAUTH_URL_DO_NOT_RETURN\n');
 if(mode==='hang'){writeFileSync(join(home,'.claude-login-pid'),String(process.pid));setInterval(()=>{},1000);await new Promise(()=>{});}
 if(mode==='fail')process.exit(1);
 writeFileSync(marker,'1');process.exit(0);
}
throw Error('unsupported invocation: '+args.join(' '));
