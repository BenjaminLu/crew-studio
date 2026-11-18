#!/usr/bin/env python3
"""Render a packet in a real (headless) browser: mechanical checks + the
screenshots the author then reads with their own eyes.

One command replaces the ad-hoc harness every session used to hand-write:

    python3 snapshot.py baton-<slug>.html -o <scratch-dir> [--primary hant]

It does two things, in order:

1. **Mechanical checks** (one --dump-dom pass, all steps forced visible):
   - every svg <text data-en> also carries data-hant and data-hans
   - no svg text wider than the box or label-mask it sits in (per language)
   - no CJK text below 12px
   - no '[object Object]' anywhere, no blank section
   Failures print with figure/step indexes and the run exits 1 — fix the spec
   and re-run before spending any screenshots.

2. **Screenshots** (only when checks pass, unless --shots-anyway):
   - the primary language: every step
   - the other two languages: the figure steps only (auto-detected), plus
     step 0 — figures are where language switching breaks layout
   - the raw-context dialog (the clipboard fallback panel), primary language

The screenshots are not decoration: pipeline §6's browser check is reading
them. This script only guarantees they exist and that the mechanical failures
are already gone.
"""
import argparse, html as htmlmod, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

CHROME_CANDIDATES = [
    os.environ.get("BATON_CHROME"),
    os.environ.get("CHROME_BIN"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    shutil.which("google-chrome"), shutil.which("chromium"),
    shutil.which("chromium-browser"), shutil.which("chrome"),
]

FREEZE_CSS = """<style id="baton-snap-freeze">
.step,.step.on{animation:none!important}
.figbody svg path[data-edge]{stroke-dasharray:none!important;stroke-dashoffset:0!important;animation:none!important}
.figbody svg rect[data-node]{opacity:1!important;animation:none!important}
</style>"""
SHOW_ALL_CSS = '<style id="baton-snap-all">.step{display:block!important}</style>'

CHECK_JS = """<script>
window.addEventListener('load',()=>{setTimeout(()=>{
  const out={missing:[],overflow:[],cjk:[],blank:[],objectObject:false,figSteps:[],steps:0};
  out.steps=document.querySelectorAll('.step').length;
  const LANGS=['en','hant','hans'];
  document.querySelectorAll('.step').forEach((st,i)=>{
    if(st.querySelector('.figbody svg')) out.figSteps.push(i);
    if(st.innerText.trim().length<10) out.blank.push(i);
  });
  if(document.body.innerText.includes('[object Object]')) out.objectObject=true;
  document.querySelectorAll('.figbody svg').forEach((svg,f)=>{
    const rects=[...svg.querySelectorAll('rect')].map(r=>({
      x:+r.getAttribute('x'),y:+r.getAttribute('y'),
      w:+r.getAttribute('width'),h:+r.getAttribute('height')}))
      .filter(r=>!isNaN(r.x)&&r.w>0);
    const vb=svg.viewBox.baseVal;
    svg.querySelectorAll('text').forEach(t=>{
      if(!t.hasAttribute('data-en')){out.missing.push({fig:f,text:t.textContent,attr:'data-en'});return;}
      for(const l of LANGS) if(!t.hasAttribute('data-'+l))
        out.missing.push({fig:f,text:t.textContent,attr:'data-'+l});
      const orig=t.textContent;
      const fs=parseFloat(t.getAttribute('font-size')||getComputedStyle(t).fontSize);
      for(const l of LANGS){
        const s=t.getAttribute('data-'+l); if(s==null) continue;
        if(/[\\u3000-\\u9fff\\uf900-\\ufaff]/.test(s)&&fs<12)
          out.cjk.push({fig:f,lang:l,text:s,size:fs});
        t.textContent=s;
        let b; try{b=t.getBBox();}catch(e){continue;}
        const cx=b.x+b.width/2, cy=b.y+b.height/2;
        const inside=rects.filter(r=>cx>=r.x&&cx<=r.x+r.w&&cy>=r.y&&cy<=r.y+r.h)
          .sort((a,c)=>a.w*a.h-c.w*c.h)[0];
        const box=inside||{x:vb.x,y:vb.y,w:vb.width,h:vb.height};
        const over=Math.max(box.x-b.x, (b.x+b.width)-(box.x+box.w));
        if(over>3) out.overflow.push({fig:f,lang:l,text:s,overPx:Math.round(over)});
      }
      t.textContent=orig;
    });
  });
  const pre=document.createElement('pre'); pre.id='baton-check';
  pre.textContent=JSON.stringify(out);
  document.body.appendChild(pre);
},250);});
</script>"""


def chrome():
    for c in CHROME_CANDIDATES:
        if c and Path(c).exists():
            return c
    sys.exit("snapshot.py: no Chrome/Chromium found — set BATON_CHROME")


def variant(src, inject_head, inject_tail=""):
    return src.replace("<body>", "<body>" + inject_head, 1) + inject_tail


def run_chrome(bin_, args):
    subprocess.run([bin_, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--virtual-time-budget=3000"] + args,
                   check=False, capture_output=True, timeout=120)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page")
    ap.add_argument("-o", "--out", default=".")
    ap.add_argument("--primary", default="hant", choices=["en", "hant", "hans"])
    ap.add_argument("--size", default="1440,2000")
    ap.add_argument("--shots-anyway", action="store_true",
                    help="take screenshots even when checks fail")
    ap.add_argument("--others-max", type=int, default=4,
                    help="max figure steps shot per non-primary language "
                         "(mechanical checks already cover every language; "
                         "these shots are for eyes, and a vuln-card deck "
                         "makes nearly every step a figure)")
    a = ap.parse_args()

    bin_ = chrome()
    src = Path(a.page).read_text()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="baton-snap-"))

    # -- pass 1: mechanical checks, all steps visible ------------------------
    chk = tmp / "check.html"
    chk.write_text(variant(src, FREEZE_CSS + SHOW_ALL_CSS, CHECK_JS))
    dom = subprocess.run([bin_, "--headless=new", "--disable-gpu",
                          "--virtual-time-budget=4000", "--dump-dom",
                          chk.resolve().as_uri()],
                         capture_output=True, text=True, timeout=120).stdout
    m = re.search(r'<pre id="baton-check">(.*?)</pre>', dom, re.S)
    if not m:
        sys.exit("snapshot.py: checker never ran — is the page valid HTML?")
    r = json.loads(htmlmod.unescape(m.group(1)))
    problems = []
    for x in r["missing"]:  problems.append(f"fig {x['fig']}: <text> '{x['text'][:40]}' missing {x['attr']}")
    for x in r["overflow"]: problems.append(f"fig {x['fig']} [{x['lang']}]: '{x['text'][:40]}' overflows its box by {x['overPx']}px")
    for x in r["cjk"]:      problems.append(f"fig {x['fig']} [{x['lang']}]: CJK at {x['size']}px (<12): '{x['text'][:40]}'")
    for i in r["blank"]:    problems.append(f"step {i}: renders blank")
    if r["objectObject"]:   problems.append("'[object Object]' appears on the page")
    steps = r.get("steps", 0)
    fig_steps = r.get("figSteps", [])

    if problems:
        print("snapshot.py: mechanical checks FAILED")
        for p in problems:
            print("  -", p)
        if not a.shots_anyway:
            sys.exit(1)
    else:
        print(f"snapshot.py: checks ok — {steps} steps, figures at {fig_steps}")

    # -- pass 2: screenshots --------------------------------------------------
    langs = ["en", "hant", "hans"]
    sampled = fig_steps if len(fig_steps) <= a.others_max else \
        [fig_steps[i * (len(fig_steps) - 1) // (a.others_max - 1)]
         for i in range(a.others_max)]
    plan = {l: (list(range(steps)) if l == a.primary
                else sorted(set([0] + sampled))) for l in langs}
    shots = []
    for lang, idxs in plan.items():
        for i in idxs:
            v = tmp / f"{lang}-{i}.html"
            head = f"<script>localStorage.setItem('baton-lang','{lang}')</script>" + FREEZE_CSS
            tail = (f"<script>window.addEventListener('load',()=>{{"
                    f"for(let k=0;k<{i};k++)document.getElementById('next').click();}});</script>")
            v.write_text(variant(src, head, tail))
            png = out / f"{lang}-step{i}.png"
            run_chrome(bin_, [f"--window-size={a.size}",
                              f"--screenshot={png}", v.resolve().as_uri()])
            shots.append(png)
    # raw-context dialog (clipboard fallback), primary language
    v = tmp / "raw.html"
    v.write_text(variant(src,
        f"<script>localStorage.setItem('baton-lang','{a.primary}')</script>" + FREEZE_CSS,
        "<script>window.addEventListener('load',()=>{setTimeout(()=>"
        "document.getElementById('raw').click(),200);});</script>"))
    png = out / "raw.png"
    run_chrome(bin_, [f"--window-size={a.size}", f"--screenshot={png}",
                      v.resolve().as_uri()])
    shots.append(png)

    print("screenshots:")
    for s in shots:
        print("  ", s)
    print("now READ them (pipeline §6) — the checks above are necessary, not sufficient.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
