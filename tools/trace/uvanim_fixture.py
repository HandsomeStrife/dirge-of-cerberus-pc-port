#!/usr/bin/env python3
"""uvanim_fixture.py -- fixtures for native/web/test_uvanim.mjs (worker 0226; scrolling room UVs).

Writes OUTDIR/uvanim_NAME.json (game-derived: OUTDIR must be gitignored; default
tools/trace/out/room_grade):
  slots   per loaded slot: chunk, and the time array (DAT_004e4c60 + slot*0x70 + 0x40, one f32 per animation)
  nodes   per node a UV track names (bmd_uvanim.py): chunk, node, RAM +0xdc / +0xde (s16)
  dump    (with DUMP + TBP) per dump frame: per (chunk, node) the median dump UV - file UV of the node's
          chains' vertices, matched on screen (camera from the state's CAM rows, as room_grade_fixture.py)

  python3 -I tools/trace/uvanim_fixture.py STATE.p2s NAME [DUMP.bin TBP ENTRY [OUTDIR]]
  e.g. tools/trace/out/room_grade/src/tp0b_450.p2s c0b tools/trace/out/room_grade/src/tp0b.bin 11808 88
"""
import os, sys, json, math, struct
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(REPO, 'native', 'assets', 'models'))
sys.path.insert(0, os.path.join(REPO, 'tools', 'gsdump', 'src'))
from p2s import read_p2s
from export_bmd_textured import find_bmd_payload, decode_packets, EXTRACT
from bmd_chains import packet_chains, raw_chain_ids
from bmd_uvanim import chunk_uv_tracks

CAM = 0x95efe0           # as room_grade_fixture.py
SLOTS = 0x4e4c60


def chunk_tracks(c):
    bm = open(os.path.join(EXTRACT, '0680%02x12.bin' % c), 'rb').read(); pay = find_bmd_payload(bm)
    an_p = os.path.join(EXTRACT, '0680%02x10.bin' % c)
    if not os.path.exists(an_p):
        return bm, pay, [], [], {}
    rid = raw_chain_ids(bm, pay)
    anims, tracks, ct = chunk_uv_tracks(open(an_p, 'rb').read(), bm, pay, lambda o: rid.get(o + 0xb0), [])
    return bm, pay, anims, tracks, ct


def main(argv):
    state, name = argv[0], argv[1]
    dump = argv[2] if len(argv) > 4 else None
    out = argv[5] if len(argv) > 5 else os.path.join(REPO, 'tools', 'trace', 'out', 'room_grade')
    ee = read_p2s(state)['eeMemory.bin']
    U = lambda a: struct.unpack_from('<I', ee, a & 0x1ffffff)[0]
    H = lambda a: struct.unpack_from('<h', ee, a & 0x1ffffff)[0]
    res = {'slots': [], 'nodes': [], 'dump': []}
    per = {}
    for s in range(3):
        b = SLOTS + s * 0x70
        if not U(b + 0x5c):
            continue
        c = U(b + 0x54)
        bm, pay, anims, tracks, ct = chunk_tracks(c)
        nan = U(U(U(0x46ba58 + 4 * (U(b + 0x38) >> 16)) + 0x24) + 4 * (U(b + 0x38) & 0xffff))
        A = U(nan + 4)
        times = [struct.unpack_from('<f', ee, U(b + 0x40) + 4 * i)[0] for i in range(H(A))]
        res['slots'].append({'chunk': c, 'times': times})
        mdl = U(U(U(0x46ba58 + 4 * (U(b + 0x20) >> 16)) + 0x24) + 4 * (U(b + 0x20) & 0xffff))
        B = U(U(mdl + 4) + 0x14) + 0x10                       # the BMD in RAM (resource list entry + 0x10)
        nt = U(B + 0x1c)
        for t in tracks:
            nd = U(nt + 4 * t['node'])
            res['nodes'].append({'chunk': c, 'node': t['node'], 'anim': anims[t['anim']]['index'],
                                 'u': H(nd + 0xdc) if t['u'] else None, 'v': H(nd + 0xde) if t['v'] else None})
        per[c] = (bm, pay, tracks, ct)
    if dump:
        tbp, entry = int(argv[3]), int(argv[4], 16)
        import gsrender2 as G
        from gsparse import read_header
        row = lambda o: np.array(struct.unpack_from('<4f', ee, CAM + o)[:3])
        eye, fwd, up = row(0x90), row(0x80), -row(0x70)
        fwd = fwd / np.linalg.norm(fwd); rt = np.cross(fwd, up); rt /= np.linalg.norm(rt); u2 = np.cross(rt, fwd)
        SCRZ = 448 * 0.5 / math.tan(73.5 * 0.008726647)
        buf = open(dump, 'rb').read(); h = read_header(buf); gif = G.build(buf, h, sprite_uv=True)
        for (a, b2, _) in G.frame_ranges(gif):
            D = []
            for t in gif.tris[a:b2]:
                x = t[3]
                if x['tex0'] & 0x3fff == tbp:
                    xo = x['xyoffset']; ox, oy = xo & 0xffff, (xo >> 32) & 0xffff
                    for v in t[:3]:
                        D.append(((v[0] - ox) / 16, (v[1] - oy) / 16, v[3] / v[5], v[4] / v[5]))
            D = np.array(D); fr = []
            for c, (bm, pay, tracks, ct) in per.items():
                pk = decode_packets(bm, pay); ch = packet_chains(bm, pay, pk, [])
                acc = {}
                for i, p in enumerate(pk):
                    ti = ct.get(ch[i])
                    if ti is None or not len(D):
                        continue
                    for P, UV in zip(p['verts'], p['uv']):
                        d = np.array(P) - eye; z = d @ fwd
                        if z < 5:
                            continue
                        x = 213 + (d @ rt) * SCRZ / z; y = 256 - (d @ u2) * SCRZ * 1.5 / z
                        k = np.hypot(D[:, 0] - x, D[:, 1] - y).argmin()
                        if np.hypot(D[k, 0] - x, D[k, 1] - y) < 0.3:
                            acc.setdefault(tracks[ti]['node'], []).append((D[k, 2] - UV[0], D[k, 3] - UV[1]))
                for node, l in acc.items():
                    if len(l) >= 4:              # a vertex or two can match a neighbour chain's
                        l = np.array(l)
                        fr.append({'chunk': c, 'node': node, 'n': len(l), 'du': float(np.median(l[:, 0])),
                                   'dv': float(np.median(l[:, 1]))})
            res['dump'].append(fr)
    os.makedirs(out, exist_ok=True)
    p = os.path.join(out, 'uvanim_%s.json' % name)
    json.dump(res, open(p, 'w'))
    print('%s: %d slots, %d nodes, %s dump frames (%s matched nodes)' % (
        p, len(res['slots']), len(res['nodes']), len(res['dump']), [len(f) for f in res['dump']]))


if __name__ == '__main__':
    main(sys.argv[1:])
