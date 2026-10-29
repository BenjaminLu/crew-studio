# The Inbox follows the live stream

What: a Studio card that is raised, answered elsewhere or withdrawn reaches the Inbox, the sidebar's
Inbox and Board counts, and the Board's Needs you through the page's one event stream, with no reload.
A card the captain has open is never re-rendered by an update that does not change it: the Inbox keeps
the same element, and its ticks, note and door tick stay in that mount. An open Inbox card is never
mounted again (a card's status is open, answered or cancelled, and only a status change remounts it,
which takes it out of the Inbox), so the Inbox needs no opts.state; the Board's Needs you, which does
remount (Close, Answer), already keeps it in BD.cstate. A card
that arrives while the page is open shows one non-blocking "new card" cue (a status line, not a dialog).

Why: with the Inbox open on R-003's merge card (#/inbox/SC-004, the Board's Open link), a newly raised
card did not show until a reload: that page listed only the one card it was opened on, so a second card
and the page after answering stayed empty. After the stream dropped (a Studio restart, a laptop that
slept), cards raised or withdrawn meanwhile were never read again. The counts and Needs you lagged the same way.

How: public/runtime.js reads the open cards on every `scard` event and on every stream (re)connect
(`crew:live`, sent by public/app.js on `hello`); #/inbox/<id> shows that card first and every other
waiting card under it; Inbox mounts reuse the element and skip the update when the card is unchanged;
public/board.js reloads its cards on `crew:live` too; public/app.js keeps
the focus and caret of a field the new view keeps. A field the new view draws anew is found again by its stable key (id, else
its first data- attribute); when it comes back empty, what was typed is carried into it.

Done when (`tests/inbox-live-ui.mjs`; red on 2215408, 6 of 17 assertions fail there):
1. With the Inbox open, a card raised by the runtime appears in it without a reload. — "a card raised while the Inbox is open appears in it without a reload".
2. The sidebar's Inbox and Board counts rise without a reload. — "the sidebar's Inbox and Board counts rise to 1 without a reload".
3. The Board's Needs you shows it, with its count, without a reload. — "the Board's Needs you shows the card and its count without a reload".
4. One non-blocking cue says a card arrived, and counts later arrivals. — "one non-blocking new-card cue shows (a status line, not a dialog)", "the counts rise to 2 and the one cue now says two cards arrived".
5. The card the captain is typing in is not re-rendered (the same element) and keeps its note and focus. — "a second card arrives while the captain types in the first: …", "the note box keeps the keyboard focus while the other card arrives", "the card still open keeps its note when another one leaves".
6. A card answered on a second page leaves the first page's Inbox, counts and Needs you. — "a card answered on another page leaves the Inbox, the sidebar count and the Board's Needs you".
7. A withdrawn card (its run cancelled) leaves them too. — "a withdrawn card (its run cancelled) leaves the Inbox, the counts and the Board".
8. On one card's page (#/inbox/<id>), after it is answered, a newly raised card still appears. — "on one card's Inbox page (#/inbox/<id>), after the captain answers it, a newly raised card still appears there without a reload".
9. After the stream drops and reconnects, a card raised meanwhile shows and one withdrawn meanwhile is gone, in the Inbox and in the Board's Needs you (public/board.js's `crew:live` reload). — "after the stream drops and reconnects, …", "after the Board's stream drops and reconnects, its Needs you shows the card raised meanwhile and drops the one withdrawn meanwhile".
10. No page reloads and no page errors. — "no page was reloaded along the way", "no page errors".
