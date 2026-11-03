#!/usr/bin/env python3
"""export_web_results.py -- the level end's Status results screen for the web page (worker 0232).

    python3 -I native/assets/models/export_web_results.py [--elf ELF] [--disc extract/_KEL] [-o native/web/data/results.json]

Reads the user's ELF and disc files at run time; writes game data into the gitignored native/web/data (never commit it).
Decoded in notes/results-research.md:
  ev0100 main's level end: endSection (FUN_003a26a8 -> FUN_003fdb00 -> FUN_0031dbf0), displayStageInfo(2) (the event
  library's bytecode: Intermission.calc() first = FUN_003a55e8 -> KerberosIntermissionCalc.calc(), then displayStageInfo_l
  -> FUN_003fdb48(2)), Zone.exit(181) (FUN_0039df70 -> FUN_0037a368: event request 0x14).
  FUN_003fdf00 opens box kind DAT_004a8250[2] = 0x1d: the sequence screen FUN_003c5358; FUN_003c54f8 copies the 54 section
  stats (FUN_0031d7b8) to +0xff0 and takes step table 0x479650 (the default case) + FUN_003c6d70 (rank effect ids).
Output:
  steps       the kind-0x1d step table 0x479650 .. 0x47a028 (0x14 bytes each: start ms, life, s8 op, arg, x, y)
  layouts     FUN_003c6600: case 0x1a / 4 / 8 -> 0x479190 (no override), case 0x19 -> 0x4791d0 (override 0x51f960),
              case 9 -> 0x479420 (override 0x51f980), case 0xf / 0xc -> FUN_003c73f0's 0x4795c8 (no override)
  tables      DAT_0047a2d8 (widget ids by step arg), DAT_0047a300 (stat index pairs by arg), DAT_0047a340 (section names),
              DAT_0047a388 / DAT_0047a428 (text ids by stat value), DAT_0047a4c8 / DAT_0047a4e0 (rank effect ids),
              DAT_0047a4f8 (stat, slot, slot triples), DAT_0047a315 / DAT_0047a338 (FUN_003c54f8's row packing)
  messages    kelstr.bin (FUN_003fd578) for every text id the screen uses (layout op 0x10 and the code's ids)
  calc        data/etc/KerberosIntermissionCalc.class (decrypted, kel_class.py), run by Intermission.calc()
"""
import argparse
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
from export_web_menu import Elf, read_layout, OPLEN_AT, OPLEN_N  # noqa: E402
from export_web_pause import kelstr_keys, kelstr_decode, kelstr_message, LOCALE  # noqa: E402
import kel_class as K  # noqa: E402
import export_web_event as E  # noqa: E402

LANGUAGE = 2                                    # FUN_00242450 for the uk build (as export_web_pause.py)
STEPS_AT, STEPS_END = 0x479650, 0x47a028        # FUN_003c54f8 default case; 0x47a028 = kind 0x1e's table
LAYOUTS = {'title': (0x479190, None), 'rows': (0x4791d0, 0x51f960), 'points': (0x479420, 0x51f980),
           'after': (0x4795c8, None)}
CODE_IDS = [0xb800, 0xb878, 0xb82f, 0xb837, 0xb838, 0xb839, 0xb83a, 0xb842]
CALC = 'data/etc/KerberosIntermissionCalc.class'


def dump_reference(path):
    """The Status screen's text in the last full frame of a GS dump (test_results.mjs compares it): the font sprites
    (TBP 0, PSMT4HH), in order, as 1/16 drawable units (XYOFFSET removed), UV / RGBA per vertex, TEX0 CBP, TEX1.
    Game-derived: gitignored data/ only."""
    sys.path.insert(0, os.path.join(ROOT, 'tools/gsdump/src'))
    import gsparse as G  # noqa: E402

    class Interp(G.GIFInterp):
        def __init__(self):
            super().__init__()
            self.extra = {}

        def write_reg(self, addr, data):
            if addr in (0x14,):
                self.extra[addr] = data
            return super().write_reg(addr, data)

        def _new_draw(self):
            super()._new_draw()
            self._cur['extra'] = dict(self.extra)
    buf = open(path, 'rb').read()
    h = G.read_header(buf)
    g = Interp()
    off, vs = h['packets_at'], []
    while off < len(buf):
        t = buf[off]; off += 1
        if t == 0:
            off += 1
            n, = struct.unpack_from('<I', buf, off); off += 4
            g.feed(buf[off:off + n]); off += n
        elif t == 1:
            off += 1; vs.append(len(g.draws))
        elif t == 2:
            off += 4
        elif t == 3:
            off += 0x2000
        else:
            break
    out = []
    for d in g.draws[vs[-2]:vs[-1]]:
        if not d['verts'] or not d['tme'] or d['ptype'] != 6:
            continue
        t0 = d['tex0']
        tbp, psm = t0 & 0x3fff, (t0 >> 20) & 0x3f
        if not (tbp == 0 and psm == 0x2c):
            continue
        xo = d['xyoffset']
        ox, oy = xo & 0xffff, (xo >> 32) & 0xffff
        v = [{'x': q['x'] - ox, 'y': q['y'] - oy, 'u': q['u'], 'v': q['vv'], 'c': [q['r'], q['g'], q['b'], q['a']]}
             for q in d['verts']]
        out.append({'prim': d['ptype'], 'tbp': tbp, 'cbp': (t0 >> 37) & 0x3fff, 'psm': psm,
                    'tex1': d['extra'].get(0x14, 0), 'v': v})
    return {'source': os.path.basename(path), 'draws': out}


def s8(b):
    return [x - 256 if x > 127 else x for x in b]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', default=os.path.join(ROOT, 'elf/SLES_541.85'))
    ap.add_argument('--disc', default=os.path.join(ROOT, 'extract/_KEL'))
    ap.add_argument('-o', default=os.path.join(ROOT, 'native/web/data/results.json'))
    ap.add_argument('--dump', action='append', default=[], metavar='NAME=GS',
                    help='GS dump (.gs, unpacked) of the Status screen: write data/results_ref_NAME.json (test reference)')
    a = ap.parse_args()
    raw = open(a.elf, 'rb').read()
    elf = Elf(raw)
    oplen = list(elf.read(OPLEN_AT, OPLEN_N))
    pal = 1 if LANGUAGE != 0 else 0             # FUN_003e2760 (as export_web_stageinfo.py)
    steps = []
    for at in range(STEPS_AT, STEPS_END, 0x14):
        t, life, op, arg, x, y = struct.unpack('<Iib3xihh', elf.read(at, 0x14))
        steps.append([t, life, op, arg, x, y])
    u32s = lambda at, n: list(struct.unpack('<%dI' % n, elf.read(at, 4 * n)))
    tables = {
        'widgets': list(elf.read(0x47a2d8, 0x28)),
        'statPairs': s8(elf.read(0x47a300, 0x50)),
        'sectionNames': u32s(0x47a340, 0x11),
        'text388': u32s(0x47a388, 0x28), 'text428': u32s(0x47a428, 0x28),
        'rankFxA': u32s(0x47a4c8, 5), 'rankFxB': u32s(0x47a4e0, 5),
        'rankSlots': s8(elf.read(0x47a4f8, 0x24)),
        'rankPosPal': list(struct.unpack('<40h', elf.read(0x51d0e0, 80))),
        'pack315': s8(elf.read(0x47a314, 0x10)), 'pack338': s8(elf.read(0x47a338, 4)),
        'kinds': list(elf.read(0x4a8250, 7)),
    }
    layouts, overrides, ids = {}, {}, set(CODE_IDS)
    for k, (lay, tab) in LAYOUTS.items():
        b = read_layout(elf, lay, oplen)
        layouts[k] = b.hex()
        n, q = 0, 0
        while b[q] != 0xff:
            if b[q] == 0x0e:
                n += 1
            if b[q] == 0x10:
                v = struct.unpack_from('<I', b, q + 1)[0] & 0x7fffffff
                if v:
                    ids.add(v)
            q += oplen[b[q]]
        ov = elf.u32(tab + 4 * LANGUAGE) if (tab and pal) else 0
        overrides[k] = list(struct.unpack('<%dh' % (4 * n), elf.read(ov, 8 * n))) if ov else None
    for t in ('sectionNames', 'text388', 'text428'):
        ids.update(v for v in tables[t] if 0 < v < 0x7fffffff)
    kel = kelstr_decode(open(os.path.join(a.disc, 'data/etc/locale', LOCALE, 'kelstr.bin'), 'rb').read(), kelstr_keys(elf))
    msgs, missing = {}, []
    for mid in sorted(ids):
        try:
            msgs['%#x' % mid] = kelstr_message(kel, mid).hex()
        except ValueError:
            missing.append(mid)
    consts = K.cipher_consts(a.elf)
    d, ok = K.decrypt(open(os.path.join(a.disc, CALC), 'rb').read(), consts)
    if not ok:
        raise SystemExit('%s: the class checksum fails (wrong ELF or file?)' % CALC)
    calc = E.read_class(d)
    doc = {'source': 'export_web_results.py (worker 0232)', 'language': LANGUAGE, 'steps': steps,
           'layouts': layouts, 'overrides': overrides, 'tables': tables, 'messages': msgs, 'calc': calc}
    os.makedirs(os.path.dirname(os.path.abspath(a.o)), exist_ok=True)
    with open(a.o, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    for item in a.dump:
        name, gs = item.split('=', 1)
        ref = dump_reference(gs)
        with open(os.path.join(os.path.dirname(os.path.abspath(a.o)), 'results_ref_%s.json' % name), 'w') as f:
            json.dump(ref, f, separators=(',', ':'))
        print('reference %s: %d font draws from %s' % (name, len(ref['draws']), ref['source']))
    print('results: %d steps, %d layouts, %d messages (%d missing), calc class %s (%d methods) -> %s' % (
        len(steps), len(layouts), len(msgs), len(missing), calc['name'], len(calc['methods']), a.o))


if __name__ == '__main__':
    main()
