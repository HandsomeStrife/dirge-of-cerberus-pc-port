#!/usr/bin/env python3
"""z128's explosive barrels (model e057) for play.html (native/web/props.js), read from the stage
file 06800001.bin at build time. Writes <out>/props.json (gitignored game data).

    python3 -I export_web_props.py extract/_KEL/noPath/06800001.bin native/web/data/props

Decoded (notes/barrel-research.md):
  - Section 15 (0x90 B) = placed gimmicks: +0x00 matrix (4 rows of 4 floats, row 3 = position = the
    object's centre), +0x40 s32 index into section 14, +0x44 s16 script, +0x48 flags (bit 2 = wait for
    a script's cmd 0x108: FUN_00584220 vt+0x14c activates the others), +0x4c s16, +0x4e s8.
  - Section 14 (0x48 B) = gimmick types: +0x00 model name (char[8]), +0x0a hit material (FUN_00585000 ->
    FUN_0033d528), +0x10 flags, +0x14 class byte (FUN_00548348: 0 -> object type 10 = vt 0x5914e8),
    +0x15 shape (0 box, 1 sphere, 2 cylinder, 3 cube; FUN_00583b10 / FUN_00584408), +0x16 s16 HP,
    +0x18 / +0x1c / +0x20 sizes (cylinder: radius, height).
  - FUN_00548348 builds one object per section-15 record; manager +0x5b2 [k] = its id (cmd 0x3e).
Exported: e057 (the barrel) and g048 (the EM barriers, class 8 = object type 0x13, vt 0x58c630; worker 0269: their
record +0x50 word, FUN_0054fa48's start state). The other gimmicks (e056 crates, g0xx items) are not on the page yet.
"""
import json, os, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'tools'))
import stage_events as SE  # noqa: E402

SEC14_STRIDE, SEC15_STRIDE = 0x48, 0x90
MODELS = ('e057', 'g048')
# The parent area +0x4c (FUN_00548348 -> FUN_0053b920 / FUN_0054c550) decides when a gimmick is switched on: the page's
# areas.js (worker 0223; notes/npc-research.md "Areas"), not this exporter.


def gitignored(path):
    r = subprocess.run(['git', 'check-ignore', '-q', path], cwd=HERE)
    return r.returncode == 0


def types(d):
    o, n, s = SE.sections(d)[14]
    if s != SEC14_STRIDE:
        raise ValueError('section 14 stride %#x' % s)
    out = []
    for k in range(n):
        r = d[o + k * s:o + (k + 1) * s]
        out.append(dict(
            idx=k, name=r[:8].split(b'\0')[0].decode('latin-1'),
            mat=r[0x0a], div_b=r[0x0b], div_c=r[0x0c], div_e=r[0x0e],
            flags=struct.unpack_from('<I', r, 0x10)[0], flags12=struct.unpack_from('<H', r, 0x12)[0],
            cls=r[0x14], shape=r[0x15], hp=struct.unpack_from('<h', r, 0x16)[0],
            size=[round(x, 6) for x in struct.unpack_from('<3f', r, 0x18)]))
    return out


def records(d, tys):
    o, n, s = SE.sections(d)[15]
    if s != SEC15_STRIDE:
        raise ValueError('section 15 stride %#x' % s)
    out = []
    for k in range(n):
        r = d[o + k * s:o + (k + 1) * s]
        ti = struct.unpack_from('<i', r, 0x40)[0]
        ty = tys[ti] if 0 <= ti < len(tys) else None       # FUN_00311310 clamps a bad index to 0
        if not ty or ty['name'] not in MODELS:
            continue
        m = [list(struct.unpack_from('<4f', r, 16 * i)) for i in range(4)]
        out.append(dict(
            rec=k, type=ti, model=ty['name'], m=[[round(x, 6) for x in row] for row in m],
            script=struct.unpack_from('<h', r, 0x44)[0], flags48=struct.unpack_from('<I', r, 0x48)[0],
            f4c=struct.unpack_from('<h', r, 0x4c)[0], f4e=struct.unpack_from('<b', r, 0x4e)[0],
            f50=struct.unpack_from('<I', r, 0x50)[0],       # FUN_0054fa48 (class 8): bit 0 -> start off (state 0)
            ))
    return out


def cam_boxes(d, tys):
    """Class 3 gimmicks (FUN_00548348 case 3, object type 0xf, vt 0x591890), all shape 0, no model, no script: what the camera's probe 6
    needs (FUN_00584408 -> FUN_0025a8f0): the record's matrix, the type's size, the parent area."""
    o, n, s = SE.sections(d)[15]
    out = []
    for k in range(n):
        r = d[o + k * s:o + (k + 1) * s]
        ti = struct.unpack_from('<i', r, 0x40)[0]
        ty = tys[ti] if 0 <= ti < len(tys) else None
        if not ty or ty['cls'] != 3:
            continue
        if ty['shape'] != 0 or struct.unpack_from('<h', r, 0x44)[0] != -1 or struct.unpack_from('<I', r, 0x48)[0] != 0:
            raise ValueError('class 3 record %d is not the plain box the page translates' % k)
        out.append(dict(rec=k, m=[[round(x, 6) for x in struct.unpack_from('<4f', r, 16 * i)] for i in range(4)],
                        size=ty['size'], area=struct.unpack_from('<h', r, 0x4c)[0],
                        chunk=struct.unpack_from('<h', d, SE.sections(d)[14][0] + ti * SEC14_STRIDE + 0x28)[0],
                        node=struct.unpack_from('<h', d, SE.sections(d)[14][0] + ti * SEC14_STRIDE + 0x2a)[0],
                        rec50=[[round(x, 6) for x in struct.unpack_from('<4f', r, 0x50 + 16 * i)] for i in range(4)],
                        type=dict(flags=ty['flags'], mat=ty['mat'], hp=ty['hp'], div_b=ty['div_b'], div_e=ty['div_e'], shape=ty['shape'])))
    return out


def chunk_anims(stage_dir, nchunks=13):
    """Each chunk's animations with position / rotation tracks (FUN_0026c198; the UV ones are bmd_uvanim.py's): the curves, the moved nodes' file matrices and their index in
    the BMD's tree (bmd_occl.py order, the room's ranges). chunk_anim.js."""
    sys.path.insert(0, HERE)
    from bmd_uvanim import read_curve, _u32, _s16
    from bmd_occl import tree as bmd_tree
    from export_bmd_textured import find_bmd_payload
    out = []
    for c in range(nchunks):
        an = open(os.path.join(stage_dir, '0680%02x10.bin' % c), 'rb').read()
        bm = open(os.path.join(stage_dir, '0680%02x12.bin' % c), 'rb').read()
        pay = find_bmd_payload(bm)
        nodes, _ = bmd_tree(bm, pay)
        tree_of = {x['off']: i for i, x in enumerate(nodes)}
        ntab = pay + _u32(bm, pay + 0x1c)
        anims, rest, tree = [], {}, {}
        for i in range(_u32(an, 0)):
            a = _u32(an, 4 + 4 * i)
            ntr, fl, _x, h3 = struct.unpack_from('<4h', an, a)
            tr, cu = _u32(an, a + 8), _u32(an, a + 0xc)
            rows = []
            for k in range(ntr):
                e = _u32(an, tr + 4 * k)
                node = _s16(an, e + 0x10)
                pos, rot = [_s16(an, e + o) for o in (0x14, 0x16, 0x18)], [_s16(an, e + o) for o in (0x1a, 0x1c, 0x1e)]
                if node < 0 or (min(pos) < 0 and min(rot) < 0):
                    continue
                cur = lambda ix: [[round(v, 6) for v in key] for key in read_curve(an, _u32(an, cu + 4 * ix))] if ix >= 0 else []
                rows.append(dict(node=node, pos=[cur(x) for x in pos], rot=[cur(x) for x in rot]))
                off = _u32(bm, ntab + 4 * node)
                rest[node] = [[round(x, 6) for x in struct.unpack_from('<3f', bm, pay + off + 16 * r)] for r in range(4)]
                tree[node] = tree_of.get(off, -1)
            if rows:
                anims.append(dict(index=i, flags=fl, h3=h3, tracks=rows))
        if anims:
            out.append(dict(chunk=c, rest=rest, tree=tree, anims=anims))
    return out


def main():
    stage, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    if not gitignored(os.path.join(out, 'props.json')):
        sys.exit('REFUSING: %s is not gitignored (game-derived output)' % out)
    d = open(stage, 'rb').read()
    tys = types(d)
    recs = records(d, tys)
    used = sorted({r['type'] for r in recs})
    res = dict(format='props-1', stage=os.path.basename(stage),
               types={str(i): tys[i] for i in used}, records=recs, camBoxes=cam_boxes(d, tys), chunkAnims=chunk_anims(os.path.dirname(stage)))
    with open(os.path.join(out, 'props.json'), 'w') as f:
        json.dump(res, f, separators=(',', ':'))
    print('wrote %s/props.json: %d records (%s), types %s' % (
        out, len(recs), ', '.join('%d (area %d)' % (r['rec'], r['f4c']) for r in recs), used))


if __name__ == '__main__':
    main()
