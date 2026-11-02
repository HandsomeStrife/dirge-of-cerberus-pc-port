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
ap.add_argument('--flat', help='(worker 0200) write the last frame\'s untextured triangles at least 400 px wide (type 107 screen sprites) to this JSON')
ap.add_argument('--fed', action='append', default=[], help='(worker 0198) also the draws with this FED\'s own TIM2 TEX0s')
ap.add_argument('--clut-out', help='(worker 0198) with --fed: write the CT32 CLUT (256 words, CSM1 logical order) at each FED texture\'s CBP in the dump\'s frozen GS memory')
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
for fp in args.fed:                  # header +0x68 TIM2 table (count +0x44): the picture header's GsTex0 at +0x28
    fb = open(fp, 'rb').read(); t = struct.unpack_from('<I', fb, 0x68)[0]
    for k in range(struct.unpack_from('<H', fb, 0x44)[0]):
        o = t + struct.unpack_from('<I', fb, t + 4 * k)[0]
        if fb[o:o + 4] == b'TIM2': core.add(struct.unpack_from('<Q', fb, o + 0x28)[0])
if args.clut_out:                    # GS memory: the freeze snapshot at +0x1a9 (export_web_pause.py); PSMCT32 block / column order
    mem = buf[h['freeze_at'] + 0x1a9: h['freeze_at'] + 0x1a9 + 4 * 1024 * 1024]
    B32 = [[0, 1, 4, 5, 16, 17, 20, 21], [2, 3, 6, 7, 18, 19, 22, 23], [8, 9, 12, 13, 24, 25, 28, 29], [10, 11, 14, 15, 26, 27, 30, 31]]
    C32 = [[0, 1, 4, 5, 8, 9, 12, 13], [2, 3, 6, 7, 10, 11, 14, 15], [16, 17, 20, 21, 24, 25, 28, 29], [18, 19, 22, 23, 26, 27, 30, 31],
           [32, 33, 36, 37, 40, 41, 44, 45], [34, 35, 38, 39, 42, 43, 46, 47], [48, 49, 52, 53, 56, 57, 60, 61], [50, 51, 54, 55, 58, 59, 62, 63]]
    w32 = lambda cbp, x, y: struct.unpack_from('<I', mem, 4 * ((cbp + B32[(y % 32) // 8][(x % 64) // 8]) * 64 + C32[y % 8][x % 8]))[0]
    sw = lambda k: (k & 0xe7) | ((k & 0x08) << 1) | ((k & 0x10) >> 1)          # CSM1: logical index -> 16 x 16 position
    cl = {}
    for t0 in core:
        if (t0 >> 20) & 0x3f == 0x13 and t0 not in {struct.unpack_from('<Q', d, 0x70 + 0x20 * k)[0] for k in range(27)}:
            cbp = (t0 >> 37) & 0x3fff
            cl[hex(t0)] = [w32(cbp, sw(k) % 16, sw(k) // 16) for k in range(256)]
    json.dump(cl, open(args.clut_out, 'w'))
    print(len(cl), 'FED CLUTs from GS memory ->', args.clut_out)
out = []
for i in range(a, b):
    t = gif.tris[i]
    c = t[3]
    if (c.get('tex0') or 0) in core:
        out.append({'i': i, 'tex0': hex(c['tex0']), 'blend': c['blend'],
                    'v': [[v[0] / 16, v[1] / 16, v[2], v[3], v[4], v[5], list(v[8:12])] for v in t[:3]], 'xyoff': c.get('xyoffset')})
if args.flat:                        # (worker 0200) the screen sprites: untextured, >= 400 px wide; with TEST and the blend
    fl = []
    for i in range(a, b):
        t = gif.tris[i]; c = t[3]; xs = [v[0] / 16 for v in t[:3]]
        if not c.get('tme') and max(xs) - min(xs) >= 400:
            fl.append({'i': i, 'blend': c['blend'], 'test': c.get('test'), 'v': [[v[0] / 16, v[1] / 16, v[2], list(v[8:12])] for v in t[:3]]})
    json.dump(fl, open(args.flat, 'w'))
    print(len(fl), 'flat screen tris ->', args.flat)
if args.lines:
    last = gif.tris[a][3]['vframe'] if a < len(gif.tris) else max((g['vframe'] for g in segs), default=0)
    lines = [g for g in segs if g['vframe'] == last and not g['tme']]
    json.dump({'tris': out, 'lines': lines}, open(args.out, 'w'))
    print(len(out), 'effect tris,', len(lines), 'line segments')
else:
    json.dump(out, open(args.out, 'w'))
    print(len(out), 'effect tris')
