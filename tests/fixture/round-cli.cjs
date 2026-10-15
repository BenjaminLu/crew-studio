#!/usr/bin/env node
// A stand-in for a provider CLI inside a sandboxed round: it tries each way out the
// prompt names and answers with what worked, in claude's stream-json result shape.
const fs = require("fs"), net = require("net"), http = require("http"), { spawn } = require("child_process");
const text = process.argv[process.argv.indexOf("-p") + 1] || "";
const m = /PROBE (\{.*\})/s.exec(text); const p = m ? JSON.parse(m[1]) : {};
const out = (o) => { process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(o), usage: {} }) + "\n"); };
const get = (url, headers = {}) => new Promise((res) => { try { const r = http.get(url, { headers, timeout: 3000 }, (resp) => { let b = ""; resp.on("data", (d) => (b += d)); resp.on("end", () => res({ status: resp.statusCode, cookie: resp.headers["set-cookie"] || null, body: b.slice(0, 200) })); });
  r.on("error", (e) => res({ status: String(e.code || e.message) })); r.on("timeout", () => { r.destroy(); res({ status: "timeout" }); }); } catch (e) { res({ status: String(e.message) }); } });
// CONNECT through the proxy, with the round's credential (from HTTPS_PROXY) or without one
const viaProxy = (host, withCred = true) => new Promise((res) => { const u = new URL(process.env.HTTPS_PROXY); const headers = withCred && u.username ? { "proxy-authorization": "Basic " + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64") } : {};
  const req = http.request({ host: u.hostname, port: u.port, method: "CONNECT", path: `${host}:443`, headers });
  req.on("connect", (resp, sock) => { sock.destroy(); res(resp.statusCode); }); req.on("response", (resp) => res(resp.statusCode)); req.on("error", (e) => res(String(e.code))); req.setTimeout(6000, () => { req.destroy(); res("timeout"); }); req.end(); });
(async () => {
  if (p.hang) { const c = spawn("/bin/sleep", ["39"], { stdio: "ignore" }); fs.writeFileSync(p.pids, JSON.stringify({ self: process.pid, child: c.pid })); setInterval(() => {}, 1000); return; }
  const r = {};
  const tryWrite = (f) => { if (!f) return null; try { const d = require("path").dirname(f); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(f, "x"); return true; } catch { return false; } };
  r.wroteOutside = tryWrite(p.outside); r.wroteInside = tryWrite(p.inside);
  r.wroteRealConfig = tryWrite(p.realConfig); r.wroteGitLink = tryWrite(p.gitLink);
  r.wroteHome = tryWrite(process.env.HOME && require("path").join(process.env.HOME, ".claude", "settings.json"));
  try { r.key = fs.readFileSync(p.key, "utf8"); } catch { r.key = null; }
  try { r.dataFile = fs.readFileSync(p.dataFile, "utf8"); } catch { r.dataFile = null; }
  try { fs.statSync(p.dataFile); r.statData = true; } catch { r.statData = false; }
  r.secretReads = (p.secrets || []).map((f) => { try { fs.readFileSync(f, "utf8"); return f; } catch { return null; } }).filter(Boolean);
  r.direct = await new Promise((res) => { const c = net.connect(80, "example.com", () => { c.end(); res(true); }); c.on("error", () => res(false)); setTimeout(() => res(false), 3000); });
  if (p.mainUrl) { r.mainPage = await get(p.mainUrl + "/"); r.mainApi = await get(p.mainUrl + "/api/agents"); }
  r.tools = (await get(process.env.CREW_STUDIO_URL + "/api/tools", { "x-crew-tool-token": process.env.CREW_TOOL_TOKEN })).status;
  r.toolsOther = (await get(process.env.CREW_STUDIO_URL + "/", { "x-crew-tool-token": process.env.CREW_TOOL_TOKEN })).status;
  if (process.env.HTTPS_PROXY) { r.proxyRefused = await viaProxy(p.badHost || "evil.example"); r.proxyNoCred = await viaProxy("api.anthropic.com", false); if (p.granted) r.proxyGranted = await viaProxy(p.granted); }
  r.envKeys = Object.keys(process.env);
  r.proxyEnv = process.env.HTTPS_PROXY ? process.env.HTTPS_PROXY.replace(/\/\/[^@]*@/, "//") : null;
  r.oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN || null;
  r.claudeTmp = process.env.CLAUDE_CODE_TMPDIR || null; r.tmpdir = process.env.TMPDIR || null; r.home = process.env.HOME || null;
  out(r);
})();
