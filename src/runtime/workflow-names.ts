// A workflow's display name: what the captain sees, kept apart from the definition.
//   data/workflow-names.json   { schema: 1, names: { <workflow id>: { name, by, at } } }
// The definition's own `name` never changes here: a crew approval is signed over staffingHash(def), a Task keeps the exact
// definition it started on, and an export or package carries the definition as saved. A rename therefore touches no
// definition, no version and no hash; it is local to this Studio (an export keeps the definition's own name).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withLock } from "../ids";
import { writeAtomic } from "./durable-log";

/** Display names Studio ships: a fresh install shows these; the captain can still rename or reset them. */
export const DEFAULT_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({ "code-firstmate": "coding" });
export const DISPLAY_NAME_MAX = 80;
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
// control characters, and the bidirectional overrides that would make a name read differently from what it is
const FORBIDDEN = /[\p{Cc}‪-‮⁦-⁩]/u;

export class DisplayNameError extends Error {}

/** A display name as stored: trimmed, 1–80 characters, no control characters. Throws DisplayNameError otherwise. */
export function checkDisplayName(raw: unknown): string {
  if (typeof raw !== "string") throw new DisplayNameError("A workflow name is text / 流程名稱必須是文字");
  const name = raw.trim();
  if (FORBIDDEN.test(name)) throw new DisplayNameError("A workflow name cannot contain control characters / 流程名稱不能包含控制字元");
  const n = [...name].length;
  if (n < 1 || n > DISPLAY_NAME_MAX) throw new DisplayNameError(`A workflow name has 1–${DISPLAY_NAME_MAX} characters / 流程名稱需 1–${DISPLAY_NAME_MAX} 個字元`);
  return name;
}

type Entry = { name: string; by: string; at: string };

export class WorkflowNames {
  readonly file: string;
  private warned: string | null = null;
  constructor(readonly dataDir: string) { this.file = join(dataDir, "workflow-names.json"); }
  /** The captain's renames. An unreadable file reads as none (the defaults show) and refuses writes until it is fixed. */
  private read(): { ok: boolean; names: Record<string, Entry> } {
    if (!existsSync(this.file)) return { ok: true, names: {} };
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      if (raw?.schema !== 1 || !raw.names || typeof raw.names !== "object" || Array.isArray(raw.names)) throw new Error("bad shape");
      const names: Record<string, Entry> = {};
      for (const [id, e] of Object.entries<any>(raw.names)) {
        if (!ID.test(id)) continue;
        try { names[id] = { name: checkDisplayName(e?.name), by: String(e?.by ?? ""), at: String(e?.at ?? "") }; } catch {}
      }
      return { ok: true, names };
    } catch (e) {
      const why = (e as Error).message;
      if (this.warned !== why) { this.warned = why; console.error(`workflow-names.json: unreadable, showing the default names: ${why}`); }
      return { ok: false, names: {} };
    }
  }
  overrides(): Record<string, Entry> { return this.read().names; }
  /** The name the captain sees: their rename, else Studio's default, else the definition's own name. */
  of(id: string, definitionName?: string): string { return this.overrides()[id]?.name ?? DEFAULT_DISPLAY_NAMES[id] ?? definitionName ?? id; }
  /** Every id with a display name of its own (a rename or a shipped default), id → name. */
  map(): Record<string, string> {
    const out: Record<string, string> = { ...DEFAULT_DISPLAY_NAMES };
    for (const [id, e] of Object.entries(this.overrides())) out[id] = e.name;
    return out;
  }
  /** Rename (name) or reset (null or blank). Returns the name now shown and whether a rename is kept. */
  set(id: string, raw: unknown, by: string): { workflow: string; name: string | null; renamed: boolean } {
    if (!ID.test(id)) throw new DisplayNameError("bad workflow id");
    const reset = raw === null || raw === undefined || (typeof raw === "string" && !raw.trim());
    const name = reset ? null : checkDisplayName(raw);
    mkdirSync(this.dataDir, { recursive: true });
    return withLock(this.dataDir, "workflow-names", () => {
      const cur = this.read();
      if (!cur.ok) throw new Error("data/workflow-names.json is unreadable; fix or remove it before renaming / 無法讀取 workflow-names.json，請先修復或移除");
      const names = { ...cur.names };
      // a name equal to the shipped default is the default: nothing to keep
      if (name === null || name === DEFAULT_DISPLAY_NAMES[id]) delete names[id];
      else names[id] = { name, by, at: new Date().toISOString() };
      writeAtomic(this.file, JSON.stringify({ schema: 1, names }, null, 1));
      return { workflow: id, name: names[id]?.name ?? DEFAULT_DISPLAY_NAMES[id] ?? null, renamed: !!names[id] };
    });
  }
}
