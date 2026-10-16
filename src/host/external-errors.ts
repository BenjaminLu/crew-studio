// Errors from outside Studio (the Claude or Codex CLI, the vendor API, the network, a process exit, an
// upload or attachment the host cannot take) shown to the captain as typed chat notices: a class, a code,
// a plain reason, and the exact external message (credentials removed, control characters stripped,
// bounded). Like native tool failures (native-errors.ts) the reason is Studio's own words; unlike them the
// vendor's message is shown too, because it is the captain's own account talking to the captain.
import { redactText } from "../secure";

export type ExternalClass = "quota" | "auth" | "timeout" | "network" | "exit" | "attachment" | "upload" | "api";
export type ExternalSource = "claude" | "codex" | "studio";
export type ExternalError = { schema: 1; source: ExternalSource; class: ExternalClass; code: string; message: string; reason: { en: string; "zh-TW": string } };

export const EXTERNAL_MESSAGE_MAX = 600;
/** The external message as it may be shown and kept: no credentials, no control characters, at most EXTERNAL_MESSAGE_MAX characters. */
export function cleanExternal(raw: unknown): string {
  const s = redactText(String(raw ?? "")).replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  return s.length > EXTERNAL_MESSAGE_MAX ? s.slice(0, EXTERNAL_MESSAGE_MAX - 1) + "…" : s;
}

/** The class of an external message, from its own words. */
export function classify(message: string): ExternalClass {
  const m = message.toLowerCase();
  if (/rate.?limit|quota|usage.?limit|insufficient_quota|credit balance|\b429\b|too many requests|spend.?limit/.test(m)) return "quota";
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|not logged in|please run \/login|authentication|invalid.{0,20}(token|key|credential)|sign.?in|log.?in again/.test(m)) return "auth";
  if (/timed? ?out|timeout|etimedout|deadline exceeded/.test(m)) return "timeout";
  if (/econn(reset|refused|aborted)|enotfound|eai_again|network|stream disconnected|socket hang up|fetch failed|connection (reset|refused|closed|error)|dns|offline|\b50[234]\b|overloaded/.test(m)) return "network";
  if (/exited\b|exit code|\bsig(term|kill|segv|abrt)\b|crash/.test(m)) return "exit";
  return "api";
}

const REASONS: Record<ExternalClass, (who: string) => { en: string; "zh-TW": string }> = {
  quota: (who) => ({ en: `${who} refused: quota or rate limit. Wait for the reset; Studio does not switch vendors.`, "zh-TW": `${who} 拒絕：額度或頻率限制。請等重設；Studio 不會換供應商。` }),
  auth: (who) => ({ en: `${who} refused the sign-in. Sign in again on its account card.`, "zh-TW": `${who} 拒絕登入，請在它的帳號卡片重新登入。` }),
  timeout: (who) => ({ en: `${who} timed out. Check the state before trying again.`, "zh-TW": `${who} 逾時，重試前請先確認狀態。` }),
  network: (who) => ({ en: `${who} could not reach its service (network).`, "zh-TW": `${who} 連不到服務（網路）。` }),
  exit: (who) => ({ en: `The ${who} process stopped.`, "zh-TW": `${who} 程序已停止。` }),
  attachment: () => ({ en: "An attachment could not be sent.", "zh-TW": "附件無法送出。" }),
  upload: () => ({ en: "The upload failed.", "zh-TW": "上傳失敗。" }),
  api: (who) => ({ en: `${who} returned an error.`, "zh-TW": `${who} 回傳錯誤。` }),
};
const WHO: Record<ExternalSource, string> = { claude: "Claude", codex: "Codex", studio: "Studio" };

/** A typed external error; the class comes from the message unless the caller knows it. */
export function externalError(source: ExternalSource, raw: unknown, o: { cls?: ExternalClass; code?: string } = {}): ExternalError {
  const message = cleanExternal(raw) || `${WHO[source]} gave no error text.`;
  const cls = o.cls ?? classify(message);
  return { schema: 1, source, class: cls, code: o.code ?? `${source}_${cls}`, message, reason: REASONS[cls](WHO[source]) };
}

/** The vendor's own words in a Claude stream-json error event. */
export function claudeVendorMessage(m: any): string {
  return [m?.error?.message, typeof m?.error === "string" ? m.error : null, m?.result, ...(Array.isArray(m?.errors) ? m.errors : []),
    m?.type === "rate_limit_event" ? `rate limit ${m.rate_limit_info?.status ?? ""}${m.rate_limit_info?.resetsAt ? ` until ${new Date(m.rate_limit_info.resetsAt * 1000).toISOString()}` : ""}` : null]
    .filter((x) => typeof x === "string" && x.trim()).join(" · ");
}
