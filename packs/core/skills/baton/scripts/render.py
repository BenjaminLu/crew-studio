#!/usr/bin/env python3
"""Turn a packet spec into the single self-contained HTML file.

The spec is written by the skill; this script does the assembly so the page is
byte-identical in structure every time. Nothing here interprets the repo — see
extract.py for that.

Usage: render.py packet.json [-o out.html]
"""
import argparse, html, json, sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "templates" / "packet.html"

REFUSAL_MARKERS = ("say you do not know", "say you don't know", "說不知道", "说不知道")


def derive_hans(node, cc, filled, missing, path="$"):
    """Fill a missing `hans` from `hant` via OpenCC (tw2sp: Taiwan Traditional
    → Simplified, phrase-level, so 資訊→信息 not 资讯).

    Only i18n dicts in the spec are touched — an explicit `hans` always wins,
    and diagram SVG stays the author's job (`data-hans` is checked by
    snapshot.py, not rewritten here). Without OpenCC installed a missing
    `hans` is an error, never a silent copy of the Traditional text: a
    Simplified reader served 繁體 would be a quality failure this script
    exists to prevent.
    """
    if isinstance(node, dict):
        if isinstance(node.get("hant"), str) and not node.get("hans"):
            if cc:
                node["hans"] = cc.convert(node["hant"])
                filled.append(path)
            else:
                missing.append(path)
        for k, v in node.items():
            derive_hans(v, cc, filled, missing, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            derive_hans(v, cc, filled, missing, f"{path}[{i}]")


def check(spec, ctx):
    """Refuse to build a packet that would mislead its reader.

    Both failures below are silent at read time — the page looks fine and the
    answers sound fine — so they have to be caught here or not at all.
    """
    problems = []
    if not any(m in ctx.lower() for m in REFUSAL_MARKERS):
        problems.append(
            "context is missing its refusal declaration; without it a receiving "
            "agent will fill gaps by inference instead of saying it does not know")
    for sec in spec.get("sections", []):
        if sec.get("kind") != "figure":
            continue
        for edge in sec.get("edges", []):
            if not edge.get("evidence"):
                problems.append(
                    f"edge {edge.get('from')}->{edge.get('to')} has no evidence; "
                    "every line on a diagram must trace to real code")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("-o", "--out")
    ap.add_argument("--force", action="store_true",
                    help="build despite integrity problems (do not ship it)")
    a = ap.parse_args()

    spec = json.loads(Path(a.spec).read_text())
    ctx = spec.pop("context", "")
    if isinstance(ctx, list):
        ctx = "\n".join(ctx)

    try:
        from opencc import OpenCC
        cc = OpenCC("tw2sp")
    except ImportError:
        cc = None
    filled, missing = [], []
    derive_hans(spec, cc, filled, missing)
    if filled:
        print(f"hans derived from hant via OpenCC tw2sp: {len(filled)} value(s)")

    problems = check(spec, ctx)
    if missing:
        problems.append(
            f"{len(missing)} i18n value(s) have hant but no hans and OpenCC is "
            "not installed — `pip install opencc`, or write hans explicitly "
            f"(first: {missing[0]})")
    if problems and not a.force:
        print("baton: refusing to build\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    spec.setdefault("format_version", "0.1")
    spec.setdefault("layer", "L0")
    spec.setdefault("filename", "baton-packet")

    # Default beside the work, not in a temp directory: a packet is something
    # the author shares, and one written to /tmp is gone by the time they
    # think to send it.
    out = Path(a.out or f"{spec['filename']}.html")
    page = TEMPLATE.read_text()
    # Diagrams arrive as inline SVG from the diagram-design skill — static
    # markup, no runtime library. Theming and language switching are page
    # behaviour, so nothing is vendored in here.
    page = page.replace("{{TITLE}}", html.escape(
        spec.get("title", {}).get("en", "baton packet") if
        isinstance(spec.get("title"), dict) else str(spec.get("title", "baton packet"))))
    # Both payloads sit inside <script> elements: the only sequence that can
    # break out is a literal closing tag.
    page = page.replace("{{DATA}}", json.dumps(spec, ensure_ascii=False)
                        .replace("</", "<\\/"))
    page = page.replace("{{CONTEXT}}", ctx.replace("</script", "<\\/script"))
    out.write_text(page)

    kb = len(page.encode()) / 1024
    print(f"{out.resolve()}  ({kb:.0f} KB, layer {spec['layer']})")
    if problems:
        print("built with --force despite:", *problems, sep="\n  - ", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
