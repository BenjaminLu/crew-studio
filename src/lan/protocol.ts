// The entries two Studios exchange (docs/units/lan-relay.md): per-author signed, append-only logs, protocol 2. An
// envelope carries the author's identity (its admin key), the hash of the certificate whose daily signing key signed it,
// its sequence number and the hash of its previous entry, the recipients' identities, a sealed body (encrypted to the
// recipients' and the author's daily key agreement keys) and the signature. Every field is checked by shape and size
// before any signature is verified, and every body by kind. A briefing or a result travels as a sealed blob beside the
// entry that names its hash; nothing is fetched by hash afterwards, so there is no blob endpoint to ask "do you have X".
import { b64u, canonical, checkPub, open, seal, sha256hex, unb64u, verify, type Box, type Recipient, type StaticKey } from "./crypto";

export const LIMITS = { openPerPeer: 5, concurrentTasks: 3, peerQuota: 64 * 1024 * 1024, addedBytes: 128 * 1024, envelope: 64 * 1024, blob: 256 * 1024, recipients: 8, title: 120, briefing: 6000, acceptance: 10, criterion: 300, files: 60, path: 240, note: 1000, reason: 300, push: 16, perDay: 500, rounds: 20, skewMs: 24 * 3600_000 };
export const KINDS = ["dispatch", "take", "assign", "result", "refine", "done", "revoke"] as const;
export type Kind = typeof KINDS[number];
export type Envelope = { v: 2; a: string; c: string; seq: number; prev: string | null; ts: string; to: string[]; box: Box; sig: string };
/** what signs this Studio's entries and opens what is sealed to it (src/lan/keystore.ts) */
export type Author = { key: string; certHash: string; dhPub: Buffer; sign(purpose: "entry", msg: Uint8Array): Promise<Buffer> };
export type Reader = { id: string; dh: StaticKey };
export type WorkflowRef = { id: string; version: number; defHash: string };
export type Body =
  | { kind: "dispatch"; thread: string; round: 1; title: string; briefing: { hash: string; size: number }; acceptance: string[]; suggested: WorkflowRef | null; base?: { root: string; sha: string } | null }
  | { kind: "take"; thread: string; round: number; briefing: string; workflow: WorkflowRef; cap: { rounds: number } }
  | { kind: "assign"; thread: string; round: number; take: string; taker: string }
  | { kind: "result"; thread: string; round: number; take: string; briefing: string; output: { hash: string; size: number; files: { path: string; bytes: number }[] }; workflow: WorkflowRef; run: string; checks: { pass: number; fail: number; other: number; summary: string }; base?: string | null; used?: { rounds: number; tokens: number; minutes: number } }
  | { kind: "refine"; thread: string; round: number; briefing: { hash: string; size: number }; note: string }
  | { kind: "done"; thread: string; round: number; result: string }
  | { kind: "revoke"; thread: string; round: number; target: string; reason: string };

const SHA1 = /^[0-9a-f]{40}$/, HEX64 = /^[0-9a-f]{64}$/, ID = /^[A-Za-z0-9_-]{8,64}$/, WF = /^[a-z0-9][a-z0-9-]{0,63}$/, RUN = /^R-\d{1,9}$/;
const str = (v: unknown, max: number, min = 0) => typeof v === "string" && v.length >= min && v.length <= max;
const int = (v: unknown, lo: number, hi: number) => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;
const keyOk = (v: unknown) => { try { checkPub(unb64u(v, 65)); return true; } catch { return false; } };
const plainObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const only = (o: Record<string, any>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
const wfRef = (w: any) => plainObj(w) && only(w, ["id", "version", "defHash"]) && WF.test(String(w.id)) && int(w.version, 1, 1e6) && HEX64.test(String(w.defHash));
const briefRef = (b: any) => plainObj(b) && only(b, ["hash", "size"]) && HEX64.test(String(b.hash)) && int(b.size, 1, LIMITS.blob);

/** The reason a decrypted body is not a valid entry of its kind, or null. */
export function bodyProblem(b: any): string | null {
  if (!plainObj(b) || !KINDS.includes(b.kind)) return "unknown entry kind";
  if (!ID.test(String(b.thread))) return "bad thread id";
  if (!int(b.round, 1, LIMITS.rounds)) return "bad round";
  const k = ["kind", "thread", "round"];
  switch (b.kind as Kind) {
    case "dispatch": return only(b, [...k, "title", "briefing", "acceptance", "suggested", "base"]) && b.round === 1 && (b.base === undefined || b.base === null || (plainObj(b.base) && only(b.base, ["root", "sha"]) && SHA1.test(String(b.base.root)) && SHA1.test(String(b.base.sha)))) && str(b.title, LIMITS.title, 1) && briefRef(b.briefing)
      && Array.isArray(b.acceptance) && b.acceptance.length <= LIMITS.acceptance && b.acceptance.every((c: unknown) => str(c, LIMITS.criterion, 1)) && (b.suggested === null || wfRef(b.suggested)) ? null : "malformed dispatch";
    case "take": return only(b, [...k, "briefing", "workflow", "cap"]) && HEX64.test(String(b.briefing)) && wfRef(b.workflow) && plainObj(b.cap) && only(b.cap, ["rounds"])
      && int(b.cap.rounds, 1, 50) ? null : "malformed take";
    case "assign": return only(b, [...k, "take", "taker"]) && HEX64.test(String(b.take)) && keyOk(b.taker) ? null : "malformed assign";
    case "result": return only(b, [...k, "take", "briefing", "output", "workflow", "run", "checks", "base", "used"]) && (b.base === undefined || b.base === null || SHA1.test(String(b.base)))
      && (b.used === undefined || (plainObj(b.used) && only(b.used, ["rounds", "tokens", "minutes"]) && int(b.used.rounds, 0, 1e4) && int(b.used.tokens, 0, 1e12) && typeof b.used.minutes === "number" && b.used.minutes >= 0 && b.used.minutes <= 1e6)) && HEX64.test(String(b.take)) && HEX64.test(String(b.briefing))
      && plainObj(b.output) && only(b.output, ["hash", "size", "files"]) && HEX64.test(String(b.output.hash)) && int(b.output.size, 1, LIMITS.blob)
      && Array.isArray(b.output.files) && b.output.files.length <= LIMITS.files && b.output.files.every((f: any) => plainObj(f) && only(f, ["path", "bytes"]) && str(f.path, LIMITS.path, 1) && int(f.bytes, 0, LIMITS.blob))
      && wfRef(b.workflow) && RUN.test(String(b.run)) && plainObj(b.checks) && only(b.checks, ["pass", "fail", "other", "summary"]) && int(b.checks.pass, 0, 1e4) && int(b.checks.fail, 0, 1e4) && int(b.checks.other, 0, 1e4) && str(b.checks.summary, LIMITS.note) ? null : "malformed result";
    case "refine": return only(b, [...k, "briefing", "note"]) && b.round >= 2 && briefRef(b.briefing) && str(b.note, LIMITS.note) ? null : "malformed refine";
    case "done": return only(b, [...k, "result"]) && HEX64.test(String(b.result)) ? null : "malformed done";
    case "revoke": return only(b, [...k, "target", "reason"]) && HEX64.test(String(b.target)) && str(b.reason, LIMITS.reason) ? null : "malformed revoke";
  }
}
/** The reason an envelope's shape is wrong (before any signature check), or null. */
export function envelopeProblem(e: any): string | null {
  if (!plainObj(e) || e.v !== 2) return "not an entry";
  if (!only(e, ["v", "a", "c", "seq", "prev", "ts", "to", "box", "sig"])) return "not an entry";
  if (!HEX64.test(String(e.c))) return "bad certificate hash";
  let size = 0; try { size = canonical(e).length; } catch { return "not canonical data"; }
  if (size > LIMITS.envelope) return "entry too large";
  if (!keyOk(e.a)) return "bad author key";
  if (!int(e.seq, 1, 1e9)) return "bad seq";
  if (!(e.prev === null || HEX64.test(String(e.prev))) || (e.seq === 1) !== (e.prev === null)) return "bad prev";
  if (!str(e.ts, 40) || !Number.isFinite(Date.parse(e.ts))) return "bad timestamp";
  if (!Array.isArray(e.to) || !e.to.length || e.to.length > LIMITS.recipients || !e.to.every(keyOk) || new Set(e.to).size !== e.to.length) return "bad recipients";
  if (!plainObj(e.box) || e.box.alg !== "p256-hkdf-aesgcm-2" || !Array.isArray(e.box.keys) || e.box.keys.length > LIMITS.recipients + 1) return "bad box";
  if (!str(e.sig, 100)) return "bad signature";
  return null;
}
const unsigned = (e: Envelope) => Buffer.from(canonical({ v: e.v, a: e.a, c: e.c, seq: e.seq, prev: e.prev, ts: e.ts, to: e.to, box: e.box }));
export const entryHash = (e: Envelope) => sha256hex(canonical(e));
/** the signature, checked against the daily signing key of the certificate the entry names (the caller looks it up) */
export const verifyEnvelope = (e: Envelope, signPub: Uint8Array) => { try { return verify(signPub, "entry", unsigned(e), unb64u(e.sig, 64)); } catch { return false; } };
/** A new signed entry: the body sealed to its recipients and to its author (each by its daily key agreement key). */
export async function makeEnvelope(me: Author, seq: number, prev: string | null, to: Recipient[], body: Body, ts = new Date().toISOString()): Promise<Envelope> {
  const problem = bodyProblem(body); if (problem) throw new Error(problem);
  const box = seal(Buffer.from(canonical(body)), [...to, { id: me.key, dh: me.dhPub }], "entry");
  const e: Omit<Envelope, "sig"> & { sig?: string } = { v: 2, a: me.key, c: me.certHash, seq, prev, ts, to: to.map((r) => r.id), box };
  e.sig = b64u(await me.sign("entry", unsigned(e as Envelope)));
  return e as Envelope;
}
/** The body of an envelope this Studio can read, checked; else the reason. */
export async function readBody(e: Envelope, me: Reader): Promise<{ body: Body } | { problem: string }> {
  const plain = await open(e.box, me, "entry"); if (!plain) return { problem: "not readable by this Studio" };
  let b: any; try { b = JSON.parse(plain.toString("utf8")); } catch { return { problem: "body is not JSON" }; }
  const p = bodyProblem(b); return p ? { problem: p } : { body: b as Body };
}
export type Blob = { hash: string; box: Box };
export const sealBlob = (plain: Buffer, recipients: Recipient[], me: Recipient): Blob => ({ hash: sha256hex(plain), box: seal(plain, [...recipients, me], "blob") });
/** The blob's bytes when this Studio can open it and they hash to its name; else null. */
export async function openBlob(b: Blob, me: Reader): Promise<Buffer | null> {
  if (!plainObj(b) || !HEX64.test(String(b.hash))) return null;
  const p = await open(b.box, me, "blob"); if (!p || p.length > LIMITS.blob) return null;
  return sha256hex(p) === b.hash ? p : null;
}

/** sha256 of what a workflow does: id, kind, roles, params, policies, hooks, nodes (without layout) and edges. The same body
 *  as the acceptance pin (scripts/acceptance/scenarios.ts defHash), so a hash means the same thing on every board. */
export function defHash(def: any): string {
  const nodes = (def?.nodes ?? []).map(({ x, y, ...n }: any) => n);
  return sha256hex(canonical(JSON.parse(JSON.stringify({ id: def?.id, kind: def?.kind ?? null, roles: def?.roles ?? [], params: def?.params ?? {}, policies: def?.policies ?? null, hooks: def?.hooks ?? null, card_checks: def?.card_checks ?? null, nodes, edges: def?.edges ?? [] }))));
}

/**
 * Text a person (or a prompt) may see from a peer: NFC (a name is NFKC too: cleanName), no control characters except newline and tab, and every bidi
 * override and zero-width character replaced by a visible marker, so what the approver reads is what the agent gets.
 */
export const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿؜᠎]/g;
export function cleanText(t: unknown, max: number): string {
  return String(t ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "").replace(INVISIBLE, (c) => `⟦U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧`).slice(0, max);
}
/** A name the peer says it has: one line, cleaned, short. Shown only as "自稱", never as who it is. */
export const cleanName = (t: unknown) => cleanText(String(t ?? "").normalize("NFKC"), 60).replace(/\s+/g, " ").trim();
