# Coffee kit: operating notes

The coffee-kit role skills are short: a shared native contract (worker, reviewer,
designer) plus a coffee profile. The procedure they used to carry lives here.

## Website (worker)

- The page is one self-contained HTML document with local CSS, built in the
  owned page folder with work_* tools. Start with the approved cinematic or
  split hero, then the approved sections.
- Keep exact host-owned image and film paths in their approved placement. The
  host supplies the image, the movie, the first-frame poster and accessible
  playback (muted inline play, user pause, reduced-motion poster fallback).
  Never generate placeholders, replace media bytes or invent filenames.
- Do not hide overflow to conceal a broken layout; keep stable media aspect
  ratios at 320px.
- Source checks prove structure and exact bytes, not visual quality or
  business facts.

## Image (image-worker)

- Generation runs through Studio's dedicated Codex image adapter only
  (image_generation): no shell, file scan, web search, other tools, API-key
  fallback or model or vendor switch.
- The prompt follows the imagegen anatomy (subject, placement, composition,
  lighting, style, palette, prohibited inventions) and its non-destructive
  version principles.
- The publisher validates complete PNG bytes and creates an unapproved managed
  Library draft at once. The record keeps the actual provider, model, effort
  and the prompt and skill hashes.

## Film (local compositor)

- Contract pointers: HyperFrames entry, hyperframes-core and
  hyperframes-animation (GSAP adapter); the pinned local renderer contract is
  docs/units/native-coffee-hyperframes.md. Nothing global (tools, plugins,
  audio services, cloud render) is assumed.
- One paused GSAP timeline registered in window.__timelines, stable
  data-duration and clip intervals, local pinned assets, no unbounded repeat or
  second playback clock. Twelve seconds, three beats: calm pan and zoom,
  layered type entrance, the confirmed transition and CTA. A still photograph
  never pretends to contain generated liquid motion.
- The compositor's profile hash, storyboard and dependency hashes go into the
  BRIEF and the source receipts. Rendering is a bounded local adapter run with
  Chromium's sandbox, a source asset and network guard and verified cleanup; no
  outer OS sandbox equivalence is claimed.
- Validate the encoded H264 metadata, decoded motion and frame samples, and the
  first-frame PNG poster. Publish movie and poster as one signed full-manifest
  draft in Library.

## Reviewer and designer

- Both run as judges on the "Verify complete bundle" check node
  (coffee-kit/reviewer and coffee-kit/designer); their role skills are the
  judges' instructions.
- Their checks see text only unless rendered captures are supplied; visual
  acceptance stays with the captain's whole-site card.
