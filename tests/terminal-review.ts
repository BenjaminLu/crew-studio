import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Send for review from a web terminal (docs/units/branch-intake.md) against a booted Studio whose code-firstmate crew is
// approved on the sandbox project (tests/lib/staffed-code-studio.ts), stub CLIs only: an agent's commits on a branch in the
// project's folder start code-firstmate at "From existing branch"; only the Mac's page may send; a running terminal, one
// with nothing beyond base, and a second send are refused.      bun tests/terminal-review.ts
import { request as httpRequest } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { staffedCodeStudio } from "./lib/staffed-code-studio";
import { sessionCookieName } from "../src/csrf";

let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { if (v) { pass++; console.log("  ok    " + n); } else { fail++; console.log(("  FAIL  " + n + " " + extra).trimEnd()); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => any, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } return null; };
const s = await staffedCodeStudio("terminal-review");
const port = Number(new URL(s.base).port), cookie = `${sessionCookieName(s.token)}=${s.token}`;
const raw = (method: string, path: string, body?: unknown, as: "page" | "script" = "page") => new Promise<{ status: number; body: any }>((resolve) => {
  const d = method === "GET" ? undefined : JSON.stringify(body ?? {});
  const headers: Record<string, any> = { host: `127.0.0.1:${port}`, ...(as === "page" ? { cookie, origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" } : { "x-crew-session": s.token }), ...(d ? { "content-type": "application/json", "content-length": Buffer.byteLength(d) } : {}) };
  const r = httpRequest({ host: "127.0.0.1", port, method, path, agent: false, headers }, (res) => { const parts: Buffer[] = []; res.on("data", (c) => parts.push(c)); res.on("end", () => { let j = null; try { j = JSON.parse(Buffer.concat(parts).toString()); } catch {} resolve({ status: res.statusCode ?? 0, body: j }); }); });
  r.on("error", (e) => resolve({ status: 0, body: { error: String(e) } })); if (d) r.write(d); r.end();
});
const term = async (id: string) => (await raw("GET", "/api/terminals")).body?.terminals?.find((t: any) => t.id === id);
try {
  const L = (await raw("GET", "/api/terminals")).body;
  const sandbox = L?.projects?.find((p: any) => p.id === "sandbox");
  ok(!!sandbox?.path && sandbox.base === "main", "the sandbox project is offered, with its base", JSON.stringify(L?.projects));
  const G = "git -c user.name=Agent -c user.email=agent@example.invalid";
  const cmd = `${G} checkout -q -b agent/rev && mkdir -p test && printf 'export const half = (n: number) => n / 2;\\n' > src/half.ts && printf 'import { expect, test } from "bun:test";\\ntest("half", async () => { const { half } = await import("../src/half"); expect(half(4)).toBe(2); });\\n' > test/half.test.ts && ${G} add src/half.ts test/half.test.ts && ${G} commit -q -m 'feat: half' && echo COMMITTED && read x`;
  const c = await raw("POST", "/api/terminals", { project: "sandbox", command: cmd, cols: 100, rows: 30 });
  const id = c.body?.terminal?.id; ok(!!id, "a terminal starts in the sandbox project", JSON.stringify(c.body));
  ok(c.body.terminal.git?.start?.branch === "main" && c.body.terminal.git.start.commits === 0, "its start is recorded: on main, nothing beyond base", JSON.stringify(c.body.terminal.git));
  await sleep(1500);
  const early = await raw("POST", `/api/terminals/${id}/review`, {});
  ok(early.status === 409 && early.body?.code === "running", "a terminal still running cannot be sent for review", JSON.stringify(early.body));
  await raw("POST", `/api/terminals/${id}/input`, { data: "\r" });
  const ended = await until(async () => { const t = await term(id); return t && !t.running && t; }, 10000);
  ok(ended?.git?.end?.branch === "agent/rev" && ended.git.end.commits === 1 && /^[0-9a-f]{40}$/.test(ended.git.end.head), "its end is recorded: agent/rev, one commit beyond main", JSON.stringify(ended?.git));
  const sc = await raw("POST", `/api/terminals/${id}/review`, {}, "script");
  ok(sc.status === 403 && sc.body?.code === "pageOnly", "a script cannot send it for review", JSON.stringify(sc.body));
  const sent = await raw("POST", `/api/terminals/${id}/review`, {});
  const run = sent.body?.terminal?.review?.run;
  ok(sent.status === 200 && /^R-\d+$/.test(run ?? ""), "the page sends it for review: a code-firstmate Task starts", JSON.stringify(sent.body));
  ok((await raw("POST", `/api/terminals/${id}/review`, {})).body?.code === "sent", "it is sent only once");
  const runs = async () => (await raw("GET", "/api/wruns", undefined, "script")).body;
  const r = await until(async () => (await runs())?.runs?.find((x: any) => x.id === run), 10000);
  ok(r?.workflow === "code-firstmate", "the Task runs code-firstmate", JSON.stringify(r));
  ok(r?.title === "Review agent/rev from a web terminal (git)", "its title names the branch and the terminal", r?.title);
  // (the drafted spec card itself, the scope check, CI and fail-first, review and merge: tests/branch-intake.ts; this
  // fixture's stub coordinator cannot draft a spec, so here the run stops at Firstmate's scope card after the copy)
  const wt = join(s.data, "work", "wt", "sandbox", run);
  const copied = await until(() => existsSync(join(wt, "src/half.ts")) && Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: wt, stdout: "pipe" }).stdout.toString().trim(), 30000);
  ok(copied === ended.git.end.head, "From existing branch copied the agent's commit into Studio's worktree", `${copied} ${wt}`);
  ok(Bun.spawnSync(["git", "branch", "--show-current"], { cwd: sandbox.path, stdout: "pipe" }).stdout.toString().trim() === "agent/rev", "the project folder stays on the agent's branch");
  ok((await term(id))?.review?.run === run, "the terminal shows the Task it was sent as");
  // review N2: a terminal's button adopts the head it ended on; if another terminal moved the checkout since, it is refused
  const cA = await raw("POST", "/api/terminals", { project: "sandbox", command: `${G} checkout -q -b agent/a main && echo a > a.txt && ${G} add a.txt && ${G} commit -q -m 'feat: a' && echo A-DONE` });
  const endA = await until(async () => { const t = await term(cA.body.terminal.id); return t && !t.running && t; }, 10000);
  const cB = await raw("POST", "/api/terminals", { project: "sandbox", command: `${G} checkout -q -b agent/b main && echo b > b.txt && ${G} add b.txt && ${G} commit -q -m 'feat: b' && echo B-DONE` });
  await until(async () => { const t = await term(cB.body.terminal.id); return t && !t.running; }, 10000);
  const moved = await raw("POST", `/api/terminals/${cA.body.terminal.id}/review`, {});
  ok(endA?.git?.end?.branch === "agent/a" && moved.status === 409 && moved.body?.code === "moved", "a terminal whose checkout another terminal moved since is refused: it would hand over that other work", JSON.stringify(moved.body));
  // review N1: _adopt is Studio's own pin: a caller's POST /api/wruns carrying it starts an ordinary Task at the worktree step
  const forged = await raw("POST", "/api/wruns", { workflow: "code-firstmate", text: "forged adopt", params: { project: "sandbox", _adopt: JSON.stringify({ commit: ended.git.end.head, branch: "agent/rev" }) } }, "script");
  const fid = forged.body?.id ?? forged.body?.run?.id;
  const fwt = join(s.data, "work", "wt", "sandbox", String(fid));
  const fhead = await until(() => existsSync(fwt) && Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: fwt, stdout: "pipe" }).stdout.toString().trim(), 30000);
  const mainHead = Bun.spawnSync(["git", "rev-parse", "main"], { cwd: sandbox.path, stdout: "pipe" }).stdout.toString().trim();
  ok(/^R-\d+$/.test(String(fid)) && fhead === mainHead && fhead !== ended.git.end.head, "a forged _adopt in POST /api/wruns is dropped: the Task's worktree starts on base, not the named commit", `${forged.status} ${JSON.stringify(forged.body).slice(0, 200)} ${fhead}`);

  // nothing beyond base: refused
  const c2 = await raw("POST", "/api/terminals", { project: "sandbox", command: `${G} checkout -q main && echo back` });
  await until(async () => { const t = await term(c2.body.terminal.id); return t && !t.running; }, 10000);
  const none = await raw("POST", `/api/terminals/${c2.body.terminal.id}/review`, {});
  ok(none.status === 409 && none.body?.code === "noCommits", "a terminal whose checkout has nothing beyond base is refused", JSON.stringify(none.body));
} finally { await s.close(); }
console.log(`terminal-review: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
