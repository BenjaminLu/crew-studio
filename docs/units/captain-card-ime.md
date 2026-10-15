# Captain card composition input

Scope: public/scard.js, tests/scard-ime-ui.mjs, package.json and this unit.

The shared card previously replaced its textarea when the first nonblank note
changed button readiness. A source card update also replaced its children.
Either could destroy an active Chinese input-method composition independently
of the application shell's existing focused-field SSE deferral.

The shared component retains the actual composing field and defers card redraws
until composition completes. It then renders the newest card, retaining committed
text, focus and selection where the field remains applicable. Incomplete
composition cannot answer a card or autosave an interview draft. Enter and
legacy keyCode 229 do not propagate as submit shortcuts while composing; native
IME key handling itself is not prevented. Existing server authority is unchanged.

The browser fixture directly loads the actual shared component and invokes the
same update method used by live card consumers. It covers coffee, code and
document notes in English and Traditional Chinese, plus the six-question
interview. Requests are intercepted offline. Synthetic composition events prove
DOM/value/selection retention, deferred state updates and request contents;
this does not claim manual testing with an operating-system Zhuyin keyboard.

Observed checks: 26 synthetic-composition assertions pass, privacy 21/0 and build
pass. The final assertions fail against extracted unchanged baseline code at
same-DOM/focus retention. The existing intent-card UI suite passes 17 static
render/tick/translation assertions, then fails because its unrelated legacy
code-firstmate launch does not raise a dispatch card and the fixture dereferences
null. That suite is not reported green; its empty-parameter launch does not
prepare the current mandatory staffing configuration. No authority is waived.
