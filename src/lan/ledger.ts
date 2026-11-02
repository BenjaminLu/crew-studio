// What work from peers used on this Mac, per local day (docs/units/lan-relay.md, Spend): the daily ceilings read this,
// never a sum over the Tasks Studio still lists (a Task archived or purged would take its use with it). Local providers
// run on subscriptions, so what is counted is the subscription's quota: rounds, agent-minutes and tokens; dollars are
// not counted (a CLI's dollar figure is notional, and Codex and Cursor report none). Its own store, lan/spend.db, opened
// when Studio starts whatever the relay does (an identity lost, CREW_LAN=0 with peer Tasks still resuming); a store that
// cannot be read refuses every round of a peer's Task (fail closed).
//   days     per local day: rounds admitted, agent-minutes (a running round at its 15-minute ceiling until it ends),
//            tokens (reported, or the estimate while a round runs or when its provider reported none), and how many
//            rounds reported no tokens
//   rates    per provider/model: rounds that reported tokens, and how many (the estimate a running round reserves)
//   settings the captain's daily ceilings, and the providers paused by their subscription limit (here, not in the
//            relay's sealed state: they hold while the relay is not open)
// A ledger that was deleted or restored from an older copy is broken, not a fresh day: its sentinel (lan/spend.created)
// says it was made and how many rounds it ever counted (src/lan/sentinel.ts).
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkHeld, checkNotMissing, Sentinel } from "./sentinel";

/** the day a round counts on: this Mac's local date (the ceilings reset at local midnight) */
export function localDay(d = new Date()) { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
export type DayUse = { rounds: number; minutes: number; tokens: number; unknown: number };
export type StoredCeilings = { dailyRounds: number; dailyMinutes: number | null; dailyTokens: number | null; unknownRoundTokens: number };
export type Paused = { provider: string; at: string; why: string; task: string | null };

export class SpendLedger {
  private db: Database | null = null;
  readonly broken: string | null = null;
  private readonly sentinel: Sentinel | null;
  /** a file path, or ":memory:" (an engine without Studio's data folder: tests) */
  constructor(readonly path: string) {
    this.sentinel = path === ":memory:" ? null : new Sentinel(join(dirname(path), "spend.created"));
    try {
      if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (this.sentinel) checkNotMissing(this.sentinel, existsSync(path), `what work from peers used (${path})`);
      const db = new Database(path, { create: true, readwrite: true });
      try {
        if (path !== ":memory:") { db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA synchronous = FULL"); db.exec("PRAGMA busy_timeout = 5000"); }
        db.exec("CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, rounds INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0)");
        db.exec("CREATE TABLE IF NOT EXISTS rates (pm TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)");
        db.exec("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
        // columns a ledger made before tokens and minutes were counted lacks
        const cols = (t: string) => new Set((db.query(`PRAGMA table_info(${t})`).all() as any[]).map((c) => String(c.name)));
        const dc = cols("days"), rc = cols("rates");
        if (!dc.has("minutes")) db.exec("ALTER TABLE days ADD COLUMN minutes REAL NOT NULL DEFAULT 0");
        if (!dc.has("tokens")) db.exec("ALTER TABLE days ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0");
        if (!rc.has("tokens")) db.exec("ALTER TABLE rates ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0");
        if (this.sentinel) checkHeld(this.sentinel, Number((db.query("SELECT coalesce(sum(rounds), 0) AS n FROM days").get() as any).n), `what work from peers used (${path})`);
      } catch (e) { db.close(); throw e; }
      if (path !== ":memory:") for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) try { chmodSync(f, 0o600); } catch {}
      this.db = db;
    } catch (e: any) { const m = String(e?.message ?? e); this.broken = m.startsWith("what work from peers used") ? m.slice(0, 400) : `what work from peers used today (${path}) cannot be read: ${m.slice(0, 200)}`; }
  }
  private live(): Database { if (!this.db) throw new Error(this.broken ?? "the spend ledger is closed"); return this.db; }
  get(day = localDay()): DayUse {
    const r = this.live().query("SELECT rounds, minutes, tokens, unknown FROM days WHERE day = ?").get(day) as any;
    return { rounds: Number(r?.rounds ?? 0), minutes: Number(r?.minutes ?? 0), tokens: Number(r?.tokens ?? 0), unknown: Number(r?.unknown ?? 0) };
  }
  private add(day: string, d: Partial<DayUse>) {
    this.live().query("INSERT INTO days (day, rounds, minutes, tokens, unknown) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET rounds = rounds + excluded.rounds, minutes = minutes + excluded.minutes, tokens = tokens + excluded.tokens, unknown = unknown + excluded.unknown")
      .run(day, d.rounds ?? 0, d.minutes ?? 0, Math.round(d.tokens ?? 0), d.unknown ?? 0);
  }
  /** the tokens a round of this provider/model uses here, on average over the rounds that reported them (the provider's
   *  average when this model has none); `fallback` when none did */
  estimate(pm: string | null, fallback: number): number {
    if (!pm) return fallback;
    const exact = this.live().query("SELECT n, tokens FROM rates WHERE pm = ?").get(pm) as any;
    const r = exact?.n ? exact : this.live().query("SELECT sum(n) AS n, sum(tokens) AS tokens FROM rates WHERE pm LIKE ? ESCAPE '\\'").get(`${pm.split("/")[0].replace(/[\\%_]/g, (c) => `\\${c}`)}/%`) as any;
    return r?.n ? Number(r.tokens) / Number(r.n) : fallback;
  }
  /** a round admitted: it counts now, its tokens and minutes reserved until it ends */
  admit(day: string, tokens: number, minutes: number) {
    this.add(day, { rounds: 1, tokens, minutes });
    this.sentinel?.raise(Number((this.live().query("SELECT coalesce(sum(rounds), 0) AS n FROM days").get() as any).n));
  }
  /** a round ended: its wall clock replaces the minutes reserved; its reported tokens replace the tokens reserved, and with
   *  none reported the reservation stays and it counts as unknown */
  settle(day: string, reserved: { tokens: number; minutes: number }, used: { tokens: number | null; minutes: number }, pm: string | null) {
    const db = this.live();
    db.transaction(() => {
      this.add(day, { minutes: used.minutes - reserved.minutes });
      if (used.tokens === null) this.add(day, { unknown: 1 });
      else { this.add(day, { tokens: used.tokens - reserved.tokens }); if (pm) db.query("INSERT INTO rates (pm, n, tokens) VALUES (?, 1, ?) ON CONFLICT(pm) DO UPDATE SET n = n + 1, tokens = tokens + excluded.tokens").run(pm, Math.round(used.tokens)); }
    })();
  }
  private setting<T>(k: string): T | null { const r = this.live().query("SELECT v FROM settings WHERE k = ?").get(k) as any; return r ? JSON.parse(r.v) : null; }
  private put(k: string, v: unknown) { this.live().query("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v)); }
  /** the captain's daily ceilings, or null when none were set here (a set from before tokens were counted is not used) */
  ceilings(): StoredCeilings | null { const c = this.setting<any>("ceilings"); return c && Number.isSafeInteger(c.dailyRounds) && "dailyTokens" in c ? c : null; }
  setCeilings(c: StoredCeilings) { this.put("ceilings", c); }
  /** providers paused by their subscription limit (peer work on them waits until the captain resumes it) */
  paused(): Paused[] { return this.setting<Paused[]>("paused") ?? []; }
  pause(provider: string, why: string, task: string | null) { const now = this.paused().filter((p) => p.provider !== provider); this.put("paused", [...now, { provider, at: new Date().toISOString(), why: String(why).slice(0, 300), task }]); }
  /** true when it was paused */
  resume(provider: string): boolean { const all = this.paused(), rest = all.filter((p) => p.provider !== provider); this.put("paused", rest); return rest.length !== all.length; }
  close() { try { this.db?.close(); } catch {} this.db = null; }
}
/** Studio's start: this data folder's spend ledger, open whatever the relay does */
export const openSpendLedger = (dataDir: string) => new SpendLedger(join(dataDir, "lan", "spend.db"));
