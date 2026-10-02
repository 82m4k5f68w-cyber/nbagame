#!/usr/bin/env python3
"""Builds dist/ from src/: inlines libs + game.js into each mode, then embeds all modes in the hub.
Usage: python3 build.py   (stdlib only)"""
import json, os, re
R = os.path.dirname(os.path.abspath(__file__))
MODES = ['5v5-3d', '5v5-2d', '1v1-3d', '1v1-2d', 'classic']

def inline(path):
    html = open(path).read(); base = os.path.dirname(path)
    def sub(m):
        code = open(os.path.join(base, m.group(1))).read()
        assert '</script' not in code.lower(), m.group(1)
        return '<script>' + ('\n' if m.group(1).endswith('game.js') else '') + code + '</script>'
    return re.sub(r'<script src="([^"]+)"></script>', sub, html)

os.makedirs(f'{R}/dist/modes', exist_ok=True)
G = {}
for k in MODES:
    G[k] = inline(f'{R}/src/modes/{k}/index.html')
    open(f'{R}/dist/modes/{k}.html', 'w').write(G[k])
tpl = open(f'{R}/src/hub/template.html').read()
out = tpl.replace('__G__', json.dumps(G).replace('</', '<\\/'))
open(f'{R}/dist/hoops2k27-hub.html', 'w').write(out)
print('built dist/hoops2k27-hub.html', round(len(out) / 1e6, 2), 'MB')
