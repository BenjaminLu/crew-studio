// The Add local project form's "Choose folder…": a page cannot learn a folder's absolute path, so Studio asks the OS.
// On macOS it runs osascript's `choose folder` (argument vector, no shell; the prompt goes in as argv, never into the
// script text) and answers {path} with the trailing slash dropped, or {cancelled:true} when the captain cancels
// (AppleScript error -128). One dialog at a time; a dialog left open is closed after `timeoutMs`. Elsewhere it is
// unsupported and the page hides the button. `run` is injectable so tests never open a real dialog.
import { spawn } from "node:child_process";

export type PickRun = (cmd: string, args: string[], o: { timeoutMs: number; signal?: AbortSignal }) =>
  Promise<{ code: number | null; stdout: string; stderr: string; timedOut?: boolean }>;
export type PickResult = { path: string } | { cancelled: true };
export class FolderPickerError extends Error {
  constructor(public code: "unsupported" | "busy" | "timeout" | "failed", public status: number, en: string, public tw: string) { super(en); }
}

// `tell me to activate` brings osascript's own dialog to the front: no other application is scripted, so no
// Automation (Apple Events) permission is asked for
const SCRIPT = ["on run argv", "tell me to activate", "return POSIX path of (choose folder with prompt (item 1 of argv))", "end run"];
const PROMPT = "Choose a local Git repository / 選擇本機 Git 儲存庫";

export const spawnRun: PickRun = (cmd, args, o) => new Promise((resolve) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", timedOut = false, done = false;
  // decoded as a stream, so a character split across two chunks stays whole
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (b) => { if (stdout.length < 64_000) stdout += b; });
  child.stderr.on("data", (b) => { if (stderr.length < 64_000) stderr += b; });
  const kill = () => { try { child.kill("SIGTERM"); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs);
  o.signal?.addEventListener("abort", kill, { once: true });
  const end = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); o.signal?.removeEventListener("abort", kill); resolve({ code, stdout, stderr, timedOut }); };
  child.on("error", (e) => { stderr += String(e?.message ?? e); end(null); });
  child.on("close", (code) => end(code));
});

export function createFolderPicker(o: { platform?: string; run?: PickRun; timeoutMs?: number } = {}) {
  const platform = o.platform ?? process.platform, run = o.run ?? spawnRun, timeoutMs = o.timeoutMs ?? 5 * 60_000;
  const supported = platform === "darwin";
  let busy = false;
  async function pick(signal?: AbortSignal): Promise<PickResult> {
    if (!supported) throw new FolderPickerError("unsupported", 501, "Choosing a folder is available on macOS only. Type the path instead.", "只有 macOS 能選擇資料夾，請直接輸入路徑。");
    if (busy) throw new FolderPickerError("busy", 409, "A folder dialog is already open. Finish or cancel it first.", "已經開著一個選擇資料夾的視窗，請先完成或取消。");
    busy = true;
    try {
      const r = await run("osascript", [...SCRIPT.flatMap((l) => ["-e", l]), "--", PROMPT], { timeoutMs, signal });
      if (r.timedOut) throw new FolderPickerError("timeout", 504, "The folder dialog was left open too long and was closed.", "選擇資料夾的視窗開太久，已關閉。");
      if (r.code !== 0 && /\(-128\)/.test(r.stderr)) return { cancelled: true };
      if (signal?.aborted) return { cancelled: true };
      const raw = r.stdout.replace(/\r?\n$/, "");
      if (r.code !== 0 || !raw.startsWith("/")) throw new FolderPickerError("failed", 500, "The folder dialog could not be opened. Type the path instead.", "無法開啟選擇資料夾的視窗，請直接輸入路徑。");
      return { path: raw.length > 1 ? raw.replace(/\/+$/, "") || "/" : raw };
    } finally { busy = false; }
  }
  return { supported, pick };
}
export type FolderPicker = ReturnType<typeof createFolderPicker>;
