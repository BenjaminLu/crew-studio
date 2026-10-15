# Studio's agents on the Crew page; the Inbox and the Overview live

R-002: #/crew showed only firstmate's v1 rounds; a Studio run's working agent was invisible there.

Done when (`tests/studio-agents-ui.mjs`; red on 690c428, where none of this exists):
1. #/crew lists every Studio agent node run working now, beside firstmate's rounds: run (a link), workflow, node, role, provider · model, round, elapsed time, last activity (redacted), and the sidebar Crew count includes them; once the run ends it leaves. — "the Crew page shows the Studio agent working …", "once the run is cancelled the agent leaves the Crew page".
2. Each links the node's Prompt, Transcript and Report (`#/runs/node/<run>/<node>/<round>/<tab>` opens that tab). — "it links the node's Prompt, Transcript and Report", "Transcript opens the node's transcript tab", "Prompt opens the prompt the node was given".
3. (inbox-studio-cards follow-up 1) A Studio card arriving, or answered on another page, updates the open Inbox live, with no reload. — "a Studio card that arrives shows in the open Inbox live …", "answered on another page, the card leaves the open Inbox live …".
4. (follow-up 2) The Overview counts Studio cards in "waiting on you" and lists them under Needs you. The Board (docs/units/board.md) has replaced the Overview at #/board, so the check reads its Needs you count and list. — "the Board counts the Studio card under Needs you and lists it".
5. 390 dark, no sideways scroll. — "the Crew page with a Studio agent renders at 390 dark …".
API: GET /api/wruns/agents. Stub: STUB_LINGER keeps a build round talking for about a minute (a live agent for the test).
Takeover area (small edits): public/takeover.js viewCrewLive appends Studio's section; public/app.js updateNav (Crew count) and viewBoard (Studio cards in Needs you).
