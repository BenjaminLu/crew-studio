# Fix round 2, backbone-nav (backbone-nav r2 REJECT)

Answers backbone-nav r2 #3 and the regression of #7 (must-fix) and #8. #6 was fixed by fix-legacy-c-privacy. Done when (each line is proved in `tests/backbone-ui.mjs`; each is red on the base):

1. Show labs in Settings is proved again: ticking `#labsToggle` puts the labs items back in the sidebar. — "Show labs (Settings) puts the labs items back in the sidebar".
2. `?labs=1` shows the labs group in the sidebar, with its items, besides rendering the labs page. — "?labs=1 turns labs on, puts the labs group in the sidebar and the labs page renders".
3. The Crew activity embed keeps its own unfiltered list (`/api/activity?limit=25`), loads it again on each visit, refreshes it while Crew is open, and never reads or resets `#/activity`'s filters. — "Crew's activity is the unfiltered log after a filtered #/activity visit, and the filter is still there when you go back".
