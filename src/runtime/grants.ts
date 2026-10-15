// Authorization windows (docs/architecture.md §3.4, §6 "auth.window"): the only
// way the runtime may answer a card for the captain. A window exists only as a
// grant record Studio wrote when the captain asked for it in Studio (an
// authenticated desktop action), signed with Studio's local key. A workflow
// definition, a pack, a bundled policy file or a hand-edited policy can never
// open one. A window never confirms a one-way door.
//   data/policies/grants.jsonl   one signed line per grant (and per revocation)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import { ledgerKey } from "./checks";

export type Grant = { id: string; kinds: string[]; until: string; project: string | null; granted_by: string; at: string; revoked?: boolean; sig?: string };

export class Grants {
  constructor(readonly dataDir: string) {}
  private file() { return join(this.dataDir, "policies", "grants.jsonl"); }
  private sign(g: Omit<Grant, "sig">) { return createHmac("sha256", ledgerKey(this.dataDir)).update(JSON.stringify({ id: g.id, kinds: g.kinds, until: g.until, project: g.project, granted_by: g.granted_by, at: g.at, revoked: !!g.revoked })).digest("hex"); }
  /** Every grant line whose signature holds (a forged or edited line is ignored). */
  all(): Grant[] {
    if (!existsSync(this.file())) return [];
    const out: Grant[] = [];
    for (const l of readFileSync(this.file(), "utf8").split("\n")) { if (!l.trim()) continue; let g: Grant; try { g = JSON.parse(l); } catch { continue; } if (g.sig && g.sig === this.sign(g)) out.push(g); }
    return out;
  }
  /** The captain opens a window (called only from an authenticated desktop route or a card answer). */
  add(o: { kinds: string[]; until: string; project?: string | null }, by: string): Grant {
    const kinds = (o.kinds ?? []).map(String).filter((k) => /^[a-z-]+$/.test(k));
    if (!kinds.length) throw new Error("name the card kinds the window answers");
    if (!(Date.parse(o.until) > Date.now())) throw new Error("the window must end in the future");
    if (!by || !/^captain\b/.test(by)) throw new Error("only the captain opens an authorization window");
    const g: Grant = { id: `G-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`, kinds, until: new Date(Date.parse(o.until)).toISOString(), project: o.project ?? null, granted_by: by, at: new Date().toISOString() };
    g.sig = this.sign(g); mkdirSync(join(this.dataDir, "policies"), { recursive: true }); appendFileSync(this.file(), JSON.stringify(g) + "\n"); return g;
  }
  revoke(id: string, by: string) { const g = this.all().find((x) => x.id === id); if (!g) throw new Error("no such grant"); const r: Grant = { ...g, revoked: true, granted_by: by, at: new Date().toISOString() }; delete r.sig; r.sig = this.sign(r); appendFileSync(this.file(), JSON.stringify(r) + "\n"); return r; }
  /** The open window for a card kind (project-scoped or global), if any. */
  open(kind: string, project: string | null, now = Date.now()): Grant | null {
    const revoked = new Set(this.all().filter((g) => g.revoked).map((g) => g.id));
    return this.all().filter((g) => !g.revoked && !revoked.has(g.id) && g.kinds.includes(kind) && Date.parse(g.until) > now && (!g.project || g.project === project)).at(-1) ?? null;
  }
}
