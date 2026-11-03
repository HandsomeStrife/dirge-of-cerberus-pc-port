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
Only the e057 type (the barrel) is exported; the other gimmicks (e056 crates, g0xx items / doors)
are not on the page yet.
"""
import json, os, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'tools'))
import stage_events as SE  # noqa: E402

SEC14_STRIDE, SEC15_STRIDE = 0x48, 0x90
MODELS = ('e057',)
# GUESS: the area objects (class vt 0x58c308, manager +0x2b4 table = cmd 0x3b) active at the save, read from
# the save state's RAM (indexes 2 and 15 -> objects 3 and 7; object 2 is active too but no index maps to it).
# FUN_00548348 parents each gimmick to area +0x4c (FUN_0053b920 -> FUN_0054c550, +0x40 |= 0x100); in the save
# only the gimmicks of active areas are active (record 17 in area 2: on; 18 / 19 in 18, 60 / 61 in 1: off).
# What activates an area (the player's position?) is not decoded (notes/barrel-research.md).
SAVE_ACTIVE_AREAS = (2, 15)


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
            # FUN_00584220 (vt+0x14c): +0x144(1, 1) unless +0x48 bit 2 (L: called once per gimmick at stage start),
            # and only in an active area (SAVE_ACTIVE_AREAS, GUESS)
            start_active=not (struct.unpack_from('<I', r, 0x48)[0] & 4) and struct.unpack_from('<h', r, 0x4c)[0] in SAVE_ACTIVE_AREAS))
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
               types={str(i): tys[i] for i in used}, records=recs)
    with open(os.path.join(out, 'props.json'), 'w') as f:
        json.dump(res, f, separators=(',', ':'))
    print('wrote %s/props.json: %d records (%s), types %s' % (
        out, len(recs), ', '.join('%d%s' % (r['rec'], '' if r['start_active'] else ' off') for r in recs), used))


if __name__ == '__main__':
    main()
