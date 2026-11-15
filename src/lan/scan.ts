// The secret scan a result must pass before it leaves this Studio (docs/units/lan-relay.md). It is a net, not a wall: an
// agent told to leak something can always encode it so no scanner recognises it (the page and the unit spec say so); the
// person reading the exact bytes before 交回 is the real gate. What it catches, so the honest mistakes do not get out:
//   - Studio's one redactor (src/secure.ts) over each line and over the whole text (PEM blocks, values split by a newline);
//   - string literals joined in order (a token cut into "abc" + "def" across lines);
//   - base64 and base64url runs decoded and scanned again;
//   - PEM headers on their own, Studio's own key files ({"d":"<43 base64url>"}, the LAN identity) and long high-entropy runs;
//   - the names on the privacy.denylist policy.
import { redactText } from "../secure";

export type Hit = { path: string; line: number; what: string };
const lineOf = (text: string, index: number) => text.slice(0, Math.max(0, index)).split("\n").length;
const entropy = (s: string) => { const f = new Map<string, number>(); for (const c of s) f.set(c, (f.get(c) ?? 0) + 1); let e = 0; for (const n of f.values()) { const p = n / s.length; e -= p * Math.log2(p); } return e; };
const flagged = (t: string) => redactText(t) !== t;

export function scanText(path: string, text: string, deny: string[] = []): Hit[] {
  const out: Hit[] = [], add = (line: number, what: string) => { if (!out.some((h) => h.line === line && h.what === what)) out.push({ path, line, what }); };
  const lines = text.split("\n");
  lines.forEach((l, i) => { if (flagged(l)) add(i + 1, "a credential"); });
  if (flagged(text) && !out.length) add(1, "a credential spread over several lines");
  // string literals joined in order: "ghp_abc" … "def" becomes one token again
  const lits = [...text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n]){4,})\1/g)];
  for (let i = 0; i < lits.length; i++) { let joined = ""; for (let j = i; j < Math.min(lits.length, i + 4); j++) { joined += lits[j][2]; if (j > i && flagged(joined) && !flagged(lits[i][2])) { add(lineOf(text, lits[i].index!), "a credential split across string literals"); break; } } }
  // base64 / base64url runs, decoded and scanned again (and Studio's own key format)
  for (const m of text.matchAll(/[A-Za-z0-9+/_-]{24,}={0,2}/g)) {
    const tok = m[0], line = lineOf(text, m.index!);
    for (const enc of ["base64", "base64url"] as const) { let dec = ""; try { dec = Buffer.from(tok, enc).toString("utf8"); } catch {}
      if (dec && /^[\x20-\x7e\s]{12,}$/.test(dec) && (flagged(dec) || /-----BEGIN [A-Z ]*PRIVATE KEY/.test(dec))) { add(line, "a credential in base64"); break; } }
    const core = tok.replace(/=+$/, "");
    if (core.length >= 32 && !/^[0-9a-f]+$/i.test(core) && /[a-z]/.test(core) && /[A-Z]/.test(core) && /\d/.test(core) && entropy(core) >= 4.3) add(line, "a long random-looking string (a key or token?)");
  }
  for (const m of text.matchAll(/-----BEGIN [A-Z0-9 ]*(PRIVATE KEY|OPENSSH PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g)) add(lineOf(text, m.index!), "a private key block");
  for (const m of text.matchAll(/"d"\s*:\s*"[A-Za-z0-9_-]{43}"/g)) add(lineOf(text, m.index!), "a Studio key file");
  for (const d of deny.filter((x) => x.trim().length >= 3)) lines.forEach((l, i) => { if (l.toLowerCase().includes(d.toLowerCase())) add(i + 1, "a name on the privacy denylist"); });
  return out;
}
