// What work from peers spent on this Mac, per local day (docs/units/lan-relay.md, Spend): the daily ceilings read this,
// never a sum over the Tasks Studio still lists (a Task archived or purged would take its spend with it). Its own store,
// lan/spend.db, opened when Studio starts whatever the relay does (an identity lost, CREW_LAN=0 with peer Tasks still
// resuming); a store that cannot be read refuses every paid round of a peer's Task (fail closed).
//   days    per local day: paid rounds admitted, dollars (reported, or the estimate while a round runs or when its
//           provider reported none), and how many rounds' dollars are unknown
//   rates   per provider/model: rounds that reported a cost, and their dollars (the estimate a running round reserves)
//   settings the captain's daily ceilings (here, not in the relay's sealed state: they hold while the relay is not open)
// A ledger that was deleted or restored from an older copy is broken, not a fresh day: its sentinel (lan/spend.created)
// says it was made and how many rounds it ever counted (src/lan/sentinel.ts).
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkHeld, checkNotMissing, Sentinel } from "./sentinel";

/** the day a round counts on: this Mac's local date (the ceilings reset at local midnight) */
export function localDay(d = new Date()) { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
export type DaySpend = { rounds: number; usd: number; unknown: number };

export class SpendLedger {
  private db: Database | null = null;
  readonly broken: string | null = null;
  /** a file path, or ":memory:" (an engine without Studio's data folder: tests) */
  private readonly sentinel: Sentinel | null;
  constructor(readonly path: string) {
    this.sentinel = path === ":memory:" ? null : new Sentinel(join(dirname(path), "spend.created"));
    try {
      if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (this.sentinel) checkNotMissing(this.sentinel, existsSync(path), `what work from peers spent (${path})`);
      const db = new Database(path, { create: true, readwrite: true });
      try {
        if (path !== ":memory:") { db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA synchronous = FULL"); db.exec("PRAGMA busy_timeout = 5000"); }
        db.exec("CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, rounds INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0)");
        db.exec("CREATE TABLE IF NOT EXISTS rates (pm TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0)");
        db.exec("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
        if (this.sentinel) checkHeld(this.sentinel, Number((db.query("SELECT coalesce(sum(rounds), 0) AS n FROM days").get() as any).n), `what work from peers spent (${path})`);
      } catch (e) { db.close(); throw e; }
      if (path !== ":memory:") for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) try { chmodSync(f, 0o600); } catch {}
      this.db = db;
    } catch (e: any) { const m = String(e?.message ?? e); this.broken = m.startsWith("what work from peers spent") ? m.slice(0, 400) : `what work from peers spent today (${path}) cannot be read: ${m.slice(0, 200)}`; }
  }
  private live(): Database { if (!this.db) throw new Error(this.broken ?? "the spend ledger is closed"); return this.db; }
  get(day = localDay()): DaySpend {
    const r = this.live().query("SELECT rounds, usd, unknown FROM days WHERE day = ?").get(day) as any;
    return { rounds: Number(r?.rounds ?? 0), usd: Number(r?.usd ?? 0), unknown: Number(r?.unknown ?? 0) };
  }
  private add(day: string, d: Partial<DaySpend>) {
    this.live().query("INSERT INTO days (day, rounds, usd, unknown) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET rounds = rounds + excluded.rounds, usd = usd + excluded.usd, unknown = unknown + excluded.unknown")
      .run(day, d.rounds ?? 0, d.usd ?? 0, d.unknown ?? 0);
  }
  /** what a round of this provider/model costs here, on average over the rounds that reported one; `fallback` (the
   *  ceiling's unknown-round estimate) when none did */
  estimate(pm: string | null, fallback: number): number {
    if (!pm) return fallback;
    const exact = this.live().query("SELECT n, usd FROM rates WHERE pm = ?").get(pm) as any;
    const r = exact?.n ? exact : this.live().query("SELECT sum(n) AS n, sum(usd) AS usd FROM rates WHERE pm LIKE ? ESCAPE '\\'").get(`${pm.split("/")[0].replace(/[\\%_]/g, (c) => `\\${c}`)}/%`) as any;
    return r?.n ? Number(r.usd) / Number(r.n) : fallback;
  }
  /** a round admitted: it counts now, its dollars reserved at the estimate until it ends */
  admit(day: string, reserved: number) {
    this.add(day, { rounds: 1, usd: reserved });
    this.sentinel?.raise(Number((this.live().query("SELECT coalesce(sum(rounds), 0) AS n FROM days").get() as any).n));
  }
  /** the captain's daily ceilings, or null when none were set here */
  ceilings(): { dailyUsd: number | null; dailyRounds: number; unknownRoundUsd: number } | null {
    const r = this.live().query("SELECT v FROM settings WHERE k = 'ceilings'").get() as any; return r ? JSON.parse(r.v) : null;
  }
  setCeilings(c: { dailyUsd: number | null; dailyRounds: number; unknownRoundUsd: number }) {
    this.live().query("INSERT INTO settings (k, v) VALUES ('ceilings', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(c));
  }
  /** a round ended: its reported dollars replace the reservation; with none reported the reservation stays and it is unknown */
  settle(day: string, reserved: number, usd: number | null, pm: string | null) {
    const db = this.live();
    db.transaction(() => {
      if (usd === null) this.add(day, { unknown: 1 });
      else { this.add(day, { usd: usd - reserved }); if (pm) db.query("INSERT INTO rates (pm, n, usd) VALUES (?, 1, ?) ON CONFLICT(pm) DO UPDATE SET n = n + 1, usd = usd + excluded.usd").run(pm, usd); }
    })();
  }
  close() { try { this.db?.close(); } catch {} this.db = null; }
}
/** Studio's start: this data folder's spend ledger, open whatever the relay does */
export const openSpendLedger = (dataDir: string) => new SpendLedger(join(dataDir, "lan", "spend.db"));
