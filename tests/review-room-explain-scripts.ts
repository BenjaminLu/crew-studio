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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { harness, suite, until } from "./rt-harness";
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
E.deps.skillPackages = new SkillPackages({ dataDir: data, skills: E.skillLibrary(), brew: false, uv: false });

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
out["anthropic"] = os.environ.get("ANTHROPIC_API_KEY", "")
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
put("scripts/bigfile.py", "import sys\ntry:\n    with open('big.bin', 'wb') as f:\n        for i in range(64):\n            f.write(b'0' * 65536)\n    print('WROTE ALL')\nexcept OSError as e:\n    print('STOPPED', e.errno)\n    sys.exit(3)\n");
put("scripts/wait.sh", "#!/bin/sh\nsleep 60\n", 0o755);
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
  && /run when it calls them, each in Studio's sandbox/.test(offer.scripts.en) && /With network: through Studio's proxy, to public hosts only/.test(offer.scripts.en) && /ANTHROPIC_API_KEY/.test(offer.scripts.en) && /never Studio's own keys or tokens/.test(offer.scripts.en)
  && /沙盒/.test(offer.scripts.zh) && /可以連網/.test(offer.scripts.zh) && !/GITHUB_TOKEN|GH_TOKEN/.test(JSON.stringify(offer)),
  "the confirmation says the skill's scripts run, sandboxed, with network, names the interpreters and the one credential they get", JSON.stringify(offer?.scripts));
ok(offer?.scripts?.approved === false && /not approved for workflows on the Skills page: confirming here lets its scripts run for this run only/.test(offer.scripts.en) && offer.scripts.limits?.cpuS === 300,
  "a version never approved on the Skills page: the confirmation says this run's confirmation is the approval; the caps are part of it", JSON.stringify(offer?.scripts));
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
  ["explain_done", { entry: "index.html", summary: "The page page-kit's scripts built and checked" }]]);
process.env.CREW_REVIEW_EXPLAIN_SCRIPT_CPU_S = "2"; process.env.CREW_REVIEW_EXPLAIN_SCRIPT_FILE_MB = "1";
// tight caps for the cap checks below (the confirmation names them, so it is read again)
e = await refused(() => X.generate(id, { skill: v1.id, confirm: offer.hash }, "captain"));
ok(e?.code === "confirm_required" && e.offer.scripts.limits.cpuS === 2, "the confirmation made before the caps changed does not start the run", JSON.stringify(e?.offer?.scripts?.limits));
let v = await X.generate(id, { skill: v1.id, confirm: e.offer.hash }, "captain");
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
ok(!!net && net.anthropic === "test-anthropic-key-for-explainer-scripts" && net.leaked.length === 0 && !net.env.includes("GITHUB_TOKEN") && !net.env.includes("GH_TOKEN"), "the script's env has the captain's exported model key and none of Studio's tokens", JSON.stringify(net && { env: net.env, leaked: net.leaked }));
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
ok(calls.length === 8 && calls.every((cc: any) => typeof cc.ms === "number" && cc.at && cc.scriptSha256 && "exit" in cc && typeof cc.stdout === "string") && calls.find((cc: any) => cc.script === "scripts/build.py")?.argv.join(" ") === "spec.json",
  "every call is kept on its round: the command, its exit, its time, the tail of its output", JSON.stringify(calls.map((cc: any) => [cc.script, cc.exit, cc.ms, cc.timedOut, cc.signal])));
ok(run1.progress.some((pp: any) => /^ran scripts\/build\.py spec\.json: exit 0/.test(pp.text)), "each call is a progress line the captain sees live", JSON.stringify(run1.progress.map((pp: any) => pp.text)));
const led = E.trusted(r.id).entries.filter((y: any) => y.record === "review-room-explain").at(-1);
ok(led?.data.skill.filesSha256 === v1.filesSha256 && led.data.scripts?.run === true && led.data.rounds[0].scripts.length === 8 && led.data.rounds[0].scripts.some((cc: any) => cc.script === "scripts/net.py" && cc.hosts.includes("api.model-vendor.example")), "the ledger has the package's hash and every call", JSON.stringify(led?.data).slice(0, 600));
ok(!existsSync(ws("")), "the run's workspace (with its read-only package copy) is gone");

// ---------- a changed package is a new version: a new confirmation, and the new script runs ----------
put("scripts/build.py", build("built by page-kit two"));
E.skillLibrary().importFolder(pkgDir, "captain");
const v2 = lib();
ok(v2.current === 2 && v2.filesSha256 !== v1.filesSha256 && v2.sha256 === v1.sha256, "changing only a script makes v2 (SKILL.md unchanged, the package's hash changed)", JSON.stringify({ v: v2.current, a: v1.filesSha256, b: v2.filesSha256 }));
e = await refused(() => X.generate(id, { skill: v2.id, confirm: offer.hash }, "captain"));
ok(e?.code === "confirm_required" && e.offer.skill.v === 2 && e.offer.hash !== offer.hash, "the v1 confirmation does not start v2", JSON.stringify(e?.offer?.skill));
script.push([["out_write", { path: "spec.json", content: JSON.stringify({ title: "v2" }) }], ["skill_run", { script: "scripts/build.py", args: ["spec.json"] }], ["explain_done", { entry: "index.html", summary: "v2" }]]);
await X.generate(id, { skill: v2.id, confirm: e.offer.hash }, "captain");
const run2 = await waitRun(2);
ok(run2.status === "done" && run2.skill.v === 2 && run2.skill.filesSha256 === v2.filesSha256 && /built by page-kit two/.test(readFileSync(join(E.rdir(r.id), "review-room", `${id}-explain`, `v${run2.version}`, "index.html"), "utf8")), "the run pins v2's package and its new script made the page", JSON.stringify({ s: run2.status, e: run2.error, skill: run2.skill }));

// ---------- text only (the Skills page's decision for a version): the scripts do not run ----------
E.deps.skillPackages.decide(v2.id, 2, "text-only", "captain", "test");
const off = X.offer(id, v2.id, "generate");
ok(off.scripts?.run === false && /text only/.test(off.scripts.en) && off.hash !== e.offer.hash, "a version set to text only: the confirmation says its scripts do not run", JSON.stringify(off.scripts));
script.push([["out_write", { path: "index.html", content: "<h1>by hand</h1>" }], ["explain_done", { entry: "index.html", summary: "text only" }]]);
await X.generate(id, { skill: v2.id, confirm: off.hash }, "captain");
const run3 = await waitRun(3);
ok(run3.status === "done" && !prompts.at(-1)!.tools.includes("skill_run") && /do not run here/.test(prompts.at(-1)!.text), "with text only the round has no skill_run and is told so", prompts.at(-1)!.tools.join(","));

upstream.stop(true); egress.stop(); H.stop();
end();
