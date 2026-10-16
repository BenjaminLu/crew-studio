// One word for a run's state, the same on Runs, the Board and the run page (docs/units/run-end-and-remove.md):
// Running, Waiting for you, Merged, Done, Closed without merging, Cancelled, Failed (and Paused).
// A run that ended at a "closed" end node is `succeeded` with result `closed`: it reads "Closed without
// merging", in a neutral colour, never the success green.
//   window.runState({ status, result, merged }) → { key, en, tw, tone }   tone: run | human | ok | neutral | bad | warn
//   window.runStateBadge(run)                  → <span class="badge …" data-run-state="key">word</span>
(() => {
const WORDS = {
  running: ["Running", "進行中", "run"], waiting: ["Waiting for you", "等你處理", "human"], paused: ["Paused", "已暫停", "warn"],
  merged: ["Merged", "已合併", "ok"], done: ["Done", "完成", "ok"], closed: ["Closed without merging", "未合併就關閉", "neutral"],
  dispatched: ["Proposal dispatched", "提案已派工", "neutral"],
  cancelled: ["Cancelled", "已取消", "neutral"], failed: ["Failed", "失敗", "bad"],
};
const FAILED_RESULTS = new Set(["fail", "error", "timeout", "cap"]);
function key(r) {
  const s = r?.status;
  if (s === "queued" || s === "running") return "running";
  if (s === "waiting") return "waiting";
  if (s === "paused") return "paused";
  if (s === "cancelled") return "cancelled";
  if (s === "failed") return "failed";
  if (s === "succeeded") { const res = r.result || "done"; if (res === "closed") return "closed"; if (FAILED_RESULTS.has(res)) return "failed"; if (r.workflow === "firstmate-proposal") return "dispatched"; return r.merged || r.ctx?.merged ? "merged" : "done"; }
  return "running";
}
window.runState = (r) => { const k = key(r); const [en, tw, tone] = WORDS[k]; return { key: k, en, tw, tone }; };
window.runStateBadge = (r) => {
  const s = window.runState(r); const zh = document.documentElement.lang === "zh-TW";
  const cls = s.tone === "neutral" ? "badge neutral" : `badge ${s.tone}`;
  return h("span", { class: `${cls} rs-badge`, "data-run-state": s.key, title: r?.cancelReason ? `${zh ? s.tw : s.en}: ${r.cancelReason}` : null }, h("span", { class: `d${s.key === "running" ? " pulse" : ""}` }), zh ? s.tw : s.en);
};
})();
