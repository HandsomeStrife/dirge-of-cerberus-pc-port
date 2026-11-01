#!/usr/bin/env python3
"""(worker 0179, moved here by 0186) The effect-sprite triangles of a GS dump's last frame (the draws
whose TEX0 is one of core_ef.bin's 27 texture records), as JSON for native/web/test_effects.mjs.

    python3 -I tools/trace/dumpfx.py DUMP.gs OUT.json [--extract extract/_KEL]

The output is game-derived: write it under the gitignored tools/trace/out/ (w179_fx/dumpN.json).
"""
import argparse
import json
import os
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/gsdump/src'))
import gsparse  # noqa: E402
import gsrender2 as G  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('dump')
ap.add_argument('out')
ap.add_argument('--extract', default=os.path.join(ROOT, 'extract/_KEL'))
args = ap.parse_args()
buf = open(args.dump, 'rb').read()
h = gsparse.read_header(buf)
gif = G.build(buf, h, sprite_uv=True)
a, b = G.pick_frame(gif, 'last')
d = open(os.path.join(args.extract, 'data/effect/core/core_ef.bin'), 'rb').read()
core = {struct.unpack_from('<Q', d, 0x70 + 0x20 * k)[0] for k in range(27)}
out = []
for i in range(a, b):
    t = gif.tris[i]
    c = t[3]
    if (c.get('tex0') or 0) in core:
        out.append({'i': i, 'tex0': hex(c['tex0']), 'blend': c['blend'],
                    'v': [[v[0] / 16, v[1] / 16, v[2], v[3], v[4], v[5], list(v[8:12])] for v in t[:3]], 'xyoff': c.get('xyoffset')})
json.dump(out, open(args.out, 'w'))
print(len(out), 'effect tris')
