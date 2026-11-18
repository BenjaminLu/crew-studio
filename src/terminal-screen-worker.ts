// The worker src/terminal-screen.ts draws a terminal's screen in, so a costly output never holds Studio's server: it gets
// {raw, cols, rows} and answers the Screen once. Its parent stops it when it takes too long.
import { drawScreen } from "./terminal-screen";

declare const self: Worker;
self.onmessage = async (e: MessageEvent) => {
  const { raw, cols, rows } = e.data as { raw: string; cols: number; rows: number };
  try { postMessage(await drawScreen(String(raw ?? ""), Number(cols), Number(rows))); } catch { postMessage(null); }
};
