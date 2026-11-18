// The worker src/terminal-screen.ts draws a terminal's screen in, so a costly output never holds Studio's server. It lives
// as long as Studio and draws one read at a time: {id, raw, cols, rows, budgetMs} in, {id, screen} out. A read over its
// budget answers a "plain" screen (drawScreen stops feeding the emulator), so the worker is never stopped mid-work.
import { drawScreen } from "./terminal-screen";

declare const self: Worker;
let queue: Promise<unknown> = Promise.resolve();
self.onmessage = (e: MessageEvent) => {
  const { id, raw, cols, rows, budgetMs } = e.data as { id: number; raw: string; cols: number; rows: number; budgetMs: number };
  queue = queue.then(async () => {
    try { postMessage({ id, screen: await drawScreen(String(raw ?? ""), Number(cols), Number(rows), Number(budgetMs)) }); } catch { postMessage({ id, screen: null }); }
  });
};
