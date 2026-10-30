# diagram-design: credit and license

This file ships with the review room's figure guidance (SKILL.md, style-guide.md, semantic-patterns.md, output-spec.md,
type-state.md, type-sequence.md, type-architecture.md, type-data-flow.md and type-flowchart.md in this folder). It is never
sent in an agent's prompt.

The guidance is adapted from diagram-design, https://github.com/cathrynlavery/diagram-design, commit
5d59b9b6bd4d7abc08bef2bb0fce8cfa525a203c: skills/diagram-design/SKILL.md and its references style-guide.md,
semantic-patterns.md, output-spec.md, type-state.md, type-sequence.md, type-architecture.md, type-data-flow.md and
type-flowchart.md. Crew Studio's changes: the figure is an inline SVG checked by Studio (an element and attribute
allowlist, the review room's palette tokens instead of hex values, a geometric gate) instead of a standalone HTML file;
no fonts are fetched; the import, export, onboarding, profile, animation and icon references are left out; the state
machine reference carries baton's database lifecycle; Studio's own layouts (arch, states, sequence) apply the same
connector rules by code.

MIT License

Copyright (c) 2025 Cathryn Lavery

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
