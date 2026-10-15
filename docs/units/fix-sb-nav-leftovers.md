# Leftovers of the sandbox-repo r2 and backbone-nav r3 fixes (fixes-sb-nav r1)

Answers fixes-sb-nav r1 #21, #20 (must-fix), #11 and #22. Done when (each new line is red on the base):

1. #21 The M3 lane card's door reads the org policy: with an org `sensitive_paths` line on its asset path the card is one-way, reason list "org"; reverted to `loadDefaults()` it is trivial. The fix-sandbox-repo-r2 doc's line 3 names its tests and no longer claims a workflow level at intake. — `tests/m3.ts` "a lane card's door reads the org policy's sensitive paths (orgDefaults)".
2. #20 The Crew activity block refetches in the background when a re-render finds it older than 3 s, and a visit to a stale list loads it again (requests to `/api/activity?limit=25` counted). — `tests/backbone-ui.mjs` "… and refetches it in the background; a visit to a stale list loads it again".
3. #11 skins and smoke boot through `tests/boot.mjs` (done in fix-round-sandbox-r1); the fix-sandbox-repo-r2 doc's line 6 no longer names a suite that is not in the tree, and names skins.
4. #22 `addPaths` tells present from gone with `lstat`: a dangling symlink is a new path, staged as such. — `tests/sandbox-repo.ts` "addPaths stages every one of them, a dangling symlink included …".
