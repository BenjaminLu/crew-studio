# Corner Shop

A small shop page built on money-kit, so a change to the library shows on screen.

```sh
bun run dev          # http://localhost:4310 (PORT=… to change it)
bun app/build.ts     # static pages in out/app (index.html in dollars, jpy.html in yen)
```

Every price, cart line and total goes through money-kit's `format()`. The
yen view converts at a fixed demo rate (¥150 to the dollar) and asks `format()` for
yen, so it shows what the library does with yen today.
