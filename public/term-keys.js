// The terminal page's keys (docs/units/web-terminal.md, "Tabs, panes and keys"): each platform's own terminal habits.
// Mac follows iTerm2 (⌘), Windows and Linux follow Windows Terminal (Ctrl+Shift, Alt). A browser tab keeps a few chords for
// itself (new, close and restore tab, new window, next and previous tab); a Studio window (Chrome --app, or the installed
// app) and fullscreen keep none, so there the first chord works. Every action whose first chord a tab takes has a second
// chord the browser never takes; both always work, and the hints show the one that works where the page is now.
// Chords are matched on KeyboardEvent.code (the physical key), so a keyboard layout or an input method does not move them.
// Pure: no DOM, no page state (tests/terminal-keys.ts runs it under Bun). Loaded before terminals.js.
(() => {
// [group, action, label, mac [chord, chord-in-a-tab], win [chord, chord-in-a-tab]]
const KEYMAP = [
  [["Tabs", "分頁"], "newTab", ["New tab", "新分頁"], ["Meta+KeyT", "Alt+KeyT"], ["Ctrl+Shift+KeyT", "Ctrl+Alt+KeyT"]],
  [["Tabs", "分頁"], "tabN", ["Go to tab 1–9", "跳到第 1–9 個分頁"], ["Meta+Digit"], ["Ctrl+Alt+Digit"]],
  [["Tabs", "分頁"], "nextTab", ["Next tab", "下一個分頁"], ["Shift+Meta+BracketRight", "Alt+Shift+BracketRight"], ["Ctrl+Tab", "Ctrl+Alt+PageDown"]],
  [["Tabs", "分頁"], "prevTab", ["Previous tab", "上一個分頁"], ["Shift+Meta+BracketLeft", "Alt+Shift+BracketLeft"], ["Ctrl+Shift+Tab", "Ctrl+Alt+PageUp"]],
  [["Tabs", "分頁"], "renameTab", ["Rename tab", "分頁改名"], ["F2"], ["F2"]],
  [["Panes", "窗格"], "splitRight", ["Split right", "向右分割"], ["Meta+KeyD"], ["Alt+Shift+Equal"]],
  [["Panes", "窗格"], "splitDown", ["Split down", "向下分割"], ["Shift+Meta+KeyD"], ["Alt+Shift+Minus"]],
  [["Panes", "窗格"], "focus", ["Move to the pane in a direction", "往某個方向換窗格"], ["Alt+Meta+Arrow", "Ctrl+Alt+Arrow"], ["Alt+Arrow"]],
  [["Panes", "窗格"], "nextPane", ["Next / previous pane", "下一個 / 上一個窗格"], ["Meta+Bracket"], ["Ctrl+Alt+Bracket"]],
  [["Panes", "窗格"], "swap", ["Swap with the pane beside", "和旁邊的窗格交換"], ["Alt+Shift+Meta+Arrow"], ["Ctrl+Alt+Shift+Arrow"]],
  [["Panes", "窗格"], "resize", ["Resize", "調整大小"], ["Ctrl+Meta+Arrow"], ["Alt+Shift+Arrow"]],
  [["Panes", "窗格"], "zoom", ["Zoom / restore", "放大 / 還原"], ["Shift+Meta+Enter"], ["Ctrl+Shift+Enter"]],
  [["Panes", "窗格"], "closePane", ["Close pane (the last one closes the tab)", "關閉窗格（最後一個就關分頁）"], ["Meta+KeyW", "Alt+KeyW"], ["Ctrl+Shift+KeyW", "Ctrl+Alt+KeyW"]],
  [["Panes", "窗格"], "clear", ["Clear the screen", "清畫面"], ["Meta+KeyK"], ["Ctrl+Shift+KeyK"]],
  [["Panes", "窗格"], "copy", ["Copy mode", "複製模式"], ["Shift+Meta+KeyC"], ["Ctrl+Shift+KeyM"]],
  [["Workspaces", "工作區"], "newWs", ["New workspace", "新工作區"], ["Meta+KeyN", "Alt+KeyN"], ["Ctrl+Shift+KeyN", "Ctrl+Alt+KeyN"]],
  [["Workspaces", "工作區"], "renameWs", ["Rename workspace", "工作區改名"], ["Shift+F2"], ["Shift+F2"]],
  [["Workspaces", "工作區"], "goto", ["Go to any terminal", "跳到任一終端機"], ["Shift+Meta+KeyO"], ["Ctrl+Shift+KeyP"]],
  [["Workspaces", "工作區"], "sidebar", ["Show / hide the sidebar", "顯示 / 隱藏側欄"], ["Meta+KeyB"], ["Ctrl+Shift+KeyB"]],
  [["Workspaces", "工作區"], "help", ["This table", "這張表"], ["Meta+Slash"], ["F1"]],
];
const ARROW = { ArrowLeft: "h", ArrowDown: "j", ArrowUp: "k", ArrowRight: "l" };
/** The chord a keydown is: modifiers in a fixed order, then the key's code; arrows, digits and brackets carry their argument. */
function chordOf(e) {
  let k = e.code, arg = null;
  if (ARROW[k]) { arg = ARROW[k]; k = "Arrow"; }
  else if (/^Digit[1-9]$/.test(k)) { arg = +k.slice(5); k = "Digit"; }
  else if (k === "BracketLeft" || k === "BracketRight") { arg = k === "BracketRight" ? 1 : -1; }
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean);
  return { full: [...mods, k].join("+"), loose: [...mods, k.replace(/^Bracket(Left|Right)$/, "Bracket")].join("+"), arg };
}
/** The action a keydown asks for on this platform ("mac" | "win"), either of its chords, or null (the key goes to the terminal). */
function lookup(e, plat) {
  const c = chordOf(e);
  for (const row of KEYMAP) { const specs = row[plat === "mac" ? 3 : 4]; if (specs.includes(c.full) || specs.includes(c.loose)) return { act: row[1], arg: c.arg }; }
  return null;
}
const KEYNAME = { Arrow: "←↑↓→", Digit: "1–9", BracketRight: "]", BracketLeft: "[", Bracket: "] / [", Equal: "=", Minus: "-", Slash: "/", PageDown: "PgDn", PageUp: "PgUp" };
/** How a chord is written on a platform: ⇧⌘D on a Mac, Alt+Shift+= elsewhere. */
function show(spec, plat) {
  const parts = spec.split("+"), key = parts.pop(), name = KEYNAME[key] ?? (key.startsWith("Key") ? key.slice(3) : key === "Enter" ? (plat === "mac" ? "↩" : "Enter") : key);
  if (plat === "mac") return ["Ctrl", "Alt", "Shift", "Meta"].filter((m) => parts.includes(m)).map((m) => ({ Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" })[m]).join("") + name;
  return [...parts, name].join("+");
}
const row = (act) => KEYMAP.find((r) => r[1] === act);
/** The chord that works where the page is now: the second one while a browser tab keeps the first. */
function chordNow(act, plat, inTab) { const specs = row(act)[plat === "mac" ? 3 : 4]; return inTab && specs[1] ? specs[1] : specs[0]; }
const useNow = (act, plat, inTab) => show(chordNow(act, plat, inTab), plat);
/** "mac" on a Mac (and iPad, iPhone), else "win" (Windows, Linux, ChromeOS: Windows Terminal's keys). */
const platformOf = (nav) => (/Mac|iPhone|iPad/i.test(nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || "") ? "mac" : "win");
globalThis.crewTermKeys = { KEYMAP, chordOf, lookup, show, chordNow, useNow, platformOf };
})();
