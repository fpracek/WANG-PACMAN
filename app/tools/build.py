import json, os, pathlib
root = pathlib.Path(__file__).resolve().parent.parent.parent
app = root / 'app'
lib = root / 'engine' / 'src'
src = pathlib.Path(os.environ.get('LISTINGS', root / 'listings'))      # UNS-MAN.txt e UNS-GAME.txt: NON inclusi nel repository
need = ('UNS-MAN', 'UNS-GAME')
missing = [n for n in need if not (src / (n + '.txt')).exists()]
if missing:
    raise SystemExit('Mancano i listati %s in %s (vedi README: non sono distribuiti con il repository)' % (missing, src))
progs = {n: (src / (n + '.txt')).read_text(encoding='latin-1') for n in need}
parts = {
  '/*FONT*/':     (lib / 'font.js').read_text(encoding='utf-8'),
  '/*PROGS*/':    'const PROGRAMS=' + json.dumps(progs) + ';\n',
  '/*TERMINAL*/': (lib / 'wangcrt.js').read_text(encoding='utf-8') + '\n' + (lib / 'crt-canvas.js').read_text(encoding='utf-8'),
  '/*INTERP*/':   (lib / 'platter.js').read_text(encoding='utf-8') + '\n' + (lib / 'basic2.js').read_text(encoding='utf-8'),
  '/*APP*/':      (app / 'app.js').read_text(encoding='utf-8'),
}
t = (app / 'template.html').read_text(encoding='utf-8')
for k, v in parts.items(): t = t.replace(k, v)
(app / 'index.html').write_text(t, encoding='utf-8')
print('app/index.html', (app / 'index.html').stat().st_size, 'bytes')
