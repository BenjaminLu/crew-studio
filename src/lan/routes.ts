// Studio's own routes for board-to-board work (docs/units/lan-relay.md), on the main port only, behind Studio's session and
// write guard like every /api route. Every one of them, reads included, is for Studio's own page on this Mac, as the web
// terminals are: its session cookie, a browser that says the request is same-origin (Sec-Fetch-Site), and on a write an
// Origin equal to Studio's own. A script's x-crew-session is not enough, and a paired phone is refused (it cannot see a
// peer's content, approve an item, introduce a key or hand a result back). Not a boundary against a local process of this
// user (it can read data/session-token); it keeps scripts and other sites off. The peer listener (src/lan/wire.ts) has
// nothing to do with these routes.
import { Lan, LanError } from "./relay";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const KEY = "[A-Za-z0-9_-]{87}", ID = "[A-Za-z0-9_-]{8,64}";
const KINDS = ["file", "enclave"];

export async function lanRoutes(lan: Lan | null, req: Request, url: URL, who: { kind: string }, writing: boolean, pageCookie: boolean, opening = false): Promise<Response | null> {
  const p = url.pathname; if (p !== "/api/lan" && !p.startsWith("/api/lan/")) return null;
  if (who.kind !== "desktop") return json({ error: "board-to-board work is on the Mac only / 區網協作只能在這台 Mac 上操作", code: "desktopOnly" }, 403);
  if (!pageCookie || req.headers.get("sec-fetch-site") !== "same-origin" || (writing && req.headers.get("origin") !== url.origin))
    return json({ error: "board-to-board work answers only Studio's own page on this Mac (its session cookie, same origin); a script's x-crew-session is not enough / 區網協作只接受這台 Mac 上 Studio 自己的頁面", code: "pageOnly" }, 403);
  // commits from peers stay on the taint list meanwhile: marking one reviewed needs the relay (its signature and audit)
  const held = "commits from peers stay on the taint list and cannot be marked reviewed until it is open / 來自同事的 commit 仍在不受信任清單上，要等它開啟後才能標為已審查";
  if (!lan && opening) return json({ error: `board-to-board work is starting (a first start builds this Mac's Secure Enclave helper): ${held} / 區網協作啟動中`, code: "starting" }, 503);
  if (!lan) return json({ error: `board-to-board work is not available in this Studio: ${held}`, code: "off" }, 404);
  let b: any = {}; if (writing) { try { b = await req.json(); } catch { return json({ error: "json only" }, 400); } if (!b || typeof b !== "object") b = {}; }
  const m = (re: string) => new RegExp(`^/api/lan/${re}$`).exec(p);
  try {
    if (!writing) {
      if (p === "/api/lan") return json(lan.view());
      if (p === "/api/lan/workflows") return json({ workflows: lan.workflows() });
      if (p === "/api/lan/audit") return json(lan.auditView(Number(url.searchParams.get("limit")) || 200));
      let x = m(`items/(${ID})`); if (x) { const i = lan.itemById(x[1]); return i ? json(i) : json({ error: "no such item" }, 404); }
      x = m("entries/([0-9a-f]{64})"); if (x) return json(lan.inspect(x[1]));
      x = m(`threads/(${ID})`); if (x) { const t = lan.thread(x[1]); return t ? json(lan.threadView(t)) : json({ error: "no such thread" }, 404); }
      return json({ error: "not found" }, 404);
    }
    if (req.method !== "POST") return json({ error: "POST" }, 405);
    if (p === "/api/lan/settings") { if (typeof b.name === "string") lan.rename(b.name); if (typeof b.enabled === "boolean") lan.setEnabled(b.enabled);
      if (b.ceilings && typeof b.ceilings === "object") lan.setCeilings({ dailyUsd: b.ceilings.dailyUsd, dailyRounds: b.ceilings.dailyRounds, unknownRoundUsd: b.ceilings.unknownRoundUsd }); return json(lan.view()); }
    if (p === "/api/lan/intro/open") return json(lan.openIntro(Number(b.minutes) || 5));
    if (p === "/api/lan/intro/close") return json(lan.closeIntro());
    if (p === "/api/lan/intro/start") return json(await lan.startIntro(String(b.host ?? ""), Number(b.port)));
    if (p === "/api/lan/sync") { await lan.flush(); return json(lan.view()); }
    // 作廢並換新身分 (an upgrade from files to the Secure Enclave is the same step), and a lost identity replaced
    if (p === "/api/lan/identity/retire") return json(await lan.retireIdentity({ kind: KINDS.includes(String(b.kind)) ? b.kind : undefined, biometry: b.biometry === true }));
    if (p === "/api/lan/identity/replace-lost") return json(await lan.replaceLostIdentity({ kind: KINDS.includes(String(b.kind)) ? b.kind : undefined }));
    if (p === "/api/lan/identity/drop-retired") return json(lan.dropRetirement(String(b.key ?? "")));
    if (p === "/api/lan/dispatch") return json(await lan.dispatch({ to: String(b.to ?? ""), title: b.title, briefing: b.briefing, acceptance: b.acceptance, workflow: b.workflow ? String(b.workflow) : null, project: b.project ? String(b.project) : null }));
    // "I reviewed commit X": a commit applied from a peer's work leaves the taint list
    if (p === "/api/lan/taint/clear") return json(await lan.clearTaint(b.sha));
    let x = m(`intro/(${ID})/(confirm|cancel)`);
    if (x) return json(x[2] === "confirm" ? await lan.confirmIntro(x[1], b.code, b.petname, { replaces: typeof b.replaces === "string" && new RegExp(`^${KEY}$`).test(b.replaces) ? b.replaces : null, keepName: b.keepName === true }) : lan.cancelIntro(x[1]));
    x = m(`peers/(${KEY})/(rename|unpair|revoke|resolve|address)`);
    if (x) { const k = x[1];
      if (x[2] === "rename") return json(lan.renamePeer(k, b.petname));
      if (x[2] === "address") return json(lan.setPeerAddress(k, String(b.host ?? ""), Number(b.port)));
      if (x[2] === "resolve") { if (b.action !== "revoke" && b.action !== "unfreeze") return json({ error: "action is revoke or unfreeze" }, 400); return json(lan.resolveFork(k, b.action)); }
      return json(lan.removePeer(k, x[2] as "unpair" | "revoke")); }
    x = m(`items/(${ID})/(approve|reject)`);
    if (x) return json(x[2] === "approve" ? await lan.approve(x[1], { workflow: b.workflow ? String(b.workflow) : undefined, usd: b.usd === undefined ? undefined : Number(b.usd), rounds: b.rounds === undefined ? undefined : Number(b.rounds), provider: b.provider ? String(b.provider) : null, staffingConfirm: b.staffingConfirm ? String(b.staffingConfirm) : null, project: b.project ? String(b.project) : null, seen: b.seen ? String(b.seen) : null, roundsOnly: b.roundsOnly === true, autoStart: b.autoStart === true }) : lan.reject(x[1], b.note));
    x = m(`threads/(${ID})/apply`); if (x) return json(lan.applyResult(x[1], { project: b.project, round: b.round, seen: b.seen }));
    x = m(`threads/(${ID})/stop`); if (x) return json(lan.stopRun(x[1]));
    x = m(`threads/(${ID})/(handback/preview|handback|refine|done|withdraw)`);
    if (x) { const id = x[1], edits = Array.isArray(b.edits) ? b.edits.slice(0, 60).map((e: any) => ({ path: String(e?.path ?? ""), text: e?.text === null ? null : String(e?.text ?? "") })) : undefined;
      if (x[2] === "handback/preview") return json(await lan.handbackPreview(id, edits));
      if (x[2] === "handback") return json(await lan.handback(id, { confirm: String(b.confirm ?? ""), edits }));
      if (x[2] === "refine") return json(await lan.refine(id, { briefing: b.briefing, note: b.note }));
      if (x[2] === "done") return json(await lan.done(id));
      return json(await lan.withdraw(id, b.reason)); }
    return json({ error: "not found" }, 404);
  } catch (e: any) {
    if (e instanceof LanError) return json({ error: e.message, code: e.code }, e.status);
    return json({ error: String(e?.message ?? e).slice(0, 500), code: "lan" }, 500);
  }
}
