"""Build the single-file web page.

  python app/tools/build.py            full build:   embeds UNS-MAN.txt and UNS-GAME.txt from ./listings (or $LISTINGS)
                                       -> app/index.html            (contains the original program: keep it private)
  python app/tools/build.py --loader   loader build: NO original program inside; the page asks the user for their own
                                       copy (listings or a Wang disk image) -> app/uns-man-loader.html  (safe to share)
"""
import json, os, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent.parent
app = root / 'app'
lib = root / 'engine' / 'src'
loader = '--loader' in sys.argv
need = ('UNS-MAN', 'UNS-GAME')

if loader:
    progs = {}
    out = app / 'uns-man-loader.html'
else:
    src = pathlib.Path(os.environ.get('LISTINGS', root / 'listings'))      # UNS-MAN.txt and UNS-GAME.txt: NOT in the repository
    missing = [n for n in need if not (src / (n + '.txt')).exists()]
    if missing:
        raise SystemExit('Missing listings %s in %s. They are not distributed with this repository: use --loader to build '
                         'a page that asks for them, or put them in listings/ (see README).' % (missing, src))
    progs = {n: (src / (n + '.txt')).read_text(encoding='latin-1') for n in need}
    out = app / 'index.html'


def read(p):
    return p.read_text(encoding='utf-8')


parts = {
    '/*FONT*/':     read(lib / 'font.js'),
    '/*PROGS*/':    'const PROGRAMS=' + json.dumps(progs) + ';\n',
    '/*TERMINAL*/': read(lib / 'wangcrt.js') + '\n' + read(lib / 'crt-canvas.js'),
    '/*INTERP*/':   read(lib / 'compat.js') + '\n' + read(lib / 'dialects.js') + '\n' + read(lib / 'platter.js') + '\n' + read(lib / 'image.js') + '\n' + read(lib / 'basic2.js'),
    '/*APP*/':      read(app / 'loader.js') + '\n' + read(app / 'app.js'),
}
t = read(app / 'template.html')
for k, v in parts.items():
    t = t.replace(k, v)
out.write_text(t, encoding='utf-8')
print(out.relative_to(root), out.stat().st_size, 'bytes', '(loader build, no program inside)' if loader else '(contains the original program)')
