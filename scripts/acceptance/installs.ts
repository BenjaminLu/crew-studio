// What a workflow needs installed on this Mac, read from its own definition (never a hand-kept table):
//   repo.prepare                       git (the Task's worktree)
//   a check whose pack script has a #! line   that interpreter (node for firstmate checks, python3 for core/ste-wording)
//   deliver.render                     the film renderer (Playwright + Chromium) and ffmpeg
// A need only some runs have (the designer's captures of a UI change) is the scenario run's needs: [renderer]. Coffee's
// film is not a need: without the renderer the run offers its film-unavailable card.
// Each need is a Doctor item id, so the sandboxed acceptance profile can say which install is missing
// and the Doctor row that installs it (scripts/acceptance-sandboxed.ts).
import { bundledText } from "../../src/bundled";

export type Install = { id: "git" | "node" | "python" | "renderer" | "ffmpeg"; why: string };
const SHEBANG: Record<string, Install["id"]> = { node: "node", python3: "python", python: "python" };

/** The check refs a definition uses: on nodes and on gated edges. */
function checkRefs(def: any): string[] {
  const refs = new Set<string>();
  for (const n of def?.nodes ?? []) for (const c of n.checks ?? []) if (c?.use) refs.add(String(c.use));
  for (const e of def?.edges ?? []) { const g = Array.isArray(e) ? e[3] : e?.gate ?? e?.args; for (const c of g?.checks ?? []) if (c?.use) refs.add(String(c.use)); }
  return [...refs];
}

export function installsFor(def: any): Install[] {
  const out = new Map<string, Install>();
  const add = (i: Install) => { if (!out.has(i.id)) out.set(i.id, i); };
  for (const n of def?.nodes ?? []) {
    if (n.do === "repo.prepare") add({ id: "git", why: `${n.id} makes the Task's worktree` });
    if (n.do === "deliver.render") { add({ id: "renderer", why: `${n.id} renders the film to MP4` }); add({ id: "ffmpeg", why: `${n.id} encodes the MP4` }); }
  }
  for (const ref of checkRefs(def)) {
    const [pack, id] = ref.split("/"); const run = bundledText(`packs/${pack}/checks/${id}/run`);
    const m = run ? /^#!\s*(\S+)(?:[ \t]+(\S+))?/.exec(run) : null; const first = m ? m[1].split("/").pop()! : null;
    const bin = first === "env" ? m![2] ?? null : first;
    const need = bin ? SHEBANG[bin] : undefined; if (need) add({ id: need, why: `check ${ref} runs on ${bin}` });
  }
  return [...out.values()];
}
