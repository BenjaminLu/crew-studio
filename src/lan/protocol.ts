// The entries two Studios exchange (docs/units/lan-relay.md): per-author signed, append-only logs. An envelope carries
// the author's full public key, its sequence number and the hash of its previous entry, the recipients' full keys, a
// sealed body (encrypted to the recipients and the author) and the signature. Every field is checked by shape and size
// before any signature is verified, and every body by kind. A briefing or a result travels as a sealed blob beside the
// entry that names its hash; nothing is fetched by hash afterwards, so there is no blob endpoint to ask "do you have X".
import { b64u, canonical, checkPub, open, seal, sha256hex, sign, unb64u, verify, type Box, type KeyPair } from "./crypto";

export const LIMITS = { envelope: 64 * 1024, blob: 256 * 1024, recipients: 8, title: 120, briefing: 6000, acceptance: 10, criterion: 300, files: 60, path: 240, note: 1000, reason: 300, push: 16, perDay: 500, rounds: 20, skewMs: 24 * 3600_000 };
export const KINDS = ["dispatch", "take", "assign", "result", "refine", "done", "revoke"] as const;
export type Kind = typeof KINDS[number];
export type Envelope = { v: 1; a: string; seq: number; prev: string | null; ts: string; to: string[]; box: Box; sig: string };
export type WorkflowRef = { id: string; version: number; defHash: string };
export type Body =
  | { kind: "dispatch"; thread: string; round: 1; title: string; briefing: { hash: string; size: number }; acceptance: string[]; suggested: WorkflowRef | null }
  | { kind: "take"; thread: string; round: number; briefing: string; workflow: WorkflowRef; cap: { usd: number; rounds: number } }
  | { kind: "assign"; thread: string; round: number; take: string; taker: string }
  | { kind: "result"; thread: string; round: number; take: string; briefing: string; output: { hash: string; size: number; files: { path: string; bytes: number }[] }; workflow: WorkflowRef; run: string; checks: { pass: number; fail: number; other: number; summary: string } }
  | { kind: "refine"; thread: string; round: number; briefing: { hash: string; size: number }; note: string }
  | { kind: "done"; thread: string; round: number; result: string }
  | { kind: "revoke"; thread: string; round: number; target: string; reason: string };

const HEX64 = /^[0-9a-f]{64}$/, ID = /^[A-Za-z0-9_-]{8,64}$/, WF = /^[a-z0-9][a-z0-9-]{0,63}$/, RUN = /^R-\d{1,9}$/;
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
    case "dispatch": return only(b, [...k, "title", "briefing", "acceptance", "suggested"]) && b.round === 1 && str(b.title, LIMITS.title, 1) && briefRef(b.briefing)
      && Array.isArray(b.acceptance) && b.acceptance.length <= LIMITS.acceptance && b.acceptance.every((c: unknown) => str(c, LIMITS.criterion, 1)) && (b.suggested === null || wfRef(b.suggested)) ? null : "malformed dispatch";
    case "take": return only(b, [...k, "briefing", "workflow", "cap"]) && HEX64.test(String(b.briefing)) && wfRef(b.workflow) && plainObj(b.cap) && only(b.cap, ["usd", "rounds"])
      && typeof b.cap.usd === "number" && b.cap.usd >= 0 && b.cap.usd <= 1000 && int(b.cap.rounds, 1, 50) ? null : "malformed take";
    case "assign": return only(b, [...k, "take", "taker"]) && HEX64.test(String(b.take)) && keyOk(b.taker) ? null : "malformed assign";
    case "result": return only(b, [...k, "take", "briefing", "output", "workflow", "run", "checks"]) && HEX64.test(String(b.take)) && HEX64.test(String(b.briefing))
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
  if (!plainObj(e) || !only(e, ["v", "a", "seq", "prev", "ts", "to", "box", "sig"]) || e.v !== 1) return "not an entry";
  let size = 0; try { size = canonical(e).length; } catch { return "not canonical data"; }
  if (size > LIMITS.envelope) return "entry too large";
  if (!keyOk(e.a)) return "bad author key";
  if (!int(e.seq, 1, 1e9)) return "bad seq";
  if (!(e.prev === null || HEX64.test(String(e.prev))) || (e.seq === 1) !== (e.prev === null)) return "bad prev";
  if (!str(e.ts, 40) || !Number.isFinite(Date.parse(e.ts))) return "bad timestamp";
  if (!Array.isArray(e.to) || !e.to.length || e.to.length > LIMITS.recipients || !e.to.every(keyOk) || new Set(e.to).size !== e.to.length) return "bad recipients";
  if (!plainObj(e.box) || !Array.isArray(e.box.keys) || e.box.keys.length > LIMITS.recipients + 1) return "bad box";
  if (!str(e.sig, 100)) return "bad signature";
  return null;
}
const unsigned = (e: Envelope) => Buffer.from(canonical({ v: e.v, a: e.a, seq: e.seq, prev: e.prev, ts: e.ts, to: e.to, box: e.box }));
export const entryHash = (e: Envelope) => sha256hex(canonical(e));
export const verifyEnvelope = (e: Envelope) => { try { return verify(unb64u(e.a, 65), "entry", unsigned(e), unb64u(e.sig, 64)); } catch { return false; } };
/** A new signed entry: the body sealed to its recipients and to its author. */
export function makeEnvelope(me: KeyPair, seq: number, prev: string | null, to: string[], body: Body, ts = new Date().toISOString()): Envelope {
  const problem = bodyProblem(body); if (problem) throw new Error(problem);
  const box = seal(Buffer.from(canonical(body)), [...to.map((k) => unb64u(k, 65)), me.pub], "entry");
  const e: Omit<Envelope, "sig"> & { sig?: string } = { v: 1, a: b64u(me.pub), seq, prev, ts, to, box };
  e.sig = b64u(sign(me, "entry", unsigned(e as Envelope)));
  return e as Envelope;
}
/** The body of an envelope this key can read, checked; else the reason. */
export function readBody(e: Envelope, me: KeyPair): { body: Body } | { problem: string } {
  const plain = open(e.box, me, "entry"); if (!plain) return { problem: "not readable by this Studio" };
  let b: any; try { b = JSON.parse(plain.toString("utf8")); } catch { return { problem: "body is not JSON" }; }
  const p = bodyProblem(b); return p ? { problem: p } : { body: b as Body };
}
export type Blob = { hash: string; box: Box };
export const sealBlob = (plain: Buffer, recipients: string[], me: KeyPair): Blob => ({ hash: sha256hex(plain), box: seal(plain, [...recipients.map((k) => unb64u(k, 65)), me.pub], "blob") });
/** The blob's bytes when this key can open it and they hash to its name; else null. */
export function openBlob(b: Blob, me: KeyPair): Buffer | null {
  if (!plainObj(b) || !HEX64.test(String(b.hash))) return null;
  const p = open(b.box, me, "blob"); if (!p || p.length > LIMITS.blob) return null;
  return sha256hex(p) === b.hash ? p : null;
}

/** sha256 of what a workflow does: id, kind, roles, params, policies, hooks, nodes (without layout) and edges. The same body
 *  as the acceptance pin (scripts/acceptance/scenarios.ts defHash), so a hash means the same thing on every board. */
export function defHash(def: any): string {
  const nodes = (def?.nodes ?? []).map(({ x, y, ...n }: any) => n);
  return sha256hex(canonical(JSON.parse(JSON.stringify({ id: def?.id, kind: def?.kind ?? null, roles: def?.roles ?? [], params: def?.params ?? {}, policies: def?.policies ?? null, hooks: def?.hooks ?? null, card_checks: def?.card_checks ?? null, nodes, edges: def?.edges ?? [] }))));
}

/**
 * Text a person (or a prompt) may see from a peer: NFKC, no control characters except newline and tab, and every bidi
 * override and zero-width character replaced by a visible marker, so what the approver reads is what the agent gets.
 */
export const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿؜᠎]/g;
export function cleanText(t: unknown, max: number): string {
  return String(t ?? "").normalize("NFKC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "").replace(INVISIBLE, (c) => `⟦U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧`).slice(0, max);
}
/** A name the peer says it has: one line, cleaned, short. Shown only as "自稱", never as who it is. */
export const cleanName = (t: unknown) => cleanText(t, 60).replace(/\s+/g, " ").trim();
