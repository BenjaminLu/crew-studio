// Proposed dedicated-worker protocol. Not connected to execution: a validated
// manifest is not evidence that an OS boundary exists (see worker-isolation.md).
export type WorkerPolicy = {
  controllerUid: number;
  workerUid: number;
  workerGid: number;
  workerHome: string;
  stagingRoot: string;
  path: string;
};
export type WorkerRequest = {
  run: string;
  argv: string[];
  cwd: string;
  timeoutS: number;
};
export type WorkerManifest = WorkerRequest & {
  protocol: 1;
  uid: number;
  gid: number;
  home: string;
  stagingRoot: string;
  env: Record<string, string>;
};

const relative = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 4096 && !s.startsWith("/") && !s.includes("\\") && !s.includes("\0") && s.split("/").every(p => p !== ".." && p !== "." && p !== "");
const absolute = (s: string) => s.startsWith("/") && s !== "/" && s.length <= 4096 && !s.includes("\0") && s.split("/").slice(1).every(p => p && p !== ".." && p !== ".");

/** Pure broker-side construction. Policy must come from an administrator-owned
 * configuration, never from the request. The helper must independently validate
 * the resulting request and resolve paths without following symlinks. */
export function workerManifest(input: unknown, policy: WorkerPolicy): WorkerManifest {
  if (![policy.controllerUid, policy.workerUid, policy.workerGid].every(n => Number.isSafeInteger(n) && n > 0) || policy.controllerUid === policy.workerUid)
    throw Error("worker requires a distinct non-root OS identity");
  if (![policy.workerHome, policy.stagingRoot].every(absolute) || !policy.path.split(":").every(absolute)) throw Error("invalid trusted worker paths");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("invalid worker request");
  const r = input as Record<string, unknown>;
  if (Object.keys(r).sort().join(",") !== "argv,cwd,run,timeoutS") throw Error("unknown or missing worker request fields");
  if (typeof r.run !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(r.run)) throw Error("invalid run identity");
  if (!relative(r.cwd)) throw Error("cwd must be a relative staging path");
  if (!Array.isArray(r.argv) || r.argv.length === 0 || r.argv.length > 256 || !r.argv.every(s => typeof s === "string" && s.length <= 65536 && !s.includes("\0")) || !r.argv[0]) throw Error("invalid worker argv");
  if (r.argv.reduce((n, s) => n + s.length, 0) > 131072) throw Error("worker argv exceeds protocol limit");
  if (typeof r.timeoutS !== "number" || !Number.isSafeInteger(r.timeoutS) || r.timeoutS < 1 || r.timeoutS > 3600) throw Error("invalid worker deadline");
  return { protocol: 1, run: r.run, argv: [...r.argv], cwd: r.cwd, timeoutS: r.timeoutS,
    uid: policy.workerUid, gid: policy.workerGid, home: policy.workerHome, stagingRoot: policy.stagingRoot,
    env: { PATH: policy.path, HOME: policy.workerHome, LANG: "C.UTF-8", CI: "1", HOST: "127.0.0.1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } };
}

/** Dedicated uid is serialized. An unverified cleanup permanently quarantines
 * this lease; only an independently verified idle worker may accept a new run. */
export class WorkerLease {
  private current: "idle" | "running" | "cleaning" | "quarantined" = "idle";
  get state() { return this.current; }
  private run: string | null = null;
  start(run: string) {
    if (this.state !== "idle" || !run) throw Error("worker unavailable");
    this.run = run; this.current = "running";
  }
  finish(run: string) {
    if (this.state !== "running" || this.run !== run) throw Error("worker run mismatch");
    this.current = "cleaning";
  }
  cleaned(run: string, verified: boolean) {
    if (this.state !== "cleaning" || this.run !== run) throw Error("worker cleanup mismatch");
    this.current = verified === true ? "idle" : "quarantined";
    if (verified === true) this.run = null;
  }
}
