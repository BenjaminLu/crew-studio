import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// macOS test loopback: own ephemeral servers work, preexisting listeners and
// reserved Studio capability ports do not. Negative probes require a successful
// sandbox start and own-server controls. Linux uses a private bwrap loopback.
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
delete process.env.CREW_LOCAL_UNRESTRICTED;
const { sandboxed, roundExec, roundProfile, profileFor, selfProbe, linuxBwrapArgv, SECRET_DIRS } = await import("../src/runtime/checks");
const root = mkdtempSync(join(tmpdir(), "crew-loopback-")), data = join(root, "data"), work = join(root, "work"); mkdirSync(data); mkdirSync(work);
copyFileSync(join(import.meta.dir, "fixture", "loopback-probe.ts"), join(work, "probe.ts"));
copyFileSync(join(import.meta.dir, "fixture", "studio-probe.ts"), join(work, "studio-probe.ts"));
const parse = (out: string) => { try { return JSON.parse(out.trim().split("\n").at(-1) ?? ""); } catch { return null; } };
// a local service that was up before the run (another app's, or Studio's own port)
const service = await new Promise<number>((r) => { const s = createServer((c) => c.end("service")); s.listen(0, "127.0.0.1", () => r((s.address() as any).port)); });

// 1. own servers answer; preexisting services are blocked
{ const r = await sandboxed([process.execPath, "probe.ts", `service=${service}`], { cwd: work, out: join(root, "out-test"), tmp: join(root, "tmp-test"), timeoutS: 60, network: false, dataDir: data, testRun: true });
  const p = parse(r.stdout);
  ok(p?.own4 === true && p?.own6 === true && p?.child === true, "a test run: a test server of its own on port 0 (IPv4, IPv6, and spawned as a child process like app/server.ts) answers its test", JSON.stringify([p, r.refused, r.stderr.slice(0, 300)]));
  ok(p?.host === "127.0.0.1", "a test run gets HOST=127.0.0.1, so a dev server binds loopback rather than every interface", JSON.stringify(p?.host));
  ok(p?.reach.service === false && !r.refused && r.code === 0, "a running test sandbox blocks a preexisting local listener", JSON.stringify(p?.reach));
  ok(/unreadable/.test(r.sandbox?.enforced ?? "") && /started after the listener snapshot/.test(r.sandbox?.notEnforced ?? "") && /LAN/.test(r.sandbox?.notEnforced ?? ""), "a test run reports what its sandbox enforces and what it does not", JSON.stringify(r.sandbox)); }
// 2. any other check and an agent round keep loopback closed
{ const r = await sandboxed([process.execPath, "probe.ts", `service=${service}`], { cwd: work, out: join(root, "out-check"), tmp: join(root, "tmp-check"), timeoutS: 60, network: false, dataDir: data });
  const p = parse(r.stdout);
  ok(p && p.own4 !== true && p.reach.service === false && !r.sandbox, "a check that is not a test run gets no loopback: not its own server, not a local service", JSON.stringify(p));
  const q = parse((await roundExec([process.execPath, "probe.ts", `service=${service}`], { cwd: work, writes: [work], tmp: join(root, "round-tmp"), dataDir: data, timeoutS: 60 })).stdout);
  ok(q && q.own4 !== true && q.reach.service === false, "an agent round's command keeps loopback closed (only its proxy and tool listener are opened)", JSON.stringify(q)); }
// 3. the self-probe: a profile that does not hold what Studio claims refuses the run, with the reason
{ writeFileSync(join(data, "ledger.key"), "LEDGER-SECRET");
  const weak = join(root, "weak.sb"); writeFileSync(weak, "(version 1)\n(allow default)\n");
  const strong = join(root, "strong.sb"); writeFileSync(strong, profileFor({ out: join(root, "out-test"), tmp: join(root, "tmp-test"), reads: [work], network: false, dataDir: data, cwd: work, localBinding: true }));
  const protectedPaths = SECRET_DIRS(data);
  const leak = selfProbe(weak, protectedPaths), held = selfProbe(strong, protectedPaths);
  ok(/self-probe failed: the profile let a test run read .*ledger\.key/.test(leak ?? "") && /connect to 1\.1\.1\.1:443/.test(leak ?? ""), "the self-probe catches a profile that lets a test run read Studio's key or leave the machine", leak ?? "null");
  ok(held === null, "the test-run profile passes its self-probe", held ?? "");
  process.env.CREW_TEST_SELF_PROBE_LEAK = "1";
  const r = await sandboxed([process.execPath, "probe.ts"], { cwd: work, out: join(root, "out-leak"), tmp: join(root, "tmp-leak"), timeoutS: 30, network: false, dataDir: data, testRun: true });
  delete process.env.CREW_TEST_SELF_PROBE_LEAK;
  ok(r.code === null && /self-probe failed/.test(r.refused ?? "") && r.stdout === "", "a test run whose self-probe fails is refused with the reason and never runs", JSON.stringify([r.refused, r.stdout.slice(0, 80)])); }
// 4. Studio's launch token and key files stay unreadable from a test run, even when its input names them
{ const rt = join(root, "runtime"); process.env.CREW_RUNTIME_DIR = rt; const { registerInstance } = await import("../src/instance");
  const inst = registerInstance(service, data, "SESSION-TOKEN-SECRET"); writeFileSync(join(data, "keys.json"), "{\"anthropic\":\"KEY-SECRET\"}"); writeFileSync(join(data, "session-token"), "SESSION-SECRET");
  const files = [join(rt, `${inst.record.boot}.key`), join(rt, `${inst.record.boot}.json`), join(data, "ledger.key"), join(data, "keys.json"), join(data, "session-token")];
  const r = await sandboxed(["/bin/cat", ...files], { cwd: work, out: join(root, "out-token"), tmp: join(root, "tmp-token"), timeoutS: 20, network: false, dataDir: data, reads: files, testRun: true });
  inst.cleanup(); delete process.env.CREW_RUNTIME_DIR;
  ok(r.code !== 0 && !/SECRET/.test(r.stdout) && (r.stderr.match(/Operation not permitted/g) ?? []).length === files.length, "a test run cannot read Studio's session token, its launch record, its ledger key or its API keys, even when its input names them", JSON.stringify([r.code, r.refused, r.stdout.slice(0, 100), r.stderr.slice(0, 300)])); }
// 5. Studio protects itself in its server: from inside a test run, a real Studio refuses every route without its token
{ const { spawn } = await import("node:child_process");
  const tmp = mkdtempSync(join(tmpdir(), "crew-loopback-studio-")); for (const x of ["state", "home", "proj", "data"]) mkdirSync(join(tmp, x));
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const app = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CREW_DATA: join(tmp, "data"), CREW_PORT: String(port), CREW_FM_STATE: join(tmp, "state"), CREW_GH: "0", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp, CREW_SESSION_TOKEN: "loopback-session", CREW_RUNTIME_DIR: join(tmp, "runtime") } });
  try {
    await waitUp(base, app);
    const doctor = await (await fetch(`${base}/api/doctor`, { headers: { "x-crew-session": "loopback-session" } })).json();
    const egress = Number(/proxy on 127\.0\.0\.1:(\d+)/.exec(JSON.stringify(doctor))?.[1] ?? 0);
    const routes = ["POST:/api/scards/x/answer", "POST:/api/wruns", "POST:/api/operating-rules", "POST:/api/main/detach", "POST:/api/tools/fs_read", "GET:/api/agents", "GET:/api/doctor", "GET:/api/wruns", "GET:/api/scards"];
    const r = await sandboxed([process.execPath, "studio-probe.ts", base, String(egress), ...routes], { cwd: work, out: join(root, "out-studio"), tmp: join(root, "tmp-studio"), timeoutS: 60, network: false, dataDir: data, testRun: true });
    const p = parse(r.stdout) ?? {};
    const refused = routes.every((x) => typeof p[x.replace(":", " ")] === "string" && /ECONNREFUSED|EPERM|FailedToOpenSocket/.test(p[x.replace(":", " ")]));
    ok(!r.refused && r.code === 0 && egress > 0 && refused, "a running test sandbox cannot connect to any isolated Studio route", JSON.stringify([p, r.stderr.slice(0, 200)]));
    ok(!r.refused && r.code === 0 && ["EPERM", "ECONNREFUSED"].includes(p.egress), "and its existing egress proxy is unreachable", String(p.egress));
    const withSession = await fetch(`${base}/api/agents`, { headers: { "x-crew-session": "loopback-session" } });
    ok(withSession.status === 200 && (await fetch(`${base}/api/instance`)).status === 200, "the same read answers with Studio's session; only the launch challenge answers without one", String(withSession.status));
  } finally { app.kill(); } }
// 6. the egress proxy's resolved-address guard (ported from sandbox-runtime)
{ const { denial, guardedLookup } = await import("../src/egress-guard");
  const local = ["192.168.7.9", "fe80::1%en0"];
  const cases: [string, string, boolean][] = [["evil.example", "127.0.0.1", false], ["evil.example", "::1", false], ["evil.example", "::ffff:127.0.0.1", false], ["evil.example", "::ffff:7f00:1", false],
    ["evil.example", "64:ff9b::7f00:1", false], ["evil.example", "2002:7f00:1::", false], ["evil.example", "0.0.0.0", false], ["evil.example", "169.254.169.254", false], ["evil.example", "168.63.129.16", false],
    ["evil.example", "192.168.7.9", false], ["evil.example", "::ffff:192.168.7.9", false], ["evil.example", "1.1.1.1", true], ["evil.example", "2606:4700:4700::1111", true],
    ["evil.example", "10.1.2.3", false], ["evil.example", "172.16.5.6", false], ["evil.example", "192.168.1.1", false], ["evil.example", "100.64.1.2", false], ["evil.example", "::ffff:10.1.2.3", false], ["evil.example", "fd12::1", false],
    ["localhost", "127.0.0.1", false], ["localhost", "1.1.1.1", false], ["127.0.0.1", "127.0.0.1", false]];
  const bad = cases.filter(([h, a, want]) => (denial(h, a, local) === null) !== want);
  ok(!bad.length, "the guard refuses a name resolving to loopback, unspecified, link-local, metadata, a private / CGNAT / tailnet range or this host's own address, in every IPv6 spelling of it; a public address passes; localhost and IP literals cannot bypass the guard", JSON.stringify(bad));
  const fake = (addrs: string[]) => ((_h: string, _o: any, cb: any) => cb(null, addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })))) as any;
  const a = await guardedLookup("mixed.example", fake(["127.0.0.1", "1.1.1.1"])), b = await guardedLookup("only-local.example", fake(["127.0.0.1"]));
  ok((a as any).address === "1.1.1.1" && /resolved to a loopback address/.test((b as any).refused ?? ""), "the proxy dials the address that passed (never re-resolving) and refuses a name with none left", JSON.stringify([a, b])); }
// 7. Linux: bwrap with v1's layout (a private loopback, reads read-only, denied paths covered)
{ const argv = linuxBwrapArgv(["bun", "test"], { cwd: "/w", reads: ["/usr", "/w", "/proc/x"], writes: ["/w/out"], deny: ["/w/.secret", "/w/key.json", "/elsewhere"] }, (c) => (c === "bwrap" ? "/usr/bin/bwrap" : null), (p) => (p.endsWith(".secret") ? "dir" : p.endsWith(".json") ? "file" : null));
  const s = argv?.join(" ") ?? "";
  ok(argv?.[0] === "/usr/bin/bwrap" && /--unshare-net/.test(s) && /--ro-bind-try \/usr \/usr/.test(s) && /--ro-bind-try \/w \/w/.test(s) && !/\/proc\/x/.test(s) && /--bind \/w\/out \/w\/out/.test(s) && /--tmpfs \/w\/\.secret/.test(s) && /--ro-bind \/dev\/null \/w\/key\.json/.test(s) && !/elsewhere/.test(s) && !/--dev-bind \/ \//.test(s) && s.endsWith("--chdir /w -- bun test"),
    "on Linux a test run is wrapped in bwrap: its own network namespace, reads read-only, writes bound, denied paths under them covered, never the whole filesystem", s);
  ok(linuxBwrapArgv(["x"], { cwd: "/", reads: [], writes: [], deny: [] }, () => null) === null, "without bwrap there is no Linux wrapper");
  if (process.platform !== "linux") console.log("  skip  Linux: a test server answers inside bwrap's private loopback and the host's listener does not (needs Linux)");
  else { const w = linuxBwrapArgv([process.execPath, join(work, "probe.ts"), `service=${service}`], { cwd: work, reads: ["/usr", "/bin", "/lib", "/lib64", "/etc", join(process.execPath, ".."), work], writes: [join(root, "out-linux")], deny: [] });
    if (!w) console.log("  skip  Linux: bwrap is not installed");
    else { const p = Bun.spawnSync(w, { stdout: "pipe", stderr: "pipe" }); const q = parse(p.stdout.toString());
      ok(q?.own4 === true && q.reach.service === false, "Linux: a test server answers inside the private loopback, and a host listener does not", JSON.stringify([q, p.stderr.toString().slice(0, 300)])); } } }
// 8. a failure the sandbox caused is named, a real failure is not
{ const { needsOutsideSandbox } = await import("../src/test-command");
  ok(/Docker daemon/.test(needsOutsideSandbox("Cannot connect to the Docker daemon at unix:///var/run/docker.sock", 1) ?? "") && /refused a network socket/.test(needsOutsideSandbox("error: FailedToOpenSocket", 1) ?? "")
    && needsOutsideSandbox("Cannot connect to the Docker daemon", 0) === null && needsOutsideSandbox("Expected: 1\nReceived: 2", 1) === null,
    "a failure needing Docker or a refused socket is marked as unable to run inside the sandbox; an assertion failure or a pass is not"); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
