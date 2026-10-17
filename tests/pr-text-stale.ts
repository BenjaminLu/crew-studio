import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A pull request's text matches its head before the merge (R-069: PR #1 on money-kit kept an older release's mangled test
// table, and no later round came to refresh it). Studio's part of the body sits between hidden markers naming the head it
// describes and its hash; before the merge card (merge on GitHub or in Studio) a text that lags the head, or an older
// release's text, is written again from the final state (the diff, the binding done lines and the captain's changes, the
// evidence at that head, the door) and the card that stands in for the merge offers the update; the merge is not offered
// meanwhile. Text outside the markers stays verbatim; a part someone edited is shown for the captain to keep or replace.
// Only the captain's answer PATCHes, and only while GitHub still shows what the card showed. An open merge card from an
// older release is replaced by the stand-in on restart, unanswered. Offline: the GitHub simulator, a scripted coordinator.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPrAdapter } from "../src/adapters/github";
import { createHash } from "node:crypto";
// read loosely: on a release without Studio's markers the flows below still run and fail on what they do, not on an import
const PT: any = await import("../src/domain/pull-template");
const studioParts: (b: string) => { marked: boolean; before: string; inner: string; after: string; head: string | null; hash: string | null } = PT.studioParts ?? ((b: string) => ({ marked: false, before: "", inner: String(b ?? ""), after: "", head: null, hash: null }));
const studioTextHash: (s: string) => string = PT.studioTextHash ?? ((s: string) => createHash("sha256").update(s).digest("hex"));
const wrapStudioText: (t: string, h: string) => string = PT.wrapStudioText ?? ((t: string) => t);
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("pr-text-stale");
const temp = checkedTempDir("pr-text-stale-"); setGitHome(join(temp, "git-home"));
const R069 = JSON.parse(readFileSync(join(import.meta.dir, "fixture/github/r069-pr.json"), "utf8"));
const TEMPLATE_TEXT = readFileSync(join(import.meta.dir, "fixture/github/money-kit-pull_request_template.md"), "utf8");
const TEMPLATE = { repository: "fixture/project", path: ".github/pull_request_template.md", blob: "ac6734daf27e7e347d02c15377576d0e2e6fcb37" };
const H40 = "a".repeat(40), H40b = "b".repeat(40);

// ---------- the markers: Studio's part, the head it describes and its hash ----------
{
  const w = wrapStudioText("## Summary\n\nEuro.\n", H40), body = `Reviewer intro.\n\n${w}\n\nReviewer note.`, p = studioParts(body);
  ok(p.marked && p.head === H40 && p.hash === studioTextHash(p.inner) && p.inner === "## Summary\n\nEuro.\n" && p.before === "Reviewer intro.\n\n" && p.after === "\n\nReviewer note.",
    "the begin marker names the head and the hash of Studio's part; the text around it is split off verbatim", JSON.stringify(p));
  ok(studioParts(body.replace("Euro.", "Euro, edited.")).hash !== studioTextHash(studioParts(body.replace("Euro.", "Euro, edited.")).inner), "an edit inside Studio's part no longer matches its hash");
  ok(!studioParts(R069.body).marked && studioParts(R069.body).inner === R069.body, "an older release's body has no markers: the whole body is the candidate");
  ok(!wrapStudioText(`a\n${w}\nb`, H40b).slice(1).includes("<!-- crew-studio:pr-text head=" + H40), "a marker inside the text is dropped, so the text cannot fake one");
  ok(studioParts(`${w}\n${w}`).hash === null, "two pairs of markers are not Studio's shape: nothing matches their hash");
}

// ---------- the flows, against the simulator ----------
const repo = join(temp, "source"), bare = join(temp, "remote.git"); mkdirSync(repo); assertTempRepo(repo);
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]); must(repo, ["remote", "add", "origin", "https://github.com/fixture/project.git"]);
must(temp, ["clone", "--bare", "-q", repo, bare]);
const baseCommit = must(repo, ["rev-parse", "HEAD"]);
const sim = githubSimulator(bare);
sim.expect("GET", "/branches/main/protection/required_status_checks", { strict: true, checks: [], contexts: [] });
const grant: any = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-17T00:00:00Z", approvalId: "test" };
const adapter = new GitHubPrAdapter(grant, () => "fake-token", 3000);
// the same project with a captain-named repository operation grant: Studio merges (in this test, the merge step only records the text on GitHub)
const operated = new GitHubPrAdapter({ ...grant, operations: { version: 1, repository: "fixture/project", approvalId: "fake-operations", approvedAt: "2026-10-17T00:00:00Z", mergeMethod: "squash" } }, () => "fake-token", 3000);
const ids = (c: any) => (c?.options ?? []).map((o: any) => o.id).join();
const patches = () => sim.calls.filter((c) => c.method === "PATCH" && /^\/pulls\/\d+$/.test(c.path) && "body" in (c.body ?? {})).length; // edits of the text (a push sends the base alone)
const mangled = (head: string) => R069.body.replaceAll("235859c5", head.slice(0, 8));
const pullOf = (r: any) => sim.pulls.get(Number(r.ctx.pr.id));
const green = (head: string) => { sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: 1, check_runs: [{ id: 1, name: "test", app: { id: 15368 }, head_sha: head, status: "completed", conclusion: "success" }] }); sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: 0, statuses: [] }); };
const commit = (text: string) => { writeFileSync(join(repo, "file"), text); must(repo, ["commit", "-qam", text]); return must(repo, ["rev-parse", "HEAD"]); };

const nodes = [{ id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 },
  { id: "r069", kind: "hook", do: "fixture.r069", label: "Older release's text", x: 2, y: 0 }, { id: "remote-ready", kind: "hook", do: "remote.ready", label: "Remote readiness", x: 3, y: 0 },
  { id: "merge-card", kind: "card", label: "Merge card", args: { body_from: "merge", card_kind: "merge" }, card: { confirm_door: true, door_from: "door" }, x: 4, y: 0 },
  { id: "round", kind: "hook", do: "fixture.round", label: "Another round", x: 4, y: 1 }, { id: "pr-push", kind: "hook", do: "pr.open", label: "Push the round", x: 3, y: 1 },
  { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 5, y: 1 }];
// code-firstmate's tail: the pull request (opened by an older release), the merge card; "changes" runs another round, pushed to the pull request
const flow = Y({ id: "stale-flow", name: "Stale flow", roles: [{ id: "coordinator", label: "Coordinator" }], nodes: nodes.filter((n) => n.id !== "remote-ready"),
  edges: [["seed", "pr-open"], ["pr-open", "r069", "ok"], ["pr-open", "closed", "close"], ["r069", "merge-card"],
    ["merge-card", "round", "changes"], ["merge-card", "closed", "close"], ["round", "pr-push"], ["pr-push", "merge-card", "ok"], ["pr-push", "closed", "close"]] });
const readyFlow = Y({ id: "stale-ready", name: "Stale ready", roles: [{ id: "coordinator", label: "Coordinator" }], nodes: nodes.filter((n) => n.id !== "round" && n.id !== "pr-push"),
  edges: [["seed", "pr-open"], ["pr-open", "r069", "ok"], ["pr-open", "closed", "close"], ["r069", "remote-ready"], ["remote-ready", "merge-card", "ok"], ["remote-ready", "closed", "close"], ["merge-card", "closed", "close"]] });
// a project without a pull request template: pr-open opens it at once; "changes" is a rescope that reclassifies the door (same head)
const plainFlow = Y({ id: "plain-flow", name: "Plain flow", roles: [{ id: "coordinator", label: "Coordinator" }],
  nodes: [...nodes.filter((n) => ["seed", "pr-open", "merge-card", "closed"].includes(n.id)), { id: "rescope", kind: "hook", do: "fixture.rescope", label: "Rescope", x: 4, y: 2 }],
  edges: [["seed", "pr-open"], ["pr-open", "merge-card", "ok"], ["pr-open", "closed", "close"], ["merge-card", "rescope", "changes"], ["merge-card", "closed", "close"], ["rescope", "merge-card"]] });
// a pull request without a template that an older release opened (no markers, no record), whose door flipped to one-way since
const legacyPlain = Y({ id: "legacy-plain", name: "Legacy plain", roles: [{ id: "coordinator", label: "Coordinator" }],
  nodes: [...nodes.filter((n) => ["seed", "pr-open", "merge-card", "closed"].includes(n.id)), { id: "legacy", kind: "hook", do: "fixture.legacy-plain", label: "Older release", x: 2, y: 2 }],
  edges: [["seed", "pr-open"], ["pr-open", "legacy", "ok"], ["pr-open", "closed", "close"], ["legacy", "merge-card"], ["merge-card", "closed", "close"], ["merge-card", "closed", "changes"]] });
const studioMerge = Y({ id: "stale-studio-merge", name: "Stale Studio merge", roles: [{ id: "coordinator", label: "Coordinator" }],
  nodes: [...nodes.filter((n) => !["remote-ready", "round", "pr-push"].includes(n.id)), { id: "merged", kind: "hook", do: "fixture.merged", label: "Merge", x: 5, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 6, y: 0 }],
  edges: [["seed", "pr-open"], ["pr-open", "r069", "ok"], ["pr-open", "closed", "close"], ["r069", "merge-card"], ["merge-card", "merged", "merge"], ["merge-card", "closed", "close"], ["merge-card", "closed", "changes"], ["merged", "done"]] });

// the coordinator writes the final state it is shown (scripted); every prompt is kept
const prompts: { system: string; text: string }[] = [];
const finalText = (head: string) => ({ title: "Add euro formatting and EUR switching to Corner Shop", sections: [
  { heading: "Summary", text: "Format cents as euros with European separators, so `format(123456, \"EUR\")` returns `€1.234,56`; Corner Shop offers EUR beside USD and JPY." },
  { heading: "Why", text: "Euro amounts need the requested cent-based display." },
  { heading: "Changes", text: "- Library: EUR formatting\n- Corner Shop: EUR selection at 1 USD = 0.92 EUR" },
  { heading: "How it was tested", text: `The acceptance tests below fail on main and pass at ${head.slice(0, 8)}.` },
  { heading: "Screenshots", text: "The shop views now include the € EUR option." }, { heading: "Risk and rollback", text: "Incorrect amounts or links could show; the acceptance tests cover them." }] });

const install = async (data?: string, with_: GitHubPrAdapter = adapter) => {
  const H = await harness([flow, readyFlow, studioMerge, plainFlow, legacyPlain], data ? { data } : {}), E = H.engine;
  installCode(E, { dataDir: H.data, projects: new Projects(H.data), adapter: with_ });
  (E.deps.agents as any).run = async (job: any) => { const t = job.tools?.find((t: any) => t.name === "pull_request_text"); if (t) { prompts.push({ system: job.system, text: job.text }); t.run(finalText(/head ([a-f0-9]{40})/.exec(job.text)?.[1] ?? "")); } return { status: "done" }; };
  const evidenceAt = (x: any) => { E.record(x, "check", { check: "firstmate/ci", verdict: "pass", kind: "deterministic", data: { shards: [] } } as any); E.record(x, "check", { check: "firstmate/fail-first", verdict: "pass", kind: "deterministic", proves: R069.proves, data: { applicable: true } } as any); };
  E.actions["fixture.seed"] = (x) => {
    sim.community.clear(); // the older release opened the pull request right away
    const branch = x.run.params.branch; must(repo, ["checkout", "-qb", branch, "main"]); const head = commit(branch); green(head);
    const door = x.run.params.door === "one-way" ? { door: "one-way", tier: "one-way", reasons: [{ path: "db/migrate.sql", list: "org", glob: "db/**", why: "a schema migration drops a column" }], decidedBy: "classifier" } : { door: "two-way", tier: "two-way", reasons: [], decidedBy: "classifier" };
    Object.assign(x.ctx, { repo, worktree: repo, base: "main", baseCommit, head, branch, door, spec: { title: R069.title, what: "Euro formatting.", why: ["Euro amounts."], done: R069.done, scope: ["file"] } });
    return "ok";
  };
  // what the older release left on the live Task: the text opened from the template, its mangled table, at this head
  E.actions["fixture.r069"] = (x) => {
    sim.community.set(TEMPLATE.path, TEMPLATE_TEXT); evidenceAt(x);
    // params.forged: a well-formed marker naming this head with the sha256 of its text, written by someone other than Studio
    const h = x.ctx.head, body = x.run.params.forged ? `${wrapStudioText("## Summary\n\nLooks current.\n", h)}\n` : mangled(h);
    x.ctx.prText = { version: 1, head: h, sources: "0".repeat(64), template: x.run.params.legacy ? null : TEMPLATE, title: R069.title, body, proven: [], proofs: {}, draft: false, repository: "fixture/project", branch: x.ctx.branch, base: "main", baseCommit, hash: "1".repeat(64), unproven: [], by: "coordinator", card: "SC-0" };
    x.ctx.pr = { ...x.ctx.pr, title: R069.title, body }; x.ctx.prPlain = null; // a template pull request, as that release opened it
    Object.assign(pullOf(x), { title: R069.title, body: x.run.params.edit ? `${body}\n\nReviewer note: the euro rows were checked by hand.` : body });
    return "ok";
  };
  // a later round: a new head with its evidence; pr-open pushes it (the text on GitHub stays as it is)
  E.actions["fixture.round"] = (x) => { const h = commit(`${x.ctx.branch} round ${x.visit}`); green(h); x.ctx.head = h; evidenceAt(x); return "ok"; };
  // Studio's merge step, as far as this test goes: what GitHub shows when it runs
  const OLD_PLAIN = "# Format euro prices\n\nWhat: Euro formatting.\n\n## Door\ntwo-way\n\n## Rollback\nRevert the change to undo it.";
  E.actions["fixture.legacy-plain"] = (x) => {
    delete x.ctx.prPlain; x.ctx.pr = { ...x.ctx.pr, body: OLD_PLAIN }; pullOf(x).body = OLD_PLAIN;
    if (x.run.params.boot) x.ctx.prText = { version: 0 }; // the older release: no text check at all (undone before the restart)
    x.ctx.door = { door: "one-way", tier: "one-way", reasons: [{ path: "db/migrate.sql", list: "org", glob: "db/**", why: "a schema migration drops a column" }], decidedBy: "classifier" };
    return "ok";
  };
  E.actions["fixture.rescope"] = (x) => { x.ctx.door = { door: "one-way", tier: "one-way", reasons: [{ path: "db/migrate.sql", list: "org", glob: "db/**", why: "a schema migration drops a column" }], decidedBy: "classifier" }; return "ok"; };
  E.actions["fixture.merged"] = (x) => { x.ctx.mergedBody = pullOf(x).body; return "ok"; };
  return { H, E };
};
const openCard = (E: any, r: any) => E.cards.list({ run: r.id, open: true })[0];
const settle = (E: any, r: any, not: string | null = null) => until(() => { const c = openCard(E, r); return (!!c && c.id !== not && !E.busy(r.id)) || ["succeeded", "failed"].includes(r.status); }, 20000);
const cleanRows = (b: string, head: string) => !/In ``|planned fail-first/i.test(b) && b.includes(`| The EUR cent-formatting scenario asserts that \`format(123456, "EUR")\` equals \`€1.234,56\` | test/format.test.ts | Yes (fail-first at ${head.slice(0, 8)}) |`);
const close = async (E: any, r: any) => { const c = openCard(E, r); if (c) await E.answer(c.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(r.status), 8000); };
const STANDIN = (r: any) => `Update the text of pull request #${r.ctx.pr?.id} before the merge?`;

try {
  // ---------- R-069: the merge waits for the text; the update writes the final EUR change, clean rows and the door ----------
  {
    const { H, E } = await install();
    try {
      const r = E.start({ workflow: "stale-flow", text: "euro", params: { branch: "crew/r069" } }); await settle(E, r);
      const c = openCard(E, r), p0 = patches(), h0 = r.ctx.head;
      ok(c?.title.en === STANDIN(r) && ids(c) === "update-text,changes,close" && c.captainOnly && c.kind === "merge" && /older release of Studio/.test(c.sections.en.why) && /not offered until the text matches the head/.test(c.sections.en.why) && /舊版 Studio/.test(c.sections["zh-TW"].why),
        "an older release's text stands the merge card down: the card offers the update, not the merge (nor 'I merge on GitHub')", `${c?.title?.en} | ${ids(c)}`);
      ok(c.body.includes("-| In ``, the EUR cent-formatting") && c.body.includes(`+| The EUR cent-formatting scenario`) && patches() === p0 && pullOf(r).body === mangled(h0)
        && E.trusted(r.id).entries.some((e: any) => e.record === "pr-text-refresh" && e.data?.card === c.id && e.data?.reason === "unmarked"), "the card shows the diff; nothing is edited before the answer; the offer is recorded against its card");
      ok(prompts.at(-1)!.system.includes("Describe the FINAL state") && /Never narrate rounds/.test(prompts.at(-1)!.system) && prompts.at(-1)!.text.includes(`head ${h0}`), "the coordinator is asked for the final state at this head, never the history");
      let refused = ""; try { await E.answer(c.id, { choice: "update-text", by: "firstmate" } as any); } catch (e: any) { refused = e.message; }
      ok(/Only the captain/.test(refused) && E.cards.get(c.id).status === "open" && patches() === p0, "Firstmate cannot decide the pull request text", refused);
      await E.answer(c.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, c.id);
      const m = openCard(E, r), body: string = pullOf(r).body, p = studioParts(body);
      ok(patches() === p0 + 1 && body === c.body.split("\nNew text:\n")[1] && p.marked && p.head === h0 && p.hash === studioTextHash(p.inner) && sim.head(r.ctx.branch) === h0,
        "Update PATCHes exactly the shown text, marked with the head and its hash (the head stays)", body.slice(0, 200));
      ok(body.includes("Corner Shop offers EUR beside USD and JPY") && cleanRows(body, h0) && body.includes("**Door: two-way (雙向門).** No changed path is on a one-way list: reverting this pull request undoes it.") && !/Studio recorded passing CI, lint/.test(body),
        "R-069 ends with a body that describes the final EUR change, with clean test rows and a door line", body.slice(body.indexOf("## How"), body.indexOf("## Checklist")));
      ok(m?.title.en === `Pull request #${r.ctx.pr.id} is open: merge it on GitHub` && ids(m) === "close,changes" && E.trusted(r.id).entries.some((e: any) => e.record === "pr-text-updated" && e.data?.card === c.id),
        "the update is recorded, and then the merge card comes", m?.title?.en);

      // ---------- someone adds a note outside Studio's part; the captain asks for changes; a round moves the head ----------
      pullOf(r).body = `${body}\n\nReviewer note: checked the euro rows by hand.`;
      await E.answer(m.id, { choice: "changes", note: "Show the exchange rate under the basket total", by: "captain" } as any); await settle(E, r, m.id);
      const s = openCard(E, r), h1 = r.ctx.head, p1 = patches(), push = sim.calls.filter((c) => c.method === "PATCH").at(-1);
      ok(JSON.stringify(push?.body) === JSON.stringify({ base: "main" }), "the round's push PATCHes the base alone: no title or text goes with it", JSON.stringify(push?.body));
      ok(h1 !== h0 && sim.head(r.ctx.branch) === h1 && /Reviewer note: checked the euro rows by hand\.$/.test(pullOf(r).body) && s?.title.en === STANDIN(r) && ids(s) === "update-text,changes,close",
        "the round's push leaves GitHub's text as it is, and the merge waits for the text of the new head", `${s?.title?.en} ${ids(s)} ${r.steps.map((x: any) => x.error).filter(Boolean).join(" | ")}`);
      const next = s.body.split("\nNew text:\n")[1] ?? "", q = studioParts(next);
      ok(q.head === h1 && cleanRows(next, h1) && !next.includes(`fail-first at ${h0.slice(0, 8)}`) && next.includes("A1. Show the exchange rate under the basket total") && !/\bround \d/i.test(next),
        "the new text is written from the final state: evidence at the new head, the captain's binding change, no history", next.slice(next.indexOf("## How"), next.indexOf("## Screenshots")));
      ok(q.after.endsWith("\n\nReviewer note: checked the euro rows by hand.") && q.after.trim() === "Reviewer note: checked the euro rows by hand." && !s.body.includes("-Reviewer note"), "the note outside Studio's markers stays verbatim");
      await E.answer(s.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, s.id);
      ok(patches() === p1 + 1 && pullOf(r).body === next && openCard(E, r)?.title.en.endsWith("merge it on GitHub"), "the update lands and the merge card follows");

      // ---------- someone edits inside Studio's part of this head after the merge card: "I merge on GitHub" reads GitHub first ----------
      pullOf(r).body = pullOf(r).body.replace("Corner Shop offers EUR beside USD and JPY", "Corner Shop offers EUR (reviewed by Ana)");
      const mc = openCard(E, r);
      await E.answer(mc.id, { choice: "close", by: "captain" } as any); await settle(E, r, mc.id);
      const k = openCard(E, r), p2 = patches();
      ok(r.status === "waiting" && k?.title.en === STANDIN(r) && ids(k) === "update-text,keep-text,changes,close" && /Someone edited Studio's part/.test(k.sections.en.why) && /^-.*reviewed by Ana/m.test(k.body) && k.options[0].label === "Replace with Studio's text",
        "the text is read again right before 'I merge on GitHub': an edit of this head's text brings the card back with the diff, Keep their text or Replace", `${r.status} ${ids(k)} ${k?.sections?.en?.why}`);
      await E.answer(k.id, { choice: "keep-text", by: "captain" } as any); await settle(E, r, k.id);
      const mk = openCard(E, r);
      ok(patches() === p2 && /reviewed by Ana/.test(pullOf(r).body) && mk?.title.en.endsWith("merge it on GitHub") && E.trusted(r.id).entries.some((e: any) => e.record === "pr-text-kept" && e.data?.card === k.id),
        "Keep their text: nothing is PATCHed, it is recorded, and the merge card follows");

      // ---------- the kept text, then a round moves the head: it lags the head now, so it can only be updated ----------
      await E.answer(mk.id, { choice: "changes", note: "Keep the rate line short", by: "captain" } as any); await settle(E, r, mk.id);
      const u = openCard(E, r);
      ok(u?.title.en === STANDIN(r) && ids(u) === "update-text,changes,close" && /describes [0-9a-f]{8}, not [0-9a-f]{8}.*it can only be updated/.test(u.sections.en.why),
        "an edited text that lags the head has no Keep: the card says it describes the older head", `${ids(u)} ${u?.sections?.en?.why}`);
      await close(E, r);
      ok(r.status === "succeeded" && r.result === "closed", "the Task closes as before", `${r.status} ${r.result}`);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }

  // ---------- an older release's body edited on GitHub: Replace (after the captain sees it); a change after the card: no PATCH ----------
  {
    const { H, E } = await install();
    try {
      const r = E.start({ workflow: "stale-flow", text: "euro", params: { branch: "crew/edited", edit: "1" } }); await settle(E, r);
      const c = openCard(E, r), p0 = patches();
      ok(ids(c) === "update-text,changes,close" && c.body.includes("-Reviewer note: the euro rows were checked by hand.") && patches() === p0, "an edited body without markers can only be updated (no Keep: it is not Studio's recorded text): the diff shows what goes", ids(c));
      pullOf(r).body = `${pullOf(r).body}\nAnother edit after the card.`;
      await E.answer(c.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, c.id);
      const c2 = openCard(E, r);
      ok(patches() === p0 && /Another edit after the card/.test(pullOf(r).body) && c2?.title.en === STANDIN(r) && c2.id !== c.id && c2.body.includes("-Another edit after the card."),
        "GitHub is read again before the PATCH: a text that changed after the card is not overwritten; a fresh card shows the new diff", `${patches() - p0} ${c2?.title?.en}`);
      await E.answer(c2.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, c2.id);
      ok(patches() === p0 + 1 && !/Reviewer note|Another edit/.test(pullOf(r).body) && cleanRows(pullOf(r).body, r.ctx.head), "Replace, after the captain saw it: Studio's text replaces theirs");
      await close(E, r);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }

  // ---------- a one-way door: the line says what it is and who confirms it ----------
  {
    const { H, E } = await install();
    try {
      const r = E.start({ workflow: "stale-flow", text: "euro", params: { branch: "crew/oneway", door: "one-way" } }); await settle(E, r);
      const c = openCard(E, r), next = c?.body.split("\nNew text:\n")[1] ?? "";
      ok(next.includes("**Door: one-way (單向門).** A revert does not undo this change: `db/migrate.sql` (a schema migration drops a column). Captain confirmation: pending.") && c.options.every((o: any) => o.hold),
        "a one-way door states the facts: what makes it one-way, and that the captain's confirmation is pending", next.slice(next.indexOf("## Risk"), next.indexOf("## Checklist")));
      await E.answer(c.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, c.id);
      const m = openCard(E, r), p0 = patches();
      ok(m?.title.en.endsWith("merge it on GitHub") && ids(m) === "confirm-door,changes,close" && !m.options.some((o: any) => /I merge on GitHub/.test(o.label)) && m.confirmDoor && m.door === "one-way" && /confirm the door here before you merge on GitHub/i.test(m.sections.en.why),
        "merge on GitHub with a one-way door: the card asks for the door confirmation first, and does not yet say to merge on GitHub", `${ids(m)} ${m?.sections?.en?.why}`);
      let refused = ""; try { await E.answer(m.id, { choice: "confirm-door", by: "captain" } as any); } catch (e: any) { refused = e.message; }
      let fm = ""; try { await E.answer(m.id, { choice: "confirm-door", confirm: "one-way", by: "firstmate" } as any); } catch (e: any) { fm = e.message; }
      ok(/confirm the door first/.test(refused) && /Only the captain/.test(fm) && E.cards.get(m.id).status === "open", "the answer must carry the confirmation, and only the captain gives it", `${refused} | ${fm}`);
      // GitHub refuses the write-back (not a compare-and-swap miss): the card does not say "ready" while GitHub still says pending
      sim.fail({ method: "PATCH", status: 500, once: true });
      await E.answer(m.id, { choice: "confirm-door", confirm: "one-way", by: "captain" } as any); await settle(E, r, m.id);
      const back = openCard(E, r);
      ok(back?.title.en === STANDIN(r) && ids(back) === "update-text,changes,close" && /no longer states the change's current facts/.test(back.sections.en.why) && /Captain confirmation: pending/.test(pullOf(r).body) && back.body.includes("+**Door: one-way (單向門).**") && patches() === p0 + 1 && !/confirmed by the captain/.test(pullOf(r).body),
        "a confirmation that could not be written: readiness reads GitHub's text, which still says pending, so the text card comes back instead of 'merge on GitHub'", `${ids(back)} ${back?.sections?.en?.why}`);
      await E.answer(back.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, back.id);
      const ready = openCard(E, r), body = pullOf(r).body;
      ok(patches() === p0 + 2 && /Captain confirmation: confirmed by the captain at \d{4}-\d\d-\d\dT/.test(body) && !/Captain confirmation: pending/.test(body) && ready?.title.en.endsWith("merge it on GitHub") && ids(ready) === "close,changes" && ready.options[0].label === "Close here (I merge on GitHub)",
        "once the text on GitHub states the confirmation, the card says it is ready to merge on GitHub", `${patches() - p0} ${ids(ready)}`);
      // a new head needs a new confirmation: the one given at the earlier head does not carry over
      await E.answer(ready.id, { choice: "changes", note: "Name the migration in the summary", by: "captain" } as any); await settle(E, r, ready.id);
      const s = openCard(E, r), later = s?.body.split("\nNew text:\n")[1] ?? "";
      ok(s?.title.en === STANDIN(r) && /Captain confirmation: pending/.test(later) && !/confirmed by the captain/.test(later), "after a round the text states the door's confirmation as pending again", later.match(/Captain confirmation: [^\n]*/)?.[0]);
      await E.answer(s.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, s.id);
      const again = openCard(E, r);
      ok(ids(again) === "confirm-door,changes,close" && E.trusted(r.id).entries.filter((e: any) => e.record === "door-confirmed").length === 1, "and the merge-on-GitHub card asks for the confirmation at the new head", ids(again));
      await close(E, r);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }

  // ---------- a pull request without a template: the same text check; a rescope that flips the door blocks the merge ----------
  {
    const { H, E } = await install();
    try {
      const r = E.start({ workflow: "plain-flow", text: "euro", params: { branch: "crew/plain" } }); await settle(E, r);
      const m = openCard(E, r), p = studioParts(pullOf(r).body), p0 = patches();
      ok(m?.title.en.endsWith("merge it on GitHub") && ids(m) === "close,changes" && p.marked && p.head === r.ctx.head && p.inner.includes("## Door\ntwo-way") && p.inner.includes("**Door: two-way (雙向門).**"),
        "a pull request without a template opens with Studio's part between the markers, the door in it, and reaches the merge card", `${ids(m)} ${pullOf(r).body.slice(0, 160)}`);
      await E.answer(m.id, { choice: "changes", note: "The migration drops a column", by: "captain" } as any); await settle(E, r, m.id);
      const s = openCard(E, r);
      ok(r.ctx.door.door === "one-way" && s?.title.en === STANDIN(r) && ids(s) === "update-text,changes,close" && s.body.includes("-two-way") && s.body.includes("+one-way") && patches() === p0,
        "a rescope that flips the door to one-way (same head): the text no longer states the facts, so the merge waits for the update", `${ids(s)} ${s?.sections?.en?.why}`);
      await E.answer(s.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, s.id);
      const c = openCard(E, r);
      ok(patches() === p0 + 1 && /## Door\none-way/.test(pullOf(r).body) && /Captain confirmation: pending/.test(pullOf(r).body) && ids(c) === "confirm-door,changes,close", "after the update the text states the one-way door, and the merge on GitHub asks for its confirmation", ids(c));
      await close(E, r);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }

  // ---------- a marker anyone could write (head = the current head, hash = sha256 of the text) does not make a text current ----------
  {
    const { H, E } = await install();
    try {
      const r = E.start({ workflow: "stale-flow", text: "euro", params: { branch: "crew/forged", forged: "1" } }); await settle(E, r);
      const c = openCard(E, r), p = studioParts(pullOf(r).body);
      ok(p.marked && p.head === r.ctx.head && p.hash === studioTextHash(p.inner) && c?.title.en === STANDIN(r) && !c.options.some((o: any) => o.id === "merge" || /I merge on GitHub/.test(o.label)) && c.body.includes("-## Summary") === false && c.body.includes("-Looks current."),
        "a well-formed marker naming the head (sha256 of its text) that Studio has no record of writing does not make the text current: the merge waits, the diff shows it going", `${ids(c)} ${c?.sections?.en?.why}`);
      await close(E, r);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }

  // ---------- Studio's merge (an operations grant): the text is read again and the door confirmation written before the merge ----------
  {
    const { H, E } = await install(undefined, operated);
    try {
      const r = E.start({ workflow: "stale-studio-merge", text: "euro", params: { branch: "crew/studio-merge", door: "one-way" } }); await settle(E, r);
      const c = openCard(E, r);
      ok(c?.title.en === STANDIN(r) && !c.options.some((o: any) => o.id === "merge"), "with an operations grant too, the merge is not offered while the text lags the head", ids(c));
      await E.answer(c.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, c.id);
      const m = openCard(E, r), p0 = patches();
      ok(m?.options.some((o: any) => o.id === "merge") && m.confirmDoor && m.door === "one-way" && /Captain confirmation: pending/.test(pullOf(r).body), "then the merge card, whose merge needs the door confirmation", ids(m));
      // someone edits Studio's part after the merge card: the merge answer reads GitHub first and brings the text card back
      const was = pullOf(r).body; pullOf(r).body = was.replace("Corner Shop offers EUR beside USD and JPY", "Corner Shop offers EUR (edited)");
      await E.answer(m.id, { choice: "merge", confirm: "one-way", aligned: [0], by: "captain" } as any); await settle(E, r, m.id);
      const back = openCard(E, r);
      ok(r.status === "waiting" && !r.ctx.mergedBody && back?.title.en === STANDIN(r) && ids(back) === "update-text,keep-text,changes,close", "the text is read right before Studio's merge: an edit since the card stops the merge and brings the text card back", `${r.status} ${ids(back)}`);
      await E.answer(back.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, back.id);
      const m2 = openCard(E, r);
      await E.answer(m2.id, { choice: "merge", confirm: "one-way", aligned: [0], by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(r.status), 15000);
      ok(r.status === "succeeded" && /Captain confirmation: confirmed by the captain at \d{4}-/.test(r.ctx.mergedBody ?? "") && patches() === p0 + 1, "the captain's confirmation is in the text on GitHub before the merge step runs", `${r.status} ${patches() - p0} ${(r.ctx.mergedBody ?? "").match(/Captain confirmation: [^\n]*/)?.[0]}`);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }

  // ---------- an older release's pull request without a template (no markers, no record): checked before the merge too ----------
  {
    const { H, E } = await install();
    try {
      const r = E.start({ workflow: "legacy-plain", text: "euro", params: { branch: "crew/legacy-plain" } }); await settle(E, r);
      const c = openCard(E, r), p0 = patches();
      ok(c?.title.en === STANDIN(r) && ids(c) === "update-text,changes,close" && /older release of Studio/.test(c.sections.en.why) && c.body.includes("-two-way") && c.body.includes("+one-way") && pullOf(r).body === "# Format euro prices\n\nWhat: Euro formatting.\n\n## Door\ntwo-way\n\n## Rollback\nRevert the change to undo it.",
        "a pre-upgrade pull request without a template whose door flipped: no 'merge on GitHub', only the update (no Keep), with the door's diff", `${c?.title?.en} ${ids(c)}`);
      await E.answer(c.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, c.id);
      const m = openCard(E, r), p = studioParts(pullOf(r).body);
      ok(patches() === p0 + 1 && p.marked && p.head === r.ctx.head && /## Door\none-way/.test(p.inner) && /Captain confirmation: pending/.test(p.inner) && ids(m) === "confirm-door,changes,close",
        "Update rewrites it as Studio's part (spec, one-way door, rollback), and the merge on GitHub then asks for the confirmation", ids(m));
      await E.answer(m.id, { choice: "confirm-door", confirm: "one-way", by: "captain" } as any); await settle(E, r, m.id);
      const ready = openCard(E, r);
      ok(/Captain confirmation: confirmed by the captain at/.test(pullOf(r).body) && ready?.options[0]?.label === "Close here (I merge on GitHub)", "after the confirmation the text on GitHub says so, then the card says it is ready", ids(ready));
      await close(E, r);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }
  {
    const first = await install(); const data = first.H.data; let runId = "", oldId = "";
    try {
      const r = first.E.start({ workflow: "legacy-plain", text: "euro", params: { branch: "crew/legacy-boot", boot: "1" } }); await settle(first.E, r); runId = r.id;
      const c = openCard(first.E, r); oldId = c?.id;
      ok(c?.title.en.endsWith("merge it on GitHub"), "the older release raised its merge card over the pre-upgrade text", c?.title?.en);
      delete r.ctx.prText; first.E.commit(r, "test: a pull request without a template, as the older release left it");
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { first.H.stop(); }
    const { H, E } = await install(data);
    try {
      E.load(); const r = E.get(runId)!; await until(() => !E.busy(r.id), 5000);
      const c = openCard(E, r);
      ok(c && c.id !== oldId && E.cards.get(oldId).status === "cancelled" && ids(c) === "render-text,changes,close" && c.title.en === STANDIN(r), "on restart that open merge card is replaced by the stand-in, unanswered", ids(c));
      await E.answer(c.id, { choice: "render-text", by: "captain" } as any); await settle(E, r, c.id);
      const s = openCard(E, r);
      ok(ids(s) === "update-text,changes,close" && s.body.includes("+one-way"), "and its 'Write the text again' shows the update first", ids(s));
      await close(E, r);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }

  // ---------- remote-ready raises the same card; "Not now" there still leaves the merge waiting for the text ----------
  {
    const { H, E } = await install();
    try {
      const r = E.start({ workflow: "stale-ready", text: "euro", params: { branch: "crew/ready" } }); await settle(E, r);
      const c = openCard(E, r), p0 = patches();
      ok(c?.node === "remote-ready" && c.title.en === `Update the text of pull request #${r.ctx.pr?.id}?` && ids(c) === "update-text,keep-text,close" && c.body.includes("+| The EUR cent-formatting scenario") && patches() === p0,
        "remote-ready offers the text written again at the head", `${c?.node} ${ids(c)}`);
      await E.answer(c.id, { choice: "keep-text", by: "captain" } as any); await settle(E, r, c.id);
      const s = openCard(E, r);
      ok(s?.node === "merge-card" && s.title.en === STANDIN(r) && ids(s) === "update-text,changes,close" && patches() === p0, "Not now at remote-ready: the merge card still waits for the text", `${s?.node} ${s?.title?.en}`);
      await E.answer(s.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, s.id);
      ok(patches() === p0 + 1 && cleanRows(pullOf(r).body, r.ctx.head) && openCard(E, r)?.title.en.endsWith("merge it on GitHub"), "Update on the stand-in card, then the merge card");
      await close(E, r);
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }

  // ---------- an open merge card from an older release is replaced on restart by the stand-in, unanswered ----------
  {
    const first = await install(); const data = first.H.data; let runId = "", oldId = "";
    try {
      const r = first.E.start({ workflow: "stale-flow", text: "euro", params: { branch: "crew/legacy", legacy: "1" } }); await settle(first.E, r); runId = r.id;
      const c = openCard(first.E, r); oldId = c?.id;
      ok(c?.title.en.endsWith("merge it on GitHub") && ids(c) === "close,changes", "the older release raised the merge card over its text", ids(c));
      r.ctx.prText.template = TEMPLATE; first.E.commit(r, "test: the text the older release opened from its template");
    } finally { first.H.stop(); }
    const p0 = patches(), n0 = prompts.length;
    const { H, E } = await install(data);
    try {
      E.load(); const r = E.get(runId)!; await until(() => !E.busy(r.id), 5000);
      const c = openCard(E, r), old = E.cards.get(oldId);
      ok(c && c.id !== oldId && old.status === "cancelled" && old.answer == null && ids(c) === "render-text,changes,close" && r.nodes["merge-card"].card === c.id && c.title.en === STANDIN(r)
        && patches() === p0 && prompts.length === n0 && r.status === "waiting" && E.trusted(r.id).entries.some((e: any) => e.record === "card-upgraded" && e.data?.from === oldId && e.data?.to === c.id),
        "after a restart the open merge card is replaced by the stand-in (no merge); nothing is answered, written or edited", `${c?.id} ${old?.status} ${ids(c)}`);
      await E.answer(c.id, { choice: "render-text", by: "captain" } as any); await settle(E, r, c.id);
      const s = openCard(E, r);
      ok(s?.title.en === STANDIN(r) && ids(s) === "update-text,changes,close" && patches() === p0 && s.body.includes("+| The EUR cent-formatting scenario"), "Write the text again shows the change first; still nothing edited", ids(s));
      await E.answer(s.id, { choice: "update-text", by: "captain" } as any); await settle(E, r, s.id);
      const m = openCard(E, r);
      ok(patches() === p0 + 1 && cleanRows(pullOf(r).body, r.ctx.head) && m?.title.en.endsWith("merge it on GitHub"), "then the update, then the merge card", m?.title?.en);
      H.stop(); const again = await install(data); again.E.load(); const r2 = again.E.get(runId)!;
      ok(openCard(again.E, r2)?.id === m.id && !again.E.trusted(r2.id).entries.some((e: any) => e.record === "card-upgraded" && e.data?.from === m.id), "a card the current release raised is not replaced on the next restart");
      await close(again.E, r2); again.H.stop();
    } catch (e: any) { ok(false, "unexpected error", e.stack?.split("\n").slice(0, 2).join(" ")); } finally { H.stop(); }
  }
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { sim.stop(); }
end();
