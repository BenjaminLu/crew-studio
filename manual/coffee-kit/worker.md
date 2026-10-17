# coffee-kit: worker (website)

## Briefing

- The `page` step builds the coffee-shop website from the captain's approved design plan, with the exact image and
  film versions the host produced. A revision changes what its annotations ask and keeps every other section.
- Missing business facts (hours, address, prices, reviews) stay out or are marked unknown; they are never invented.

## Environment

- An isolated page folder inside the round's write roots. No shell, network, external fonts or scripts, forms,
  tracking, Git writes or publication.

## Tools

- `work_*` file tools inside the page folder only.

## Tests

- No test command. The bundle's `coffee-kit/bundle-ready` check and the `coffee-kit/reviewer` and
  `coffee-kit/designer` judges read the page source; the captain's whole-site card judges the visual result.
- Source checks prove structure and exact bytes, not visual quality or business facts.

## Dependencies

- Nothing to install. The image, the film and its first-frame poster are supplied by the host.

## Deliverable

- One self-contained HTML document with local CSS: the approved cinematic or split hero first, then the approved
  sections; one h1 and one primary CTA, readable outside the film.
- Keep the host-owned image and film paths exactly where the plan places them. Never make placeholder or fake media,
  replace media bytes or invent filenames. The host adds muted inline playback, user pause and the reduced-motion
  poster fallback.
- Keep stable media aspect ratios, and readable text and a usable CTA on a 320px phone. Do not hide overflow to
  conceal a broken layout.
