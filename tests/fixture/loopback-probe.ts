// Run inside a check or round sandbox by tests/sandbox-loopback.ts: what a project's test does with a server of its own
// (bind on port 0, connect to it, in this process and from a child process, IPv4 and IPv6), and whether the ports named in
// argv (Studio's, another local service's) can be reached. Prints one JSON line.
import { connect } from "node:net";
const tryTcp = (host: string, port: number) => new Promise<boolean>((res) => {
  const s = connect({ host, port }); const t = setTimeout(() => { s.destroy(); res(false); }, 1500);
  s.once("connect", () => { clearTimeout(t); s.destroy(); res(true); }); s.once("error", () => { clearTimeout(t); res(false); });
});
const own = async (hostname: string) => { try { const s = Bun.serve({ hostname, port: 0, fetch: () => new Response("own") });
  try { const host = hostname === "::1" ? "[::1]" : "127.0.0.1"; return (await (await fetch(`http://${host}:${s.port}/`)).text()) === "own"; } finally { s.stop(true); } }
  catch (e) { return String(e).slice(0, 200); } };
// the shape of a real project test: spawn the app's server on port 0, read its URL, connect
const child = async () => {
  const p = Bun.spawn([process.execPath, "-e", 'const s=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response("child")});console.log("http://127.0.0.1:"+s.port)'], { stdout: "pipe", stderr: "pipe" });
  try { const r = p.stdout.getReader(); let o = ""; while (!o.includes("\n")) { const c = await r.read(); if (c.done) return `server exited: ${await new Response(p.stderr).text()}`; o += new TextDecoder().decode(c.value); }
    return (await (await fetch(o.trim())).text()) === "child"; } catch (e) { return String(e).slice(0, 200); } finally { p.kill(); await p.exited; }
};
const reach: Record<string, boolean> = {};
if (process.env.PROBE_DELAY_MS) await Bun.sleep(Number(process.env.PROBE_DELAY_MS)); // the test starts listeners outside meanwhile
// name=<port> tries 127.0.0.1; name=<port>@<host> tries that address (::1, ::ffff:127.0.0.1, the LAN address)
for (const a of process.argv.slice(2)) { const [name, target] = a.split("="); const [port, host] = target.split("@"); reach[name] = await tryTcp(host || "127.0.0.1", Number(port)); }
console.log(JSON.stringify({ own4: await own("127.0.0.1"), own6: await own("::1"), ownAny: await own("0.0.0.0"), child: await child(), reach, host: process.env.HOST ?? null }));
