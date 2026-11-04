#!/usr/bin/env python3
"""light_fixture.py -- the game's light 2 at route states, for native/web/test_light_states.mjs (worker 0260).
Writes tools/trace/out/w260/light_states.json (game-derived, gitignored): per state, the slots' chunks, MP+0x10 matrix, MP+0x90 / +0xa0, MP+0x110 dir,
MP+0x140 colour, MP+0x450 scale and whether MP+0x430 is set.
  python3 -I tools/trace/light_fixture.py [STATE.p2s ...]   (default: tools/trace/out/route/r*.p2s)"""
import glob, json, os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from p2s import read_p2s
import fields
out = []
for f in sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, 'out', 'route', 'r*.p2s'))):
    ee = read_p2s(f)['eeMemory.bin']
    u = lambda a: struct.unpack_from('<I', ee, a)[0]
    v = lambda a, n: list(struct.unpack_from('<%df' % n, ee, a))
    base = u(0x46e290)
    mp = u(base + 0x50)                     # FUN_0026a0c0: DAT_0046e290 + 0x50 = Vincent's MP
    # Vincent's C (C+0x7c8 = MP): his position C+0x3c0 and polygon C+0x4c0 (FUN_00340e08's arguments to FUN_005ae1f0)
    C = fields.resolve_bases(ee).get('C')
    pos = v(C + 0x3c0, 3) if C else None
    poly = u(C + 0x4c0) if C else 0
    out.append(dict(pos=pos, word0=u(poly) if poly else None, name=os.path.basename(f)[:-4], slots=[u(0x4e4c60 + s * 0x70 + 0x54) for s in range(3)],
                    loaded=[u(0x4e4c60 + s * 0x70 + 0x5c) for s in range(3)], m=v(mp + 0x10, 16), b0=v(mp + 0x90, 4), b1=v(mp + 0xa0, 4),
                    dir=v(mp + 0x110, 3), col=v(mp + 0x140, 3), rec=u(mp + 0x430), rec_f=([x if x == x and abs(x) < 1e30 else 0.0 for x in v(u(mp + 0x430), 16)] if 0 < u(mp + 0x430) < 0x2000000 else []), scale=struct.unpack_from('<H', ee, mp + 0x450)[0], scale_b=ee[mp + 0x450]))
p = os.path.join(HERE, 'out', 'w260', 'light_states.json')
json.dump(out, open(p, 'w'))
print(len(out), 'states ->', p)
