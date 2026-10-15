# Fix round 1, legacy class C (privacy): no private path or name in committed content

Answers: m6#4, gates#5, m7#3, m8#6, m8#7, skins#6, backbone-nav#6 (the private Playwright path in every UI suite), and the same class across the repository: a committed fixture log with a home path, a test and a script that encoded a home path as a project key, the GitHub owner name used as a default repository, and external names in a fixture script.

Done when (each line is proved by `tests/privacy.ts`, new and red on the base):

1. Every tracked file is scanned. — "the scan reads every tracked file".
2. No committed file names a macOS or Linux home path (placeholders `/Users/you`, `/home/captain` aside), a home path encoded as a project key, the local user's name, or a name on the local denylist (`data/privacy-denylist.txt`, never committed). — "no committed file names a private home path, the local user, or a denylisted name".
3. No secret file is tracked. — "no secret file is tracked".

How: the UI suites import Playwright from `PLAYWRIGHT_MODULE` or the `playwright` package and fail with a clear message otherwise; the GitHub repository Studio reads defaults to the firstmate checkout's own origin (read-only `git remote get-url`) instead of a named owner; fixtures use `/Users/you` and `captain`; the retro fixture script takes the names it scrubs from `CREW_SCRUB_NAMES`. tests/host.ts (takeover's suite) changes one line to build the project key from the home folder.
