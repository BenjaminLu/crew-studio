import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Add local project form's "Choose folder…" (docs/units/local-project-add.md): POST /api/projects/pick-folder asks
// the OS for a folder through an injected runner, so no real dialog ever opens here.          bun tests/folder-picker.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFolderPicker, spawnRun, type PickRun } from "../src/folder-picker";
import { createProjectOverview } from "../src/project-overview";
import { Projects } from "../src/doors";

let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log((v ? "ok   " : "FAIL ") + n + (v ? "" : ` ${extra}`)); v ? pass++ : fail++; };
const data = mkdtempSync(join(tmpdir(), "crew-folder-picker-"));
const SESSION = "folder-picker-session";
type Call = { cmd: string; args: string[]; timeoutMs: number };
const runner = (answer: () => Promise<Awaited<ReturnType<PickRun>>>) => { const calls: Call[] = []; const run: PickRun = async (cmd, args, o) => { calls.push({ cmd, args, timeoutMs: o.timeoutMs }); return answer(); }; return { calls, run }; };
const overviewWith = (picker: ReturnType<typeof createFolderPicker>) => createProjectOverview({ dataDir: data, engine: { cards: { list: () => [] }, list: () => [] } as any, projects: new Projects(data), session: SESSION, worktrees: { all: () => [] }, folderPicker: picker });
const post = (ov: ReturnType<typeof overviewWith>, who: any = { kind: "desktop" }, headers: Record<string, string> = { "x-crew-session": SESSION }, method = "POST") => {
  const req = new Request("http://127.0.0.1/api/projects/pick-folder", { method, headers: { "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: "{}" }) });
  return ov.handle(req, new URL(req.url), who, method !== "GET").then(async (r) => ({ status: r?.status, body: r ? await r.json() : null }));
};
try {
  // success: osascript's POSIX path ends in "/" and a newline; the field gets the folder without either
  { const r = runner(async () => ({ code: 0, stdout: "/Users/you/code/repo/\n", stderr: "" })), ov = overviewWith(createFolderPicker({ platform: "darwin", run: r.run }));
    const a = await post(ov);
    ok(a.status === 200 && a.body.path === "/Users/you/code/repo", "a chosen folder answers its absolute path, trailing slash and newline dropped", JSON.stringify(a.body));
    ok(r.calls.length === 1 && r.calls[0].cmd === "osascript", "it runs osascript");
    const args = r.calls[0].args, script = args.filter((_, i) => args[i - 1] === "-e").join("\n");
    ok(/choose folder with prompt \(item 1 of argv\)/.test(script) && /POSIX path of/.test(script), "the script asks choose folder for a POSIX path, the prompt from argv");
    ok(/tell me to activate/.test(script) && !/tell application "(Finder|System Events)"/.test(script), "the dialog is brought to the front without scripting another application");
    ok(args.at(-2) === "--" && !script.includes(args.at(-1)!), "the prompt is passed as an argument after --, never spliced into the script");
    ok(r.calls[0].timeoutMs >= 60_000, "the dialog may stay open for minutes", String(r.calls[0].timeoutMs));
    ok((await post(ov, { kind: "desktop" }, { "x-crew-session": SESSION }, "GET")).status === 405, "a GET is refused (405)");
    ok(r.calls.length === 1, "a refused request runs nothing"); }
  { const r = runner(async () => ({ code: 0, stdout: "/\n", stderr: "" })); ok((await createFolderPicker({ platform: "darwin", run: r.run }).pick() as any).path === "/", "the root folder stays /"); }
  // cancel: AppleScript error -128, no error shown, no path
  { const r = runner(async () => ({ code: 1, stdout: "", stderr: "0:83: execution error: User canceled. (-128)\n" })), ov = overviewWith(createFolderPicker({ platform: "darwin", run: r.run }));
    const a = await post(ov); ok(a.status === 200 && a.body.cancelled === true && !("path" in a.body) && !a.body.error, "Cancel in the dialog answers {cancelled:true}", JSON.stringify(a.body)); }
  // any other failure: a fixed message, never osascript's output
  { const r = runner(async () => ({ code: 1, stdout: "", stderr: "secret detail /private/path" })), ov = overviewWith(createFolderPicker({ platform: "darwin", run: r.run }));
    const a = await post(ov); ok(a.status === 500 && a.body.code === "failed" && a.body.tw && !JSON.stringify(a.body).includes("/private/path"), "a failed dialog answers a fixed error without the tool's output", JSON.stringify(a.body)); }
  { const r = runner(async () => ({ code: null, stdout: "", stderr: "", timedOut: true })), ov = overviewWith(createFolderPicker({ platform: "darwin", run: r.run, timeoutMs: 5 }));
    const a = await post(ov); ok(a.status === 504 && a.body.code === "timeout", "a dialog left open past the limit is closed and says so", JSON.stringify(a.body)); }
  // one dialog at a time; the next one opens once it is answered
  { let release!: () => void; const gate = new Promise<void>((res) => (release = res));
    const r = runner(async () => { await gate; return { code: 0, stdout: "/tmp/one/\n", stderr: "" }; }), ov = overviewWith(createFolderPicker({ platform: "darwin", run: r.run }));
    const first = post(ov); await Bun.sleep(5);
    // a second dialog would wait on the same gate: give up after a second rather than hang the suite
    const second: any = await Promise.race([post(ov), Bun.sleep(1000).then(() => ({ status: 0, body: { code: "waited for a second dialog" } }))]);
    ok(second.status === 409 && second.body.code === "busy" && r.calls.length === 1, "a second request while a dialog is open is refused (409 busy) and opens nothing", JSON.stringify(second.body));
    release(); ok((await first).body.path === "/tmp/one", "the first dialog still answers");
    const third = await post(ov); ok(third.status === 200 && r.calls.length === 2, "after it is answered the next dialog may open"); }
  { let n = 0; const run: PickRun = async () => { n++; throw new Error("spawn failed"); }; const ov = overviewWith(createFolderPicker({ platform: "darwin", run }));
    const a = await post(ov), b = await post(ov); ok(a.status === 500 && b.status === 500 && n === 2, "a runner that throws frees the slot for the next request"); }
  // gating: desktop with Studio's session only, checked before any dialog
  { const r = runner(async () => ({ code: 0, stdout: "/x/\n", stderr: "" })), ov = overviewWith(createFolderPicker({ platform: "darwin", run: r.run }));
    ok((await post(ov, { kind: "desktop" }, {})).status === 401, "a desktop request without Studio's session: 401");
    ok((await post(ov, { kind: "desktop" }, { "x-crew-session": "wrong" })).status === 401, "a wrong session: 401");
    const ph = await post(ov, { kind: "phone", device: { id: "d" } }); ok(ph.status === 403 && ph.body.code === "desktopOnly", "a paired phone: 403 desktopOnly");
    ok((await post(ov, { kind: "refused" })).status === 403, "anyone else: 403");
    ok(r.calls.length === 0, "no refused request opens a dialog");
    const side = await ov.handle(new Request("http://127.0.0.1/api/projects/overview", { headers: { "x-crew-session": SESSION } }), new URL("http://127.0.0.1/api/projects/overview"), { kind: "desktop" }, false);
    ok((await side!.json()).folderPicker === true, "the sidebar read tells the Mac's page the button is available");
    const sidePhone = await ov.handle(new Request("http://127.0.0.1/api/projects/overview"), new URL("http://127.0.0.1/api/projects/overview"), { kind: "phone", device: { id: "d" } } as any, false);
    ok((await sidePhone!.json()).folderPicker === false, "a phone's page is not offered it"); }
  // not macOS: unsupported, the page hides the button
  { const r = runner(async () => ({ code: 0, stdout: "/x/\n", stderr: "" })), picker = createFolderPicker({ platform: "linux", run: r.run }), ov = overviewWith(picker);
    const a = await post(ov); ok(a.status === 501 && a.body.code === "unsupported" && a.body.tw && r.calls.length === 0, "elsewhere than macOS: 501 unsupported, nothing runs", JSON.stringify(a.body));
    const side = await ov.handle(new Request("http://127.0.0.1/api/projects/overview", { headers: { "x-crew-session": SESSION } }), new URL("http://127.0.0.1/api/projects/overview"), { kind: "desktop" }, false);
    ok((await side!.json()).folderPicker === false, "and the sidebar read says the button is not available"); }
  // the real runner (with a harmless command, never osascript): its timeout and an abort both end the process
  { const t0 = Date.now(), r = await spawnRun("sleep", ["5"], { timeoutMs: 50 });
    ok(r.timedOut === true && Date.now() - t0 < 3000, "the real runner kills a process that outlives its timeout");
    const ac = new AbortController(); setTimeout(() => ac.abort(), 30); const t1 = Date.now(), a = await spawnRun("sleep", ["5"], { timeoutMs: 60_000, signal: ac.signal });
    ok(!a.timedOut && a.code !== 0 && Date.now() - t1 < 3000, "an aborted request (the page went away) closes the dialog");
    const e = await spawnRun("printf", ["/tmp/x/\\n"], { timeoutMs: 5000 }); ok(e.code === 0 && e.stdout === "/tmp/x/\n", "the real runner returns stdout and the exit code"); }
} finally { rmSync(data, { recursive: true, force: true }); }
console.log(`folder-picker: ${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
