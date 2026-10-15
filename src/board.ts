// Answers a card through the firstmate board's own write route, exactly as a
// script on the operator's machine does: POST /decisions with the board's
// secret as a Bearer token, the board's own Origin, and a JSON body. The
// board validates and records the answer; Crew Studio never writes state.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Answer = { id: string; chosen: string; project?: string | null; text?: string; answers?: { index: number; ok: boolean; text?: string }[];
  /** a one-way merge: the captain reviewed every intent and answered the check, exactly as on the board */
  door?: { reviewed_intents: number[]; check_answer: number; locale: string } };

export class Board {
  constructor(readonly url: string, readonly secretFile: string, readonly enabled: boolean, readonly disabledReason = "CREW_READONLY=1") {}

  static fromEnv(legacy = true): Board {
    const url = (process.env.CREW_BOARD_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "");
    const port = new URL(url).port || "80";
    const cfg = (process.env.XDG_CONFIG_HOME ?? "").startsWith("/") ? process.env.XDG_CONFIG_HOME! : join(homedir(), ".config");
    const secretFile = process.env.CREW_BOARD_SECRET ?? join(cfg, "firstmate", `board-${port}.secret`);
    return new Board(url, secretFile, legacy && process.env.CREW_READONLY !== "1", legacy ? "CREW_READONLY=1" : "legacy adapter disabled");
  }

  private secret(): string | null {
    if (!existsSync(this.secretFile)) return null;
    const s = readFileSync(this.secretFile, "utf8").trim();
    return /^[0-9a-f]{64,}$/.test(s) ? s : null;
  }

  status() {
    return { url: this.url, writable: this.enabled && this.secret() !== null, readonlyReason: !this.enabled ? this.disabledReason : this.secret() ? null : "no board secret file" };
  }

  async answer(a: Answer): Promise<{ status: number; body: any }> {
    if (!this.enabled) return { status: 403, body: { error: `Crew Studio is read-only (${this.disabledReason})`, code: "readOnly" } };
    const secret = this.secret();
    if (!secret) return { status: 403, body: { error: `no board secret at ${this.secretFile}`, code: "noSecret" } };
    return this.post("/decisions", this.body(a));
  }

  /** The board's own door check (POST /decisions/check-door): verifies the intents and the check answer, records nothing. */
  async checkDoor(d: { id: string; reviewed_intents: number[]; check_answer: number; locale: string }): Promise<{ status: number; body: any }> {
    if (!this.enabled) return { status: 403, body: { error: `Crew Studio is read-only (${this.disabledReason})`, code: "readOnly" } };
    return this.post("/decisions/check-door", d);
  }

  private body(a: Answer) {
    const body: Record<string, unknown> = { id: a.id, chosen: a.chosen };
    if (a.project) body.project = a.project;
    if (a.chosen === "custom") body.text = a.text ?? "";
    if (a.answers) body.answers = a.answers;
    if (a.door) Object.assign(body, a.door);
    return body;
  }

  private async post(path: string, body: unknown): Promise<{ status: number; body: any }> {
    const secret = this.secret();
    if (!secret) return { status: 403, body: { error: `no board secret at ${this.secretFile}`, code: "noSecret" } };
    try {
      const r = await fetch(`${this.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, origin: this.url },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = { error: text.slice(0, 300) }; }
      return { status: r.status, body: parsed };
    } catch (e: any) {
      return { status: 502, body: { error: `the board at ${this.url} did not answer: ${e?.message ?? e}`, code: "unreachable" } };
    }
  }
}
