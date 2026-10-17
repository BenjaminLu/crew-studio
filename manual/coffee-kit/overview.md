# coffee-kit: overview

## Briefing

- The captain approves one design plan (brand tokens, sections, CTA, image composition, storyboard). Studio then
  makes the image, the film and the website for that plan, checks the bundle, and the captain accepts the whole
  site. Each role skill is the shared native contract (worker, reviewer, designer) plus a short coffee profile.
- `image-worker`: one image for its place on the page, through the dedicated Codex image adapter; a revision edits
  the pinned reference image and keeps what its annotations do not mark.
- The film is composed by Studio's local deterministic compositor, not a model turn; its profile is pinned in its
  inputs.
- `reviewer` and `designer` judge the bundle on the "Verify complete bundle" check node (`coffee-kit/reviewer`,
  `coffee-kit/designer`).

## Environment

- Image: `image_generation` only, through Studio's Codex image adapter: no shell, file scan, web search, other
  tools, API-key fallback or model or vendor switch.
- Film: a bounded local render with Chromium's sandbox, a source asset and network guard and verified cleanup; no
  outer OS sandbox equivalence is claimed.
- Website: see `coffee-kit/worker`.

## Tools

- Image: none for a model; Studio calls the image tool. Website: `work_*` in the page folder. Judges: their verdict
  tool.

## Tests

- Image: the publisher validates complete PNG bytes and creates an unapproved Library draft at once.
- Film: encoded H264 metadata, decoded motion and frame samples, and the first-frame PNG poster are validated.
- Bundle: `coffee-kit/bundle-ready`, then the reviewer and designer judges. Their evidence is text unless rendered
  captures are supplied; visual acceptance stays with the captain's whole-site card.

## Dependencies

- A Codex sign-in for the image. The film needs the pinned local renderer (docs/units/native-coffee-hyperframes.md):
  one paused GSAP timeline registered in `window.__timelines`, stable `data-duration` and clip intervals, local
  pinned assets, no unbounded repeat or second playback clock. Nothing global (tools, plugins, audio, cloud render)
  is assumed; a missing capability holds the film.

## Deliverable

- One unapproved Library draft per artifact: the PNG (with the actual provider, model, effort and the prompt and
  skill hashes), movie and poster as one signed full-manifest draft, and the website. No public upload and no
  automatic whole-site approval.
- Film: twelve seconds, three beats (calm pan and zoom, layered type entrance, the confirmed transition and CTA). A
  still photograph never pretends to contain generated liquid motion.
