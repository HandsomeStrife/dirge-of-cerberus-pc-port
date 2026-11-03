#!/usr/bin/env python3
"""test_cull_tag.py -- the room's back-face tags (export_z128_room.py cull_tag / build_flat_kept; worker 0227).

  python3 -I native/assets/models/test_cull_tag.py      (ROOM_PY=<path>: test another copy, for mutation runs)

1. Hand cases: two-sided header (w 0x20) -> never; list triangle -> no partner; strip quad -> the
   partner's game-front plane; a 3-vertex strip tail -> no partner; zero-area partner -> never; an undecoded
   header w raises. build_flat_kept keeps the packet order and writes 5 floats per vertex (partner plane, own
   game-front plane distance), the same on a triangle's three vertices (room.js decides once per triangle).
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
def plane(a, b, c):          # game-front plane of (a, b, c) in emitted order: n = -(b - a) x (c - a), d = n . a
    n = unit(tuple(-x for x in cross(a, b, c))); return n + (sum(n[k] * a[k] for k in range(3)),)
close = lambda x, y: len(x) == len(y) and all(abs(p - q) < 1e-9 for p, q in zip(x, y))
g1, g2 = R.cull_tag(quad, t1), R.cull_tag(quad, t2)
ok(close(g1, plane(V[2], V[1], V[3])), f'quad tri 1: the partner (v2, v1, v3) game-front plane {g1}')
ok(close(g2, plane(V[0], V[1], V[2])), f'quad tri 2: the partner (v0, v1, v2) game-front plane {g2}')
ok(R.cull_tag(dict(quad, hdr_w=0x20), t1) == R.CULL_NEVER == (0, 0, 0, -1), 'two-sided header (w 0x20): never (0, 0, 0, -1)')
ok(R.cull_tag(dict(quad, is_list=True, verts=V + V[:2]), t1) == R.CULL_NO_PARTNER == (0, 0, 0, 1), 'list triangle: no partner (0, 0, 0, 1)')
tail = dict(quad, verts=V + [(8, 0, 0), (12, 0, 0), (8, 4, 1)])           # one quad + a 3-vertex tail
try:
    ok(R.cull_tag(tail, (4, 5, 6)) == R.CULL_NO_PARTNER, 'strip 3-vertex tail: no partner')
except IndexError as x:
    ok(False, f'strip 3-vertex tail: no partner ({x!r})')
ok(R.cull_tag(dict(quad, verts=[(0, 0, 0), (4, 0, 0), (2, 2, 1), (4, 4, 2)]), t1)[3] != -1 and
   R.cull_tag(dict(quad, verts=[(0, 0, 0), (2, 0, 0), (1, 0, 0), (4, 4, 4)]), t2) == R.CULL_NEVER,
   'zero-area partner: never (the VU flag is never set for it)')
try:
    R.cull_tag(dict(quad, hdr_w=0x10), t1); ok(False, 'header w 0x10 raises')
except ValueError:
    ok(True, 'header w 0x10 (an undecoded mask) raises')
tags = []
fl, n = R.build_flat_kept([quad], [0], {0: [t1, t2]}, culls=tags)
P = [tuple(fl[12 * i:12 * i + 3]) for i in range(len(fl) // 12)]
ok(n == 2 and P == [V[0], V[1], V[2], V[2], V[1], V[3]], 'triangles emitted in packet order')
ok(len(tags) == 5 * 6 and all(tags[5 * v:5 * v + 5] == tags[5 * (v - v % 3):5 * (v - v % 3) + 5] for v in range(6)),
   'five floats per vertex, the same on a triangle\'s three vertices')
ok(close(tags[:4], g1) and close(tags[15:19], g2), 'each triangle carries its partner plane')
# own plane: game-front normal = -(the vertex normal); faces the eye when dot(-normal, eye) - dg >= 0, dg = -(normal . v0)
for k, t in ((0, t1), (1, t2)):
    nrm = fl[36 * k + 3:36 * k + 6]; dg = tags[15 * k + 4]
    ok(all(abs(sum(-nrm[j] * V[i][j] for j in range(3)) - dg) < 1e-9 for i in t), f'tri {k + 1}: own plane distance on all three vertices')
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
