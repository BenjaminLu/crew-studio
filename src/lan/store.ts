// The relay's store (docs/units/lan-relay.md): one SQLite database in Studio's data folder (`lan/relay.db`, 0600, WAL,
// synchronous FULL), so what this Studio has signed, what it owes its peers and what it decided are written in one
// transaction, synced, before anything is sent. A crash can lose a step that was never sent; it can never send an entry
// whose sequence number a later start would sign again (peers would see a fork), nor forget that it claimed a run.
//   state      the relay's records (settings, own log head, peers, threads, items, outbox), one JSON row, sealed with
//              AES-256-GCM under a key derived from the daily key agreement key (src/lan/keystore.ts storageKey): its
//              titles and criteria are a peer's words. The row `meta` (identity, whether a log or peers exist) is clear,
//              so a missing identity is noticed before anything can be unsealed
//   entries    every signed entry this Studio holds (its own and its peers'), sealed as received; `used` keeps the ones
//              that started a run or were applied when the rest are pruned
//   blobs      sealed briefings and results; `used` as above
//   chain      each author's sequence numbers → entry hash (fork detection), with a per-author low-water mark in `marks`
//   verdicts   the decision on every received entry (an entry sent again keeps it)
//   audit      the hash-chained audit log: each row carries the hash of the one before; a write that fails stops the step
// Bodies are kept sealed (each to its recipients' keys); nothing here is plaintext of a peer's briefing or result.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { aeadOpen, aeadSeal, canonical, randomBytes, sha256hex } from "./crypto";

export type AuditRow = { n: number; at: string; what: string; data: Record<string, unknown>; prev: string; hash: string };

const GENESIS = "0".repeat(64);
const now = () => new Date().toISOString();

export class Store {
  readonly db: Database;
  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const fresh = !existsSync(file);
    this.db = new Database(file, { create: true, strict: true });
    if (fresh) try { chmodSync(file, 0o600); } catch {}
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entries (hash TEXT PRIMARY KEY, author TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, thread TEXT, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, body TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, thread TEXT, bytes INTEGER NOT NULL, peer TEXT, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chain (author TEXT NOT NULL, seq INTEGER NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (author, seq));
      CREATE TABLE IF NOT EXISTS marks (author TEXT PRIMARY KEY, low INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS verdicts (hash TEXT PRIMARY KEY, verdict TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (n INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, what TEXT NOT NULL, data TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS entries_thread ON entries(thread);
      CREATE INDEX IF NOT EXISTS blobs_thread ON blobs(thread);
    `);
  }
  close() { try { this.db.close(); } catch {} }
  /** One transaction: every write in `fn` lands together, synced, or none does. Nested calls join the outer one. */
  private depth = 0;
  tx<T>(fn: () => T): T {
    if (this.depth) return fn();
    this.depth++;
    try { return this.db.transaction(fn)(); } finally { this.depth--; }
  }

  // ---------- the relay's records ----------
  private seal: Buffer | null = null;
  /** the key the state row is sealed with (null: not open yet; nothing is written) */
  setSeal(key: Buffer | null) { this.seal = key; }
  /** the sealed state, opened; null when there is none; throws when it does not open (another identity's state) */
  getState<T>(): T | null {
    const r = this.db.query("SELECT v FROM state WHERE k = 'main'").get() as { v: string } | null; if (!r) return null;
    if (!r.v.startsWith("sealed:")) throw new Error("the relay's state is not sealed (an older version's): it is not read");
    if (!this.seal) throw new Error("the relay's state cannot be opened without this Studio's identity");
    const b = Buffer.from(r.v.slice(7), "base64"), p = aeadOpen(this.seal, b.subarray(0, 12), b.subarray(12), Buffer.from("crew-studio/lan/v2 state"));
    if (!p) throw new Error("the relay's state does not open with this Studio's identity");
    return JSON.parse(p.toString("utf8")) as T;
  }
  putState(v: unknown) {
    if (!this.seal) throw new Error("the relay's state is not written without this Studio's identity");
    const iv = randomBytes(12), ct = aeadSeal(this.seal, iv, Buffer.from(JSON.stringify(v)), Buffer.from("crew-studio/lan/v2 state"));
    this.db.query("INSERT INTO state (k, v) VALUES ('main', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run("sealed:" + Buffer.concat([iv, ct]).toString("base64"));
  }
  /** what is known without the identity: whose state this is, and whether it holds an own log or peers */
  getMeta(): { proto: 2; identity: string; log: boolean; peers: number } | null { const r = this.db.query("SELECT v FROM state WHERE k = 'meta'").get() as { v: string } | null; try { return r ? JSON.parse(r.v) : null; } catch { return null; } }
  putMeta(m: { proto: 2; identity: string; log: boolean; peers: number }) { this.db.query("INSERT INTO state (k, v) VALUES ('meta', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(m)); }
  hasState() { return !!this.db.query("SELECT 1 FROM state WHERE k = 'main'").get(); }

  // ---------- entries and blobs ----------
  putEntry(hash: string, author: string, seq: number, e: unknown, thread: string | null = null) {
    this.db.query("INSERT INTO entries (hash, author, seq, body, thread, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET thread = COALESCE(entries.thread, excluded.thread)").run(hash, author, seq, JSON.stringify(e), thread, now());
  }
  entry<T>(hash: string): T | null { if (!/^[0-9a-f]{64}$/.test(hash)) return null; const r = this.db.query("SELECT body FROM entries WHERE hash = ?").get(hash) as { body: string } | null; return r ? JSON.parse(r.body) as T : null; }
  entryCount(): number { return (this.db.query("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n; }
  putBlob(hash: string, b: unknown, o: { thread?: string | null; peer?: string | null; bytes: number }) {
    this.db.query("INSERT INTO blobs (hash, body, thread, bytes, peer, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(hash) DO NOTHING").run(hash, JSON.stringify(b), o.thread ?? null, o.bytes, o.peer ?? null, now());
  }
  blob<T>(hash: string): T | null { if (!/^[0-9a-f]{64}$/.test(hash)) return null; const r = this.db.query("SELECT body FROM blobs WHERE hash = ?").get(hash) as { body: string } | null; return r ? JSON.parse(r.body) as T : null; }
  hasBlob(hash: string) { return !!this.db.query("SELECT 1 FROM blobs WHERE hash = ?").get(hash); }
  /** content that started a run or was applied is kept sealed whatever happens to its thread or its peer */
  markUsed(hashes: string[]) { for (const h of hashes) { this.db.query("UPDATE entries SET used = 1 WHERE hash = ?").run(h); this.db.query("UPDATE blobs SET used = 1 WHERE hash = ?").run(h); } }
  isUsed(hash: string) { return !!this.db.query("SELECT 1 FROM blobs WHERE hash = ? AND used = 1 UNION SELECT 1 FROM entries WHERE hash = ? AND used = 1").get(hash, hash); }
  /** a blob nothing used (a withdrawn briefing, a revoked result): deleted; a used one is kept sealed */
  dropBlob(hash: string): boolean { return this.db.query("DELETE FROM blobs WHERE hash = ? AND used = 0").run(hash).changes > 0; }
  /** a pruned thread's entries and blobs, except what started a run or was applied, and except fork evidence */
  pruneThread(thread: string, keep: string[] = []) {
    const k = new Set(keep);
    for (const r of this.db.query("SELECT hash FROM entries WHERE thread = ? AND used = 0").all(thread) as { hash: string }[]) if (!k.has(r.hash)) this.db.query("DELETE FROM entries WHERE hash = ?").run(r.hash);
    this.db.query("DELETE FROM blobs WHERE thread = ? AND used = 0").run(thread);
  }
  /** what a peer's content takes on this disk (the per-peer quota) */
  peerBytes(peer: string): number { return (this.db.query("SELECT COALESCE(SUM(bytes), 0) AS n FROM blobs WHERE peer = ?").get(peer) as { n: number }).n; }

  // ---------- each author's chain ----------
  chainAt(author: string, seq: number): string | null { const r = this.db.query("SELECT hash FROM chain WHERE author = ? AND seq = ?").get(author, seq) as { hash: string } | null; return r?.hash ?? null; }
  setChain(author: string, seq: number, hash: string) { this.db.query("INSERT INTO chain (author, seq, hash) VALUES (?, ?, ?) ON CONFLICT(author, seq) DO NOTHING").run(author, seq, hash); }
  /** entries at or below an author's low-water mark were decided and trimmed: they are never applied again */
  lowWater(author: string): number { const r = this.db.query("SELECT low FROM marks WHERE author = ?").get(author) as { low: number } | null; return r?.low ?? 0; }
  /** keep the newest `keep` sequence numbers of an author's chain; the rest move under its low-water mark. Fork evidence
   *  (`keepHashes`) is never trimmed. */
  trimChain(author: string, keep: number, keepHashes: Set<string>) {
    const max = (this.db.query("SELECT MAX(seq) AS m FROM chain WHERE author = ?").get(author) as { m: number | null }).m ?? 0;
    const cut = max - keep; if (cut <= this.lowWater(author)) return;
    for (const r of this.db.query("SELECT seq, hash FROM chain WHERE author = ? AND seq <= ?").all(author, cut) as { seq: number; hash: string }[]) {
      if (keepHashes.has(r.hash)) continue;
      this.db.query("DELETE FROM chain WHERE author = ? AND seq = ?").run(author, r.seq);
    }
    this.db.query("INSERT INTO marks (author, low) VALUES (?, ?) ON CONFLICT(author) DO UPDATE SET low = MAX(low, excluded.low)").run(author, cut);
  }
  authors(): string[] { return (this.db.query("SELECT DISTINCT author FROM chain").all() as { author: string }[]).map((r) => r.author); }

  // ---------- verdicts ----------
  verdict(hash: string): string | null { const r = this.db.query("SELECT verdict FROM verdicts WHERE hash = ?").get(hash) as { verdict: string } | null; return r?.verdict ?? null; }
  setVerdict(hash: string, v: string) { this.db.query("INSERT INTO verdicts (hash, verdict, at) VALUES (?, ?, ?) ON CONFLICT(hash) DO NOTHING").run(hash, v, now()); }
  trimVerdicts(keep: number) { this.db.query("DELETE FROM verdicts WHERE rowid IN (SELECT rowid FROM verdicts ORDER BY rowid DESC LIMIT -1 OFFSET ?)").run(keep); }

  // ---------- the hash-chained audit ----------
  /** one audit row, chained to the one before; it throws when it cannot be written (the step it records does not happen) */
  audit(what: string, data: Record<string, unknown>): AuditRow {
    const last = this.db.query("SELECT hash FROM audit ORDER BY n DESC LIMIT 1").get() as { hash: string } | null;
    const at = now(), prev = last?.hash ?? this.anchor(), body = canonical(JSON.parse(JSON.stringify({ at, what, data })));
    const hash = sha256hex(`${prev}\0${body}`);
    const r = this.db.query("INSERT INTO audit (at, what, data, prev, hash) VALUES (?, ?, ?, ?, ?)").run(at, what, JSON.stringify(data), prev, hash);
    return { n: Number(r.lastInsertRowid), at, what, data, prev, hash };
  }
  /** the hash the chain starts from after a rotation (older rows moved out keep their last hash here) */
  private anchor(): string { const r = this.db.query("SELECT v FROM state WHERE k = 'audit-anchor'").get() as { v: string } | null; return r ? JSON.parse(r.v) : GENESIS; }
  auditRows(limit = 500): AuditRow[] { return (this.db.query("SELECT * FROM audit ORDER BY n DESC LIMIT ?").all(limit) as any[]).reverse().map((r) => ({ n: r.n, at: r.at, what: r.what, data: JSON.parse(r.data), prev: r.prev, hash: r.hash })); }
  /** every row's hash recomputed and joined to the one before: the first row that does not, or null */
  auditBreak(): number | null {
    let prev = this.anchor();
    for (const r of this.db.query("SELECT * FROM audit ORDER BY n").all() as any[]) {
      const body = canonical(JSON.parse(JSON.stringify({ at: r.at, what: r.what, data: JSON.parse(r.data) })));
      if (r.prev !== prev || sha256hex(`${prev}\0${body}`) !== r.hash) return r.n;
      prev = r.hash;
    }
    return null;
  }
  /** rotation: rows beyond the newest `keep` are moved to the returned list (the caller files them); the chain goes on
   *  from the last moved row's hash */
  rotateAudit(keep: number, sink?: (rows: AuditRow[]) => void): AuditRow[] {
    const total = (this.db.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n; if (total <= keep) return [];
    const old = (this.db.query("SELECT * FROM audit ORDER BY n LIMIT ?").all(total - keep) as any[]).map((r) => ({ n: r.n, at: r.at, what: r.what, data: JSON.parse(r.data), prev: r.prev, hash: r.hash }));
    sink?.(old); // filed before they leave the table: a failed write moves nothing
    this.tx(() => { this.db.query("DELETE FROM audit WHERE n <= ?").run(old.at(-1)!.n); this.db.query("INSERT INTO state (k, v) VALUES ('audit-anchor', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(old.at(-1)!.hash)); });
    return old;
  }
}
