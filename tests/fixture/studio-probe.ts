// Run inside a sandboxed test run by tests/sandbox-loopback.ts: what a project's test could do to a Studio it reaches on
// loopback without Studio's token. argv: <studio origin> <egress port> then METHOD:path pairs. Each request is sent as the
// page would send it (JSON, Studio's own Origin), only without the session; prints {"METHOD path": status}.
const [origin, egress, ...routes] = process.argv.slice(2);
const out: Record<string, number | string> = {};
for (const r of routes) {
  const [method, path] = [r.slice(0, r.indexOf(":")), r.slice(r.indexOf(":") + 1)];
  try { const res = await fetch(origin + path, { method, headers: { "content-type": "application/json", origin }, ...(method === "GET" ? {} : { body: JSON.stringify({ choice: "approve", text: "x", workflow: "x" }) }), signal: AbortSignal.timeout(5000) });
    out[`${method} ${path}`] = res.status; } catch (e) { out[`${method} ${path}`] = String((e as any)?.code ?? e).slice(0, 80); }
}
// the egress proxy without a round credential
out.egress = await new Promise<number | string>((res) => {
  const s = require("node:net").connect(Number(egress), "127.0.0.1", () => s.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"));
  let b = ""; s.on("data", (d: Buffer) => { b += d; const m = /^HTTP\/1\.[01] (\d{3})/.exec(b); if (m) { res(Number(m[1])); s.destroy(); } }); s.on("error", (e: any) => res(String(e.code)));
  setTimeout(() => res("timeout"), 4000);
});
console.log(JSON.stringify(out));
