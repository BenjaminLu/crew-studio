// What scripts/lan-two-machine.ts must never use: the live board's port or data dir. Pure, so it is tested without
// starting anything. Live means: the fixed 4210, the port and data dir in ~/.crew-studio/releases/live.json, the
// default ~/.crew-studio/data, and CREW_PORT / CREW_DATA from the operator's environment or .env (Bun loads it when
// the script runs from the checkout), which still name the live board when live.json has no `live` (stopped, failed).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };

export function liveBoardRefusal(o: { port: number; data: string; home: string; env: Record<string, string | undefined> }): string | null {
  const record = join(o.home, ".crew-studio", "releases", "live.json");
  let live: any = null;
  if (existsSync(record)) { try { live = JSON.parse(readFileSync(record, "utf8"))?.live ?? null; } catch { live = null; } }
  const ports = new Set<number>([4210]);
  if (live?.port) ports.add(Number(live.port));
  if (o.env.CREW_PORT && Number.isFinite(Number(o.env.CREW_PORT))) ports.add(Number(o.env.CREW_PORT));
  const datas = new Set<string>([join(o.home, ".crew-studio", "data")]);
  if (live?.data) datas.add(String(live.data));
  if (o.env.CREW_DATA) datas.add(String(o.env.CREW_DATA));
  if (ports.has(o.port)) return `--port ${o.port} is the live board's port; pick another (default 4310)`;
  const data = real(o.data);
  if ([...datas].map(real).includes(data)) return `--data ${o.data} is a live board data dir; pick another (default ~/crew-lan-trial)`;
  return null;
}
