// One word for a run's state, the same on Runs, the Board and the run page (docs/units/run-end-and-remove.md):
// Running, Waiting for you, Merged, Done, Closed without merging, Cancelled, Failed (and Paused).
// A Task that ended closed or cancelled although GitHub shows its pull request merged into its base (an older release closed it)
// reads "Merged (reconciled)" once Studio recorded that observation (run.reconciled, its signed reconciled-merge entry); when
// GitHub merged another head than the one Studio verified it reads "Merged (reconciled, unverified head)", in the warning colour.
// A run that ended at a "closed" end node is `succeeded` with result `closed`: it reads "Closed without
// merging", in a neutral colour, never the success green.
//   window.runState({ status, result, merged }) → { key, en, tw, tone }   tone: run | human | ok | neutral | bad | warn
//   window.runStateBadge(run)                  → <span class="badge …" data-run-state="key">word</span>
(() => {
const WORDS = {
  running: ["Running", "進行中", "run"], waiting: ["Waiting for you", "等你處理", "human"], firstmate: ["Waiting for Firstmate", "等 Firstmate 回答", "run"], paused: ["Paused", "已暫停", "warn"],
  merged: ["Merged", "已合併", "ok"], reconciled: ["Merged (reconciled)", "已合併（事後核對）", "ok"], "reconciled-unverified": ["Merged (reconciled, unverified head)", "已合併（事後核對，非 Studio 驗證的版本）", "warn"], done: ["Done", "完成", "ok"], closed: ["Closed without merging", "未合併就關閉", "neutral"],
  dispatched: ["Proposal dispatched", "提案已派工", "neutral"],
  cancelled: ["Cancelled", "已取消", "neutral"], failed: ["Failed", "失敗", "bad"],
};
const FAILED_RESULTS = new Set(["fail", "error", "timeout", "cap"]);
function key(r) {
  const s = r?.status;
  if (r?.reconciled && (s === "succeeded" || s === "cancelled")) return r.reconciled.verifiedHead === false ? "reconciled-unverified" : "reconciled";
  if (s === "queued" || s === "running") return "running";
  if (s === "waiting") return r.ctx?.firstmateQuestion && !r.failureCard ? "firstmate" : "waiting"; // an agent's question is Firstmate's turn, not the captain's
  if (s === "paused") return "paused";
  if (s === "cancelled") return "cancelled";
  if (s === "failed") return "failed";
  if (s === "succeeded") { const res = r.result || "done"; if (res === "closed") return "closed"; if (FAILED_RESULTS.has(res)) return "failed"; if (r.workflow === "firstmate-proposal") return "dispatched"; return r.merged || r.ctx?.merged ? "merged" : "done"; }
  return "running";
}
window.runState = (r) => { const k = key(r); const [en, tw, tone] = WORDS[k]; const artifact=k==="closed"&&(r.def?.kind==="coffee-kit"||r.workflow==="coffee-kit"||r.ctx?.deliver||r.ctx?.coffee);return { key:k,en:artifact?"Closed without approval":en,tw:artifact?"尚未驗收就關閉":tw,tone }; };
window.runStateBadge = (r) => {
  const s = window.runState(r); const word = T(s.en, s.tw);
  const cls = s.tone === "neutral" ? "badge neutral" : `badge ${s.tone}`;
  return h("span", { class: `${cls} rs-badge`, "data-run-state": s.key, title: r?.cancelReason ? `${word}: ${r.cancelReason}` : null }, h("span", { class: `d${s.key === "running" ? " pulse" : ""}` }), word);
};
})();
