#!/usr/bin/env python3
"""Export the game over's menu data for the page (worker 0192): native/web/data/gameover.json.

Everything comes from the user's ELF (SLES_541.85) and kelstr.bin at run time; nothing game-derived is kept
in the repo. The page draws the menu with pause.json's images, textures and font (pause.js / pause_layer.js),
so this file only adds what the game over has of its own:
  - layout 0x477c38: the Restart / Quit box (FUN_005348c0, box kind 0x21; 0x477cb0 when FUN_002419d8(0x11))
  - the kind-6 sequence table 0x47a130 (FUN_003c54f8 -> screen +0x488; read by FUN_003c6050): 0x14-byte
    records { +0 start ms, +4 duration ms, +8 command byte (case = (byte + 0x1d) & 0xff), +0xc arg, +0x10 },
    up to the 0xff command
  - the end-screen box kinds DAT_004a8250 (FUN_003fdf00: kind = table[type], type 3 = game over)
  - messages 0x4c01 / 0x4c02 (the two buttons' text, kelstr.bin)
With --menu-dump GS: also data/gameover_ref.json, the menu's draws in that dump's last frame (test reference,
game-derived, gitignored).

Usage: python3 -I native/assets/models/export_web_gameover.py [--menu-dump tools/trace/out/w192/menu.gs]
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
from export_web_pause import kelstr_decode, kelstr_keys, kelstr_message, LOCALE  # noqa: E402

ELF = os.path.join(ROOT, 'elf/SLES_541.85')
DISC = os.path.join(ROOT, 'extract/_KEL')
OUT = os.path.join(ROOT, 'native/web/data/gameover.json')

LAYOUTS = {'gameover': 0x477c38, 'gameover_flag11': 0x477cb0, 'seq6': 0x479190}
SEQ6_AT = 0x47a130          # FUN_003c54f8 case 6: screen +0x488 = &DAT_0047a130
END_KINDS_AT = 0x4a8250     # FUN_003fdf00: uStack_80 = DAT_004a8250..56 (7 bytes)
MESSAGES = [0x4c01, 0x4c02]
MENU_PAGES = (10828, 10960)  # 'menu3' / 'menu4' TBPs (pause_layer.js notes)


def seq_table(elf, at):
    out = []
    for i in range(64):
        t, dur, cmd, arg, x = struct.unpack('<IIBxxxiI', elf.read(at + 0x14 * i, 0x14))
        out.append([t, dur, cmd, arg, x])
        if cmd == 0xff:
            return out
    raise ValueError('sequence table %#x: no end record' % at)


def menu_reference(path):
    """The last full frame's menu-kit draws (untextured, or TEX0 on the menu pages or the font at TBP 0, PSMT4HH) of a GS dump,
    as export_web_pause.dump_reference writes them (drawable 1/16 px, XYOFFSET removed)."""
    sys.path.insert(0, os.path.join(ROOT, 'tools/gsdump/src'))
    import gsparse as G  # noqa: E402
    keep = (0x08, 0x14, 0x42)

    class Interp(G.GIFInterp):
        def __init__(self):
            super().__init__()
            self.extra = {}

        def write_reg(self, addr, data):
            if addr in keep:
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
    a, b = vs[-2], vs[-1]
    draws = []
    for d in g.draws[a:b]:
        if not d['verts']:
            continue
        t0 = d['tex0']
        tbp, psm = t0 & 0x3fff, (t0 >> 20) & 0x3f
        if d['tme'] and not (tbp in MENU_PAGES or (tbp == 0 and psm == 0x2c)):
            continue                           # other textures (the FED title, the scene): not menu draws
        xo = d['xyoffset']
        ox, oy = xo & 0xffff, (xo >> 32) & 0xffff
        v = [{'x': p['x'] - ox, 'y': p['y'] - oy, 'u': p['u'], 'v': p['vv'], 'c': [p['r'], p['g'], p['b'], p['a']]}
             for p in d['verts']]
        draws.append({'prim': d['ptype'], 'tme': d['tme'], 'tbp': tbp, 'cbp': (t0 >> 37) & 0x3fff, 'psm': psm,
                      'clamp': '%x' % d['extra'].get(0x08, 0), 'tex1': d['extra'].get(0x14, 0), 'v': v})
    return {'source': os.path.basename(path), 'draws': draws}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', default=ELF)
    ap.add_argument('--disc', default=DISC)
    ap.add_argument('-o', default=OUT)
    ap.add_argument('--menu-dump', help='GS dump with the game over menu open: also write data/gameover_ref.json')
    a = ap.parse_args()
    elf = Elf(open(a.elf, 'rb').read())
    loc = os.path.join(a.disc, 'data/etc/locale', LOCALE)
    kelstr = kelstr_decode(open(os.path.join(loc, 'kelstr.bin'), 'rb').read(), kelstr_keys(elf))
    oplen = list(elf.read(OPLEN_AT, OPLEN_N))
    doc = {
        'source': 'SLES_541.85 + data/etc/locale/%s (exported by export_web_gameover.py)' % LOCALE,
        'layouts': {k: read_layout(elf, v, oplen).hex() for k, v in LAYOUTS.items()},
        'seq6': seq_table(elf, SEQ6_AT),
        'endKinds': list(elf.read(END_KINDS_AT, 7)),
        'messages': {'%#x' % m: kelstr_message(kelstr, m).hex() for m in MESSAGES},
    }
    os.makedirs(os.path.dirname(a.o), exist_ok=True)
    with open(a.o, 'w') as f:
        json.dump(doc, f)
    print('wrote', a.o, 'seq6', doc['seq6'], 'endKinds', doc['endKinds'],
          'messages', {k: bytes.fromhex(v) for k, v in doc['messages'].items()})
    if a.menu_dump:
        ref = menu_reference(a.menu_dump)
        rp = os.path.join(os.path.dirname(a.o), 'gameover_ref.json')
        with open(rp, 'w') as f:
            json.dump(ref, f)
        print('wrote', rp, len(ref['draws']), 'menu draws')


if __name__ == '__main__':
    sys.exit(main())
