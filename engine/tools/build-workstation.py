"""Builds dist/workstation.html: a single file with the BASIC-2 environment (CRT + disks + editor)."""
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
parts = {
    '/*FONT*/':     (src / 'font.js').read_text(encoding='utf-8'),
    '/*TERMINAL*/': (src / 'wangcrt.js').read_text(encoding='utf-8') + '\n' + (src / 'crt-canvas.js').read_text(encoding='utf-8') + '\n' + (src / 'printer.js').read_text(encoding='utf-8'),
    '/*INTERP*/':   (src / 'compat.js').read_text(encoding='utf-8') + '\n' + (src / 'dialects.js').read_text(encoding='utf-8') + '\n' + (src / 'platter.js').read_text(encoding='utf-8') + '\n' + (src / 'image.js').read_text(encoding='utf-8') + '\n' + (src / 'basic2.js').read_text(encoding='utf-8'),
    '/*SHELL*/':    (src / 'shell.js').read_text(encoding='utf-8'),
    '/*APP*/':      (root / 'app' / 'workstation-app.js').read_text(encoding='utf-8'),
}
t = (root / 'app' / 'workstation.template.html').read_text(encoding='utf-8')
for k, v in parts.items():
    t = t.replace(k, v)
out = root / 'dist'
out.mkdir(exist_ok=True)
(out / 'workstation.html').write_text(t, encoding='utf-8')
print('dist/workstation.html', (out / 'workstation.html').stat().st_size, 'bytes')
