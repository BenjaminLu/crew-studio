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
  // ---------- the first review's rules ----------
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
    edits: [{ file: "src/lan/relay.ts", from: `const conflict = at && at !== h ? at : before && e.prev !== before ? before : after && afterPrev !== h ? after : null;`, to: `const conflict: string | null = null;` }] },
  { name: "github", rule: ".github/ (and every protected path) is refused when written and at hand-back", tests: [PROFILE, RELAY],
    edits: [{ file: "src/lan/paths.ts", from: `".github/", `, to: `".never-github/", ` }] },
  { name: "push", rule: "push is blocked (a step outside the LAN allowlist never runs)", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `return LAN_HOOKS.has(d) ? null :`, to: `return true ? null :` }] },
  { name: "egress", rule: "egress beyond the provider is blocked", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `sandbox: { ...opts.sandbox, allow: [] } });`, to: `sandbox: opts.sandbox });` },
      { file: "src/lan/profile.ts", from: `if (path === "egress.allow") return [];`, to: `` }] },
  { name: "listeners", rule: "no test run of a peer's Task can listen (tools and checks run without local binding)", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `return sandboxScope.run({ noLocalBinding: true }, () => t.run(a));`, to: `return t.run(a);` },
      { file: "src/lan/profile.ts", from: `return sandboxScope.run({ noLocalBinding: true }, () => exec(x, man, ...rest));`, to: `return exec(x, man, ...rest);` }] },
  { name: "listeners-sandbox", rule: "the sandbox honours the no-local-binding scope", tests: [PROFILE],
    edits: [{ file: "src/runtime/checks.ts", from: `const localBinding = !!o.testRun && sandboxScope.getStore()?.noLocalBinding !== true;`, to: `const localBinding = !!o.testRun;` }] },
  { name: "network-check", rule: "a check that wants the network does not run", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `if (man?.network) return { verdict: "error"`, to: `if (false) return { verdict: "error"` }] },
  { name: "secret", rule: "a secret in a result blocks the send", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `hits: Hit[] = files.flatMap((f) => scanText(f.path, f.text, deny));`, to: `hits: Hit[] = [];` }] },
  { name: "html", rule: "received HTML is not executed", tests: [UI],
    edits: [{ file: "public/lan.js", from: `const pre = (text, attrs = {}) => h("pre", { class: "lan-pre", ...attrs }, text ?? "");`, to: `const pre = (text, attrs = {}) => { const e = h("pre", { class: "lan-pre", ...attrs }); e.innerHTML = text ?? ""; return e; };` }] },
  { name: "phone", rule: "phone sessions cannot approve", tests: [RELAY],
    edits: [{ file: "src/lan/routes.ts", from: `if (who.kind !== "desktop") return json(`, to: `if (false) return json(` },
      { file: "src/lan/routes.ts", from: `if (!pageCookie || req.headers.get("sec-fetch-site") !== "same-origin" || (writing && req.headers.get("origin") !== url.origin))`, to: `if (false)` },
      { file: "src/server.ts", from: `if (DESKTOP_ONLY.has(p) || p === "/api/lan" || p.startsWith("/api/lan/"))`, to: `if (DESKTOP_ONLY.has(p))` }] },
  { name: "briefing-hash", rule: "a briefing hash mismatch between dispatch and take is rejected", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `if (b.briefing !== r.briefing.hash) return "briefing hash mismatch: the take names a different briefing than this thread's";`, to: `` }] },
  { name: "workflow-hash", rule: "a workflow hash mismatch between take and result is flagged", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `flags.push("workflow-mismatch");`, to: `void 0;` }] },
  { name: "spend", rule: "the spend cap is enforced", tests: [PROFILE, RELAY],
    edits: [{ file: "src/lan/profile.ts", from: `if (over) { o.onStop?.(r, over); return Promise.reject(new RoundBlocked(over)); }`, to: `` }] },
  // ---------- the second review's findings ----------
  { name: "BL1-newtask", rule: "a peer's Task is never repeated as a new Task (its marks would be dropped)", tests: [PROFILE],
    edits: [{ file: "src/runtime/engine.ts", from: `if (a.choice === ACT.newTask || a.choice === ACT.repropose) for (const g of Object.values(this.followUpGuards))`, to: `if (false) for (const g of Object.values(this.followUpGuards))` }] },
  { name: "BL1-failclosed", rule: "a tainted-by-LAN Task without its mark is still held to the profile", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `if (!v) return tainted ? { item: "?", usd: 0, rounds: 0 } : null;`, to: `if (!v) return null;` }] },
  { name: "BL2-question", rule: "an untrusted Task's question never reaches Firstmate", tests: [PROFILE],
    edits: [{ file: "src/runtime/engine.ts", from: `firstmateBarred(r: Run): boolean { return !!r.params?._tainted; }`, to: `firstmateBarred(r: Run): boolean { return false; }` }] },
  { name: "BL2-status", rule: "Firstmate's status never shows a peer's Task title", tests: [PROFILE],
    edits: [{ file: "src/firstmate-turn.ts", from: `const titleOf = (r: any) => (fromPeer(r) ?`, to: `const titleOf = (r: any) => (false ?` }] },
  { name: "M3-log", rule: "Studio's event log keeps no text of a peer's Task", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `return emit(r && lanOf(r) ? {`, to: `return emit(false ? {` }] },
  { name: "BL3-symlink", rule: "the hand-back refuses a symbolic link", tests: [PROFILE],
    edits: [{ file: "src/lan/runner.ts", from: `if (st.isSymbolicLink()) return { refused: "a symbolic link" };`, to: `` }] },
  { name: "H1-failures", rule: "a failed introduction is counted and three close the window", tests: [PROFILE],
    edits: [{ file: "src/lan/wire.ts", from: `this.d.introFailed?.(ip, "its revealed nonce does not match its commitment");`, to: `` }] },
  { name: "H1-one", rule: "one introduction at a time", tests: [PROFILE],
    edits: [{ file: "src/lan/wire.ts", from: `if (this.xx.size >= 1) return this.refuse("another introduction is in progress", ip, 429);`, to: `` }] },
  { name: "H1-close", rule: "a successful introduction closes the window", tests: [PROFILE],
    edits: [{ file: "src/lan/relay.ts", from: `if (role === "responder") this.st.introUntil = null;`, to: `` }] },
  { name: "H2-case", rule: "protected paths match in any letter case", tests: [PROFILE],
    edits: [{ file: "src/lan/paths.ts", from: `.replace(/\\/{2,}/g, "/").toLowerCase();`, to: `.replace(/\\/{2,}/g, "/");` }] },
  { name: "H2-write", rule: "a round from a peer cannot write a protected path", tests: [PROFILE, RELAY],
    edits: [{ file: "src/lan/profile.ts", from: `if (writes && writeRefused(String(a?.path ?? "")))`, to: `if (false)` }] },
  { name: "H2-branch", rule: "a peer's Task works on a lan-untrusted/ branch", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `if (path === "branch_prefix") return "lan-untrusted/";`, to: `` }] },
  { name: "H2-apply", rule: "the dispatcher's patch check refuses protected paths", tests: [PROFILE],
    edits: [{ file: "src/lan/apply.ts", from: `else if (writeRefused(p)) problems.push`, to: `else if (false) problems.push` }] },
  { name: "H3-page", rule: "/api/lan answers only Studio's own page", tests: [RELAY],
    edits: [{ file: "src/lan/routes.ts", from: `if (!pageCookie || req.headers.get("sec-fetch-site") !== "same-origin" || (writing && req.headers.get("origin") !== url.origin))`, to: `if (false)` }] },
  { name: "H3-seen", rule: "an approval must name the exact prompt read to its end", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `if (o.seen !== this.seenHash(t, r)) throw`, to: `if (false) throw` }] },
  { name: "H4-base64", rule: "the scan decodes base64", tests: [PROFILE],
    edits: [{ file: "src/lan/scan.ts", from: `add(line, "a credential in base64"); break;`, to: `break;` }] },
  { name: "H4-literals", rule: "the scan joins string literals across lines", tests: [PROFILE],
    edits: [{ file: "src/lan/scan.ts", from: `add(lineOf(text, lits[i].index!), "a credential split across string literals");`, to: `` }] },
  { name: "H4-keyfile", rule: "the scan knows Studio's key file", tests: [PROFILE],
    edits: [{ file: "src/lan/scan.ts", from: `add(lineOf(text, m.index!), "a Studio key file");`, to: `` }] },
  { name: "H4-entropy", rule: "the scan flags long random strings", tests: [PROFILE],
    edits: [{ file: "src/lan/scan.ts", from: `add(line, "a long random-looking string (a key or token?)");`, to: `` }] },
  { name: "M1-reserve", rule: "rounds are reserved before admission", tests: [PROFILE],
    edits: [{ file: "src/lan/profile.ts", from: `reserved.set(r.id, (reserved.get(r.id) ?? 0) + 1);`, to: `` }] },
  { name: "M1-unknown", rule: "an unreported cost stops the next paid round under a dollar cap", tests: [PROFILE, RELAY],
    edits: [{ file: "src/lan/profile.ts", from: `if (mark.usd !== null && s.unknown) return`, to: `if (false) return` }] },
  { name: "M2-frozen-first", rule: "a frozen author's entries are refused before they are stored", tests: [PROFILE],
    edits: [{ file: "src/lan/relay.ts", from: `if (p.frozen) return later("this author is frozen (a fork) until a person resolves it");`, to: `` }] },
  { name: "M2-transient", rule: "a transient refusal is not kept as the entry's verdict", tests: [PROFILE],
    edits: [{ file: "src/lan/relay.ts", from: `if (!d.transient) this.st.verdicts[h] = d.why ?? "ok";`, to: `this.st.verdicts[h] = d.why ?? "ok";` }] },
  { name: "L-nan", rule: "a request time that is not a date is refused", tests: [CRYPTO],
    edits: [{ file: "src/lan/wire.ts", from: `!Number.isFinite(ts) || Math.abs(ts - now) > SKEW_MS`, to: `Math.abs(ts - now) > SKEW_MS` }] },
  { name: "L-replay", rule: "the replay cache survives a restart", tests: [CRYPTO],
    edits: [{ file: "src/lan/wire.ts", from: `try { this.d.replay?.save(Object.fromEntries(this.seenE)); } catch {}`, to: `` }] },
  { name: "L-inflight", rule: "requests in flight are capped", tests: [CRYPTO],
    edits: [{ file: "src/lan/wire.ts", from: `if (this.inFlight >= MAX_IN_FLIGHT) return`, to: `if (false) return` }] },
  { name: "L-ratemap", rule: "the rate table is bounded", tests: [CRYPTO],
    edits: [{ file: "src/lan/wire.ts", from: `if (this.rate.size >= RATE.addresses) return true;`, to: `` }] },
  { name: "L-gateway", rule: "the gateway is never a peer", tests: [CRYPTO],
    edits: [{ file: "src/lan/wire.ts", from: `if (gateways().includes(host)) return`, to: `if (false) return` }] },
  { name: "L-unpair", rule: "unpair keeps a freeze", tests: [PROFILE],
    edits: [{ file: "src/lan/relay.ts", from: `p.state = how === "revoke" ? "revoked" : "unpaired";`, to: `if (how === "revoke") p.state = "revoked"; else this.st.peers = this.st.peers.filter((x) => x.key !== key);` }] },
  { name: "L-revoke-result", rule: "revoking a result deletes its content", tests: [RELAY],
    edits: [{ file: "src/lan/relay.ts", from: `if (tb?.kind === "result") { this.dropBlob(tb.output.hash);`, to: `if (false) { this.dropBlob(tb.output.hash);` }] },
  { name: "L-identity", rule: "a broken identity file stops Studio instead of minting a new key", tests: [PROFILE],
    edits: [{ file: "src/lan/identity.ts", from: "catch { throw new Error(`the LAN identity file", to: "catch { return null; throw new Error(`the LAN identity file" }] },
  { name: "keychain-default", rule: "the Keychain is never used without CREW_KEYSTORE=keychain", tests: [PROFILE],
    edits: [{ file: "src/lan/identity.ts", from: `if (process.env.CREW_KEYSTORE !== "keychain") return false;`, to: `` }] },
  // ---------- the third review: applying a peer's patch ----------
  { name: "R3-gitpaths", rule: "git, not a regex, names the paths a patch touches (a quoted header cannot hide one)", tests: [PROFILE],
    edits: [{ file: "src/lan/apply.ts", from: `for (const p of named) { if (p === undefined) continue; paths.push(p); }`, to: "for (const p of named.filter((x) => patch.includes(`diff --git a/${x} `))) { if (p === undefined) continue; paths.push(p); }" }] },
  { name: "R3-modes", rule: "a new executable file or a mode change is refused", tests: [PROFILE],
    edits: [{ file: "src/lan/apply.ts", from: `if (c && c[1] !== "100644") problems.push`, to: `if (c && ["120000", "160000"].includes(c[1])) problems.push` },
      { file: "src/lan/apply.ts", from: `if (ch) problems.push`, to: `if (false) problems.push` },
      { file: "src/lan/apply.ts", from: `if (mm && mm[2] !== "100644"`, to: `if (false && mm` }] },
  { name: "R3-binary", rule: "a binary hunk is refused", tests: [PROFILE],
    edits: [{ file: "src/lan/apply.ts", from: "if (/^GIT binary patch$/m.test(patch) || /^Binary files .* differ$/m.test(patch) || /^literal \\d+$|^delta \\d+$/m.test(patch)) problems.push", to: "if (false) problems.push" },
      { file: "src/lan/apply.ts", from: `if (m[1] === "-" || m[2] === "-") problems.push`, to: `if (false) problems.push` }] },
  { name: "R3-filters", rule: "applying runs no clean or smudge filter (no checkout, no working tree)", tests: [PROFILE],
    edits: [{ file: "src/lan/apply.ts", from: `must(["read-tree", baseCommit.out.trim()]);`, to: "must([\"read-tree\", baseCommit.out.trim()]); must([\"checkout-index\", \"-a\", \"-f\", `--prefix=${tmp}/wt/`]);" }] },
  { name: "R3-outside", rule: "a path outside the project (renames and copies included) is refused", tests: [PROFILE],
    edits: [{ file: "src/lan/apply.ts", from: `if (outside(p)) problems.push`, to: `if (false) problems.push` }] },
  { name: "R3-depth", rule: "protected paths match at any depth", tests: [PROFILE],
    edits: [{ file: "src/lan/paths.ts", from: "new RegExp(`(^|/)${e.slice(0, -1)", to: "new RegExp(`^${e.slice(0, -1)" },
      { file: "src/lan/paths.ts", from: ": new RegExp(`(^|/)${e}$`)", to: ": new RegExp(`^${e}$`)" }] },
  { name: "R3-lockfiles", rule: "lockfiles are protected", tests: [PROFILE],
    edits: [{ file: "src/lan/paths.ts", from: `"package-lock\\\\.json", `, to: `` }] },
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
