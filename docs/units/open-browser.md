# `crew-studio open` picks the browser

The captain's default browser did not open with a plain `open <url>`.

Done when (`tests/open.ts`, with stand-ins for open(1) and defaults(1) that record argv; red on d621d31, where there is no browser choice and no test):
1. `--browser <app>` or CREW_BROWSER passes `open -a <app>`; the output names the app and never prints the link. — "--browser <app> opens with open -a <app> …", "CREW_BROWSER does the same".
2. With neither, LaunchServices' default http handler (`defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`, the http entry's own LSHandlerRoleAll) is used explicitly with `open -b <bundle id>` and named; unreadable or failing, a plain `open`; an app that will not open falls back to the default browser; nothing opening prints the link. — "the default http handler is read from the http entry's own LSHandlerRoleAll …", "with neither, LaunchServices' default http handler is used explicitly …", "when LaunchServices cannot be read, a plain open", "when the default handler will not open, a plain open", "an app that will not open falls back …", "when nothing opens, the link is printed …".
On this Mac the listing resolves to the captain's default (checked by hand, nothing opened).

## r2 (open-browser r1 REJECT)
1. #1 the open(1) stand-in records each argv element (NUL-separated, one record per call) and the test asserts exact argv arrays (`["-a", "Google Chrome", url]`).
2. #2 "--browser=<app> works the same as --browser <app>", "an empty --browser= falls back to CREW_BROWSER" (red on 0163ed2: an empty --browser= skipped CREW_BROWSER), "… with no CREW_BROWSER falls back to the default browser".
3. #3 the test removes its temporary folder.
