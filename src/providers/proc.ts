// A session that runs one CLI process per turn and maps its JSON lines to
// normalized events. Claude and Codex providers are both built on it.
// The process runs in its own process group: interrupting the turn (a timeout, a
// cancel, a hot swap) kills the whole group, so no child outlives its round. When
// the context carries a sandbox profile, the process runs under it (an agent round:
// architecture §10).
import { claudeCredentialFds } from "./credential-fds";
import { spawn,spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { reapMarked } from "../runtime/checks";
import { LOGIN_RE, type NEvent, type Session } from "./types";

export type LineParser = { line(o: any): NEvent[]; exit(code: number, stderr: string): NEvent | null };

export function processSession(cmd: () => string[], cwd: string, env: Record<string, string>, makeParser: () => LineParser, sandbox?: { profile: string } | null,options:{requireSuccessfulExit?:boolean;credentialFds?:boolean}={}): Session {
  let pid: number | null = null;
  let interrupted = false;
  let wake: (() => void) | null = null;
  const marker = randomBytes(12).toString("hex"); // tags the round's processes; a setsid escapee is reaped when the turn ends
  const killGroup = () => { try { if (pid) process.kill(-pid, "SIGKILL"); } catch {} reapMarked(marker); };
  return {
    interrupt() { interrupted = true; killGroup(); wake?.(); },
    async *send(text: string): AsyncIterable<NEvent> {
      const parser = makeParser();
      const queue: NEvent[] = [];
      let ended = false, stderr = "";
      let pending:NEvent|null=null,releasing=false,finishing=false;
      const push = (e: NEvent) => { if (ended) return;if(options.requireSuccessfulExit&&!releasing&&e.type==='turnEnd'){pending=e;if(e.status!=='ok')killGroup();return;} if (e.type === "turnEnd") ended = true; queue.push(e); wake?.(); };
      const inner = cmd().map((a) => (a === "{TEXT}" ? text : a));
      const argv = sandbox ? ["/usr/bin/sandbox-exec", "-f", sandbox.profile, ...inner] : inner;
      let p: ReturnType<typeof spawn>;
      try {
        const auth=options.credentialFds?claudeCredentialFds(env):{env,fds:[] as number[],close(){}};
        try { p = spawn(argv[0], argv.slice(1), { cwd, env: { ...auth.env, CREW_RUN_KILL: marker }, detached: true, stdio: ["ignore", "pipe", "pipe", ...auth.fds] }); pid = p.pid ?? null; }
        finally {auth.close();}
      }
      catch (e: any) { yield { type: "turnEnd", status: "error", code: "cliUnavailable", message: `${inner[0]} could not start: ${e?.message ?? e}` }; return; }
      if(interrupted)killGroup();
      let buf = "";
      p.stdout!.on("data", (d: Buffer) => {
        buf += d.toString("utf8"); let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const l = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!l.trim()) continue;
          let o: any; try { o = JSON.parse(l); } catch { continue; }
          for (const e of parser.line(o)) push(e);
        }
      });
      p.stderr!.on("data", (d: Buffer) => { if (stderr.length < 200_000) stderr += d.toString("utf8"); });
      let spawnError: string | null = null;
      const finish=async(code:number)=>{
        if(finishing)return;finishing=true;
        let cleanup=true;killGroup();
        if(pid){const until=Date.now()+2000;try{for(;;){const rows=spawnSync('/bin/ps',['-ax','-o','pgid=,pid='],{encoding:'utf8',timeout:500,maxBuffer:512*1024});if(rows.status!==0||rows.error)throw 0;const live=rows.stdout.split('\n').some(row=>Number(row.trim().split(/\s+/)[0])===pid);if(!live)break;if(Date.now()>=until)throw 0;await new Promise(r=>setTimeout(r,10));}}catch{cleanup=false;}}
        p.stdout?.destroy();p.stderr?.destroy();
        const last=parser.exit(cleanup?code:-1,cleanup?stderr:'owned process cleanup unverified');releasing=true;
        push(!cleanup?{type:'turnEnd',status:'error',code:'cleanupUnverified',message:'Owned Claude process cleanup is unverified; readiness was withdrawn'}:interrupted?{type:'turnEnd',status:'interrupted'}:last??pending??{type:'turnEnd',status:'error',code:'cliError',message:'CLI exited without a successful result'});
      };
      p.on("error", (e) => { spawnError = String(e?.message ?? e); if (!pid){if(options.requireSuccessfulExit)void finish(-1);else push({ type: "turnEnd", status: "error", code: "cliUnavailable", message: `${inner[0]} could not start: ${spawnError}` });} });
      p.on("exit", (code) => {
        if(options.requireSuccessfulExit){setTimeout(()=>void finish(code??-1),30);return;}
        setTimeout(() => {
          killGroup(); // a child the CLI left behind does not outlive the turn
          if (interrupted) return push({ type: "turnEnd", status: "interrupted" });
          if (spawnError) return push({ type: "turnEnd", status: "error", code: "cliUnavailable", message: `${inner[0]} could not start: ${spawnError}` });
          const last = parser.exit(code ?? -1, stderr);
          if (last) return push(last);
          const login = LOGIN_RE.test(stderr);
          push({ type: "turnEnd", status: "error", code: login ? "notLoggedIn" : "cliError",
            message: (stderr.trim().split("\n").slice(-3).join(" ") || `${inner[0]} exited ${code}`).slice(0, 400) });
        }, 30); // let stdout drain
      });
      for (;;) {
        while (queue.length) { const e = queue.shift()!; yield e; if (e.type === "turnEnd") return; }
        if (interrupted && !ended&&!options.requireSuccessfulExit) { push({ type: "turnEnd", status: "interrupted" }); continue; }
        await new Promise<void>((r) => { wake = r; });
        wake = null;
      }
    },
  };
}
