#!/usr/bin/env python3
"""Ortak koddan iki kabuğu üretir: Chrome uzantısı ve Outlook eklentisi.

Kullanım:  python3 tools/build.py [--base https://KULLANICI.github.io/REPO]
- shared/ altındaki motor ve arayüz tek kaynaktır; chrome-extension/ ve outlook/taskpane.html buradan üretilir.
- Yayın adresi değişirse sadece --base ile yeniden çalıştırın, manifest.xml güncellenir.
"""
import argparse, json, re, shutil, zipfile
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SH, CH, OL = ROOT / 'shared', ROOT / 'chrome-extension', ROOT / 'outlook'
ENGINE = ['core.js', 'sync.js', 'stops.js', 'io.js']
VERSION = '1.1.0'

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='https://rustukursad.github.io/yolcu_listesi/liste-guncelleme')
base = ap.parse_args().base.rstrip('/')
origin = '{0.scheme}://{0.netloc}'.format(urlparse(base))
tpl = (SH / 'ui.template.html').read_text(encoding='utf-8')

def page(css, icon, scripts):
    tags = '\n'.join(f'<script src="{s}"></script>' for s in scripts)
    return tpl.replace('{{CSS}}', css).replace('{{ICON}}', icon).replace('{{SCRIPTS}}', tags)

# ── Chrome uzantısı: dosyalar uzantı klasörüne kopyalanır (uzantı dışarıya başvuramaz)
for d in ('js', 'lib'):
    shutil.rmtree(CH / d, ignore_errors=True); (CH / d).mkdir()
for f in ENGINE + ['ui.js']:
    shutil.copy(SH / 'js' / f, CH / 'js' / f)
shutil.copy(SH / 'lib' / 'exceljs.min.js', CH / 'lib' / 'exceljs.min.js')
shutil.copy(SH / 'ui.css', CH / 'tool.css')
(CH / 'tool.html').write_text(page('tool.css', 'icons/48.png',
    ['lib/exceljs.min.js'] + [f'js/{f}' for f in ENGINE] + ['js/ui.js']), encoding='utf-8')
m = json.loads((CH / 'manifest.json').read_text(encoding='utf-8')); m['version'] = VERSION
(CH / 'manifest.json').write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding='utf-8')

# ── Outlook eklentisi: GitHub Pages'ta ../shared'a başvurur
(OL / 'taskpane.html').write_text(page('../shared/ui.css', 'assets/icon-32.png',
    ['https://appsforoffice.microsoft.com/lib/1/hosted/office.js', '../shared/lib/exceljs.min.js']
    + [f'../shared/js/{f}' for f in ENGINE] + ['host-outlook.js', '../shared/js/ui.js']), encoding='utf-8')
xml = (OL / 'manifest.template.xml').read_text(encoding='utf-8')
xml = xml.replace('{{BASE}}', base).replace('{{BASE_ORIGIN}}', origin).replace('{{VERSION}}', VERSION + '.0')
(OL / 'manifest.xml').write_text(xml, encoding='utf-8')

# ── İndirilebilir paketler (açılış sayfasından bağlanır)
dist = ROOT / 'dist'; dist.mkdir(exist_ok=True)
with zipfile.ZipFile(dist / 'ListeGuncelleme-Chrome.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(CH.rglob('*')):
        if p.is_file(): z.write(p, Path('ListeGuncelleme') / p.relative_to(CH))
shutil.copy(OL / 'manifest.xml', dist / 'ListeGuncelleme-Outlook-manifest.xml')
print(f'Tamam · sürüm {VERSION} · adres {base}')
