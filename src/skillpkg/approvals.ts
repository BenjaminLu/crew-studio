// The captain's decisions on script skills (docs/units/skill-packages.md §3): Studio's own record, never in the skill's files.
//   data/skills/_library/<id>/approvals.jsonl   one HMAC-signed line per decision (Studio's ledger key)
//   {v, sha256, filesSha256, scripts: "approved"|"text-only", hosts, installScripts, by, via, card?, run?, at, sig}
// A decision binds both hashes of the version: SKILL.md and every other file. A later line for the same version supersedes
// an earlier one; a line that does not verify (edited, forged, another key) is ignored. A new version (any changed file is
// one) has no decision until the captain makes one: nothing is inherited, the hosts included.
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ledgerKey } from "../runtime/checks";

export type ScriptDecision = "approved" | "text-only";
export type Approval = { v: number; sha256: string; filesSha256: string; scripts: ScriptDecision; hosts: string[]; installScripts: string[]; by: string; via: string; card?: string; run?: string; at: string; sig: string };
const SAFE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export class SkillApprovals {
  constructor(readonly dataDir: string) {}
  private file(id: string) { if (!SAFE.test(id)) throw new Error(`bad skill id ${id}`); return join(this.dataDir, "skills", "_library", id, "approvals.jsonl"); }
  private sign(rec: Omit<Approval, "sig">) { return createHmac("sha256", ledgerKey(this.dataDir)).update(JSON.stringify(rec)).digest("hex"); }
  /** Every decision that verifies, oldest first. */
  all(id: string): Approval[] {
    const f = this.file(id); if (!existsSync(f)) return [];
    const out: Approval[] = [];
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue; let r: any; try { r = JSON.parse(line); } catch { continue; }
      if (!r || typeof r.sig !== "string" || !/^[a-f0-9]{64}$/.test(r.sig)) continue;
      const { sig, ...rest } = r; const want = this.sign(rest);
      if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want))) continue;
      out.push(r as Approval);
    }
    return out;
  }
  /** The decision in force for exactly this version and both its hashes; null when the captain made none. */
  current(id: string, v: number, sha256: string, filesSha256: string): Approval | null {
    return this.all(id).filter((a) => a.v === v && a.sha256 === sha256 && a.filesSha256 === filesSha256).at(-1) ?? null;
  }
  /** Record the captain's decision (only the captain: a card answer or the Crew page). */
  record(id: string, d: { v: number; sha256: string; filesSha256: string; scripts: ScriptDecision; hosts: string[]; installScripts?: string[]; by: string; via: string; card?: string; run?: string }): Approval {
    if (!/^captain\b/i.test(d.by)) throw new Error("only the captain approves a script skill");
    if (!/^[a-f0-9]{64}$/.test(d.sha256) || !/^[a-f0-9]{64}$/.test(d.filesSha256)) throw new Error("an approval names both hashes of the version");
    const rec: Omit<Approval, "sig"> = { v: d.v, sha256: d.sha256, filesSha256: d.filesSha256, scripts: d.scripts, hosts: [...new Set(d.hosts)].sort(), installScripts: [...new Set(d.installScripts ?? [])].sort(),
      by: d.by, via: d.via, ...(d.card ? { card: d.card } : {}), ...(d.run ? { run: d.run } : {}), at: new Date().toISOString() };
    const full = { ...rec, sig: this.sign(rec) } as Approval;
    mkdirSync(join(this.file(id), ".."), { recursive: true }); appendFileSync(this.file(id), JSON.stringify(full) + "\n", { mode: 0o600 });
    return full;
  }
}
