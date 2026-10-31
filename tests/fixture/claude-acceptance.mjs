// The acceptance harness's Claude CLI (tests/acceptance/studio.ts): the strict stand-in (claude-native.mjs) in its acceptance
// mode, chosen by this file's name. A round on the captain's own sign-in reaches none of the captain's files, so the mode cannot
// come from a file in the captain's home; the real CLI reads its own keychain item, which a stub has none of.
await import("./claude-native.mjs");
