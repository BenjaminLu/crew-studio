#!/usr/bin/env python3
"""Export a baton packet HTML to PDF — same page, same CSS, same SVGs.

Optional. Does not run as part of render/verify. Layout and colours stay
identical because this prints the rendered packet; it does not redraw.

    python3 export_pdf.py baton-<slug>.html --lang hant -o baton-<slug>-hant.pdf

Requires Chrome/Chromium (same discovery as snapshot.py). Set BATON_CHROME
or CHROME_BIN if needed.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME_CANDIDATES = [
    os.environ.get("BATON_CHROME"),
    os.environ.get("CHROME_BIN"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    shutil.which("google-chrome"),
    shutil.which("chromium"),
    shutil.which("chromium-browser"),
    shutil.which("chrome"),
]

# Same freeze idea as snapshot.py; plus expand every step and strip chrome
# so the PDF is the content, not the deck controls.
PDF_HEAD = """
<script>localStorage.setItem('baton-lang','{lang}');</script>
<style id="baton-pdf-export">
:root, :root[data-theme=light], :root[data-theme=dark] {{
  /* formal handout defaults to the light packet palette */
  --bg:#f5f5f5; --card:#ffffff; --card-2:#ececec; --fg:#2d3142; --muted:#4f5d75;
  --soft:#7a8399; --rule:#d5d6d8; --rule-strong:#2d3142; --accent:#eb6c36;
  --accent-tint:#f8e4da; --amber:#c98a2e; --seal:#a05b4d; --ok:#3d6b4f; --link:#2b5f8a;
}}
html[data-theme], html {{ color-scheme: light; }}
.step, .step.on {{ animation: none !important; display: block !important; }}
.figbody svg path[data-edge] {{
  stroke-dasharray: none !important; stroke-dashoffset: 0 !important; animation: none !important;
}}
.figbody svg rect[data-node] {{ opacity: 1 !important; animation: none !important; }}
.rail, .langs, .nav, .handoff, .foot button, #theme {{ display: none !important; }}
.step {{ page-break-after: always; break-after: page; margin-bottom: 2rem; }}
.step:last-of-type {{ page-break-after: auto; break-after: auto; }}
body {{ background: var(--bg) !important; }}
* {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
</style>
"""

PDF_TAIL = """
<script>
document.documentElement.setAttribute('data-theme', '{theme}');
document.addEventListener('DOMContentLoaded', function () {{
  document.querySelectorAll('.langs button[data-lang]').forEach(function (b) {{
    if (b.getAttribute('data-lang') === '{lang}') b.click();
  }});
}});
</script>
"""


def chrome() -> str:
    for c in CHROME_CANDIDATES:
        if c and Path(c).exists():
            return c
    sys.exit("export_pdf.py: no Chrome/Chromium found — set BATON_CHROME")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Print a baton HTML packet to PDF (same layout and colours)."
    )
    ap.add_argument("page", help="path to baton-*.html")
    ap.add_argument(
        "--lang",
        default="hant",
        choices=["en", "hant", "hans"],
        help="packet language (default: hant)",
    )
    ap.add_argument(
        "--theme",
        default="light",
        choices=["light", "dark"],
        help="force theme for the handout (default: light)",
    )
    ap.add_argument(
        "-o",
        "--out",
        default=None,
        help="output PDF path (default: <page-stem>-<lang>.pdf beside the HTML)",
    )
    ap.add_argument(
        "--budget-ms",
        type=int,
        default=10000,
        help="Chrome virtual-time budget so diagrams/labels settle (default: 10000)",
    )
    a = ap.parse_args()

    page = Path(a.page).resolve()
    if not page.is_file():
        sys.exit(f"export_pdf.py: not a file: {page}")

    out = Path(a.out).resolve() if a.out else page.with_name(f"{page.stem}-{a.lang}.pdf")
    out.parent.mkdir(parents=True, exist_ok=True)

    src = page.read_text(encoding="utf-8")
    head = PDF_HEAD.format(lang=a.lang)
    tail = PDF_TAIL.format(lang=a.lang, theme=a.theme)
    if "<body>" not in src:
        sys.exit("export_pdf.py: page has no <body> — not a baton HTML packet?")
    variant = src.replace("<body>", "<body>" + head, 1) + tail

    bin_ = chrome()
    tmp = Path(tempfile.mkdtemp(prefix="baton-pdf-"))
    try:
        html = tmp / f"print-{a.lang}.html"
        html.write_text(variant, encoding="utf-8")
        # Chrome writes the PDF itself; cwd-safe absolute path.
        cmd = [
            bin_,
            "--headless=new",
            "--disable-gpu",
            "--no-pdf-header-footer",
            f"--virtual-time-budget={a.budget_ms}",
            f"--print-to-pdf={out}",
            html.as_uri(),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if not out.is_file() or out.stat().st_size < 1000:
            err = (r.stderr or r.stdout or "").strip() or "Chrome produced no PDF"
            sys.exit(f"export_pdf.py: failed\n{err}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    kb = out.stat().st_size / 1024
    print(f"{out}  ({kb:.0f} KB, lang={a.lang}, theme={a.theme})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
