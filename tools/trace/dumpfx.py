#!/usr/bin/env python3
"""(worker 0179, moved here by 0186) The effect-sprite triangles of a GS dump's last frame (the draws
whose TEX0 is one of core_ef.bin's 27 texture records), as JSON for native/web/test_effects.mjs.

    python3 -I tools/trace/dumpfx.py DUMP.gs OUT.json [--extract extract/_KEL] [--lines]

--lines (worker 0188): also the last frame's untextured LINE STRIP segments (the type 137 sparks,
VU1 instr 649-785), as 'lines': [{'seq', 'alpha', 'v': [[x, y, z, [r, g, b, a]] x 2]}].

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
ap.add_argument('--lines', action='store_true')
args = ap.parse_args()
buf = open(args.dump, 'rb').read()
h = gsparse.read_header(buf)
segs = []
if args.lines:                       # record PRIM 2 (line strip) segments as the interpreter kicks them
    _emit = G.DepthInterp._emit_vertex
    def _emit_lines(self, x, y, z, f=None, drawkick=True, adc=False):
        if (self.prim & 7) == 2 and self.vq and drawkick:
            a = self.vq[-1]
            c = self._ctx()
            segs.append({'vframe': c['vframe'], 'seq': c['seq'], 'alpha': c['blend'], 'tme': c['tme'],
                         'xyoff': c.get('xyoffset'),
                         'v': [[a[0] / 16, a[1] / 16, a[2], list(a[8:12])], [x / 16, y / 16, z, list(self.rgba)]]})
        return _emit(self, x, y, z, f, drawkick, adc)
    G.DepthInterp._emit_vertex = _emit_lines
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
if args.lines:
    last = gif.tris[a][3]['vframe'] if a < len(gif.tris) else max((g['vframe'] for g in segs), default=0)
    lines = [g for g in segs if g['vframe'] == last and not g['tme']]
    json.dump({'tris': out, 'lines': lines}, open(args.out, 'w'))
    print(len(out), 'effect tris,', len(lines), 'line segments')
else:
    json.dump(out, open(args.out, 'w'))
    print(len(out), 'effect tris')
