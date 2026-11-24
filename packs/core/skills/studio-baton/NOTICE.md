# baton in Crew Studio: credit and license

This folder is Crew Studio's built-in copy of baton, the review room's default way to explain a change.

baton: https://github.com/BenjaminLu/baton, commit 2d7f9b9c87f16a738008e7635f5d2f23a7546d3c. SKILL.md, requirements.txt,
references/ (boundary-review.md, components.md, diagrams.md, extraction.md, pipeline.md, spec.md), scripts/ (export_pdf.py,
figures.py, render.py, snapshot.py, verify.py) and templates/packet.html are copied byte for byte. Its README.md and
AGENTS.md (for baton's own contributors) are left out, and so is tests/: baton's own unit tests (test_attacks.py,
test_failures.py, test_links.py, test_row_links.py, test_soft_breaks.py, test_system_map.py, test_verify.py) check its
scripts and template where baton is developed. A packet's build never runs them, and every file here is part of the skill
the review room's model reads and Studio pins, so they would only add to both. baton's repository states its license as
MIT in its README; the copyright holder is its author.

diagram-design/: https://github.com/cathrynlavery/diagram-design, commit 5d59b9b6bd4d7abc08bef2bb0fce8cfa525a203c, its
LICENSE, skills/diagram-design/SKILL.md, assets/template.html and the references style-guide, semantic-patterns,
output-spec, type-architecture, type-sequence, type-state, type-flowchart, type-data-flow, type-er, type-db-schema,
type-dependency, type-swimlane, type-timeline, type-tree, type-layers and type-deployment, copied byte for byte. The other
references, assets and scripts are left out. MIT License, copyright (c) 2025 Cathryn Lavery (diagram-design/LICENSE).

Crew Studio changes none of these files. How baton runs in the review room (the room's materials instead of git, gh and
session transcripts; diagram-design's guidance read from this folder) is Studio's adapter, sent with the skill
(src/domain/review-baton.ts). Studio pins this folder by its hashes there: a changed file is another version, and only the
pinned one runs without a confirmation.

MIT License (baton)

Copyright (c) Benjamin Lu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
