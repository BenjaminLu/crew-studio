import assert from 'node:assert/strict';
import {isVendorProcess} from '../src/host/probe';
for(const command of ['codex resume session-id','/opt/homebrew/bin/codex resume session-id','claude --resume session-id','node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js --resume session-id','/usr/bin/node /opt/node_modules/@openai/codex/bin/codex.js resume session-id'])assert(isVendorProcess(command),command);
for(const command of ['/bin/zsh -lc cat /Users/example/.codex/sessions/session-id.jsonl','/bin/zsh -lc "codex resume session-id"','rg session-id /Users/example/.codex/sessions','node report.js /Users/example/.codex/sessions/session-id','python3 inspect.py /opt/codex session-id'])assert(!isVendorProcess(command),command);
console.log('host process identification: real vendor CLIs retained, shell/read-only mentions excluded PASS');
assert(isVendorProcess('node --enable-source-maps /opt/node_modules/@openai/codex/bin/codex.js resume demo'));
assert(!isVendorProcess('node /tmp/codex-report/cli.js demo'));
assert(!isVendorProcess('node --eval /opt/node_modules/@openai/codex/bin/codex.js'));
