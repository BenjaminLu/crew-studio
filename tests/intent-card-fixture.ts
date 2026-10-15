// Writes R-002's merge card, rebuilt from the fixture of its real records with the
// intent-aligned detail, as a Studio card file (used by tests/intent-card-ui.mjs).
//      bun tests/intent-card-fixture.ts <data dir> [card id]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeDetail } from "../src/domain/mergecard";
import { doneMap } from "../src/runtime/checks";

export function r002Card(id = "SC-900") {
  const fx = join(import.meta.dir, "fixture/cards/R-002");
  const input = JSON.parse(readFileSync(join(fx, "input.json"), "utf8"));
  const coord = JSON.parse(readFileSync(join(fx, "coordinator.json"), "utf8"));
  const detail = mergeDetail({ run: input.run, intent: input.intent, spec: input.spec, ctx: input.ctx, ledger: input.ledger, doneMap: doneMap(input.spec.done, input.ledger, input.ctx.head),
    diff: readFileSync(join(fx, "diff.patch"), "utf8"), stat: input.stat, cost: input.cost }, coord);
  const sec = { intent: input.intent, why: "", scope: { in: input.spec.scope, out: [] }, done: input.spec.done, beforeAfter: "", how: "", glossary: [] };
  return { id, run: input.run, node: "merge-card", visit: 1, kind: "merge", title: { en: `Merge: ${input.spec.title}`, "zh-TW": "合併：format() 支援日圓這種沒有「分」的貨幣" },
    sections: { en: sec, "zh-TW": { ...sec, intent: input.spec.explain["zh-TW"] } }, body: `Intent: ${input.intent}`,
    options: [{ id: "merge", label: "Merge", primary: true }, { id: "changes", label: "Request changes", note: true, hold: true }, { id: "close", label: "Close without merging", hold: true }],
    confirmDoor: true, door: "two-way", links: [], detail, workflow: "code-firstmate", runTitle: input.title, ledger: null, ste: null, status: "open", createdAt: "2026-10-14T09:31:44.000Z", answer: null };
}
if (import.meta.main) {
  const dir = join(process.argv[2], "cards"); mkdirSync(dir, { recursive: true });
  const c = r002Card(process.argv[3]); writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(c, null, 1)); console.log(join(dir, `${c.id}.json`));
}
