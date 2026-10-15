// firstmate's long-term memory, vendor-neutral. Today it lives in Claude's own
// project folder (~/.claude/projects/<project>/memory/), which a Codex main
// session cannot read. This provider reads and writes one plain folder of
// Markdown notes plus a MEMORY.md index, so any host can use the same memory.
//   CREW_MEMORY_DIR  the folder (default <Studio data>/memory, created empty)
// Nothing is migrated here; scripts/migrate-memory.ts --dry-run shows a plan.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Note = { name: string; description: string; type: string; body: string; file: string; links: string[] };

export const parseNote = (file: string, text: string): Note => {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const front = m?.[1] ?? "", body = (m?.[2] ?? text).trim();
  const get = (k: string) => new RegExp(`^\\s*${k}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
  const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]);
  return { name: get("name") || file.replace(/\.md$/, ""), description: get("description"), type: get("type"), body, file, links };
};

export class MemoryStore {
  constructor(readonly dir: string) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }
  static fromEnv(dataDir: string) { return new MemoryStore(process.env.CREW_MEMORY_DIR ?? join(dataDir, "memory")); }
  list(): Note[] {
    return readdirSync(this.dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").sort()
      .map((f) => parseNote(f, readFileSync(join(this.dir, f), "utf8")));
  }
  index(): string { try { return readFileSync(join(this.dir, "MEMORY.md"), "utf8"); } catch { return ""; } }
  write(n: { name: string; description: string; type: string; body: string }) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(n.name)) throw new Error("note name must be a short kebab-case slug");
    const file = `${n.name}.md`, text = `---\nname: ${n.name}\ndescription: ${n.description}\nmetadata:\n  type: ${n.type}\n---\n\n${n.body.trim()}\n`;
    const tmp = join(this.dir, `.${file}.tmp`); writeFileSync(tmp, text); renameSync(tmp, join(this.dir, file));
    const idx = this.index();
    if (!idx.includes(`(${file})`)) writeFileSync(join(this.dir, "MEMORY.md"), `${idx.trimEnd()}${idx ? "\n" : ""}- [${n.name}](${file}) — ${n.description}\n`);
  }
}
