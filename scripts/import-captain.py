"""Import Firstmate's renderer without writing to its checkout.
Usage: ESBUILD=/path/to/esbuild python3 scripts/import-captain.py [source-repo]
"""
import json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path
root = Path(__file__).resolve().parents[1]
repo = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'firstmate-workflow'
origin = repo / 'games/voyage-2d'
out = root / 'skins/captain'
out.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='captain-build-') as tmp:
    work = Path(tmp)
    for folder in ['src', 'v3src']:
        shutil.copytree(origin / folder, work / folder)
    (work / 'src/bake-data.js').write_text('export default ' + (origin / 'bake/sprites.json').read_text() + ';')
    mods = {m['id']:m for m in [json.loads(p.read_text()) for p in sorted((origin / 'mods').glob('*.json'))]}
    (work / 'src/mods-data.js').write_text('export default ' + json.dumps(mods) + ';')
    main = (work / 'src/main.js').read_text()
    main = re.sub(r'window\.parent\.VOYAGE\?\.fight\([^;]+\);', '', main)
    (work / 'src/main.js').write_text(main)
    hud = work / 'src/hud.js'
    hud.write_text(hud.read_text().replace('https://github.com/OWNER/firstmate-workflow', ''))
    # Remove the upstream write transport entirely before bundling.
    board = work / 'src/board-source.js'
    text = board.read_text()
    start, end = text.index('  async command(c)'), text.index('  close()')
    text = text[:start] + text[end:]
    text = text.replace("constructor({token = () => '', fetch: request = globalThis.fetch} = {})", 'constructor()')
    text = text.replace('    this.token=token;', '').replace('    this.request=(...args)=>request(...args);', '')
    text = text.replace('const arms=kraken.arms.filter', 'const arms=[...new Set([...kraken.arms,...tasks.filter(t=>t.status==="failed").map(t=>t.id)])].filter')
    board.write_text(text)
    shutil.copyfile(root / 'scripts/captain-adapter.js', work / 'src/captain-adapter.js')
    (work / 'src/captain-entry.js').write_text('import "./captain-adapter.js";\nimport "./main.js";\n')
    subprocess.run([os.environ.get('ESBUILD', 'esbuild'), str(work / 'src/captain-entry.js'), '--bundle', '--format=iife', '--minify', '--outfile=' + str(out / 'captain.js')], check=True)
html = (origin / 'game2d.html').read_text()
html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
html = re.sub(r'<link[^>]*https://[^>]*>', '', html)
html = html.replace('Firstmate Voyage 2D', 'Captain')
html = html.replace('<script type="module" src="./src/main.js"></script>', '<nav id="captain-cards" aria-label="Pending cards"></nav>\n<script src="/skin/_kit/skin-kit.js"></script>\n<script src="captain.js"></script>')
html = html.replace('</head>', '<style>#captain-cards{position:fixed;top:12px;left:12px;z-index:100;display:flex;gap:8px;flex-wrap:wrap;max-width:calc(100% - 24px)}#captain-cards button{max-width:280px;padding:10px;background:#fff;color:#16121a;border:2px solid #e60012;cursor:pointer;overflow-wrap:anywhere}</style></head>')
(out / 'index.html').write_text(html)
shutil.copyfile(repo / 'LICENSE', out / 'LICENSE.txt')
sha = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
(out / 'ORIGIN.txt').write_text('Firstmate Voyage 2D, OWNER/firstmate-workflow\nSource commit: ' + sha + '\nImported by scripts/import-captain.py; Studio bridge: scripts/captain-adapter.js.\n')
