// Board-to-board work between two real machines on one network (docs/units/lan-relay.md), walked through by hand:
//
//   on the Mac that takes the work:      bun scripts/lan-two-machine.ts take
//   on the machine that dispatches it:   bun scripts/lan-two-machine.ts dispatch --to <the Mac's LAN IP>
//
//   options: --port <board port, 4310>  --peer-port <this side's listener, 7417>  --to-port <the Mac's listener, 7417>
//            --bind <this machine's LAN IP>
//            --data <data folder, ~/crew-lan-trial>  --provider <codex>  --rounds <6>  --name <this board's name>
//
// Each side starts its own Studio with its own data folder and board port, so the live board is never touched, and
// drives it through the same routes the Peers page uses. The two people compare the short codes and type the other
// screen's code themselves; the script never reads the other machine's screen. Only a Mac takes work (the peer's Task
// runs under macOS Seatbelt); a Windows or Linux machine can only dispatch, with a file keystore (its identity is a file
// any local program of that user can read).
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sessionCookieName } from "../src/csrf";

const REPO = resolve(import.meta.dir, "..");
const args = process.argv.slice(2), role = args[0];
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i > 0 && args[i + 1] ? args[i + 1] : d; };
if (role !== "take" && role !== "dispatch") { console.error("usage: bun scripts/lan-two-machine.ts take | dispatch --to <the Mac's LAN IP> [--port 4310] [--peer-port 7417] [--bind <ip>] [--data <dir>]"); process.exit(2); }
if (role === "take" && process.platform !== "darwin") { console.error("only a Mac takes work from a peer (the Task runs under macOS Seatbelt); run `dispatch` on this machine"); process.exit(2); }
const PORT = Number(opt("port", "4310")), PEER_PORT = Number(opt("peer-port", "7417")), BIND = opt("bind", ""), DATA = resolve(opt("data", join(homedir(), "crew-lan-trial")));
const TO_PORT = Number(opt("to-port", "7417")), PROVIDER = opt("provider", "codex"), ROUNDS = Number(opt("rounds", "6")), TO = opt("to", ""), NAME = opt("name", role === "take" ? "Mac" : "Desktop");
if (role === "dispatch" && !TO) { console.error("dispatch needs --to <the Mac's LAN IP> (the take side prints it)"); process.exit(2); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => console.log(s);
const ask = (q: string) => (prompt(`\n${q}`) ?? "").trim();
const seenOf = (p: string) => createHash("sha256").update(`lan-seen\0${p ?? ""}`).digest("hex");

// ---------- this machine's own Studio ----------
const TOKEN = randomBytes(24).toString("hex"), BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(DATA, { recursive: true });
const logFile = join(DATA, `studio-${new Date().toISOString().replace(/[:.]/g, "-")}.log`), log = createWriteStream(logFile);
const env: Record<string, string> = { ...(process.env as Record<string, string>), CREW_DATA: DATA, CREW_PORT: String(PORT), CREW_SESSION_TOKEN: TOKEN,
  CREW_LAN_PEER_PORT: String(PEER_PORT), CREW_LAN_MDNS: "0", CREW_GH: "0", CREW_APP_WINDOW: "0" };
if (BIND) env.CREW_LAN_BIND = BIND;
const studio = spawn(process.execPath, ["src/main.ts"], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
studio.stdout.pipe(log); studio.stderr.pipe(log);
let exited = false; studio.on("exit", (c) => { exited = true; say(`\nStudio exited (${c}); its log: ${logFile}`); });
const stop = () => { if (!exited) studio.kill("SIGTERM"); };
process.on("SIGINT", () => { stop(); process.exit(130); });

async function api(path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", cookie: `${sessionCookieName(TOKEN)}=${TOKEN}`, "sec-fetch-site": "same-origin", ...(body === undefined ? {} : { origin: BASE }) };
  const r = await fetch(BASE + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let b: any; try { b = JSON.parse(t); } catch { b = { raw: t.slice(0, 500) }; }
  return { status: r.status, body: b };
}
async function must(path: string, body: unknown, what: string) {
  const r = await api(path, body); if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`); return r.body;
}
async function until<T>(what: string, f: () => Promise<T | null | undefined | false>, ms: number): Promise<T> {
  const t0 = Date.now(); let last: unknown = null;
  while (Date.now() - t0 < ms) { if (exited) throw new Error(`Studio exited while waiting for ${what}`); try { const v = await f(); if (v) return v as T; } catch (e) { last = e; } await sleep(500); }
  throw new Error(`timed out waiting for ${what}${last ? `: ${(last as any)?.message ?? last}` : ""}`);
}
const view = () => must("/api/lan", undefined, "read the Peers page");
const openItem = (kind: string, thread?: string) => until(`a ${kind} in the inbox`, async () => (await view()).items.find((i: any) => i.kind === kind && i.state === "open" && (!thread || i.thread === thread)), 60 * 60_000);

async function boot() {
  say(`starting Studio on ${BASE} (data ${DATA}, log ${logFile})`);
  await until("Studio to answer", async () => (await api("/api/lan")).status === 200, 120_000);
  say(`board (open it to watch): ${BASE}/session?t=${TOKEN}`);
  const v0 = (await api("/api/lan")).body;
  if (v0.off) { say(`turning board-to-board work on${process.platform === "darwin" ? " (a Mac builds its Secure Enclave helper the first time)" : ""}…`); await must("/api/lan/enable", {}, "turn board-to-board work on"); }
  await until("the relay to open", async () => { const v = await api("/api/lan"); return v.status === 200 && !v.body?.off; }, 300_000);
  await must("/api/lan/settings", { enabled: true, name: NAME }, "turn the peer listener on");
  const v = await view();
  say(`this board: ${v.me.name} · fingerprint ${v.me.fingerprint} · identity in ${v.me.store}${v.me.warning ? ` (${v.me.warning.en})` : ""}`);
  say(`peer listener: ${v.listening ? `${v.host}:${PEER_PORT}` : "NOT listening"}`);
  if (!v.listening) throw new Error("the peer listener did not start; pass --bind <this machine's LAN IP>");
  return v;
}

/** the code each side shows, typed on the other side; null when the person gives up */
function typeCode(other: string) {
  for (let n = 0; n < 3; n++) { const c = ask(`type the short code ${other}'s screen shows (from the other machine, not this one):`); if (c) return c; }
  return null;
}

// ---------- the Mac that takes the work ----------
async function take() {
  const me = await boot();
  await must("/api/lan/intro/open", { minutes: 10 }, "open the introduction window");
  say(`\nintroduction window open for 10 minutes. On the other machine run:\n  bun scripts/lan-two-machine.ts dispatch --to ${me.host}${PEER_PORT !== 7417 ? ` --to-port ${PEER_PORT}` : ""}`);
  say("(if it cannot connect: allow incoming TCP on that port in this Mac's firewall and the other machine's)");
  const intro = await until("the other machine to introduce itself", async () => (await view()).intros[0], 10 * 60_000);
  say(`\n${intro.claimed ?? "a board"} introduced itself. This screen's short code: ${intro.sas}`);
  const code = typeCode(intro.claimed ?? "the other machine"); if (!code) throw new Error("no code typed");
  say("confirming (Touch ID or your password signs the introduction)…");
  await must(`/api/lan/intro/${intro.id}/confirm`, { code, petname: intro.claimed || "Desktop" }, "confirm the introduction");
  await must("/api/lan/intro/close", {}, "close the introduction window");
  say(`introduced: ${intro.claimed} is on this board's allowlist\n\nwaiting for work from it…`);

  const d = await openItem("dispatch");
  say(`\n— work from ${d.from.name} (${d.from.short}): ${d.title ?? ""}\n${d.briefing}\n\n— the exact prompt the agent gets:\n${d.prompt}`);
  const wf = (await must("/api/lan/workflows", undefined, "list workflows")).workflows.find((w: any) => w.id === (d.suggested?.id ?? "documents"));
  if (!wf?.eligible) throw new Error(`workflow ${d.suggested?.id ?? "documents"} cannot be taken here: ${JSON.stringify(wf?.why ?? wf)}`);
  if (!/^y/i.test(ask(`take it with ${wf.id}@v${wf.version} on ${PROVIDER}, capped at ${ROUNDS} agent rounds? [y/N]`))) throw new Error("not taken");
  await must(`/api/lan/items/${d.id}/approve`, { seen: seenOf(d.prompt), workflow: wf.id, provider: PROVIDER, roundsOnly: true, rounds: ROUNDS }, "take it");
  say("taken; waiting for the other machine to assign it…");
  const a = await openItem("assign", d.thread);
  const started = await must(`/api/lan/items/${a.id}/approve`, {}, "start the Task");
  const run = started.rounds.at(-1).run.id;
  say(`Task ${run} running under the restricted profile (watch it on the board)…`);
  const answered = new Set<string>();
  const end = await until("the Task to end", async () => {
    const v = (await api(`/api/wruns/${run}`)).body;
    for (const c of (v.cards ?? []).filter((c: any) => c.status === "open" && !answered.has(c.id))) {
      answered.add(c.id);
      if (c.node === "accept") { say(`acceptance card: approving the draft (${c.title?.en ?? c.title ?? c.id})`); await api(`/api/scards/${encodeURIComponent(c.id)}/answer`, { choice: "approve-draft", note: null, confirm: c.confirmDoor && c.door === "one-way" ? "one-way" : null, aligned: c.detail?.intents?.length ? c.detail.intents.map((_: unknown, n: number) => n) : undefined }); }
      else say(`a card needs you on the board: ${c.node} · ${c.title?.en ?? c.title ?? c.id}`);
    }
    return ["succeeded", "failed", "cancelled", "stopped"].includes(v.status) ? v : null;
  }, 60 * 60_000);
  say(`Task ended: ${end.status}${end.result ? ` / ${end.result}` : ""}`);
  if (end.status !== "succeeded") throw new Error(`the Task did not succeed: ${JSON.stringify((end.steps ?? []).map((s: any) => `${s.node}:${s.state}${s.error ? `(${String(s.error).slice(0, 200)})` : ""}`))}`);
  const pre = await must(`/api/lan/threads/${d.thread}/handback/preview`, {}, "preview the hand-back");
  say(`\n— what goes back (${pre.files.length} file(s), ${pre.bytes} bytes):`); for (const f of pre.files) say(`  ${f.path}`);
  if (!pre.ok) throw new Error(`the hand-back gate stopped it: ${JSON.stringify({ secrets: pre.secrets, protected: pre.protectedPaths, binary: pre.binary })}`);
  if (!/^y/i.test(ask("hand it back? [y/N]"))) throw new Error("not handed back");
  await must(`/api/lan/threads/${d.thread}/handback`, { confirm: pre.hash }, "hand it back");
  say("handed back; waiting for the other machine to close it…");
  const dn = await openItem("done", d.thread);
  await must(`/api/lan/items/${dn.id}/approve`, {}, "acknowledge done");
  return d.thread as string;
}

// ---------- the machine that dispatches ----------
async function dispatch() {
  await boot();
  say(`\nintroducing this board to ${TO}:${TO_PORT}…`);
  const ia = await must("/api/lan/intro/start", { host: TO, port: TO_PORT }, "introduce this board to the Mac");
  say(`This screen's short code: ${ia.sas}`);
  const code = typeCode("the Mac"); if (!code) throw new Error("no code typed");
  await must(`/api/lan/intro/${ia.id}/confirm`, { code, petname: "Mac" }, "confirm the introduction");
  const peer = await until("the Mac on this board's allowlist", async () => (await view()).peers.find((p: any) => p.state === "trusted" && p.host === TO), 120_000);
  say(`introduced: the Mac (${peer.fp}) is on this board's allowlist`);
  const title = ask("title of the work [A one-page onboarding checklist]:") || "A one-page onboarding checklist";
  const briefing = ask("briefing [Write notes.md: a one-page checklist for a new teammate's first week (accounts, access, first tasks).]:") || "Write notes.md: a one-page checklist for a new teammate's first week (accounts, access, first tasks).";
  const t = await must("/api/lan/dispatch", { to: peer.key, title, briefing, acceptance: ["one page at most"], workflow: "documents" }, "dispatch");
  say(`dispatched thread ${t.id}; waiting for the Mac to take it…`);
  const k = await openItem("take", t.id);
  say(`the Mac takes it with ${k.workflow ?? "its workflow"}, cap ${k.rounds ?? k.cap ?? "?"} rounds`);
  await must(`/api/lan/items/${k.id}/approve`, {}, "assign it");
  say("assigned; the Mac runs it (this can take several minutes)…");
  const r = await openItem("result", t.id);
  say(`\n— the result from ${r.from.name}:`); for (const f of r.files ?? []) say(`\n## ${f.path}\n${f.text ?? "(not text)"}`);
  if (r.used) say(`\nthe Mac reports it used: ${JSON.stringify(r.used)} (its own report)`);
  if (!/^y/i.test(ask("accept the result and close the work? [y/N]"))) throw new Error("result not accepted");
  await must(`/api/lan/items/${r.id}/approve`, {}, "accept the result");
  await must(`/api/lan/threads/${t.id}/done`, {}, "mark it done");
  return t.id as string;
}

try {
  const thread = role === "take" ? await take() : await dispatch();
  const th = await must(`/api/lan/threads/${thread}`, undefined, "read the thread");
  say("\nthe relay track:"); for (const s of th.steps ?? []) say(`  ${new Date(s.at).toLocaleString("sv-SE")}  r${s.round}  ${String(s.kind).padEnd(8)} ${s.who?.name ?? ""} ${String(s.who?.fp ?? "").slice(0, 11)}`);
  say(`\ndone. Studio keeps running for a look at the board (${BASE}/session?t=${TOKEN}); press Enter to stop it.`);
  ask("");
} catch (e: any) {
  say(`\nFAILED: ${e?.message ?? e}\nStudio's log: ${logFile}`); process.exitCode = 1;
} finally { stop(); }
