#!/usr/bin/env python3
"""test_cull_tag.py -- the room's back-face tags (export_z128_room.py cull_tag / build_flat_kept; worker 0227).

  python3 -I native/assets/models/test_cull_tag.py      (ROOM_PY=<path>: test another copy, for mutation runs)

1. Hand cases: two-sided header (w 0x20) -> mode 0; list triangle -> mode 1; strip quad -> mode 2 with the
   partner's game-front normal (minus its emitted-order cross); zero-area partner -> mode 0; an undecoded header
   w raises. build_flat_kept emits a quad's second triangle as (v3, v2, v1) (same winding), so its last vertex
   (WebGL's provoking vertex, which room.js reads the partner test from) lies on the partner's plane, and the
   tags line up with the vertices.
2. z128's packets (needs extract/): header w is 0 or 0x20, and 0x20 exactly on the chains with header +0x94
   bit 0.
3. The game's GS dumps (needs tools/trace/out/room_grade/src): the room's triangles (TEST 0x5000e, the room's
   opaque draws) as the GS got them, strip parity undone: >= 98 % of the 4-vertex quads have both triangles
   clockwise on screen (y down), i.e. the kept side of the VU test is the one the export calls game-front.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location('room_exp', os.environ.get('ROOM_PY') or os.path.join(HERE, 'export_z128_room.py'))
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)

fail = 0
def ok(c, m):
    global fail
    print(('ok   ' if c else 'FAIL ') + m)
    fail += not c

def cross(a, b, c):
    u = [b[k] - a[k] for k in range(3)]; v = [c[k] - a[k] for k in range(3)]
    return (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])

def unit(n):
    l = sum(x * x for x in n) ** 0.5
    return tuple(x / l for x in n)

# 1. hand cases: a non-planar quad (v3 lifted off the plane of v0 v1 v2)
V = [(0, 0, 0), (4, 0, 0), (0, 4, 0), (4, 4, 3)]
quad = dict(verts=V, uv=[(0, 0)] * 4, col=[(128, 128, 128, 128)] * 4, is_list=False, hdr_w=0)
t1, t2 = (0, 1, 2), (2, 1, 3)
want1 = unit(tuple(-x for x in cross(V[2], V[1], V[3]))); want2 = unit(tuple(-x for x in cross(V[0], V[1], V[2])))
g1, g2 = R.cull_tag(quad, t1), R.cull_tag(quad, t2)
ok(g1[3] == 2 and all(abs(g1[k] / 32767 - want1[k]) < 1e-4 for k in range(3)), f'quad tri 1: mode 2, partner normal {g1}')
ok(g2[3] == 2 and all(abs(g2[k] / 32767 - want2[k]) < 1e-4 for k in range(3)), f'quad tri 2: mode 2, partner normal {g2}')
ok(R.cull_tag(dict(quad, hdr_w=0x20), t1) == (0, 0, 0, 0), 'two-sided header (w 0x20): mode 0')
ok(R.cull_tag(dict(quad, is_list=True, verts=V + V[:2]), t1) == (0, 0, 0, 1), 'list triangle: mode 1 (no partner)')
ok(R.cull_tag(dict(quad, verts=[(0, 0, 0), (4, 0, 0), (2, 2, 1), (4, 4, 2)]), t1)[3] == 2 and
   R.cull_tag(dict(quad, verts=[(0, 0, 0), (2, 0, 0), (1, 0, 0), (4, 4, 4)]), t2) == (0, 0, 0, 0),
   'zero-area partner: mode 0 (the VU flag is never set for it)')
try:
    R.cull_tag(dict(quad, hdr_w=0x10), t1); ok(False, 'header w 0x10 raises')
except ValueError:
    ok(True, 'header w 0x10 (an undecoded mask) raises')
tags = []
fl, n = R.build_flat_kept([quad], [0], {0: [t1, t2]}, culls=tags)
P = [tuple(fl[12 * i:12 * i + 3]) for i in range(len(fl) // 12)]
ok(n == 2 and P[3:] == [V[3], V[2], V[1]], f'second triangle emitted as (v3, v2, v1): {P[3:]}')
ok(unit(cross(*P[3:])) == unit(cross(V[2], V[1], V[3])), 'the rotation keeps the winding')
on = lambda p, a, b, c: abs(sum(x * y for x, y in zip(unit(cross(a, b, c)), [p[k] - a[k] for k in range(3)]))) < 1e-9
ok(on(P[2], V[2], V[1], V[3]) and on(P[5], V[0], V[1], V[2]), "each triangle's last vertex lies on its partner's plane")
ok(len(tags) == 4 * 6 and tags[:4] == list(g1) and tags[12:16] == list(g2), 'one tag per vertex, in emitted order')

# 2. z128 packets
from export_bmd_textured import find_bmd_payload, decode_packets, EXTRACT
from bmd_chains import packet_chains, chain_headers
if not os.path.exists(os.path.join(EXTRACT, '06800012.bin')):
    print('SKIP z128 packets: no extract/')
else:
    ws = set(); agree = n2 = 0; tot = 0
    for i in range(13):
        buf = open(os.path.join(EXTRACT, '0680%02x12.bin' % i), 'rb').read(); pay = find_bmd_payload(buf)
        pk = decode_packets(buf, pay); ch = packet_chains(buf, pay, pk); hd, _ = chain_headers(buf, pay)
        for p, c in zip(pk, ch):
            ws.add(p['hdr_w']); tot += 1
            if c in hd:
                agree += (p['hdr_w'] == 0x20) == bool(hd[c]['flags'] & 1); n2 += p['hdr_w'] == 0x20
    ok(ws <= {0, 0x20}, f'header w values {sorted(ws)} (0 / 0x20 decoded)')
    ok(agree == tot and n2 > 500, f'w 0x20 = chain flag +0x94 bit 0 on {agree} / {tot} packets ({n2} two-sided)')

# 3. GS dumps
SRC = os.path.join(REPO, 'tools', 'trace', 'out', 'room_grade', 'src')
dumps = [d for d in ('tp09_450.bin', 'tp0b.bin', 'npc_g100.bin') if os.path.exists(os.path.join(SRC, d))]
if not dumps:
    print('SKIP GS dumps: no tools/trace/out/room_grade/src (room_grade_fixture.py)')
else:
    sys.path.insert(0, os.path.join(REPO, 'tools', 'gsdump', 'src'))
    import gsrender2 as G, gsrender as GR
    from gsparse import read_header
    side = []
    o_set, o_tri = GR.TriInterp.set_prim, GR.TriInterp._tri
    def set_prim(self, v): o_set(self, v); self._p0 = self.nverts
    def _tri(self, a, b, c): o_tri(self, a, b, c); side.append((self.prim & 7, self.nverts - getattr(self, '_p0', 0) - 1))
    GR.TriInterp.set_prim, GR.TriInterp._tri = set_prim, _tri
    G.DepthInterp._sprite = lambda self, a, b: None
    for d in dumps:
        side.clear()
        buf = open(os.path.join(SRC, d), 'rb').read(); h = read_header(buf); gif = G.build(buf, h)
        a, b = G.pick_frame(gif, 'last')
        def area(i):
            (x0, y0), (x1, y1), (x2, y2) = [(v[0], v[1]) for v in gif.tris[i][:3]]
            A = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
            return -A if (side[i][1] - 2) % 2 else A          # odd strip triangle: GS order reversed
        both = nq = 0; i = a
        while i < b - 1:
            (p, k), (p2, k2) = side[i], side[i + 1]
            if (p == 4 and p2 == 4 and (k - 2) % 4 == 0 and k2 == k + 1
                    and gif.tris[i][3].get('test', 0) & 0xfffff == 0x5000e):
                nq += 1; both += area(i) > 0 and area(i + 1) > 0; i += 2
            else:
                i += 1
        ok(nq > 300 and both >= 0.98 * nq, f'{d}: {both} / {nq} room quads clockwise on screen (y down) in the game')

print('all ok' if not fail else f'{fail} FAILED')
sys.exit(1 if fail else 0)
