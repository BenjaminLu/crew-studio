#!/usr/bin/env python3
"""Check a rendered packet for the failures a reader cannot see.

Deliberately small. Diagram correctness is checked by eye in a browser — that
is the gate, and no regex substitutes for it. What a script does better than
eyes is notice an absence: a refusal declaration that was dropped, an
identifier left bare in a sentence written for someone who does not read code.

Usage: verify.py <page>.html [--repo .] [--register eli5|engineer]
"""
import argparse, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from figures import lazy_after_reason  # noqa: E402  (one rule, shared with the layout)

# An identifier a reader would have to decode. Marked terms (backticks, <code>)
# and glossary entries are exempt — see the register rule in pipeline.md §4.
IDENTIFIER = re.compile(
    r"\b[a-z0-9]+_[a-z0-9_]+\b"                 # snake_case
    r"|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b"           # UPPER_SNAKE, usually a state
    # camelCase and PascalCase need a lowercase run before the inner capital,
    # or an ordinary shouted word like CHANGED matches and the checker starts
    # rejecting its own labels.
    r"|\b[a-z][a-z0-9]+[A-Z][A-Za-z]*\b"
    r"|\b[A-Z][a-z0-9]+[A-Z][A-Za-z]*\b"
    r"|\b[A-Za-z_][\w.]*\.(?:go|rs|py|rb|ts|tsx|js|java|kt|sql|json|ya?ml)\b"
    r"|\b\w+/\w+/[\w./]+"                       # paths
    r"|::"
    r"|\b[0-9a-f]{7,40}\b")                     # sha

TERM_MARKUP = re.compile(r"<(code|kbd|samp)\b[^>]*>.*?</\1>", re.S | re.I)
REFUSAL = ("say you do not know", "say you don't know", "說不知道", "说不知道")

# Keys whose values are data, not reader-facing prose: mermaid source, ids,
# database column names shown as data, and the glossary itself — scanning the
# glossary flags the very words it exists to permit.
SKIP_KEYS = {"mermaid", "svg", "id", "kind", "tone", "filename", "range",
             "repo", "branch", "format_version", "layer", "glossary",
             "layer_note", "k", "was", "now", "method", "table", "op",
             "guard", "summary", "ref", "at", "state"}


def load(path):
    html = Path(path).read_text()
    m = re.search(r'<script id="baton-data"[^>]*>(.*?)</script>', html, re.S)
    data = None
    if m:
        try:
            data = json.loads(m.group(1).replace("<\\/", "</"))
        except json.JSONDecodeError:
            pass
    return html, data


def prose(data):
    """Every reader-facing string in the packet, with where it came from."""
    out = []
    def walk(v, path="data"):
        if isinstance(v, str):
            out.append((path, v))
        elif isinstance(v, dict):
            for k, x in v.items():
                if k not in SKIP_KEYS:
                    walk(x, f"{path}.{k}")
        elif isinstance(v, list):
            for x in v:
                walk(x, path)
    if data:
        walk(data)
    return [(w, t) for w, t in out if t]


def check_register(data, glossary=()):
    """Catch words the reader has to decode, not words that are technical.

    A page about a database has to say `payments` and `status_log` — the most
    precise words available, and translating them costs the reader the word
    they need with an engineer afterwards. What breaks a page is an identifier
    dropped into prose with nothing marking it as a name.
    """
    allowed = {g.lower() for g in glossary}
    problems = []
    for where, text in prose(data):
        clean = TERM_MARKUP.sub(" ", text)
        clean = re.sub(r"`[^`]+`", " ", clean)   # backticks render as <code>
        for m in IDENTIFIER.finditer(clean):
            if m.group(0).lower() in allowed:
                continue
            problems.append(
                f'{where}: "{m.group(0)}" is unmarked code in a sentence — '
                f'mark it as a term or find a word — in: {text[:70]}')
    return problems


def check_context(html):
    m = re.search(r'<script id="baton-context"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return ["no embedded context; the page is a summary with nothing behind it"]
    ctx = m.group(1)
    if not any(r in ctx.lower() for r in REFUSAL):
        return ["context is missing its refusal declaration; a receiving agent "
                "will fill gaps by inference instead of saying it does not know"]
    if len(ctx) < 2000:
        return [f"context is {len(ctx)} characters — that is a digest, not the "
                "complete three-layer context (pipeline §2)"]
    return []


CONCRETE = re.compile(r"`[^`]+`|\d|\"[^\"]+\"|「[^」]+」|“[^”]+”")
SVG_OUTCOME = re.compile(
    r'data-node="(before|after)-outcome".*?<text[^>]*data-en="([^"]*)"[^>]*data-hant="([^"]*)"', re.S)


def _langs(v):
    if isinstance(v, dict):
        return v.get("en", ""), v.get("hant", v.get("en", ""))
    return (v or ""), (v or "")


def check_before_after(data):
    """The gate against lazy before/after (diagrams.md § Per-change before / after).

    A card that says only "the old problem is gone" tells the reader nothing
    they could not have guessed from the title. Every change card must state
    what the system did BEFORE and what it does AFTER — observable, concrete,
    and the AFTER may not be the BEFORE with a negation bolted on.
    """
    problems = []
    for idx, s in enumerate((data or {}).get("sections", [])):
        # chain sections carry structured before/after rows; check_components owns them
        if s.get("kind") == "chain":
            continue
        is_card = s.get("kind") == "vuln"
        has_pair = "before" in s or "after" in s
        if not (is_card or has_pair):
            continue
        name = _langs(s.get("heading"))[0] or f"section {idx}"
        if not s.get("before") or not s.get("after"):
            problems.append(f'"{name}": change card has no `before` / `after` — state what the '
                            "system did and what it does now (spec.md § vuln)")
            continue
        for lang, b, a in zip(("en", "hant"), _langs(s["before"]), _langs(s["after"])):
            r = lazy_after_reason(b, a)
            if r:
                problems.append(f'"{name}" [{lang}]: {r}')
            elif not CONCRETE.search(a):
                problems.append(f'"{name}" [{lang}]: AFTER is not concrete — name the new value, '
                                "error, state or call (a `code` term, a number or a quoted value): " + a[:80])
        svg = s.get("svg")
        if svg:
            found = {k: (en, hant) for k, en, hant in SVG_OUTCOME.findall(svg)}
            if set(found) != {"before", "after"}:
                problems.append(f'"{name}": figure lacks data-node="before-outcome" and '
                                '"after-outcome" boxes — draw it with scripts/figures.py before_after()')
            else:
                for lang in (0, 1):
                    r = lazy_after_reason(found["before"][lang], found["after"][lang])
                    if r:
                        problems.append(f'"{name}" figure: {r}')
            if re.search(r'data-node="after-outcome"[^>]*stroke-dasharray', svg) or "✗" in svg:
                problems.append(f'"{name}" figure: AFTER outcome is drawn struck-through / ✗ — '
                                "draw the new outcome as a live box instead")
    return problems


LENSES = {"identity", "truth", "effect", "dependency", "coexist", "edges"}
MARKS = {"have", "part", "gap", "plan", "na"}
PROOF_STATES = {"verified", "code-only", "absent"}


def _en(v):
    if isinstance(v, dict):
        return str(v.get("en") or "")
    return "" if v is None else str(v)


def _ids(nodes):
    return {n.get("id") for n in nodes or []}


def _map(data, sec):
    """The systems a map section draws: its own, else the packet's `systems`."""
    own = sec.get("systems") if isinstance(sec, dict) else None
    if isinstance(own, list) and own:
        return own
    reg = (data or {}).get("systems") if isinstance(data, dict) else None
    if isinstance(reg, dict) and isinstance(reg.get("systems"), list):
        return reg["systems"]
    return []


def check_components(data):
    """Every section is a component, not a slab of text (spec.md § Section kinds).

    The page exists to be read in minutes. A section that is mostly sentences,
    a list of findings typed as lines, or a three-box change card all read as
    plain text — which is the thing this format replaces.
    """
    problems = []
    for i, s in enumerate((data or {}).get("sections") or []):
        name = _en(s.get("heading")) or f"section {i+1}"
        k = s.get("kind") or "prose"
        if k == "vuln":
            problems.append(f'"{name}": kind "vuln" is retired — draw the change as a "chain" '
                            "(the real component chain before/after, with proof)")
        elif k == "points":
            if s.get("role") != "questions":
                problems.append(f'"{name}": a "points" list reads as plain text — findings and risks go '
                                'in "chain" cards or the "boundary" map; points are only for '
                                '"role": "questions"')
            items = s.get("items") or []
            if len(items) > 6:
                problems.append(f'"{name}": {len(items)} open questions — keep the 6 that block most')
            for it in items:
                if len(_en(it.get("text"))) > 200:
                    problems.append(f'"{name}": an open question over 200 characters — one question, one sentence')
        elif k == "prose":
            blocks = s.get("text")
            blocks = blocks if isinstance(blocks, list) else [{"p": blocks}]
            chars = sum(len(_en(b.get("p"))) + len(_en(b.get("note"))) for b in blocks if isinstance(b, dict))
            paras = sum(1 for b in blocks if isinstance(b, dict) and (b.get("p") is not None or b.get("note") is not None))
            visual = any(isinstance(b, dict) and (b.get("stats") or b.get("bars")) for b in blocks)
            if chars > 480 or paras > 3:
                problems.append(f'"{name}": {chars} characters in {paras} paragraphs — turn it into a component '
                                "(chain / compare / matrix / steps / stats) or cut to a two-sentence lead")
            elif not visual and chars > 300:
                problems.append(f'"{name}": prose with no visual — add a stats row or move it into a component')
            for b in blocks:
                if isinstance(b, dict) and b.get("kv") and len(b["kv"]) > 6:
                    problems.append(f'"{name}": a {len(b["kv"])}-row key/value list — use a "compare" or '
                                    '"matrix" section instead')
        elif k == "chain":
            nodes = s.get("nodes") or []
            ids = _ids(nodes)
            if not 3 <= len(nodes) <= 6:
                problems.append(f'"{name}": a chain needs 3–6 real components, has {len(nodes)}')
            for key in ("before", "after"):
                row = s.get(key) or {}
                hot = set(row.get("hot") or [])
                if not hot or not hot <= ids:
                    problems.append(f'"{name}" {key}: mark the {"broken" if key=="before" else "changed"} '
                                    "node(s) in `hot` using node ids")
                why = row.get("why") or {}
                if why.get("at") not in hot or not _en(why.get("text")):
                    problems.append(f'"{name}" {key}: `why` must sit on a hot node and say why that hop '
                                    "produces the outcome")
                if not _en(row.get("outcome")):
                    problems.append(f'"{name}" {key}: no outcome')
                missing = [n.get("id") for n in nodes if n.get("id") in hot and not (row.get("sub") or {}).get(n.get("id"))]
                if missing:
                    problems.append(f'"{name}" {key}: hot node(s) {missing} carry no mechanism (`sub`)')
            for lang in ("en", "hant"):
                bo = ((s.get("before") or {}).get("outcome") or {})
                ao = ((s.get("after") or {}).get("outcome") or {})
                bo = bo.get(lang) if isinstance(bo, dict) else bo
                ao = ao.get(lang) if isinstance(ao, dict) else ao
                r = lazy_after_reason(bo or "", ao or "")
                if r:
                    problems.append(f'"{name}" [{lang}]: {r}')
            for key in ("before", "after"):
                row = s.get(key) or {}
                for nid, v in (row.get("sub") or {}).items():
                    if isinstance(v, str) and len(v) > 24:
                        problems.append(f'"{name}" {key}.{nid}: code label "{v}" is {len(v)} chars — '
                                        "keep code labels ≤ 24 so they do not break mid-token")
                for hi, v in (row.get("hops") or {}).items():
                    t = v if isinstance(v, str) else _en(v)
                    if len(t) > 16:
                        problems.append(f'"{name}" {key}.hop{hi}: "{t}" is {len(t)} chars — hop labels ≤ 16')
            proof = s.get("proof") or []
            if not proof:
                problems.append(f'"{name}": no proof — list the tests, CI runs, live checks or reproductions '
                                'that show the AFTER, with "state": verified | code-only | absent')
            for pr in proof:
                # No default: a chip whose author never said what it proves must
                # not read as verified (or as anything else) by omission.
                label = _en(pr.get("label"))[:50] or "(no label)"
                if "state" not in pr or pr.get("state") in (None, ""):
                    problems.append(f'"{name}": proof chip "{label}" has no `state` — set it explicitly to '
                                    f'one of {sorted(PROOF_STATES)}; a missing state is never read as verified')
                elif pr["state"] not in PROOF_STATES:
                    problems.append(f'"{name}": proof chip "{label}" state "{pr["state"]}" is not one of '
                                    f'{sorted(PROOF_STATES)}')
        elif k == "compare":
            rows = s.get("rows") or []
            if len(rows) > 6:
                problems.append(f'"{name}": {len(rows)} compare rows — split, never shrink (max 6)')
            if any(len(r) != 3 for r in rows):
                problems.append(f'"{name}": every compare row is [dimension, from, to]')
        elif k == "matrix":
            cols = s.get("cols") or []
            for r in s.get("rows") or []:
                v = r.get("v") or []
                if len(v) != len(cols) or not set(v) <= MARKS:
                    problems.append(f'"{name}": matrix row "{_en(r.get("k"))}" must hold one of '
                                    f"{sorted(MARKS)} per column")
            if len(s.get("rows") or []) > 12:
                problems.append(f'"{name}": more than 12 matrix rows — split it')
        elif k == "chart":
            t = s.get("type")
            ser = s.get("series") or []
            n = len(s.get("x") or [])
            if t not in ("line", "bar", "stacked", "funnel"):
                problems.append(f'"{name}": chart type "{t}" is not line | bar | stacked | funnel')
            if not _en(s.get("source")):
                problems.append(f'"{name}": a chart without `source` is a number nobody can check — '
                                "name the query, dashboard or file the data came from")
            if not ser or len(ser) > 4 or (t == "funnel" and len(ser) != 1):
                problems.append(f'"{name}": {len(ser)} series — charts carry 1–4 (funnel exactly 1); '
                                "fold the rest into Other or split into small multiples")
            for se in ser:
                vals = se.get("values") or []
                if len(vals) != n or not all(isinstance(v, (int, float)) for v in vals):
                    problems.append(f'"{name}": series "{_en(se.get("name"))}" needs {n} numeric values')
            if s.get("y2") or s.get("unit2"):
                problems.append(f'"{name}": a second axis — split into two charts instead')
        elif k == "steps":
            if not 3 <= len(s.get("steps") or []) <= 5:
                problems.append(f'"{name}": steps hold 3–5 items')
    return problems


def check_boundary_review(html, data):
    """The last section is the boundary map (boundary-review.md)."""
    sections = (data or {}).get("sections") or []
    if not sections or sections[-1].get("kind") != "boundary":
        return ['the last section must be the boundary map — kind "boundary" '
                "(references/boundary-review.md); with no finding it carries `ok`, "
                "saying what was checked"]
    sec = sections[-1]
    problems = []
    ids = _ids(_map(data, sec))
    if len(ids) < 2:
        problems.append("the boundary map needs at least two systems")
    chains = {_en(s.get("heading")) for s in sections if s.get("kind") == "chain"}
    finds = sec.get("findings") or []
    for f in finds:
        at = str(f.get("at", ""))
        ends = at.split(">") if ">" in at else [at]
        if not all(e in ids for e in ends):
            problems.append(f'boundary finding {f.get("n")}: `at` "{at}" is not a system id or "a>b" link')
        if f.get("lens") not in LENSES:
            problems.append(f'boundary finding {f.get("n")}: lens "{f.get("lens")}" is not one of {sorted(LENSES)}')
        if f.get("card") not in chains:
            problems.append(f'boundary finding {f.get("n")}: `card` must name the chain card that draws it')
    if not finds and not _en(sec.get("ok")):
        problems.append("a boundary map with no finding must say what was checked in `ok`")
    if finds and sec.get("ok"):
        problems.append("`ok` must stand alone — drop it or the findings")
    m = re.search(r'<script id="baton-context"[^>]*>(.*?)</script>', html, re.S)
    if m and "## Boundary review" not in m.group(1):
        problems.append('context lacks a "## Boundary review" heading in layer (b) — record the '
                        "boundaries checked, each lens's result, and dropped candidates")
    return problems


FAILURE_STATES = {"handled", "detected", "unhandled"}
GITHUB_CODE = re.compile(r"(?ai)^https://(?:www\.)?github\.com/[^/?#]+/[^/?#]+/(?:blob|blame|tree|raw|edit|commits|history)/")
GITHUB_HOST = re.compile(r"(?ai)^https://(?:(?:www\.)?github\.com|raw\.github(?:usercontent)?\.com|"
                         r"media\.githubusercontent\.com)(?=[/?#]|$)")
GITHUB_RAW = re.compile(r"(?ai)^https://(?:raw\.github(?:usercontent)?\.com|media\.githubusercontent\.com/media)"
                        r"/[^/?#]+/[^/?#]+/([^/?#]+)/")
GITHUB_BLOB = re.compile(r"(?ai)^https://(?:www\.)?github\.com/([^/?#]+/[^/?#]+)/(?:blob|blame|raw)/([^/?#]+)/[^#]+"
                         r"(#L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?)?$")


REF_HOST = re.compile(r"(?ai)^https://[a-z0-9-]+(?:\.[a-z0-9-]+)*(?=[/?#]|$)")
DOT_SEG = re.compile(r"(?ai)/(?:\.|%2e){1,2}(?=[/?#]|$)")
# The path is matched from a fixed point after the host, so a long host
# cannot make these backtrack quadratically.
EMPTY_SEG = re.compile(r"(?ai)^https://[^/?#]+(?:/[^?#]*)?//")       # GitHub folds // away
GITHUB_ESC = re.compile(r"(?ai)^https://[^/?#]+(?:/[^?#%]*)?%")       # and decodes %xx in the path
REF_MAX = 2048


def safe_ref(url):
    """A failure mode's evidence link: https only, no control character or
    space, no raw quote / angle bracket / backtick (the page's safeRef())."""
    if not isinstance(url, str) or len(url) > REF_MAX or safe_href(url) is None or not re.match(r"(?ai)^https://", url):
        return None
    # The host shown must be the host opened (the page's REF_HOST / DOT_SEG):
    # ASCII labels only, no port, trailing dot, userinfo or percent-escape; no
    # backslash; no dot segment that would fold /blob/<sha>/../main/ away.
    if re.search(r"[\"'<>`\\]", url) or not REF_HOST.match(url) or DOT_SEG.search(url):
        return None
    # GitHub serves /o//r/blob/… and /o/r/bl%6fb/… as the plain path, which would
    # slip a fork or a branch past the pin check and the owner/repo label.
    if EMPTY_SEG.search(url) or (GITHUB_HOST.match(url) and GITHUB_ESC.search(url)):
        return None
    return url


def _js_str(v):
    """String(v) as the page computes it, so an id compares the same here."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _text(v):
    """Text the page would print for an i18n field: a string or an i18n dict."""
    if isinstance(v, dict):
        return v["en"] if isinstance(v.get("en"), str) else ""
    return v if isinstance(v, str) else ""


def _links(systems):
    """The links the map draws, as (key, a, b): each system to the next one."""
    ids = [_js_str(n.get("id")) for n in systems or [] if isinstance(n, dict)]
    return [(f"{a}>{b}", a, b) for a, b in zip(ids, ids[1:])]


def _check_rows(rows, systems, pins, problems, warnings, what="failure mode"):
    """Row checks shared by the boundary `failures` and every `runbook`."""
    covered = set()
    ids = {_js_str(n.get("id")) for n in systems if isinstance(n, dict)}
    hashable = lambda v: isinstance(v, (int, str)) and not isinstance(v, bool)
    drawn = {k for k, _, _ in _links(systems)}
    for i, f in enumerate(rows):
        if not isinstance(f, dict):
            problems.append(f"{what} {i+1}: must be an object")
            continue
        label = f'{what} {i+1} ("{_en(f.get("mode"))[:40]}")'
        at = f.get("at")
        at = _js_str(at) if isinstance(at, (str, int)) and not isinstance(at, bool) else ""
        if not (at in ids or at in drawn):
            problems.append(f'{label}: `at` "{at}" is not a system id or an "a>b" link drawn on the map '
                            "(each system to the next, in map order)")
        else:
            covered.add(at)
        for key in ("mode", "impact", "action"):
            if not _text(f.get(key)).strip():
                problems.append(f"{label}: `{key}` is required")
        st = f.get("state")
        if st in (None, ""):
            problems.append(f"{label}: no `state` — set one of {sorted(FAILURE_STATES)}; there is no default")
        elif not isinstance(st, str) or st not in FAILURE_STATES:
            problems.append(f'{label}: state "{st}" is not one of {sorted(FAILURE_STATES)}')
        ref = f.get("ref")
        if ref is not None:
            if safe_ref(ref) is None:
                problems.append(f"{label}: `ref` {str(ref)[:60]!r} is not a plain https:// URL — the page "
                                "refuses it: https only, at most 2048 characters; an ASCII host with no port, trailing dot, userinfo or %; no control "
                                "character, space, quote or backslash; no empty, . or .. segment; no % in a GitHub path")
            else:
                m = GITHUB_BLOB.match(ref)
                raw = GITHUB_RAW.match(ref)
                if raw and not re.fullmatch(r"(?ai)[0-9a-f]{7,40}", raw.group(1)):
                    problems.append(f"{label}: `ref` is a raw GitHub link not pinned to a commit — use "
                                    "raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>")
                if GITHUB_CODE.match(ref):
                    if not m:
                        problems.append(f"{label}: `ref` is not a GitHub file permalink — use "
                                        "/blob/<sha>/<path>#La-Lb")
                    elif not re.fullmatch(r"(?ai)[0-9a-f]{7,40}", m.group(2)):
                        problems.append(f"{label}: `ref` is a GitHub link not pinned to a commit — use "
                                        "/blob/<sha>/<path>#La-Lb; a branch link drifts")
                    elif not m.group(3):
                        warnings.append(f"{label}: `ref` names a file but no lines — add #La-Lb")
        if st == "handled" and ref is None and not _text(f.get("source")).strip():
            problems.append(f"{label}: `handled` needs `ref` — the code line that handles it "
                            "(or, on a proposal, the `source` sentence)")
        if st == "detected" and not _text(f.get("detect")).strip():
            problems.append(f"{label}: `detected` needs `detect` — the signal that notices it")
        if f.get("finding") is not None:
            if not (hashable(f["finding"]) and f["finding"] in pins):
                problems.append(f"{label}: `finding` {f['finding']!r} is not a pin on the map")
            elif pins[f["finding"]] != at:
                problems.append(f'{label}: `finding` {f["finding"]} is pinned at "{pins[f["finding"]]}", '
                                f'not at this row\'s "{at}" — point it at the pin on the same boundary')
        if f.get("introduced") and st == "unhandled" and f.get("finding") is None:
            problems.append(f"{label}: unhandled and introduced by this work — that is a finding; "
                            "give it a pin and set `finding` to its number")
    return covered


def check_failures(data, register="engineer"):
    """The failure-mode table under the boundary map (boundary-review.md §3).

    Returns (problems, warnings). Problems fail the run; warnings print and
    leave the exit code alone. A packet written before `failures` existed gets
    one clear sentence telling the author what to add, never a traceback.
    """
    sections = (data or {}).get("sections") if isinstance(data, dict) else None
    if not isinstance(sections, list) or not sections or not isinstance(sections[-1], dict) \
            or sections[-1].get("kind") != "boundary":
        return [], []          # check_boundary_review already reports the missing map
    sec = sections[-1]
    problems, warnings = [], []
    systems = _map(data, sec)
    ids = {_js_str(n.get("id")) for n in systems if isinstance(n, dict)}
    for i in sorted(i for i in ids if ">" in i):
        problems.append(f'system id "{i[:40]}" contains ">" — it would make an `at` link ambiguous; rename it')
    hashable = lambda v: isinstance(v, (int, str)) and not isinstance(v, bool)
    finds = sec.get("findings") if isinstance(sec.get("findings"), list) else []
    pins = {f.get("n"): ("" if f.get("at") is None else _js_str(f.get("at")))
            for f in finds if isinstance(f, dict) and hashable(f.get("n"))}
    runbooks = [x for x in sections if isinstance(x, dict) and x.get("kind") == "runbook"]
    covered, seen = set(), {}
    # One place per failure mode. With runbooks, every row lives in a runbook
    # and the boundary map keeps only its pins: the same row twice is the
    # overlap a reader has to reconcile by hand.
    if runbooks:
        if sec.get("failures"):
            problems.append("the packet has runbooks, so the boundary map keeps only its pins — move its "
                            "`failures` rows into the runbooks (each row once) and drop the key")
        for x in runbooks:
            name = _en(x.get("heading")) or "runbook"
            rows = x.get("rows") if isinstance(x.get("rows"), list) else []
            if not rows:
                problems.append(f'"{name}": a runbook needs `rows`')
            covered |= _check_rows(rows, _map(data, x), pins, problems, warnings, what=f'"{name}" row')
            for i, r in enumerate(rows):
                if not isinstance(r, dict):
                    continue
                m = _en(r.get("mode"))
                # The mode's name: the text before " — ", without links, (…) and punctuation.
                head = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", m.split(" — ")[0])
                head = re.sub(r"[（(][^)）]*[)）]", " ", head)
                key = (_js_str(r.get("at")), re.sub(r"\W+", " ", head).strip().lower())
                if key[1] and key in seen:
                    problems.append(f'"{name}" row {i+1} repeats {seen[key]} ("{m[:40]}" at "{key[0]}") — '
                                    "one failure mode, one row")
                else:
                    seen[key] = f'"{name}" row {i+1}'
    else:
        if "failures" not in sec:
            msg = ("the boundary map has no `failures` — list every failure mode per system and link "
                   "(mode, detect, impact, action, ref, state; boundary-review.md §3) in `failures` or in "
                   '`runbook` sections, or `"failures": []` when none apply')
            (problems if register == "engineer" and len(ids) >= 2 else warnings).append(msg)
            return problems, warnings
        rows = sec.get("failures")
        if not isinstance(rows, list):
            return ["`failures` must be a list of failure modes"], warnings
        covered = _check_rows(rows, systems, pins, problems, warnings)
    if not _en(sec.get("ok")):
        for link, a, b in _links(systems):
            if not covered & {link, a, b}:
                warnings.append(f'link "{link}" has no failure mode listed — list how it fails' +
                                ("" if sec.get("findings") else ", or say in `ok` why nothing can"))
    return problems, warnings


# The page's link rule (templates/packet.html rich() / safeHref()), mirrored:
# default-deny. Only http(s):// and mailto: render as links, and a URL with
# any control character or space is refused, because browsers strip leading
# C0 controls ("\x01javascript:" runs as javascript:). A packet carrying a
# refused link is an attack or a broken link, so it fails here.
LINK = re.compile(r"\[([^\]\n]+)\]\(([^)\t\n\x0b\f\r ]+)\)")   # same class as the page


def safe_href(url):
    if re.search(r"[\x00-\x20\x7f]", url):
        return None
    return url if re.match(r"(?ai)^(https?://|mailto:)", url) else None   # ASCII, like the page's /i


# The page's SVG allow-list (templates/packet.html safeSVG()), mirrored, so a
# diagram the page would strip fails here instead of silently losing parts.
SVG_OK = {"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text",
          "tspan", "defs", "marker", "title", "desc", "lineargradient", "radialgradient", "stop",
          "clippath", "mask", "pattern", "use"}
LOCAL_URL = re.compile(r"""(?i)url\(\s*['"]?#[\w.:-]+['"]?\s*\)""")
BAD_STYLE = re.compile(r"(?i)expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding")


# Ids the page itself uses (getElementById targets). The page prefixes every
# diagram id, so a collision cannot clobber them any more, but a diagram that
# names one is a probe or a mistake. Read from the template, so the list
# cannot drift from it.
TEMPLATE = Path(__file__).resolve().parent.parent / "templates" / "packet.html"
RESERVED_IDS = set(re.findall(r'\bid="([^"]+)"', TEMPLATE.read_text())) if TEMPLATE.exists() else set()


def _text_attr(name):
    return name.startswith(("data-", "aria-")) and name not in ("aria-labelledby", "aria-describedby")


CSS_FN = {"url", "var", "calc", "rgb", "rgba", "hsl", "hsla", "translate", "translatex", "translatey",
          "rotate", "scale", "scalex", "scaley", "matrix", "skewx", "skewy"}
URL_STRING = re.compile(r"""(["'])[^"']*(:|//)[^"']*\1""")


def _url_ok(v):
    """The page's cssOK(): url() only as url(#id), only allow-listed CSS
    functions (image-set(), element(), paint() … fetch without url()), and no
    quoted string holding a URL."""
    if re.search(r"(?i)url\s*\(", LOCAL_URL.sub("", v)):
        return False
    if any(m.group(1).lower() not in CSS_FN for m in re.finditer(r"(?i)(-?[a-z_][\w-]*)\s*\(", v)):
        return False
    return not URL_STRING.search(v)


def check_svg_markup(svg):
    from html.parser import HTMLParser
    found = []
    class P(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag not in SVG_OK:
                found.append(f"<{tag}> is not an allowed SVG element")
                return
            href = None
            for name, value in attrs:
                value = value or ""
                if name == "id" and value in RESERVED_IDS:
                    found.append(f'<{tag} id="{value}">: the page uses that id — rename it')
                if "\\" in value and not _text_attr(name):
                    found.append(f'<{tag} {name}="{value[:40]}">: a backslash can hide a CSS escape '
                                 "(\\75 rl( spells url() — drop it")
                    continue
                if name.startswith("on"):
                    found.append(f"<{tag} {name}>: event handlers are not allowed")
                elif name in ("href", "xlink:href"):
                    href = value
                    if not re.fullmatch(r"#[\w.:-]+", value):
                        found.append(f'<{tag} {name}="{value[:40]}">: only #fragment links are allowed')
                elif name == "style" and (not _url_ok(value) or BAD_STYLE.search(value)):
                    found.append(f'<{tag} style="{value[:40]}">: only url(#…), allow-listed CSS functions '
                                 "and plain values are allowed")
                elif name != "style" and not _text_attr(name) and not _url_ok(value):
                    found.append(f'<{tag} {name}="{value[:40]}">: only url(#…) and allow-listed CSS '
                                 "functions (var, calc, rgb, hsl, transforms) are allowed")
            if tag == "use" and not (href or "").startswith("#"):
                found.append("<use> must point at a #fragment")
        handle_startendtag = handle_starttag
    P().feed(svg)
    return list(dict.fromkeys(found))


def check_svg(data):
    problems = []
    for i, sec in enumerate((data or {}).get("sections") or []):
        if isinstance(sec.get("svg"), str):
            name = _en(sec.get("heading")) or f"section {i+1}"
            problems += [f'"{name}" svg: {p}' for p in check_svg_markup(sec["svg"])]
    return problems


def check_links(data):
    problems = []
    def walk(v, path="data"):
        if isinstance(v, str):
            for m in LINK.finditer(v):
                url = m.group(2)
                if safe_href(url) is None:
                    problems.append(f'{path}: link "{m.group(1)[:30]}" → "{url[:60]!r}" is refused by the '
                                    "page — only http(s):// and mailto: links render, with no control "
                                    "characters or spaces")
                elif re.search(r"[\"'<>`]", url):
                    # The page escapes these, so nothing breaks out; a real URL
                    # never needs them unencoded, so one here is a mistake or a probe.
                    problems.append(f'{path}: link "{m.group(1)[:30]}" → "{url[:60]}" has a raw quote, '
                                    "angle bracket or backtick — percent-encode it")
        elif isinstance(v, dict):
            for k, x in v.items():
                if k != "svg":
                    walk(x, f"{path}.{k}")
        elif isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, f"{path}[{i}]")
    walk(data or {})
    return problems

RUNBOOK_WORDS = re.compile(r"(?i)run ?book|failure[- ]mode|error code|排障|失效模式|故障|錯誤碼|错误码|處置|处置")


def _fig_nodes(sec):
    """Node ids a figure draws: `nodes` if given, else every edge end."""
    if isinstance(sec.get("nodes"), list):
        return [_js_str(x) for x in sec["nodes"]]
    out = []
    for e in sec.get("edges") or []:
        if isinstance(e, dict):
            for k in ("from", "to"):
                v = e.get(k)
                if v is not None and _js_str(v) not in out:
                    out.append(_js_str(v))
    return out


def _svg_texts(svg):
    if not isinstance(svg, str):
        return set()
    t = set(re.findall(r'data-(?:en|hant|hans)="([^"]*)"', svg))
    t |= {x.strip() for x in re.findall(r">([^<>]+)<", svg) if x.strip()}
    return {html_unescape(x) for x in t}


def html_unescape(x):
    import html as _h
    return _h.unescape(x)


def check_system_map(data):
    """One system map, drawn the same everywhere (spec.md § systems).

    The boundary map, every runbook map, and the architecture and sequence
    figures of the same state must draw the same components under the same
    names; a runbook or failure-mode table is never a bare table.
    """
    problems = []
    if not isinstance(data, dict):
        return problems
    sections = [x for x in data.get("sections") or [] if isinstance(x, dict)]
    reg = data.get("systems")
    maps = [x for x in sections if x.get("kind") in ("boundary", "runbook")]
    figs = [x for x in sections if x.get("kind") == "figure" and x.get("edges")]

    # 1. Runbooks and failure modes are located on the map, never a bare table.
    for x in sections:
        if x.get("kind") in ("compare", "matrix"):
            words = " ".join(_text(v) if not isinstance(v, dict) else " ".join(str(t) for t in v.values())
                             for v in [x.get("heading")] + list(x.get("cols") or []))
            if RUNBOOK_WORDS.search(words):
                problems.append(f'"{_en(x.get("heading"))}": a runbook or failure-mode table must be a '
                                '`runbook` section (or the boundary map\'s `failures`) — each row needs `at`, '
                                "the system or link where it fails, drawn on the system map above it")

    # 2. Figures that draw systems say which view and which state they are.
    for x in figs:
        name = _en(x.get("heading")) or "figure"
        if x.get("view") not in ("architecture", "sequence"):
            problems.append(f'"{name}": a figure with `edges` needs `"view": "architecture"|"sequence"` '
                            "so its nodes are checked against the system map")
        if x.get("state") not in ("before", "after", "today"):
            problems.append(f'"{name}": a figure with `edges` needs `"state": "before"|"after"|"today"`')

    if not maps and not figs:
        return problems
    if not isinstance(reg, dict) or not isinstance(reg.get("systems"), list) or len(reg["systems"]) < 2:
        if len(maps) + len(figs) == 1 and maps and _map(data, maps[0]):
            return problems    # one map, nothing to agree with
        problems.append("the packet needs a top-level `systems` map ({state, systems, sub, hops, groups}) — "
                        "the boundary map, every runbook and the architecture/sequence figures all draw it")
        return problems
    state = reg.get("state")
    if state not in ("after", "today"):
        problems.append('`systems.state` must be "after" (the architecture this work leaves behind) or "today"')
    if any(x.get("state") == "after" for x in figs) and state != "after":
        problems.append('the packet draws an "after" architecture, so `systems.state` must be "after": the '
                        "boundary map and runbooks show the target system, not production today")
    ids = [_js_str(n.get("id")) for n in reg["systems"] if isinstance(n, dict)]
    if len(ids) > 8:
        problems.append(f"the system map has {len(ids)} systems — at most 8 fit one row; group the "
                        "internals (`systems.groups`) or move peripheral boxes to a figure's `context`")
    names = {_js_str(n.get("id")): _en(n.get("name")) for n in reg["systems"] if isinstance(n, dict)}
    groups = reg.get("groups") if isinstance(reg.get("groups"), dict) else {}
    for g, spec in groups.items():
        parts = spec.get("parts") if isinstance(spec, dict) else None
        if not isinstance(parts, list) or not parts or not all(_js_str(p) in ids for p in parts):
            problems.append(f'systems.groups "{g}": `parts` must list system ids on the map')

    # 3. Map sections draw exactly the registry.
    for x in maps:
        own = x.get("systems")
        if isinstance(own, list) and own:
            if [_js_str(n.get("id")) for n in own if isinstance(n, dict)] != ids:
                problems.append(f'"{_en(x.get("heading"))}": its `systems` differ from the packet map — drop '
                                "them and let the section draw `systems`")

    # 4. Figures of the map's state draw the same systems, by the same names.
    for x in figs:
        if x.get("state") != state:
            continue
        name = _en(x.get("heading")) or "figure"
        nodes = _fig_nodes(x)
        ctx = {_js_str(c) for c in x.get("context") or []}
        drawn = set()
        for n in nodes:
            if n in ids:
                drawn.add(n)
            elif n in groups:
                drawn |= {_js_str(p) for p in groups[n].get("parts") or []}
            elif n not in ctx:
                problems.append(f'"{name}": draws "{n}", which is not on the system map — add it to '
                                "`systems`, map it with `systems.groups`, or list it in the figure's `context`")
        for m in ids:
            if m not in drawn:
                problems.append(f'"{name}": the system map has "{m}" ({names.get(m)}) but this {x.get("view")} '
                                "does not draw it — every view of the same state shows the same systems")
        texts = _svg_texts(x.get("svg"))
        if texts:
            for n in nodes:
                want = names.get(n) or (_en(groups[n].get("name")) if n in groups and isinstance(groups[n], dict) else "")
                if want and not any(want in t for t in texts):
                    problems.append(f'"{name}": node "{n}" should be labelled "{want}" as on the system map')
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packet")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--register", choices=["eli5", "engineer"], default="engineer")
    a = ap.parse_args()

    html, data = load(a.packet)
    fail_problems, fail_warnings = check_failures(data, a.register)
    groups = [("context", check_context(html)), ("before/after", check_before_after(data)),
              ("components", check_components(data)),
              ("boundary review", check_boundary_review(html, data)),
              ("failure modes", fail_problems),
              ("system map", check_system_map(data)),
              ("links", check_links(data)), ("svg", check_svg(data))]
    if a.register == "eli5":
        groups.append(("register",
                       check_register(data, (data or {}).get("glossary", []))))

    total = sum(len(p) for _, p in groups)
    if fail_warnings:
        print(f"baton: {len(fail_warnings)} warning(s) — failure modes:", file=sys.stderr)
        for w in fail_warnings[:12]:
            print(f"    - {w}", file=sys.stderr)
        if len(fail_warnings) > 12:
            print(f"    … and {len(fail_warnings) - 12} more", file=sys.stderr)
    if not total:
        print("ok — context, components, before/after, boundary map, failure modes and register checked. "
              "Diagrams are checked in the browser (pipeline §6).")
        return 0

    print(f"baton: {total} problem(s)\n", file=sys.stderr)
    for name, problems in groups:
        if not problems:
            continue
        print(f"  {name}:", file=sys.stderr)
        for p in problems[:12]:
            print(f"    - {p}", file=sys.stderr)
        if len(problems) > 12:
            print(f"    … and {len(problems) - 12} more", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
