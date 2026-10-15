// Reading the default http handler from LaunchServices' listing (`defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`), for `crew-studio open`.
/** The bundle id of the default http handler in LaunchServices' LSHandlers listing (defaults read output), or null. */
export function defaultHttpHandler(listing: string): string | null {
  // the array's elements, each a { … } at depth 1; nested { … } (LSHandlerPreferredVersions) dropped before reading the keys
  const els: string[] = []; let depth = 0, start = -1;
  for (let i = 0; i < listing.length; i++) {
    const c = listing[i];
    if (c === "{") { depth++; if (depth === 1) start = i; }
    else if (c === "}") { if (depth === 1 && start >= 0) els.push(listing.slice(start + 1, i)); depth = Math.max(0, depth - 1); }
  }
  for (const el of els) {
    let flat = el; while (/\{[^{}]*\}/.test(flat)) flat = flat.replace(/\{[^{}]*\}/g, "");
    if (!/\bLSHandlerURLScheme\s*=\s*"?http"?\s*;/.test(flat)) continue;
    const m = flat.match(/\bLSHandlerRoleAll\s*=\s*"?([^";\s]+)"?\s*;/); if (m && m[1] !== "-") return m[1];
  }
  return null;
}
