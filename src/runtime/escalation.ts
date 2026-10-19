// Escalations go to Firstmate first (retro 2026-10-17, finding 9). An escalation card node
// (args.firstmate_first: step-back, no progress, round budget, scope blocked, checks that did not
// converge) sends Firstmate the stuck question; Firstmate decides within the spec (another model, a
// rescope with its reason, one more round after an environment fix it made) or escalates with its
// diagnosis. Only then does the captain see a card, and its body is that diagnosis in captain terms:
// what is stuck, why, and what Firstmate recommends. Never a raw worker brief.
import type { Body } from "./engine";
import type { SCard } from "./cards";

type Opt = SCard["options"][number];
/** The notice Firstmate gets: what is stuck, the options it may take itself, and when to escalate instead. */
export function escalationQuestion(label: string, b: Body, all: Opt[], open: Opt[]): string {
  const stuck = String(b.en?.why ?? "").trim() || b.title;
  const opt = (o: Opt) => `${o.id} (${o.label}${o.select?.length ? `; answer is one of: ${o.select.map((s) => s.value).join(", ")}` : o.note ? "; answer is the note" : ""})`;
  const captainOnly = all.filter((o) => !open.some((p) => p.id === o.id));
  return `Escalation at ${label}: ${b.title}\nWhat is stuck: ${stuck}${b.en?.how ? `\nThe options: ${b.en.how}` : ""}\n`
    + `You may decide: ${open.map(opt).join("; ") || "nothing here (escalate)"}.${captainOnly.length ? ` Only the captain may: ${captainOnly.map((o) => o.id).join(", ")}.` : ""}\n`
    + `Decide it yourself when the spec and the evidence settle it (another model, a rescope with a concrete reason, one more round after an environment fix you made). `
    + `Escalate (escalate: what is stuck and why, recommendation: what the captain should pick) only for a one-way decision, a credential or permission, or a preference nobody can infer.`;
}

/** The captain's card after Firstmate (or its silence): the stuck question, why, and the recommendation; the options stay. */
export function diagnosedBody(b: Body, d: { by: "firstmate" | "studio"; why: string; zhWhy?: string; recommendation?: string | null }): Body {
  const stuck = String(b.en?.why ?? "").trim(), zhStuck = String(b.zh?.why ?? "").trim();
  const who = d.by === "firstmate" ? "Firstmate's diagnosis" : "Why it comes to you";
  const zhWho = d.by === "firstmate" ? "Firstmate 的診斷" : "為什麼交給你";
  const rec = d.recommendation ? d.recommendation : null;
  return {
    ...b,
    en: { ...b.en, why: [stuck, `${who}: ${d.why}`].filter(Boolean).join("\n\n"), how: rec ? `Recommended: ${rec}` : b.en?.how },
    zh: { ...(b.zh ?? {}), why: [zhStuck, `${zhWho}：${d.zhWhy ?? d.why}`].filter(Boolean).join("\n\n"), how: rec ? `建議原文：「${rec.replaceAll("「", "﹁").replaceAll("」", "﹂")}」` : b.zh?.how },
    body: [`What is stuck: ${stuck || b.title}`, `${who}: ${d.why}`, rec ? `Recommended: ${rec}` : b.en?.how ? `What you can do: ${b.en.how}` : ""].filter(Boolean).join("\n\n"),
  };
}

type Cause = { en: { short: string; cause: string; action: string }; zh: { short: string; cause: string; action: string }; provider: boolean };
/** A readiness refusal in plain words: the cause the captain can act on and the exact action (the raw reason stays in the body's detail). */
export function readinessCause(reason: string): Cause {
  const c = (provider: boolean, en: [string, string, string], zh: [string, string, string]): Cause => ({ provider, en: { short: en[0], cause: en[1], action: en[2] }, zh: { short: zh[0], cause: zh[1], action: zh[2] } });
  const dep = /dependency (R-\d+)/.exec(reason)?.[1], held = /scope held by (R-\d+)/.exec(reason)?.[1], skill = /role skill (\S+) changed since staffing approval/i.exec(reason)?.[1];
  if (dep) return c(false, [`it waits for ${dep}`, `This task depends on ${dep}, and ${dep} has no verified merge yet.`, `Merge ${dep} first (or close it), then approve fresh preparation.`],
    [`等待 ${dep}`, `這個任務依賴 ${dep}，而 ${dep} 還沒有可驗證的合併。`, `先合併 ${dep}（或關閉它），再核准重新準備。`]);
  if (held) return c(false, [`its scope overlaps ${held}`, `Its scope overlaps ${held}, which is still open; two tasks never change the same files at once.`, `Wait until ${held} merges or closes, then approve fresh preparation.`],
    [`範圍與 ${held} 重疊`, `它的範圍和仍在進行的 ${held} 重疊；兩個任務不會同時改同一批檔案。`, `等 ${held} 合併或關閉後，再核准重新準備。`]);
  if (/capacity.*full/i.test(reason)) return c(false, ["every round slot is busy", "Every live round slot is in use right now.", "Wait for a running round to finish, then approve fresh preparation; or close this task."],
    ["回合名額都在使用中", "目前所有可同時執行的回合名額都在使用中。", "等一個執行中的回合結束後核准重新準備，或關閉這個任務。"]);
  if (/deadline/i.test(reason)) return c(false, ["the wait for a free round ran out", "The task waited for a free round until its wait time ran out.", "Approve fresh preparation to queue again, or close this task."],
    ["等待時間已到", "這個任務排隊等回合，等到時間用完了。", "核准重新準備以重新排隊，或關閉這個任務。"]);
  if (skill) return c(false, [`role skill ${skill} changed`, `The role skill ${skill} changed after the staffing was approved, so this round may not use it unseen.`, "Approve the changed skill (the option on this card), or ask Firstmate for a new staffing approval."],
    [`角色技能 ${skill} 已變更`, `角色技能 ${skill} 在派工核准之後變更了，這一輪不能在沒看過的情況下使用它。`, "用本卡的選項核准變更後的技能，或請 Firstmate 重新提出派工核准。"]);
  if (/staffing|role configuration/i.test(reason)) return c(false, ["the staffing is not approved", "The staffing (who works on each role, with which model) is not approved for this task.", "Approve the staffing in Firstmate, then approve fresh preparation."],
    ["派工配置尚未核准", "這個任務的派工配置（每個角色由誰、用哪個模型）尚未核准。", "先在 Firstmate 核准派工配置，再核准重新準備。"]);
  if (/historical|binding|scope pin|dispatch/i.test(reason)) return c(false, ["the approved scope no longer matches", "The approved scope or its dependency pins no longer match this round.", "Rescope or dispatch the task again, then approve fresh preparation."],
    ["核准的範圍已不相符", "核准的範圍或依賴綁定和這一輪不再相符。", "重新界定範圍或重新派工後，再核准重新準備。"]);
  if (/capacity|wait_timeout/i.test(reason)) return c(false, ["the queue settings are invalid", "The queue settings (round capacity or wait time) are not valid numbers.", "Fix the round capacity and wait time in Settings, then approve fresh preparation."],
    ["排隊設定無效", "排隊設定（回合容量或等待時間）不是有效的數值。", "在設定裡修正回合容量和等待時間後，再核准重新準備。"]);
  if (/model|effort/i.test(reason)) return c(true, ["the model is not verified", "The configured model or effort is not verified as available on its provider.", "Check the model in Settings (Doctor shows the provider), then approve fresh preparation."],
    ["模型尚未驗證", "設定的模型或推理強度還沒有驗證為可用。", "在設定裡確認模型（Doctor 會顯示供應商狀態）後，再核准重新準備。"]);
  if (/provider|capability|login|quota|sign.?in/i.test(reason)) return c(true, ["no provider is ready", "No provider has a verified sign-in, quota and model right now, so the round did not start.", "Sign in or wait for quota (Doctor shows which provider), then approve fresh preparation."],
    ["沒有可用的供應商", "目前沒有登入、額度和模型都已驗證的供應商，所以回合沒有開始。", "登入或等額度恢復（Doctor 會顯示是哪個供應商）後，再核准重新準備。"]);
  return c(false, ["Studio could not confirm it may start", "Studio could not confirm this round may start: its permission to run or its evidence is not confirmed.", "Approve fresh preparation to check again, or close this task."],
    ["無法確認可以開始", "Studio 無法確認這一輪可以開始：執行權或驗證資料尚未確認。", "核准重新準備以重新檢查，或關閉這個任務。"]);
}
