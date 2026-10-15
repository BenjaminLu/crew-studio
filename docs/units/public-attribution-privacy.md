# Public attribution privacy classification

Approved scope: tests/privacy.ts and this document. No license, attribution,
production behavior or credential handling changes.

Four full-line SHA-256 fingerprints classify the unchanged Captain source-import
attribution as public for the local-username heuristic only. Provenance: upstream
Captain import d2b9966 and follow-up aab02f0; imported source commit
671a0c7185d94b56b8d791fac309965251a3f966. The importer, license and origin text stay
byte-identical. Each exception binds exact tracked filename, line number and text.
Private-home paths, encoded paths, explicit denylist entries and tracked secret
filenames are never exempted. Modified, relocated or appended attribution fails
closed. Controls run with a synthetic local-user rule independent of CI username.

The scanner has no general token-content detector; this change does not claim one.
The existing secret-filename check remains unconditional, including token files.

Baseline: /tmp/v2-public-attribution-base.log and .exit (3 pass, 1 fail).
Actual e79 welcome UI: /tmp/v2-e79-welcome-ui.log and .exit (20 pass, exit 0),
using the existing installed Playwright module without installation or vendor calls.

Upstream main c94b6c4 / 54c5268 preserves the same public source URL while
refactoring its importer statement at line 23 and moving the unchanged origin
write to line 46. Renew only these exact full-line fingerprints; every other
privacy rule and the license/origin text remain unchanged.
