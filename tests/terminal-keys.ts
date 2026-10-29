import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The terminal page's keymap (public/term-keys.js, docs/units/web-terminal.md "Tabs, panes and keys"), both platforms:
// iTerm2's chords on a Mac, Windows Terminal's elsewhere; matched on KeyboardEvent.code; the second chord of an action the
// browser tab keeps works too and is the one the hints show in a tab; a key that is not Studio's is left for the terminal.
await import("../public/term-keys.js");
const K = (globalThis as any).crewTermKeys;
let pass = 0, fail = 0;
const ok = (c: unknown, name: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); } };
// a keydown as a browser makes it: the physical key's code and the modifiers held
const ev = (chord: string) => { const parts = chord.split("+"), code = parts.pop()!;
  return { code, key: code, ctrlKey: parts.includes("Ctrl"), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift"), metaKey: parts.includes("Meta") }; };
const act = (chord: string, plat: "mac" | "win") => { const r = K.lookup(ev(chord), plat); return r ? `${r.act}${r.arg != null ? `:${r.arg}` : ""}` : null; };
const expect = (plat: "mac" | "win", table: [string, string][]) => { for (const [chord, want] of table) ok(act(chord, plat) === want, `${plat}: ${chord} is ${want}`, String(act(chord, plat))); };

expect("mac", [
  ["Meta+KeyT", "newTab"], ["Alt+KeyT", "newTab"], ["Meta+KeyD", "splitRight"], ["Shift+Meta+KeyD", "splitDown"],
  ["Meta+KeyW", "closePane"], ["Alt+KeyW", "closePane"], ["Meta+KeyN", "newWs"], ["Alt+KeyN", "newWs"],
  ["Meta+Digit1", "tabN:1"], ["Meta+Digit9", "tabN:9"], ["Shift+Meta+BracketRight", "nextTab:1"], ["Shift+Meta+BracketLeft", "prevTab:-1"],
  ["Alt+Shift+BracketRight", "nextTab:1"], ["Meta+BracketRight", "nextPane:1"], ["Meta+BracketLeft", "nextPane:-1"],
  ["Alt+Meta+ArrowLeft", "focus:h"], ["Ctrl+Alt+ArrowRight", "focus:l"], ["Alt+Shift+Meta+ArrowUp", "swap:k"], ["Ctrl+Meta+ArrowDown", "resize:j"],
  ["Shift+Meta+Enter", "zoom"], ["Meta+KeyK", "clear"], ["Shift+Meta+KeyO", "goto"], ["Meta+Slash", "help"], ["Meta+KeyB", "sidebar"],
]);
expect("win", [
  ["Ctrl+Shift+KeyT", "newTab"], ["Ctrl+Alt+KeyT", "newTab"], ["Ctrl+Shift+KeyW", "closePane"], ["Ctrl+Alt+KeyW", "closePane"], ["Ctrl+Shift+KeyN", "newWs"], ["Ctrl+Alt+KeyN", "newWs"],
  ["Alt+Shift+Equal", "splitRight"], ["Alt+Shift+Minus", "splitDown"], ["Alt+ArrowLeft", "focus:h"], ["Alt+Shift+ArrowRight", "resize:l"], ["Ctrl+Alt+Shift+ArrowUp", "swap:k"],
  ["Ctrl+Tab", "nextTab"], ["Ctrl+Shift+Tab", "prevTab"], ["Ctrl+Alt+PageDown", "nextTab"], ["Ctrl+Alt+PageUp", "prevTab"], ["Ctrl+Alt+Digit3", "tabN:3"],
  ["Ctrl+Shift+Enter", "zoom"], ["Ctrl+Shift+KeyK", "clear"], ["Ctrl+Shift+KeyP", "goto"], ["Ctrl+Shift+Slash", "help"], ["Ctrl+Shift+KeyB", "sidebar"],
]);
// what is not Studio's goes to the terminal: plain keys, the shell's own Ctrl chords, the browser's copy and paste, the
// other platform's chords
for (const [plat, chords] of [["mac", ["KeyA", "Enter", "Ctrl+KeyC", "Ctrl+KeyD", "Ctrl+KeyL", "Meta+KeyC", "Meta+KeyV", "Alt+ArrowLeft", "Ctrl+Shift+KeyT", "Shift+KeyD", "Digit1"]],
  ["win", ["KeyA", "Enter", "Ctrl+KeyC", "Ctrl+KeyD", "Ctrl+KeyT", "Ctrl+KeyW", "Ctrl+Shift+KeyC", "Ctrl+Shift+KeyV", "Meta+KeyT", "Meta+KeyD", "Alt+KeyT", "Digit1"]]] as const)
  for (const c of chords) ok(act(c, plat) === null, `${plat}: ${c} is left for the terminal`, String(act(c, plat)));
// F1, F2 and Shift+F2 are full-screen programs' (htop, mc): never Studio's
for (const plat of ["mac", "win"] as const) for (const c of ["F1", "F2", "Shift+F2", "F10"]) ok(act(c, plat) === null, `${plat}: ${c} is left for the terminal`, String(act(c, plat)));
// the second chord counts only in a browser tab: in a Studio window ⌥T ⌥W ⌥⇧] are Option-as-Meta and ’ ” for the shell
const inWin = (chord: string, plat: "mac" | "win") => K.lookup(ev(chord), plat, false)?.act ?? null;
ok(inWin("Alt+KeyT", "mac") === null && inWin("Alt+KeyW", "mac") === null && inWin("Alt+KeyN", "mac") === null && inWin("Alt+Shift+BracketRight", "mac") === null && inWin("Ctrl+Alt+ArrowLeft", "mac") === null,
  "mac, Studio window: ⌥T ⌥W ⌥N ⌥⇧] ⌃⌥← go to the shell");
ok(inWin("Meta+KeyT", "mac") === "newTab" && inWin("Meta+KeyW", "mac") === "closePane" && inWin("Alt+Meta+ArrowLeft", "mac") === "focus" && inWin("Ctrl+Shift+KeyT", "win") === "newTab" && inWin("Ctrl+Alt+KeyT", "win") === null,
  "Studio window: the first chords work (⌘T ⌘W ⌥⌘←, Ctrl+Shift+T), the tab's second ones are the shell's");
ok(K.lookup(ev("Alt+KeyT"), "mac", true)?.act === "newTab", "mac, browser tab: ⌥T opens a tab");
// the code, not the character: a layout that types another letter on the T key still opens a tab; Shift+Meta+D is not Meta+D
ok(K.lookup({ code: "KeyT", key: "ㄔ", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, "mac")?.act === "newTab", "the physical key decides (an input method's character does not)");
ok(K.lookup(ev("Shift+Meta+KeyD"), "mac").act === "splitDown" && K.lookup(ev("Meta+KeyD"), "mac").act === "splitRight", "Shift is part of the chord");
// how chords are written, and which one the hints show
ok(K.show("Shift+Meta+KeyD", "mac") === "⇧⌘D" && K.show("Ctrl+Meta+Arrow", "mac") === "⌃⌘←↑↓→" && K.show("Shift+Meta+Enter", "mac") === "⇧⌘↩", "Mac chords are written with ⌃⌥⇧⌘", `${K.show("Shift+Meta+KeyD", "mac")} ${K.show("Ctrl+Meta+Arrow", "mac")}`);
ok(K.show("Alt+Shift+Equal", "win") === "Alt+Shift+=" && K.show("Ctrl+Shift+KeyT", "win") === "Ctrl+Shift+T" && K.show("Ctrl+Shift+Enter", "win") === "Ctrl+Shift+Enter", "Windows chords are written with their names", K.show("Alt+Shift+Equal", "win"));
ok(K.useNow("newTab", "mac", true) === "⌥T" && K.useNow("newTab", "mac", false) === "⌘T" && K.useNow("closePane", "mac", true) === "⌥W" && K.useNow("newWs", "mac", true) === "⌥N", "in a browser tab the Mac hints show ⌥T ⌥W ⌥N; in a Studio window ⌘T");
ok(K.useNow("newTab", "win", true) === "Ctrl+Alt+T" && K.useNow("newTab", "win", false) === "Ctrl+Shift+T" && K.useNow("nextTab", "win", true) === "Ctrl+Alt+PgDn", "in a browser tab the Windows hints show Ctrl+Alt+T; in a Studio window Ctrl+Shift+T");
ok(K.useNow("splitRight", "mac", true) === "⌘D" && K.useNow("splitRight", "win", true) === "Alt+Shift+=", "a chord no browser keeps is the same in a tab and in a window");
// AltGr: Windows reports it as Ctrl+Alt. On a German or French layout Ctrl+Alt+7 types {, Ctrl+Alt+8 [, Ctrl+Alt+3 #: text for
// the shell, never a tab or a pane move. The same chord that types its own key (a US layout) is still Studio's
const kd = (code: string, key: string, more: Record<string, unknown> = {}) => ({ code, key, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, ...more });
for (const [code, key, where] of [["Digit7", "{", "de"], ["Digit8", "[", "de"], ["Digit9", "]", "de"], ["Digit0", "}", "de"], ["Minus", "\\", "de"], ["BracketRight", "~", "de"], ["Digit2", "~", "fr"], ["Digit3", "#", "fr"], ["Digit6", "|", "fr"], ["Digit0", "@", "fr"], ["BracketLeft", "ü", "de"]] as const)
  ok(K.lookup(kd(code, key), "win") === null, `win: AltGr ${code} (${where}: ${key}) is text for the shell`, JSON.stringify(K.lookup(kd(code, key), "win")));
ok(K.lookup(kd("Digit3", "3", { getModifierState: (m: string) => m === "AltGraph" }), "win") === null, "win: a keydown that says AltGraph is never a chord");
ok(K.lookup(kd("Digit3", "3"), "win")?.act === "tabN" && K.lookup(kd("BracketRight", "]"), "win")?.act === "nextPane" && K.lookup(kd("KeyT", "t"), "win")?.act === "newTab" && K.lookup(kd("ArrowLeft", "ArrowLeft", { shiftKey: true }), "win")?.act === "swap",
  "win: Ctrl+Alt chords that type their own key (a US layout) and named keys stay Studio's");
ok(K.lookup(kd("ArrowLeft", "ArrowLeft"), "mac")?.act === "focus", "mac: ⌃⌥← (a named key) stays Studio's");
// a letter key types another letter on another layout: that is not AltGr. AZERTY's W key types z, a Russian T types е
ok(K.lookup(kd("KeyW", "z"), "win")?.act === "closePane", "win, AZERTY: Ctrl+Alt+W (the key types z) closes the pane", JSON.stringify(K.lookup(kd("KeyW", "z"), "win")));
ok(K.lookup(kd("KeyT", "е"), "win")?.act === "newTab", "win, Russian: Ctrl+Alt+T (the key types е) opens a tab", JSON.stringify(K.lookup(kd("KeyT", "е"), "win")));
ok(K.lookup(kd("KeyT", "t", { getModifierState: (m: string) => m === "AltGraph" }), "win") === null && K.lookup(kd("Digit7", "{"), "win") === null, "AltGraph said outright still wins on a letter; German AltGr+7 still types {");
// the platform: a Mac (and iPad) is iTerm2's, everything else Windows Terminal's
ok(K.platformOf({ platform: "MacIntel" }) === "mac" && K.platformOf({ userAgentData: { platform: "macOS" } }) === "mac" && K.platformOf({ platform: "iPad" }) === "mac", "a Mac is \"mac\"");
ok(K.platformOf({ platform: "Win32" }) === "win" && K.platformOf({ userAgentData: { platform: "Windows" }, platform: "MacIntel" }) === "win" && K.platformOf({ platform: "Linux x86_64" }) === "win", "Windows and Linux are \"win\" (userAgentData first)");
// every action has a chord on both platforms, and no chord means two actions
for (const plat of [3, 4]) { const seen = new Map<string, string>();
  for (const r of K.KEYMAP) for (const c of r[plat]) { if (seen.has(c)) ok(false, `${plat === 3 ? "mac" : "win"}: ${c} is one action`, `${seen.get(c)} and ${r[1]}`); seen.set(c, r[1]); } }
ok(K.KEYMAP.every((r: any) => r[1] === "renameTab" || (r[3].length && r[4].length)), "every action but renaming a tab (double-click) has a chord on both platforms");
console.log(`\nterminal-keys: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
