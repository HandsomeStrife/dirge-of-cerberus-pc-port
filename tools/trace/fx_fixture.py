#!/usr/bin/env python3
"""(worker 0179, moved here by 0186) The effect engine's state in a PCSX2 save state, as JSON for
native/web/test_effects.mjs: the effect LCG DAT_004e9400, the camera DAT_0050b4f8[0] (+0x150 view,
+0x110 projection) and every emitter of manager DAT_004ee2e0 (+0x84 list, +0x14 next) whose FED has
FileCode 0x40000, with its particles (+0x60 / +0x64 lists, +0x14 next; value region +0x44, matrix +0x50).

    python3 -I tools/trace/fx_fixture.py STATE.p2s OUT.json

The output is game-derived: write it under the gitignored tools/trace/out/ (w179_fx/stateN.json).
Field offsets: notes/effects-research.md "Evidence".
"""
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from p2s import read_p2s  # noqa: E402

EE = read_p2s(sys.argv[1])['eeMemory.bin']


def a(x): return x & 0x1ffffff
def u32(x): return struct.unpack_from('<I', EE, a(x))[0]
def s32(x): return struct.unpack_from('<i', EE, a(x))[0]
def u16(x): return struct.unpack_from('<H', EE, a(x))[0]
def s16(x): return struct.unpack_from('<h', EE, a(x))[0]
def u8(x): return EE[a(x)]
def f32(x):                      # non-finite words (pool garbage) as null: JSON.parse has no NaN
    v = struct.unpack_from('<f', EE, a(x))[0]
    return v if math.isfinite(v) else None
def vec(x, n=4): return struct.unpack_from('<%df' % n, EE, a(x))


out = {'lcg': u32(0x4e9400), 'cam': {}, 'emitters': []}
c = u32(0x50b4f8)
for nm, o in (('view', 0x150), ('proj', 0x110)):
    out['cam'][nm] = [f32(c + o + 4 * i) for i in range(16)]
o = u32(0x4ee2e0 + 0x84)
while o:
    if u32(u32(o + 0x70) + 4) == 0x40000:
        em = {'addr': o, 'ei': u16(o + 8), 'p80': vec(o + 0x80), 'r90': vec(o + 0x90), 'd4': u8(o + 0xd4),
              'age': f32(o + 0x1c), 'dt': f32(o + 0x20), 'p120': vec(o + 0x120),
              'm': [f32(o + 0xe0 + 4 * i) for i in range(16)], 'col': vec(o + 0xb0), 'scale': vec(o + 0xa0), 'parts': []}
        for L in (0, 1):
            p = u32(o + 0x60 + 4 * L)
            while p:
                P = u32(p + 0x40)
                size = (s16(P + 2) + 99) & ~3
                em['parts'].append({'list': L, 'tag': u8(p + 0x22), 'age': f32(p + 0x30), 'ev': s16(p + 0x36), 'flags': u16(p + 2),
                                    'v': [f32(u32(p + 0x44) + 4 * i) for i in range(size // 4)],
                                    'vi': [s32(u32(p + 0x44) + 4 * i) for i in range(size // 4)],
                                    'm50': [f32(u32(p + 0x50) + 4 * i) for i in range(16)] if u32(p + 0x50) else None})
                p = u32(p + 0x14)
        out['emitters'].append(em)
    o = u32(o + 0x14)
json.dump(out, open(sys.argv[2], 'w'))
print(len(out['emitters']), 'emitters', [(e['ei'], round(e['age'], 2), len(e['parts'])) for e in out['emitters']])
