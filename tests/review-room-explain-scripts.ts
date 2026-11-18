import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// "Explain with" a skill that has scripts (docs/units/review-room.md, "The skill's own scripts"; src/domain/review-explain.ts):
// on a real code-firstmate Task stopped at its merge card, with a scripted stub provider, temporary data and a made-up skill
// package, the run calls the package's own scripts through skill_run in the round sandbox (sandbox-exec), for real:
//   - a script builds the page from a spec and another checks it; the page they made is the version shown;
//   - a script reaches the network through Studio's egress proxy (any public host; a metadata address is refused), and every
//     host it reached is kept on the call; its env carries the captain's exported API key and none of Studio's tokens, and
//     Studio's secret files stay unreadable;
//   - it cannot write the materials, the package, Studio's data or anywhere outside its output folder and temp folder;
//   - CPU, file-size, wall-clock and output caps hold; every call (command, exit, time, output tail) is on its round and the ledger;
//   - the confirmation says the scripts run, sandboxed, with network, and names the interpreters; a changed package is a new
//     version with a new confirmation; text only (the Skills page's decision) keeps the scripts from running.
//        bun tests/review-room-explain-scripts.ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { harness, suite, until } from "./rt-harness";
import { PYPI, fixtureEgress, startRegistry } from "./lib/skill-fixtures";
const { ok, end } = suite("review-room-explain-scripts");
if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) { console.log("FAIL  this suite needs macOS sandbox-exec (the round sandbox)"); process.exit(1); }
const root = join(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "crew-room-explain-scripts-"));
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code");
const { Projects } = await import("../src/doors");
const { SkillPackages } = await import("../src/skillpkg");
const { Egress } = await import("../src/egress");
const def = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")
  .replace('- { id: reviewer, label: Reviewer, seat: reviewer, skill: "pack:firstmate/skills/reviewer.md" }', '- { id: reviewer, label: Reviewer, seat: reviewer, provider: tutor, model: t-1, skill: "pack:firstmate/skills/reviewer.md" }');
const H = await harness([def], { data, checkRoots: [] });
const E = H.engine;
installCode(E, { dataDir: data, projects: new Projects(data), reviewWeb: { search: async () => ({ configured: false }), fetch: async () => { throw new Error("no web in this test"); } } });
E.policies.setProject("sandbox", { install: false });

// ---------- Studio's egress proxy, with a made-up public host that lands on a local server (no real network in a test) ----------
const upstream = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => new Response(`hello from the model at ${new URL(req.url).pathname}`) });
const egress = new Egress(null, (_port: number, _address: string) => connect(upstream.port, "127.0.0.1"));
egress.lookup = ((host: string, _o: any, cb: any) => host === "api.model-vendor.example" ? cb(null, [{ address: "93.184.216.34", family: 4 }]) : cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }))) as any;
await egress.start();
// the captain exported a model key; Studio's own tokens exist (env and files) and must never reach a script
process.env.ANTHROPIC_API_KEY = "test-anthropic-key-for-explainer-scripts";
process.env.GITHUB_TOKEN = "test-github-token-never-for-scripts"; process.env.GH_TOKEN = "test-gh-token-never-for-scripts";
for (const f of ["github-token", "session-token", "ledger.key", "keys.json"]) writeFileSync(join(data, f), `STUDIO-SECRET-${f}`);

// ---------- a made-up Task to its merge card ----------
const intent = ["Add a percent function to money-kit",
  "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
const r = E.start({ workflow: "code-firstmate", text: intent, params: {} });
const waitCard = async (kind: string) => { await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === kind) || ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000); return E.cards.list({ run: r.id, open: true }).find((c) => c.kind === kind); };
const dispatch = await waitCard("dispatch"); if (!dispatch) throw new Error(`no dispatch card: ${E.get(r.id)!.status} ${E.get(r.id)!.error ?? ""} ${JSON.stringify(E.cards.list({ run: r.id, open: true }).map((c: any) => [c.kind, c.title]))}`);
await E.answer(dispatch.id, { choice: "dispatch", by: "captain" });
const merge = (await waitCard("merge"))!;
if (!merge) { console.log(E.get(r.id)!.status, E.get(r.id)!.error); throw new Error("the Task never reached its merge card"); }
await until(() => E.get(r.id)!.nodes[merge.node].waiting === "card", 10000);
const room = E.reviewRoom!, X = room.explain, id = merge.id;
// Studio's proxy and skill packages, as the server wires them (after the made-up Task: its stub rounds run unsandboxed)
(H.agents as any).egress = egress;
// a prepare reaches only the wheel index its lockfile names: a local fixture behind its own strict egress (tests/lib/skill-fixtures.ts)
const fx = startRegistry(), prepEgress = fixtureEgress(join(data, "egress-prepare.log")); await prepEgress.start(); prepEgress.testUpstreams.set(PYPI, { address: "127.0.0.1", port: fx.port });
E.deps.skillPackages = new SkillPackages({ dataDir: data, skills: E.skillLibrary(), egress: () => prepEgress, brew: false, uv: false });

// ---------- the made-up skill package: SKILL.md and python / shell scripts ----------
const pkgDir = mkdtempSync(join(tmpdir(), "crew-skill-page-kit-"));
const outside = mkdtempSync(join(tmpdir(), "crew-skill-outside-"));
const put = (rel: string, text: string, mode = 0o644) => { mkdirSync(join(pkgDir, rel, ".."), { recursive: true }); writeFileSync(join(pkgDir, rel), text); chmodSync(join(pkgDir, rel), mode); };
put("SKILL.md", "---\nname: page-kit\ndescription: A one-page explanation built by its own scripts: build.py renders it from a spec, check.py checks it.\n---\n# page-kit\n\nWrite spec.json, run scripts/build.py spec.json, then scripts/check.py index.html. Never hand-write the page.\n");
const build = (marker: string) => `import json, os, sys\nspec = json.load(open(sys.argv[1]))\ndiff = open(os.path.join(os.environ["MATERIALS_DIR"], "diff.txt")).read()\nhtml = "<!doctype html><html><head><meta charset=utf-8><title>%s</title></head><body><h1>%s</h1><p>%d diff lines</p><p>${marker}</p></body></html>" % (spec["title"], spec["title"], diff.count("\\n"))\nopen("index.html", "w").write(html)\nprint("BUILT", len(html))\n`;
put("scripts/build.py", build("built by page-kit one"));
put("scripts/check.py", "import sys\nt = open(sys.argv[1]).read()\nok = '<h1>' in t and 'built by page-kit' in t\nprint('CHECK', 'ok' if ok else 'missing')\nsys.exit(0 if ok else 1)\n");
put("scripts/net.py", `import json, os, sys, urllib.request
out = {}
def get(u):
    try: return urllib.request.urlopen(u, timeout=10).read().decode()
    except Exception as e: return "ERR " + type(e).__name__ + " " + str(e)[:120]
out["model"] = get("http://api.model-vendor.example/v1/messages")
out["metadata"] = get("http://169.254.169.254/latest/meta-data/")
out["env"] = sorted(os.environ.keys())
import hashlib
out["anthropic"] = os.environ.get("ANTHROPIC_API_KEY", "")
out["anthropic_sha"] = hashlib.sha256(out["anthropic"].encode()).hexdigest()
out["leaked"] = [k for k, v in os.environ.items() if "never-for-scripts" in v or k in ("GITHUB_TOKEN", "GH_TOKEN") or (k.startswith("CREW_") and k != "CREW_RUN_KILL")]
reads = {}
for p in sys.argv[1:]:
    try: reads[p] = open(p).read()[:40]
    except Exception as e: reads[p] = "DENIED " + type(e).__name__
out["reads"] = reads
print(json.dumps(out))
`);
put("scripts/escape.py", `import json, os, sys
res = {}
for p in sys.argv[1:] + ["ok.txt"]:
    try:
        open(p, "w").write("x"); res[p] = "WROTE"
    except Exception as e: res[p] = "DENIED " + type(e).__name__
print(json.dumps(res))
`);
put("scripts/spin.py", "while True:\n    pass\n");
put("scripts/loud.py", "import sys\nfor i in range(6000):\n    sys.stdout.write('line %05d %s\\n' % (i, 'x' * 40))\nprint('LAST LINE')\n");
put("scripts/bigfile.py", "import sys\ntry:\n    with open('big.bin', 'wb') as f:\n        for i in range(64):\n            f.write(b'0' * 65536)\n    print('WROTE ALL')\nexcept OSError as e:\n    print('STOPPED', e)\n    sys.exit(3)\n");
put("scripts/wait.sh", "#!/bin/sh\nsleep 60\n", 0o755);
// a leftover that escapes every group kill: double fork, setsid, an empty environment; it keeps writing and plants links
put("scripts/surv.py", `import os, sys
secret = sys.argv[1]
if os.fork() == 0:
    os.setsid()
    if os.fork() == 0:
        os.execve("/bin/sh", ["/bin/sh", "-c", "i=0; while [ $i -lt 40 ]; do date >> survivor.txt; ln -sf '" + secret + "' leak.txt 2>/dev/null; ln -sf /etc etcdir 2>/dev/null; i=$((i+1)); sleep 0.2; done"], {})
    os._exit(0)
print("parent done")
`);
put("scripts/diskfill.py", "import os, time\nd = os.environ['TMPDIR']\nfor i in range(400):\n    open(os.path.join(d, 'f%d' % i), 'wb').write(b'0' * 900000); time.sleep(0.01)\nprint('FILLED')\n");
put("scripts/browser.py", "import os, subprocess, sys\nr = subprocess.run([os.environ['CHROME_BIN'], '--headless', '--disable-gpu', '--dump-dom', 'file://' + os.path.abspath('index.html')], capture_output=True, text=True, timeout=60)\nprint('DOM', r.returncode, r.stdout[:400])\n");
E.skillLibrary().importFolder(pkgDir, "captain");
const lib = () => E.skillLibrary().library().find((s: any) => s.name === "page-kit")!;
const v1 = lib();
ok(!!v1 && v1.current === 1, "fixture: the package is in Studio's library at v1", JSON.stringify(E.skillLibrary().library().map((s: any) => s.id)));

// ---------- a scripted provider: each round runs the next script, through the real tool route ----------
const script: any[][] = [], prompts: { system: string; text: string; tools: string[] }[] = [], results: [string, any][] = [];
const scripted = (pid: string, model: string) => ({ id: pid, model, sandboxFree: true, start(system: string, tools: any[], ctx: any) {
  const me = { system, text: "", tools: tools.map((t) => t.name) }; prompts.push(me);
  return { interrupt() {}, async *send(text: string) { me.text = text;
    for (const [name, args] of script.shift() ?? []) {
      if (name === "msg") { yield { type: "message", text: args } as any; continue; }
      if (name === "sleep") { await Bun.sleep(args); continue; }
      const res = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const j = await res.json(); results.push([name, j]);
      yield { type: "toolStart", id: name, name, args } as any; yield { type: "toolEnd", id: name, rows: null, error: j?.error ?? null, result: JSON.stringify(j) } as any; }
    yield { type: "turnEnd", status: "ok", usage: { usd: 0.1, inTokens: 10, outTokens: 5 } } as any; } }; } });
const baseProvider = E.deps.provider; E.deps.provider = (pid?: string, model?: string) => pid === "tutor" ? scripted(pid, model ?? "") : baseProvider(pid, model);
const refused = async (f: () => any) => { try { await f(); return null; } catch (e: any) { return e; } };
const waitRun = async (n: number, ms = 120000) => { await until(() => { const v = X.view(id); return v.running == null && v.runs.find((x: any) => x.n === n)?.status !== "running"; }, ms); return X.view(id).runs.find((x: any) => x.n === n); };
const runRes = (i: number) => results.filter(([n]) => n === "skill_run")[i]?.[1];

// ---------- the confirmation: the scripts run, sandboxed, with network, on these interpreters ----------
let e: any = await refused(() => X.generate(id, { skill: v1.id }, "captain"));
const offer = e?.offer;
ok(e?.code === "confirm_required" && offer?.scripts?.run === true && offer.scripts.network === true && offer.scripts.interpreters.some((x: string) => /^python3 \d/.test(x)) && offer.scripts.interpreters.includes("/bin/bash")
  && /run when it calls them, each in Studio's sandbox/.test(offer.scripts.en) && /With network: through Studio's proxy, to public hosts only/.test(offer.scripts.en) && /ANTHROPIC_API_KEY/.test(offer.scripts.en) && /never a key Studio stores/.test(offer.scripts.en)
  && /沙盒/.test(offer.scripts.zh) && /可以連網/.test(offer.scripts.zh) && !/GITHUB_TOKEN|GH_TOKEN/.test(JSON.stringify(offer)),
  "the confirmation says the skill's scripts run, sandboxed, with network, names the interpreters and the one credential they get", JSON.stringify(offer?.scripts));
ok(offer?.scripts?.approved === false && /no decision yet: choose below whether its scripts run/.test(offer.scripts.en) && offer.decide?.state === "pending" && offer.decide.facts.sha256 === v1.sha256 && offer.decide.facts.filesSha256 === v1.filesSha256 && offer.scripts.limits?.cpuS === 300,
  "a version never decided: the confirmation asks for the decision, bound to both hashes; the caps are part of it", JSON.stringify(offer?.scripts));
ok(JSON.stringify(offer?.scripts?.keys) === '["ANTHROPIC_API_KEY"]' && Array.isArray(offer.scripts.endpoints) && /public hosts only/.test(offer.scripts.rows?.network?.en) && /300 s of CPU/.test(offer.scripts.rows?.limits?.en) && /no decision yet/.test(offer.scripts.rows?.approval?.en) && /還沒決定/.test(offer.scripts.rows?.approval?.zh) && !!offer.scripts.rows?.browser,
  "the confirmation's rows: network, credentials by name (endpoints apart), limits, browser, the undecided note, in both languages", JSON.stringify(offer?.scripts?.rows));
process.env.ANTHROPIC_BASE_URL = "https://gateway.example";
const withEp = X.offer(id, v1.id, "generate").scripts;
ok(withEp.endpoints.includes("ANTHROPIC_BASE_URL") && !withEp.keys.includes("ANTHROPIC_BASE_URL"), "a base URL is listed as an endpoint, not a credential", JSON.stringify(withEp));
delete process.env.ANTHROPIC_BASE_URL;
process.env.CREW_REVIEW_EXPLAIN_SCRIPT_CPU_S = "7";
ok(X.offer(id, v1.id, "generate").hash !== offer.hash, "a changed cap is a new confirmation");
delete process.env.CREW_REVIEW_EXPLAIN_SCRIPT_CPU_S;

// round 1: write the spec, build, check, try the network, try to escape, hit each cap; then finish with the page the scripts made
const ws = (rel: string) => join(E.rdir(r.id), "review-room", `${id}-explain`, "work", "run-1", rel);
script.push([
  ["out_write", { path: "spec.json", content: JSON.stringify({ title: "percent, built by its script" }) }],
  ["skill_run", { script: "scripts/build.py", args: ["spec.json"] }],
  ["skill_run", { script: "scripts/check.py", args: ["index.html"] }],
  ["skill_run", { script: "scripts/net.py", args: [join(data, "github-token"), join(data, "session-token"), join(data, "ledger.key"), join(data, "keys.json")] }],
  ["skill_run", { script: "scripts/escape.py", args: [ws("materials/diff.txt"), ws("pkg/page-kit/scripts/build.py"), ws("pkg/page-kit/evil.py"), join(data, "planted.txt"), join(outside, "planted.txt"), join(tmpdir(), "crew-explain-planted.txt")] }],
  ["skill_run", { script: "scripts/spin.py" }],
  ["skill_run", { script: "scripts/bigfile.py" }],
  ["skill_run", { script: "scripts/wait.sh", timeout_s: 5 }],
  ["skill_run", { script: "scripts/loud.py" }],
  ["skill_run", { script: "../../etc/passwd" }],
  ["skill_run", { script: "scripts/surv.py", args: [join(data, "github-token")] }],
  ["out_read", { path: "survivor.txt" }], ["sleep", 1500], ["out_read", { path: "survivor.txt" }], ["out_list", {}], ["out_read", { path: "leak.txt" }],
  ["skill_run", { script: "scripts/diskfill.py" }],
  ["skill_run", { script: "scripts/browser.py" }],
  ["explain_done", { entry: "index.html", summary: "The page page-kit's scripts built and checked" }]]);
process.env.CREW_REVIEW_EXPLAIN_SCRIPT_CPU_S = "2"; process.env.CREW_REVIEW_EXPLAIN_SCRIPT_FILE_MB = "1";
// tight caps for the cap checks below (the confirmation names them, so it is read again)
e = await refused(() => X.generate(id, { skill: v1.id, confirm: offer.hash }, "captain"));
ok(e?.code === "confirm_required" && e.offer.scripts.limits.cpuS === 2, "the confirmation made before the caps changed does not start the run", JSON.stringify(e?.offer?.scripts?.limits));
ok((await refused(() => X.generate(id, { skill: v1.id, confirm: e.offer.hash }, "captain")))?.code === "confirm_required", "an undecided script version does not start without the captain's pick");
let v = await X.generate(id, { skill: v1.id, confirm: e.offer.hash, skillDecision: "scripts" }, "captain");
const run1 = await waitRun(1);
delete process.env.CREW_REVIEW_EXPLAIN_SCRIPT_CPU_S; delete process.env.CREW_REVIEW_EXPLAIN_SCRIPT_FILE_MB;
v = X.view(id);
const p1 = prompts.at(-1)!;
ok(p1.tools.includes("skill_run") && /The skill's scripts run with skill_run/.test(p1.text) && /scripts\/build\.py \(python\)/.test(p1.text) && /network through Studio's proxy/.test(p1.text), "the round has skill_run and its first message lists the scripts", p1.text.slice(0, 900));
const [b, c, n, x, spin, big, wait, loud, bad] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(runRes);
ok(b?.exit === 0 && /BUILT/.test(b.stdout) && c?.exit === 0 && /CHECK ok/.test(c.stdout), "a script builds the page from the spec (reading the materials) and another checks it", JSON.stringify({ b, c }).slice(0, 800));
ok(run1.status === "done" && run1.version === 1 && v.versions[0].entry === "index.html", "the run finished with the page the scripts made as v1", JSON.stringify({ s: run1.status, e: run1.error }));
const page = readFileSync(join(E.rdir(r.id), "review-room", `${id}-explain`, "v1", "index.html"), "utf8");
ok(/built by page-kit one/.test(page) && /percent, built by its script/.test(page) && /\d+ diff lines/.test(page), "the version is the scripts' own output (the spec's title, the materials' diff)", page.slice(0, 300));
let net: any = null; try { net = JSON.parse(n?.stdout ?? ""); } catch {}
ok(!!net && /hello from the model at \/v1\/messages/.test(net.model), "a script reaches a public host through Studio's proxy (network allowed)", JSON.stringify(n).slice(0, 600));
ok(!!net && /^ERR/.test(net.metadata), "a metadata address is refused by the proxy's address guard", net?.metadata);
ok(!!net && net.anthropic === "[redacted]" && net.anthropic_sha === createHash("sha256").update("test-anthropic-key-for-explainer-scripts").digest("hex") && !JSON.stringify(X.view(id)).includes("test-anthropic-key-for-explainer-scripts"),
  "the key reaches the script, and its value is redacted from what the script printed (the result, the round, the page)", JSON.stringify({ a: net?.anthropic, sha: net?.anthropic_sha }));
ok(!!net && net.env.includes("ANTHROPIC_API_KEY") && net.leaked.length === 0 && !net.env.includes("GITHUB_TOKEN") && !net.env.includes("GH_TOKEN"), "the script's env has the captain's exported model key and none of Studio's tokens", JSON.stringify(net && { env: net.env, leaked: net.leaked }));
ok(!!net && Object.values(net.reads).every((t: any) => /^DENIED/.test(t)), "Studio's token and key files stay unreadable to a script", JSON.stringify(net?.reads));
const calls = run1.rounds.flatMap((rr: any) => rr.scripts ?? []);
const netCall = calls.find((cc: any) => cc.script === "scripts/net.py");
ok(netCall?.hosts.includes("api.model-vendor.example") && netCall.refused.some((f: any) => f.host === "169.254.169.254"), "the call records the hosts it reached and the one it was refused", JSON.stringify(netCall && { hosts: netCall.hosts, refused: netCall.refused }));
let esc: any = null; try { esc = JSON.parse(x?.stdout ?? ""); } catch {}
ok(!!esc && esc["ok.txt"] === "WROTE" && Object.entries(esc).filter(([p]) => p !== "ok.txt").every(([, t]) => /^DENIED/.test(String(t))), "a script writes its output folder, and nothing else: not the materials, the package, Studio's data, another folder or /tmp", JSON.stringify(esc));
ok(!existsSync(join(outside, "planted.txt")) && !existsSync(join(data, "planted.txt")) && !existsSync(join(tmpdir(), "crew-explain-planted.txt")), "nothing was planted outside");
ok(spin?.signal === "SIGXCPU" && /CPU time/.test(spin.note ?? ""), "the CPU cap stops a script that spins", JSON.stringify(spin));
const bigFile = join(E.rdir(r.id), "review-room", `${id}-explain`, "v1", "big.bin");
ok(big?.exit !== 0 && /STOPPED/.test(big?.stdout ?? "") && (!existsSync(bigFile) || statSync(bigFile).size <= 1024 * 1024), "the file-size cap stops a script that writes too much", JSON.stringify({ big, size: existsSync(bigFile) ? statSync(bigFile).size : null }));
ok(wait?.timedOut === true && wait.ms < 20000, "the wall-clock cap (timeout_s) stops a script that waits", JSON.stringify(wait));
ok(loud?.exit === 0 && loud.stdout.length <= 64 * 1024 && /LAST LINE/.test(loud.stdout) && !/line 00000/.test(loud.stdout), "output is cut to its last 64 KiB", String(loud?.stdout?.length));
ok(!!bad?.error && /not a script of/.test(bad.error), "only the package's own scripts run", JSON.stringify(bad));
// the leftover: it is killed or cut off when its call ends; nothing it planted is followed by Studio
const reads = results.filter(([nm]) => nm === "out_read").map(([, j]) => j), listed = results.filter(([nm]) => nm === "out_list").map(([, j]) => j).at(-1);
ok(typeof reads[0]?.text === "string" && reads[0].text === reads[1]?.text, "a leftover that escaped the group kill writes nothing more in the output folder once its call ended", JSON.stringify([reads[0]?.text?.split("\n").length, reads[1]?.text?.split("\n").length]));
ok(!!reads[2]?.error && !/STUDIO-SECRET/.test(JSON.stringify(reads[2])), "a link it planted is not followed by Studio's reads", JSON.stringify(reads[2]));
const v1files = v.versions[0].files.map((f: any) => f.path);
ok(!v1files.includes("leak.txt") && !v1files.some((p: string) => p.startsWith("etcdir")) && !v1files.some((p: string) => /STUDIO-SECRET/.test(readFileSync(join(E.rdir(r.id), "review-room", `${id}-explain`, "v1", p), "latin1"))), "the version keeps no link and nothing of Studio's secrets", JSON.stringify(v1files));
const fill = runRes(10);
const fillLine = run1.progress.find((pp: any) => pp.script?.script === "scripts/diskfill.py");
ok(fillLine?.script.limit === "disk" && !/FILLED/.test(fill?.stdout ?? ""), "a call that fills its temp folder past the disk limit is stopped and named so", JSON.stringify({ fill, line: fillLine?.text }));
const br = runRes(11), hasBrowser = !!(await import("../src/domain/review-explain")).headlessBrowser();
if (hasBrowser) ok(br?.exit === 0 && /DOM 0 /.test(br.stdout) && /<h1>/.test(br.stdout), "a headless browser starts inside the sandbox ($CHROME_BIN) and renders the page", JSON.stringify(br).slice(0, 600));
else console.log("  note  no Playwright headless shell on this machine: the browser path is not exercised here");
const ran = calls.filter((cc: any) => cc.outcome !== "refused");
ok(calls.length === 12 && ran.length === 11 && ran.every((cc: any) => typeof cc.ms === "number" && cc.at && cc.scriptSha256 && "exit" in cc && typeof cc.stdout === "string") && calls.find((cc: any) => cc.script === "scripts/build.py")?.argv.join(" ") === "spec.json",
  "every call is kept on its round: the command, its exit, its time, the tail of its output (and the refused one)", JSON.stringify(calls.map((cc: any) => [cc.script, cc.exit, cc.ms, cc.timedOut, cc.signal, cc.outcome])));
const lines = run1.progress.filter((pp: any) => pp.script), lineOf = (s: string) => lines.find((pp: any) => pp.script.script === s);
ok(/^build\.py — exit 0 · \d+\.\d s$/.test(lineOf("scripts/build.py")?.text ?? "") && lineOf("scripts/build.py").script.outcome === "ok" && lineOf("scripts/build.py").script.args === "spec.json", "each call is a progress line, the result first", JSON.stringify(lines.map((pp: any) => pp.text)));
ok(lineOf("scripts/spin.py")?.script.outcome === "limit" && lineOf("scripts/spin.py").script.limit === "cpu" && /hit the CPU limit \(2 s\)/.test(lineOf("scripts/spin.py").text)
  && lineOf("scripts/bigfile.py")?.script.limit === "file" && /hit the file-size limit \(1 MB\)/.test(lineOf("scripts/bigfile.py").text)
  && lineOf("scripts/wait.sh")?.script.limit === "time" && /hit the time limit \(5 s\)/.test(lineOf("scripts/wait.sh").text) && lineOf("scripts/wait.sh").script.limits.wallS === 5, "a limit a call hit is named with its value (CPU, file size, time)", JSON.stringify(lines.map((pp: any) => [pp.text, pp.script.limit])));
const netLine = lineOf("scripts/net.py")?.script;
ok(netLine?.hosts.includes("api.model-vendor.example") && netLine.refused.some((x: any) => x.host === "169.254.169.254") && /refused 169\.254\.169\.254/.test(lineOf("scripts/net.py").text) && /<Studio data>\/github-token/.test(netLine.args) && !netLine.args.includes(data),
  "a call's line names the hosts it reached and was refused, with its paths shortened", JSON.stringify(netLine));
const refLine = lines.find((pp: any) => pp.script.outcome === "refused");
ok(refLine?.script.script === "../../etc/passwd" && /not a script of/.test(refLine.script.refusal) && /^\.\.\/\.\.\/etc\/passwd — refused: not a script of this skill$/.test(refLine.text) && refLine.script.refusalCode === "not-script", "a call refused before it ran is a line too, with why", JSON.stringify(refLine));
ok(lines.find((pp: any) => pp.script.script === "scripts/check.py")?.script.stderr === "" && typeof netLine?.stderr === "string", "each line carries its stderr tail for the page to open");
const led = E.trusted(r.id).entries.filter((y: any) => y.record === "review-room-explain").at(-1);
ok(led?.data.skill.filesSha256 === v1.filesSha256 && led.data.scripts?.run === true && led.data.rounds[0].scripts.length === 12 && led.data.rounds[0].scripts.some((cc: any) => cc.outcome === "refused") && led.data.rounds[0].scripts.some((cc: any) => cc.script === "scripts/net.py" && cc.hosts.includes("api.model-vendor.example")), "the ledger has the package's hash and every call", JSON.stringify(led?.data).slice(0, 600));
ok(!existsSync(ws("")), "the run's workspace (with its read-only package copy) is gone");

// ---------- a changed package is a new version: a new confirmation, and the new script runs ----------
put("scripts/build.py", build("built by page-kit two"));
E.skillLibrary().importFolder(pkgDir, "captain");
const v2 = lib();
ok(v2.current === 2 && v2.filesSha256 !== v1.filesSha256 && v2.sha256 === v1.sha256, "changing only a script makes v2 (SKILL.md unchanged, the package's hash changed)", JSON.stringify({ v: v2.current, a: v1.filesSha256, b: v2.filesSha256 }));
e = await refused(() => X.generate(id, { skill: v2.id, confirm: offer.hash }, "captain"));
ok(e?.code === "confirm_required" && e.offer.skill.v === 2 && e.offer.hash !== offer.hash, "the v1 confirmation does not start v2", JSON.stringify(e?.offer?.skill));
script.push([["out_write", { path: "spec.json", content: JSON.stringify({ title: "v2" }) }], ["skill_run", { script: "scripts/build.py", args: ["spec.json"] }], ["explain_done", { entry: "index.html", summary: "v2" }]]);
await X.generate(id, { skill: v2.id, confirm: e.offer.hash, skillDecision: "scripts" }, "captain");
const run2 = await waitRun(2);
ok(run2.status === "done" && run2.skill.v === 2 && run2.skill.filesSha256 === v2.filesSha256 && /built by page-kit two/.test(readFileSync(join(E.rdir(r.id), "review-room", `${id}-explain`, `v${run2.version}`, "index.html"), "utf8")), "the run pins v2's package and its new script made the page", JSON.stringify({ s: run2.status, e: run2.error, skill: run2.skill }));

// ---------- text only (the Skills page's decision for a version): the scripts do not run ----------
E.deps.skillPackages.decide(v2.id, 2, "text-only", "captain", "test");
const off = X.offer(id, v2.id, "generate");
ok(off.scripts?.run === false && /text only/.test(off.scripts.en) && (off.scripts.en.match(/do not run/g) ?? []).length === 1 && (off.scripts.zh.match(/不會執行/g) ?? []).length === 1 && off.hash !== e.offer.hash, "a version set to text only: the confirmation says its scripts do not run", JSON.stringify(off.scripts));
script.push([["out_write", { path: "index.html", content: "<h1>by hand</h1>" }], ["explain_done", { entry: "index.html", summary: "text only" }]]);
await X.generate(id, { skill: v2.id, confirm: off.hash }, "captain");
const run3 = await waitRun(3);
ok(run3.status === "done" && !prompts.at(-1)!.tools.includes("skill_run") && /do not run here/.test(prompts.at(-1)!.text), "with text only the round has no skill_run and is told so", prompts.at(-1)!.tools.join(","));

// ---------- Studio's bun standing in for node: a bunfig.toml or .env the agent wrote in the working folder is not honoured ----------
{
  const { skillTools } = await import("../src/skillpkg/run");
  const root2 = mkdtempSync(join(tmpdir(), "crew-skill-bun-")), skill = join(root2, "skill"), work = join(root2, "out"); mkdirSync(join(skill, "scripts"), { recursive: true }); mkdirSync(work);
  writeFileSync(join(skill, "scripts", "hello.js"), "console.log('HELLO', process.env.PLANTED ?? 'no-env', globalThis.PWNED ?? 'no-preload');\n");
  writeFileSync(join(work, "bunfig.toml"), 'preload = ["./evil.js"]\n'); writeFileSync(join(work, "evil.js"), "globalThis.PWNED = 'PWNED';\n"); writeFileSync(join(work, ".env"), "PLANTED=from-dotenv\n");
  // Studio's own bun, and a `node` on PATH that is a link to a bun (the host's node, as far as Studio's resolver knows)
  const alias = join(root2, "bin", "node"); mkdirSync(join(root2, "bin")); symlinkSync(realpathSync(process.execPath), alias);
  for (const [label, node] of [["Studio's bun", { name: "node", bin: process.execPath, version: "bun", source: "studio", dir: join(process.execPath, "..", "..") }], ["a node that links to bun", { name: "node", bin: alias, version: "22.0.0", source: "host", dir: root2 }]] as [string, any][]) {
    const status: any = { state: "ready", blocking: false, reasons: [], runtimes: { node }, bins: [], envKey: null, env: null, decision: null };
    const pkgs: any = { pkg: () => ({ scripts: [{ path: "scripts/hello.js", lang: "node", sha256: "x" }] }), runReads: () => [dirname(realpathSync(process.execPath))] };
    const t: any = skillTools({ skills: [{ id: "bunny", v: 1, sha256: "a", filesSha256: "b", dir: skill, status, run: true }], packages: pkgs, round: { cwd: work, writes: [work], tmp: join(root2, "tmp"), dataDir: data, protect: [], egress: null, run: "R", node: "n", visit: 1 }, record: () => {} })
      .find((x: any) => x.name === "skill_run");
    const out2 = await t.run({ skill: "bunny", script: "scripts/hello.js" });
    ok(/HELLO no-env no-preload/.test(out2.stdout), `${label} ignores a bunfig.toml preload and a .env written in its working folder`, JSON.stringify(out2).slice(0, 400));
  }
}

// ---------- an undecided script skill with a hash-pinned requirements lock: decided in the confirmation, prepared, then run ----------
{
  const mkSkill = (name: string, requirements: string) => { const d = mkdtempSync(join(tmpdir(), `crew-skill-${name}-`)), f = join(d, name); mkdirSync(join(f, "scripts"), { recursive: true });
    writeFileSync(join(f, "SKILL.md"), `---\nname: ${name}\ndescription: A page made by a script that needs one pinned package.\n---\n# ${name}\n\nRun scripts/use-py.py with a word.\n`);
    writeFileSync(join(f, "requirements.txt"), requirements);
    writeFileSync(join(f, "scripts", "use-py.py"), "import sys\nimport fixture_py\nout = fixture_py.shout(sys.argv[1] if len(sys.argv) > 1 else 'none')\nopen('index.html', 'w').write('<h1>' + out + '</h1>')\nprint(out)\n");
    E.skillLibrary().importFolder(f, "captain"); return E.skillLibrary().library().find((x: any) => x.name === name)!; };
  const ledger = (sid: string) => { try { return readFileSync(join(data, "skills", "_library", sid, "approvals.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const n0 = () => (X.view(id).runs.at(-1)?.n ?? 0) + 1;
  const dep = mkSkill("dep-kit", fx.requirements);
  const o1: any = X.offer(id, dep.id, "generate");
  const f1 = o1.decide?.facts;
  ok(o1.decide?.state === "pending" && f1?.sha256 === dep.sha256 && f1.filesSha256 === dep.filesSha256 && f1.scripts.some((x: any) => x.path === "scripts/use-py.py" && Array.isArray(x.flags)) && JSON.stringify(f1.locks) === '["python (requirements.txt)"]' && Array.isArray(f1.hosts) && Array.isArray(f1.bins),
    "an undecided script skill with a lockfile: the confirmation carries the team-change card's facts (scripts and flags, hosts, lockfiles, programs), bound to both hashes", JSON.stringify(o1.decide));
  ok((await refused(() => X.generate(id, { skill: dep.id, confirm: o1.hash }, "captain")))?.code === "confirm_required" && ledger(dep.id).length === 0, "confirming without the pick starts nothing and records nothing");
  const nA = n0();
  script.push([["skill_run", { script: "scripts/use-py.py", args: ["prepared"] }], ["explain_done", { entry: "index.html", summary: "made with its prepared env" }]]);
  await X.generate(id, { skill: dep.id, confirm: o1.hash, skillDecision: "scripts" }, "captain");
  const l1 = ledger(dep.id);
  ok(l1.length === 1 && l1[0].scripts === "approved" && l1[0].via === "review-room" && l1[0].sha256 === dep.sha256 && l1[0].filesSha256 === dep.filesSha256 && /^[a-f0-9]{64}$/.test(l1[0].sig) && E.deps.skillPackages.decision(dep.id, 1)?.sig === l1[0].sig,
    "Approve with scripts records one signed ledger line, via the review room, bound to the hashes shown", JSON.stringify(l1));
  const runA = await waitRun(nA, 240000), use = results.filter(([nm]) => nm === "skill_run").at(-1)?.[1];
  const stA = E.deps.skillPackages.status(dep.id, 1);
  ok(runA?.prepare?.state === "done" && stA.state === "ready" && !!stA.envKey && stA.env?.python === true && fx.hits.some((h) => h.startsWith(`${PYPI}/files/`)), "the run waited for the version's prepare: its env was installed from the lockfile's index", JSON.stringify({ prep: runA?.prepare, st: stA.state, r: stA.reasons, hits: fx.hits.slice(-4) }));
  ok(runA?.status === "done" && use?.exit === 0 && /py:PREPARED/.test(use.stdout), "skill_run ran the script in the prepared env (the pinned package imports)", JSON.stringify({ s: runA?.status, e: runA?.error, use }).slice(0, 600));
  const startRec = E.trusted(r.id).entries.filter((y: any) => y.record === "review-room-explain-start").at(-1);
  ok(startRec?.data?.decided === "approved" && runA.decided === "approved", "the run and its start record name the decision made with its confirmation", JSON.stringify(startRec?.data).slice(0, 300));
  // already approved: no pick, the decision shown; the confirmation's hash moved with the decision
  const o2: any = X.offer(id, dep.id, "generate");
  ok(o2.decide?.state === "approved" && o2.decide.via === "review-room" && !o2.decide.facts && o2.hash !== o1.hash, "a decided version shows its decision and asks nothing; the offer's hash changed with the decision", JSON.stringify(o2.decide));
  const nB = n0(); script.push([["skill_run", { script: "scripts/use-py.py", args: ["again"] }], ["explain_done", { entry: "index.html", summary: "again" }]]);
  await X.generate(id, { skill: dep.id, confirm: o2.hash }, "captain"); const runB = await waitRun(nB);
  ok(runB?.status === "done" && ledger(dep.id).length === 1 && !runB.prepare && /py:AGAIN/.test(results.filter(([nm]) => nm === "skill_run").at(-1)?.[1]?.stdout ?? ""), "an approved, prepared version runs without a pick or another prepare", JSON.stringify({ s: runB?.status, e: runB?.error, p: runB?.prepare }));
  // text only, picked in the confirmation: recorded, and the run has no skill_run
  const txt = mkSkill("dep-kit-text", fx.requirements), o3: any = X.offer(id, txt.id, "generate"), nC = n0();
  script.push([["out_write", { path: "index.html", content: "<h1>by hand</h1>" }], ["explain_done", { entry: "index.html", summary: "text only" }]]);
  await X.generate(id, { skill: txt.id, confirm: o3.hash, skillDecision: "text-only" }, "captain"); const runC = await waitRun(nC);
  const l3 = ledger(txt.id);
  ok(l3.length === 1 && l3[0].scripts === "text-only" && l3[0].via === "review-room" && runC?.status === "done" && !runC.prepare && !prompts.at(-1)!.tools.includes("skill_run") && /do not run here/.test(prompts.at(-1)!.text),
    "Text only in the confirmation: recorded via the review room, no prepare, the round has no skill_run", JSON.stringify({ l3, s: runC?.status, tools: prompts.at(-1)!.tools.filter((t) => /skill/.test(t)) }));
  // a prepare that fails stops the run with its reason, in both languages
  const badReq = fx.requirements.replace(/sha256:[a-f0-9]{64}/, `sha256:${"0".repeat(64)}`), bad = mkSkill("dep-kit-bad", badReq), o4: any = X.offer(id, bad.id, "generate"), nD = n0(), roundsBefore = prompts.length;
  await X.generate(id, { skill: bad.id, confirm: o4.hash, skillDecision: "scripts" }, "captain"); const runD = await waitRun(nD, 240000);
  ok(runD?.status === "failed" && runD.why === "prepare" && runD.prepare?.state === "failed" && /could not prepare the skill's dependencies/.test(runD.error) && /沒辦法準備這個 skill 的依賴/.test(runD.error) && runD.rounds.length === 0 && prompts.length === roundsBefore,
    "a prepare that fails stops the run before any paid round, with the reason in en and zh", JSON.stringify({ s: runD?.status, why: runD?.why, e: runD?.error, rounds: runD?.rounds?.length }));
}

upstream.stop(true); egress.stop(); prepEgress.stop(); fx.stop(); H.stop();
end();
