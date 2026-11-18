#!/usr/bin/env python3
"""Shared layout functions for baton diagrams — import, do not copy.

    import sys; sys.path.insert(0, f"{BATON}/scripts")
    from figures import before_after

`before_after(prefix, item)` draws the per-change BEFORE / AFTER card figure
(diagrams.md § Per-change before / after). It REFUSES to draw a lazy AFTER:

* `after_outcome` is required and must state what the system does NOW —
  the new value, error, state or behaviour — not that the old outcome is gone.
* It must differ from `before_outcome`, and may not be the before outcome
  with a negation bolted on ("no longer diluted", "不再被稀釋", "✗ blocked").

The AFTER row's third box is a live outcome (`--ok`), never a struck-through
copy of the BEFORE impact. verify.py checks the rendered page for the same
thing (data-node="before-outcome" / "after-outcome"), so hand-drawn figures
are held to the same rule.

item keys (each label is (en, hant); hans is derived via OpenCC when present):
  title, desc                 figure <title>/<desc>
  src                         trigger / input, same in both rows
  comp, comp_sub              component as it was (sub: the old mechanism)
  fix_name, fix_sub           component as it is now (sub: the new mechanism)
  before_outcome              what happened before  (observable)
  after_outcome               what happens now      (observable, concrete)
  before_kind                 "seal" (cannot be undone) | "warn" (default)
"""
import re
from html import escape

try:
    import opencc
    _CC = opencc.OpenCC("tw2sp")
    _hans = _CC.convert
except Exception:  # render.py refuses the build without OpenCC anyway
    def _hans(s):
        return s

NEGATION = re.compile(
    r"\b(no longer|not|never|no|cannot|can't|doesn't|won't|isn't|blocked|prevented|"
    r"removed|fixed|eliminated|avoided|stops?)\b|"
    r"不再|不會|不会|沒有|没有|不能|無法|无法|已修|修好|消除|避免|阻斷|阻断|擋下|挡下|不|無|无|沒|没|✗|×",
    re.I)


def _norm(s):
    s = NEGATION.sub("", s.lower())
    return re.sub(r"[\s\W_]+", "", s)


def lazy_after_reason(before, after):
    """Why an AFTER label is lazy, or None. Shared with verify.py."""
    if not after or not after.strip():
        return "AFTER outcome is empty"
    if _norm(after) == _norm(before) or (_norm(after) and _norm(after) in _norm(before)):
        return (f'AFTER "{after}" only negates BEFORE "{before}" — say what the system '
                "does now (the new value, error, state or behaviour)")
    if NEGATION.match(after.strip()) and len(_norm(after)) < 8:
        return f'AFTER "{after}" says what stopped, not what happens now'
    return None


def esc(s):
    return escape(str(s), quote=True)


def T(x, y, en, hant, hans=None, size=13, anchor="middle", font="sans",
      fill="var(--fg)", weight=None, extra=""):
    hans = hans if hans is not None else _hans(hant)
    w = f' font-weight="{weight}"' if weight else ""
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}"{w} fill="{fill}" '
            f'style="font-family:var(--{font})" data-en="{esc(en)}" data-hant="{esc(hant)}" '
            f'data-hans="{esc(hans)}"{extra}>{esc(en)}</text>')


def head(p, w, h, title, desc):
    marks = "".join(
        f'<marker id="{p}-{n}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">'
        f'<polygon points="0 0, 8 3, 0 6" fill="{c}"/></marker>'
        for n, c in (("m", "var(--muted)"), ("a", "var(--accent)"), ("s", "var(--seal)"),
                     ("w", "var(--amber)"), ("o", "var(--ok)")))
    return (f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-labelledby="{p}-title {p}-desc" '
            f'xmlns="http://www.w3.org/2000/svg"><title id="{p}-title">{esc(title)}</title>'
            f'<desc id="{p}-desc">{esc(desc)}</desc><defs>{marks}</defs>'
            f'<rect width="{w}" height="{h}" fill="var(--card)"/>')


BW, BH, GAP = 208, 64, 40
XS = [16, 16 + BW + GAP, 16 + 2 * (BW + GAP)]
STYLE = {
    "src": ("var(--card-2)", "var(--rule-strong)", ""),
    "comp": ("var(--card)", "var(--fg)", ""),
    "fix": ("var(--accent-tint)", "var(--accent)", ""),
    "seal": ("var(--card)", "var(--seal)", ""),
    "warn": ("var(--card)", "var(--amber)", ""),
    "ok": ("var(--card)", "var(--ok)", ""),
}


def _box(x, y, name, sub, kind, node):
    fill, stroke, dash = STYLE[kind]
    o = [f'<rect data-node="{node}" x="{x}" y="{y}" width="{BW}" height="{BH}" rx="6" '
         f'fill="{fill}" stroke="{stroke}" stroke-width="1.3"{dash}/>']
    cx = x + BW // 2
    if sub:
        o.append(T(cx, y + 27, *name, size=13, weight=600))
        o.append(T(cx, y + 47, sub, sub, sub, size=11, font="mono", fill="var(--muted)"))
    else:
        o.append(T(cx, y + 37, *name, size=13, weight=600))
    return "".join(o)


def before_after(p, item):
    for lang in (0, 1):
        reason = lazy_after_reason(item["before_outcome"][lang], item["after_outcome"][lang])
        if reason:
            raise ValueError(f"{item.get('title', p)}: {reason}")
    W, H = 16 + 3 * BW + 2 * GAP + 16, 240
    o = [head(p, W, H, item["title"], item["desc"])]
    bk = item.get("before_kind", "warn")
    for row, (en, hant, y) in enumerate((("BEFORE", "改動前", 32), ("AFTER", "改動後", 148))):
        after = row == 1
        o.append(T(16, y - 12, en, hant, size=12, anchor="start", font="mono",
                   fill="var(--muted)", weight=600))
        cy = y + BH // 2
        o.append(f'<path data-edge="1" d="M{XS[0]+BW} {cy} H{XS[1]-2}" stroke="var(--muted)" '
                 f'stroke-width="1.3" fill="none" marker-end="url(#{p}-m)"/>')
        col, mk = (("var(--ok)", "o") if after else
                   (("var(--seal)", "s") if bk == "seal" else ("var(--amber)", "w")))
        o.append(f'<path data-edge="1" d="M{XS[1]+BW} {cy} H{XS[2]-2}" stroke="{col}" '
                 f'stroke-width="1.4" fill="none" marker-end="url(#{p}-{mk})"/>')
        o.append(_box(XS[0], y, item["src"], None, "src", f"src{row}"))
        if after:
            o.append(_box(XS[1], y, item["fix_name"], item["fix_sub"], "fix", "fix"))
            o.append(_box(XS[2], y, item["after_outcome"], None, "ok", "after-outcome"))
        else:
            o.append(_box(XS[1], y, item["comp"], item["comp_sub"], "comp", "comp"))
            o.append(_box(XS[2], y, item["before_outcome"], None, bk, "before-outcome"))
    o.append("</svg>")
    return "".join(o)
