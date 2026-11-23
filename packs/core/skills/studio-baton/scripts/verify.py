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
             "guard", "summary", "ref"}


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
    ids = _ids(sec.get("systems"))
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


# The page's link rule (templates/packet.html rich() / safeHref()), mirrored:
# default-deny. Only http(s):// and mailto: render as links, and a URL with
# any control character or space is refused, because browsers strip leading
# C0 controls ("\x01javascript:" runs as javascript:). A packet carrying a
# refused link is an attack or a broken link, so it fails here.
LINK = re.compile(r"\[([^\]\n]+)\]\(([^)\t\n\x0b\f\r ]+)\)")   # same class as the page


def safe_href(url):
    if re.search(r"[\x00-\x20\x7f]", url):
        return None
    return url if re.match(r"(?i)^(https?://|mailto:)", url) else None


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packet")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--register", choices=["eli5", "engineer"], default="engineer")
    a = ap.parse_args()

    html, data = load(a.packet)
    groups = [("context", check_context(html)), ("before/after", check_before_after(data)),
              ("components", check_components(data)),
              ("boundary review", check_boundary_review(html, data)),
              ("links", check_links(data)), ("svg", check_svg(data))]
    if a.register == "eli5":
        groups.append(("register",
                       check_register(data, (data or {}).get("glossary", []))))

    total = sum(len(p) for _, p in groups)
    if not total:
        print("ok — context, components, before/after, boundary map and register checked. "
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
