#!/usr/bin/env python3
"""z128's item pickups and drops for play.html (native/web/items.js), read at build time from the user's disc files
and ELF. Writes <out>/items.json (gitignored game data). Notes: notes/items-research.md.

    python3 -I export_web_items.py --elf ELF --stage 06800001.bin --bgd bgd.bin -o native/web/data/items/items.json

Decoded (worker 0224):
  - Placed items: section-15 gimmicks whose section-14 type has class byte +0x14 = 2 (FUN_00548348 case 2 -> object
    type 8, vt 0x590a68). Type +0x28 item id, +0x2c u16 count (FUN_00580590). Record +0x48 bit 2 -> item +200 bit 0
    (wait for a script), +0x4c s16 area, +0x44 script. The k-th class-2 gimmick is "taken" bit k (FUN_0031e1a8 /
    FUN_0031e0e0, item +0xce = k, FUN_00580718).
  - Drops (FUN_0055cac8 -> FUN_00316d70): section-1 record +0x40 flags (= status +0xc: bit 18 no drop, bit 23 fixed
    drop, bit 14 no life timer), +0x5c item id, +0x60 count; else the parameter set (section 0) +0x70 s16 chance and
    +0x1d0 table of 5 x 12 bytes (u32 id, s32 count, s16 weight).
  - bgd.bin items (FUN_00310560): section 3 = categories (id & 0xffff0000, start, count), section 0 = 0x18-byte items
    (+8 u16 flags, +0xc kind, +0xe u16 stack max, +0x10 value, +4 s16 section-5 part index); section 5 part +0x10
    (FUN_00310660; & 0xf0000 == 0x50000: ammo).
  - ELF: the model-name table 0x5909c0 (18 x 5 bytes, FUN_0057f6f8), the colour pulse table 0x590a48 (32 bytes,
    FUN_0057ff80), the pickup sound names 0x58d938.. (FUN_00560110).
"""
import argparse, json, os, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'tools'))
sys.path.insert(0, HERE)
import stage_events as SE  # noqa: E402
from export_web_aim import Elf  # noqa: E402

# The parent area +0x4c decides when an item is switched on: the page's areas.js (worker 0223; notes/npc-research.md
# "Areas"). Area 69 has no area object in z128 (empty manager +0x2b4 slot), so those items have no parent and the
# stage-start pass FUN_0053ced8 switches them on, as -1.
MODEL_TABLE, MODEL_COUNT = 0x5909c0, 18
PULSE_TABLE = 0x590a48
SOUND_NAMES = {'full': 0x58d938, 'id_6932000b': 0x58d940, 'id_6932000c': 0x58d948, 'nonammo': 0x58d950,
               'dropped': 0x58d958, 'placed': 0x58d960,
               'cycle': 0x58ee70}               # worker 0243: FUN_00574058's FUN_0054b158(P, 0x58ee70, 1) (the item cycle)


def gitignored(path):
    return subprocess.run(['git', 'check-ignore', '-q', path], cwd=HERE).returncode == 0


def cstr(elf, a, n=8):
    return elf.read(a, n).split(b'\0')[0].decode('latin-1')


def bgd_items(b):
    sec = lambda k: struct.unpack_from('<3I', b, 0x24 + 16 * k)
    o0, n0, s0 = sec(0)
    o3, n3, s3 = sec(3)
    o5, n5, s5 = sec(5)
    cats = [struct.unpack_from('<3I', b, o3 + i * s3) for i in range(n3)]

    def rec(i):
        for c, st, n in cats:
            if c == (i & 0xffff0000) and (i & 0xffff) < n:
                k = st + (i & 0xffff)
                if k < n0:
                    return b[o0 + k * s0:o0 + (k + 1) * s0]
        return None

    def item(i):
        r = rec(i)
        if r is None:
            return None
        part = struct.unpack_from('<h', r, 4)[0]
        p10 = struct.unpack_from('<I', b, o5 + part * s5 + 0x10)[0] if 0 <= part < n5 else None
        # worker 0243: +6 the item's script (FUN_0031e208 -> FUN_00310718), +0xa the item list's order key (FUN_0031f520's
        # comparator 0x31f4e0: +0xa, then the id)
        return dict(flags=struct.unpack_from('<H', r, 8)[0], kind=r[0xc], max=struct.unpack_from('<H', r, 0xe)[0],
                    value=struct.unpack_from('<i', r, 0x10)[0], part10=p10,
                    script=struct.unpack_from('<h', r, 6)[0], key=struct.unpack_from('<H', r, 0xa)[0])
    item.ids = [c + k for c, _st, n in cats for k in range(n)]
    return item


def bgd_scripts(b, wanted):
    """Worker 0243: the item scripts. FUN_00310718(n): bgd section 8 (u32 offsets, count = section 8's) + section 9's
    base (DAT_0046dd68 +0x24 / +0x28 = the section 8 / 9 pointers); n out of range -> script 0. The format is the stage
    scripts' (FUN_0036fd58 / FUN_0036fdc8), exported as export_web_triggers.script does: {event: {locals, code, data}}."""
    sec = lambda k: struct.unpack_from('<3I', b, 0x24 + 16 * k)
    o8, n8, _ = sec(8)
    o9 = sec(9)[0]
    out = {}
    for n in sorted(wanted):
        m = n if 0 <= n < n8 else 0
        base = o9 + struct.unpack_from('<I', b, o8 + 4 * m)[0]
        ev = {}
        for e, f, code, end in SE.functions(b, base):
            ins = SE.disasm(b, code, end)
            data = b[f + SE.u32(b, f + 4): f + SE.u32(b, f + 4) + SE.u32(b, f + 0xc)]
            ev[str(e)] = dict(locals=SE.u32(b, f + 8), code=[[op, imm] for _i, op, imm in ins], data=data.hex())
        out[str(n)] = ev
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', required=True)
    ap.add_argument('--stage', required=True)
    ap.add_argument('--bgd', required=True)
    ap.add_argument('-o', required=True)
    a = ap.parse_args()
    if not gitignored(a.o):
        sys.exit('REFUSING: %s is not gitignored (game-derived output)' % a.o)
    elf = Elf(open(a.elf, 'rb').read())
    d = open(a.stage, 'rb').read()
    bgd = open(a.bgd, 'rb').read()
    item = bgd_items(bgd)
    S = SE.sections(d)
    o0, n0, s0 = S[0]
    o1, n1, s1 = S[1]
    o14, n14, s14 = S[14]
    o15, n15, s15 = S[15]
    ids = set()

    placed, k = [], 0
    for r in range(n15):
        rec = d[o15 + r * s15:o15 + (r + 1) * s15]
        t = struct.unpack_from('<i', rec, 0x40)[0]
        if not 0 <= t < n14:
            t = 0                                            # FUN_00311310 clamps a bad index to 0
        ty = d[o14 + t * s14:o14 + (t + 1) * s14]
        if ty[0x14] != 2:
            continue
        iid, cnt = struct.unpack_from('<IH', ty, 0x28)
        f48 = struct.unpack_from('<I', rec, 0x48)[0]
        area = struct.unpack_from('<h', rec, 0x4c)[0]
        placed.append(dict(rec=r, k=k, id=iid, count=cnt,
                           m=[[round(x, 6) for x in struct.unpack_from('<4f', rec, 16 * i)] for i in range(4)],
                           script=struct.unpack_from('<h', rec, 0x44)[0], flags48=f48, area=area))
        ids.add(iid)
        k += 1

    drops = {}
    for r in range(n1):
        rec = d[o1 + r * s1:o1 + (r + 1) * s1]
        ps = struct.unpack_from('<I', rec, 0)[0]
        p = d[o0 + ps * s0:o0 + (ps + 1) * s0] if ps < n0 else bytes(0x20c)
        tab = [list(struct.unpack_from('<Iih', p, 0x1d0 + 12 * i)) for i in range(5)]
        dr = dict(flags=struct.unpack_from('<I', rec, 0x40)[0], id=struct.unpack_from('<I', rec, 0x5c)[0],
                  count=struct.unpack_from('<i', rec, 0x60)[0], chance=struct.unpack_from('<h', p, 0x70)[0], table=tab)
        # every record (worker 0224, review): status bit 18 with chance 0 still means no drop and no RNG draw
        drops[str(r)] = dr
        if (dr['flags'] >> 23) & 1 or dr['chance'] > 0:
            ids.add(dr['id'])
            ids.update(e[0] for e in tab)
    ids.update((0x62300000, 0x69300000))
    ids.update(item.ids)                     # worker 0243: every item (the inventory's, the item list's cycle and use)
    table = {}
    for i in sorted(ids):
        it = item(i)
        if it:
            table['%08x' % i] = it
    out = dict(format='items-1', stage=os.path.basename(a.stage),
               models=[cstr(elf, MODEL_TABLE + 5 * i, 5) for i in range(MODEL_COUNT)],
               pulse=list(elf.read(PULSE_TABLE, 32)),
               sounds={n: cstr(elf, v) for n, v in SOUND_NAMES.items()},
               items=table, placed=placed, drops=drops,
               # worker 0243: the usable items' scripts (kind 2, flags bit 2: FUN_00573eb0 / FUN_0031f520)
               scripts=bgd_scripts(bgd, {t['script'] for t in table.values() if t['kind'] == 2 and (t['flags'] >> 2) & 1}))
    os.makedirs(os.path.dirname(a.o), exist_ok=True)
    with open(a.o, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote %s: %d placed, %d drop records, %d item records' % (a.o, len(placed), len(drops), len(table)))


if __name__ == '__main__':
    main()
