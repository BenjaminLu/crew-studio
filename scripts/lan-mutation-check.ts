// The mutation check of board-to-board work (docs/units/lan-relay.md): each rule is switched off in the source, the suite
// that covers it runs, and it must fail; then the source is put back. A mutation that leaves its suite green means the
// rule is not really tested. Run from the repository root:   bun scripts/lan-mutation-check.ts [name…]
// It edits files under src/ and public/ while it runs and restores them (also on Ctrl-C); never run it with uncommitted
// changes in those files.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type M = { name: string; rule: string; edits: { file: string; from: string; to: string }[]; tests: string[] };
const R = join(import.meta.dir, "..");
const RELAY = "bun tests/lan-relay.ts", PROFILE = "bun tests/lan-profile.ts", CRYPTO = "bun tests/lan-crypto.ts", UI = "node tests/lan-ui.mjs";
const MUTATIONS: M[] = [
  { name: "unintroduced", rule: "an unintroduced key is refused", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `allowlist: () => this.st.peers.filter((p) => p.state === "trusted").map((p) => p.key),`, to: `allowlist: () => [...this.st.peers.filter((p) => p.state === "trusted").map((p) => p.key), ...this.st.intros.map((i) => i.key)],` }] },
  { name: "sas", rule: "a wrong SAS is refused", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `if (typed !== i.sas) {`, to: `if (false && typed !== i.sas) {` }] },
  { name: "browser", rule: "a browser-origin request to the LAN listener is refused", tests: [CRYPTO],
    edits: [{ file: "src/lan/wire.ts", from: `if (BROWSER_HEADERS.includes(h) || h.startsWith("sec-fetch-"))`, to: `if (false)` }] },
  { name: "mdns-ids", rule: "a spoofed mDNS answer is only listed by an opaque id", tests: [PROFILE],
    edits: [{ file: "src/lan/mdns.ts", from: `return /^cs-[0-9a-f]{12}$/.test(id) ?`, to: `return true ?` }] },
  { name: "mdns-target", rule: "a discovered or typed target must pass the peer address guard", tests: [PROFILE],
    edits: [{ file: "src/lan/wire.ts", from: `if (loopOk && host.startsWith("127.")) return null;`, to: `if (host.startsWith("127.") || host.startsWith("169.254.")) return null;` }] },
  { name: "fork", rule: "a forked author is frozen", tests: [PROFILE, RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `const conflict = at ? at : before && e.prev !== before ? before : after && afterPrev !== h ? after : null;`, to: `const conflict: string | null = null;` }] },
  { name: "github", rule: "a received briefing that edits .github/ is refused at hand-back", tests: [RELAY],
    edits: [{ file: "src/lan/runner.ts", from: `const PROTECTED: RegExp[] = [/^\\.github\\//,`, to: `const PROTECTED: RegExp[] = [/^\\.never-github\\//,` }] },
  { name: "push", rule: "push is blocked (a step outside the LAN allowlist never runs)", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `return LAN_HOOKS.has(d) ? null :`, to: `return true ? null :` }] },
  { name: "egress", rule: "egress beyond the provider is blocked", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `sandbox: opts.sandbox ? { ...opts.sandbox, allow: [] } : opts.sandbox };`, to: `sandbox: opts.sandbox };` }] },
  { name: "listeners", rule: "no test that opens a listener runs (run_tests and test-run checks)", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `if (lanOf(x.run) && (man?.test_run || man?.network))`, to: `if (false)` },
      { file: "src/lan/profile.ts", from: `tools: (opts.tools ?? []).filter((t: any) => !LAN_DENIED_TOOLS.has(t.name)),`, to: `tools: opts.tools ?? [],` }] },
  { name: "secret", rule: "a secret in a result blocks the send", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `if (redactText(line) !== line) hits.push`, to: `if (false) hits.push` }] },
  { name: "html", rule: "received HTML is not executed", tests: [UI],
    edits: [{ file: "public/lan.js", from: `const pre = (text, attrs = {}) => h("pre", { class: "lan-pre", ...attrs }, text ?? "");`, to: `const pre = (text, attrs = {}) => { const e = h("pre", { class: "lan-pre", ...attrs }); e.innerHTML = text ?? ""; return e; };` }] },
  { name: "phone", rule: "phone sessions cannot approve", tests: [RELAY],
    edits: [{ file: "src/lan/routes.ts", from: `if (who.kind !== "desktop") return json(`, to: `if (false) return json(` },
      { file: "src/server.ts", from: `if (DESKTOP_ONLY.has(p) || p === "/api/lan" || p.startsWith("/api/lan/"))`, to: `if (DESKTOP_ONLY.has(p))` }] },
  { name: "briefing-hash", rule: "a briefing hash mismatch between dispatch and take is rejected", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `if (b.briefing !== r.briefing.hash) return "briefing hash mismatch: the take names a different briefing than this thread's";`, to: `` }] },
  { name: "workflow-hash", rule: "a workflow hash mismatch between take and result is flagged", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `flags.push("workflow-mismatch");`, to: `void 0;` }] },
  { name: "spend", rule: "the spend cap is enforced", tests: [PROFILE, RELAY],
    edits: [{ file: "src/lan/profile.ts", from: `if (over) { o.onStop?.(r, over); return Promise.reject(new RoundBlocked(over)); }`, to: `` }] },
];

const only = process.argv.slice(2);
const saved = new Map<string, string>();
const restore = () => { for (const [f, s] of saved) writeFileSync(join(R, f), s); saved.clear(); };
process.on("SIGINT", () => { restore(); process.exit(130); });
const rows: string[] = []; let bad = 0;
for (const m of MUTATIONS.filter((x) => !only.length || only.includes(x.name))) {
  try {
    for (const e of m.edits) { const f = join(R, e.file); const s = saved.get(e.file) ?? readFileSync(f, "utf8"); if (!saved.has(e.file)) saved.set(e.file, s);
      const cur = readFileSync(f, "utf8"); if (cur.split(e.from).length !== 2) throw new Error(`${e.file}: the text to mutate is not there exactly once`); writeFileSync(f, cur.replace(e.from, () => e.to)); }
    const failed: string[] = [];
    for (const t of m.tests) { const t0 = Date.now(); const p = Bun.spawnSync(["/bin/sh", "-c", t], { cwd: R, stdout: "pipe", stderr: "pipe", env: process.env });
      const out = p.stdout.toString(); const fails = out.split("\n").filter((l) => /^\s*FAIL/.test(l)).map((l) => l.trim().slice(0, 140));
      if (p.exitCode !== 0) failed.push(`${t.split(" ").at(-1)} (${((Date.now() - t0) / 1000).toFixed(0)} s): ${fails[0] ?? `exit ${p.exitCode}`}`); }
    const killed = failed.length > 0; if (!killed) bad++;
    rows.push(`${killed ? "killed  " : "SURVIVED"}  ${m.name.padEnd(14)} ${m.rule}${killed ? `\n            ${failed.join("\n            ")}` : ""}`);
    console.log(rows.at(-1));
  } catch (e: any) { bad++; rows.push(`ERROR     ${m.name}: ${e?.message ?? e}`); console.log(rows.at(-1)); }
  finally { restore(); }
}
console.log(`\nlan mutation check: ${rows.length - bad} killed, ${bad} survived or errored`);
process.exit(bad ? 1 : 0);
