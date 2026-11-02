#!/usr/bin/env python3
"""(worker 0198) The GAME OVER title's effect state in a PCSX2 save state, as JSON for native/web/test_gameover.mjs:
the emitters of the 2D effect manager DAT_004ee4a0 (+0x84 list, +0x14 next): age +0x1c, matrix +0xe0, colour +0xb0,
and the list-1 particles (+0x64, +0x14 next): tag +0x22, age +0x30, event index +0x36, flags +2, the value region
+0x44 (first 40 floats; non-finite words and heap pointers as null) and the matrix +0x50.

    python3 -I tools/trace/title_fixture.py STATE.p2s OUT.json

The output is game-derived: write it under the gitignored tools/trace/out/ (w198/ramN.json)."""
import json, math, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from p2s import read_p2s

EE = read_p2s(sys.argv[1])["eeMemory.bin"]
a = lambda x: x & 0x1ffffff
u32 = lambda x: struct.unpack_from('<I', EE, a(x))[0]
f32 = lambda x: struct.unpack_from('<f', EE, a(x))[0]
s16 = lambda x: struct.unpack_from('<h', EE, a(x))[0]
u16 = lambda x: struct.unpack_from('<H', EE, a(x))[0]
fin = lambda x, i: x if math.isfinite(x) and (x == 0 or abs(x) > 1e-30) and i < 40 else None
out = {'emitters': []}
o = u32(0x4ee4a0 + 0x84)
while o:
    em = {'code': u32(u32(o + 0x70) + 4), 'age': f32(o + 0x1c), 'm': [f32(o + 0xe0 + 4 * i) for i in range(16)],
          'col': [f32(o + 0xb0 + 4 * i) for i in range(4)], 'parts': []}
    p = u32(o + 0x64)
    while p:
        P = u32(p + 0x40); size = (s16(P + 2) + 99) & ~3
        # worker 0202: 'vall' = the whole value region (finite words, no 40-word cap); 'pool' = each type 103
        # channel's points (value word 0 -> object: +8 end, +0xc start; 0x60-byte points: pos, tail, vel, acc,
        # u16 life +0x40, u16 half +0x42, fade +0x44, rate +0x48, live +0x4c, length +0x50)
        V = u32(p + 0x44); pools = {}
        for i in range(EE[a(P + 8)]):
            d = u32(u32(P + 0xc) + 4 * i)        # the loader relocates the FED's offsets: absolute in RAM (fx_fixture.py)
            if u16(d) == 103:
                o = u32(V + u16(d + 4)); q, end = (u32(o + 0xc), u32(o + 8)) if o else (0, 0); pts = []
                while q and q < end and len(pts) < 64:
                    pts.append({'pos': [f32(q + 4 * j) for j in range(3)], 'tail': [f32(q + 0x10 + 4 * j) for j in range(3)],
                                'vel': [f32(q + 0x20 + 4 * j) for j in range(3)], 'acc': [f32(q + 0x30 + 4 * j) for j in range(3)],
                                'life': u16(q + 0x40), 'half': u16(q + 0x42), 'fade': f32(q + 0x44), 'rate': f32(q + 0x48),
                                'live': u32(q + 0x4c), 'len': f32(q + 0x50)})
                    q += 0x60
                pools[u16(d + 4) // 4] = pts
        em['parts'].append({'tag': EE[a(p + 0x22)], 'age': f32(p + 0x30), 'ev': s16(p + 0x36), 'flags': u16(p + 2),
                            'v': [fin(f32(u32(p + 0x44) + 4 * i), i) for i in range(size // 4)],
                            'vall': [fin(f32(V + 4 * i), 0) for i in range(size // 4)], 'pool': pools,
                            'm50': [f32(u32(p + 0x50) + 4 * i) for i in range(16)] if u32(p + 0x50) else None})
        p = u32(p + 0x14)
    out['emitters'].append(em)
    o = u32(o + 0x14)
json.dump(out, open(sys.argv[2], 'w'))
print(sys.argv[2], [(hex(e['code']), round(e['age'], 2), len(e['parts'])) for e in out['emitters']])
