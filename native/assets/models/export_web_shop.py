#!/usr/bin/env python3
"""Export what the Shop (native/web/shop.js) needs, read from the user's own game files (worker 0263; notes/shop-research.md).

    python3 -I native/assets/models/export_web_shop.py --elf ELF --disc extract/_KEL --stage 06800006.bin --bgd bgd.bin
        -o native/web/data/shop.json

Everything written lands in the gitignored native/web/data/; this script holds only addresses and the decode steps.

  shops     the stage's section (DAT_0047dbb0 +0x20 = the file 06800006.bin): u32 count, then (offset, size); each entry FUN_0023c418:
            u32 inflated size, u32 size, then FUN_0041c1d8 (kel_class.cipher, key 7: FUN_0023c3f0) + zlib. Inflated ("KelShop1.0 .."):
            +0x40 / +0x44 the Buy rows (0x20 bytes: id, price), +0x48 / +0x4c the Modify rows (0x20 bytes: id, price, result, +0x10
            required item or 0: 0x3c39a0), +0x50 / +0x54 the Sell prices (8 bytes: id, price; sorted, 0x3c3760 searches them).
  items     bgd.bin (export_web_items.bgd_items) for every id of the Sell tables and rows: the records items.js already reads, the
            weapon stats (FUN_003d2338: FUN_003106c8 = section 5, record +4), the row icon (FUN_003d21c8), and name + description (FUN_003fd5e8).
  layouts   the screen's byte scripts for menu_layout.js.
  images    DAT_0047bfc0 as export_web_pause.py, for the ids these layouts draw.
"""
import argparse
import json
import os
import struct
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
from export_web_menu import Elf, read_layout, OPLEN_AT, OPLEN_N  # noqa: E402
from export_web_pause import (LOCALE, IMAGES_AT, KINDS_AT, PAGES_AT, kelstr_decode, kelstr_keys, kelstr_message, menu_texture8)  # noqa: E402
from export_web_items import bgd_items, bgd_scripts  # noqa: E402
import kel_class as K  # noqa: E402

OUT = os.path.join(ROOT, 'native/web/data/shop.json')
LAYOUTS = {'shopRoot': 0x4788c8, 'shopTabs': 0x4789e8, 'shopInfo': 0x4759d8, 'shopDesc': 0x478ab8,   # FUN_003c21b0, FUN_003c43c0
           'shopQty0': 0x478b08, 'shopQty1': 0x478ba8,                                               # FUN_003c49d0, FUN_003c4b30
           'shopBuy': 0x479040, 'shopSell': 0x479060, 'shopLeave': 0x479080, 'shopMod': 0x4790a0}    # FUN_003c28a0, FUN_003c2ae8
HELP_LAYOUT = 0x476818                                                                                # FUN_003bafb0 +0x38
MESSAGES = [0x3002, 0x7c11, 0x340c, 0x340d, 0x340e, 0x340f, 0x3410, 0x3411, 0x3412, 0x3800, 0x3801] + list(range(0xa800, 0xa811)) + [0xb841]
ICONS_KIND3, ICONS_KIND = 0x47acc0, 0x47ac78                                                          # FUN_003d21c8
STATS_NONE = 0x4a6470                                                                                 # FUN_003d2338: the '---' of a zero stat


def gitignored(p):
    return subprocess.run(['git', '-C', ROOT, 'check-ignore', '-q', os.path.abspath(p)]).returncode == 0


def shops(path, elfpath):
    C = K.cipher_consts(elfpath)
    d = open(path, 'rb').read()
    out = []
    for i in range(struct.unpack_from('<I', d, 0)[0]):
        off, size = struct.unpack_from('<II', d, 4 + i * 8)
        body, ok = K.cipher(d[off + 8:off + size], 7, C)
        if not ok:
            raise ValueError('shop %d: checksum fails' % i)
        raw = zlib.decompressobj().decompress(body)
        if not raw.startswith(b'KelShop'):
            raise ValueError('shop %d: no KelShop header' % i)
        n0, o0, n1, o1, n2, o2 = struct.unpack_from('<6I', raw, 0x40)
        out.append({
            'buy': [list(struct.unpack_from('<2I', raw, o0 + k * 0x20)) for k in range(n0)],
            'modify': [[struct.unpack_from('<I', raw, o1 + k * 0x20 + q)[0] for q in (0, 4, 8, 0x10)] for k in range(n1)],
            'sell': [list(struct.unpack_from('<2I', raw, o2 + k * 8)) for k in range(n2)],
        })
    return out


def icon_of(elf, it, stats):
    """FUN_003d21c8: the row's icon by the item's kind."""
    if it is None:
        return 0x27
    if it['kind'] == 3:
        i = 0
        while elf.u32(ICONS_KIND3 + i * 8) != 0xffffffff:
            if stats is not None and elf.u32(ICONS_KIND3 + i * 8) == (stats['p12'] & 0xf):
                return struct.unpack('<h', elf.read(ICONS_KIND3 + i * 8 + 4, 2))[0]
            i += 1
        return 0x27
    i = 0
    while elf.u32(ICONS_KIND + i * 8) != 0xffffffff:
        if elf.u32(ICONS_KIND + i * 8) == it['kind']:
            return struct.unpack('<h', elf.read(ICONS_KIND + i * 8 + 4, 2))[0]
        i += 1
    return 0x27


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', required=True)
    ap.add_argument('--disc', required=True)
    ap.add_argument('--stage', required=True)
    ap.add_argument('--bgd', required=True)
    ap.add_argument('-o', default=OUT)
    a = ap.parse_args()
    if not gitignored(a.o):
        sys.exit('REFUSING: %s is not gitignored (game-derived output)' % a.o)
    elf = Elf(open(a.elf, 'rb').read())
    oplen = list(elf.read(OPLEN_AT, OPLEN_N))
    S = shops(a.stage, a.elf)
    bgd = open(a.bgd, 'rb').read()
    item = bgd_items(bgd)
    loc = os.path.join(a.disc, 'data/etc/locale', LOCALE)
    kel = kelstr_decode(open(os.path.join(loc, 'kelstr.bin'), 'rb').read(), kelstr_keys(elf))
    menudata = open(os.path.join(loc, 'menudata.bin'), 'rb').read()

    # FUN_003fd5e8 on the decoded file: a table of (count, category, offset) by item id
    t = struct.unpack_from('<I', kel, 0x24)[0] + 0x24
    n = struct.unpack_from('<H', kel, t)[0] + (struct.unpack_from('<H', kel, t + 2)[0] << 16)
    cats = {}
    for i in range(n):
        p = t + (2 + i * 4) * 2
        cats[struct.unpack_from('<H', kel, p + 2)[0]] = (struct.unpack_from('<H', kel, p)[0], struct.unpack_from('<H', kel, p + 4)[0] & 0xfffe)

    def text(i, k):
        c = cats.get(i >> 16)
        if not c or (i & 0xffff) >= c[0]:
            return None
        o = struct.unpack_from('<H', kel, t + k * 2 + (i & 0xffff) * 4 + c[1])[0]
        return kel[t + o:kel.index(b'\0', t + o)]

    o5, n5, s5 = struct.unpack_from('<3I', bgd, 0x24 + 16 * 5)
    o0, n0, s0 = struct.unpack_from('<3I', bgd, 0x24)
    o3, n3, s3 = struct.unpack_from('<3I', bgd, 0x24 + 16 * 3)
    bcats = [struct.unpack_from('<3I', bgd, o3 + i * s3) for i in range(n3)]

    def part(i):                                     # FUN_00310560 + FUN_00310660(+4)
        for c, st, cnt in bcats:
            if c == (i & 0xffff0000) and (i & 0xffff) < cnt:
                p = struct.unpack_from('<h', bgd, o0 + (st + (i & 0xffff)) * s0 + 4)[0]
                if 0 <= p < n5:
                    return bgd[o5 + p * s5:o5 + (p + 1) * s5]
        return None

    ids = set()
    for s in S:
        ids |= {r[0] for r in s['buy']} | {r[0] for r in s['sell']}
        for r in s['modify']:
            ids |= {r[0], r[2]} | ({r[3]} if r[3] else set())
    items = {}
    for i in sorted(ids):
        it = item(i)
        if it is None:
            continue
        stats = None
        if it['kind'] == 3:
            p = part(i)
            if p is not None:
                g = lambda q: struct.unpack_from('<h', p, q)[0]
                # FUN_003d2338's order: +0x5a, +0x58, +0x5c, +0x5e, +0x70, +0x6e, +0x6c (widgets 59..65)
                stats = {'p12': struct.unpack_from('<H', p, 0x12)[0], 'v': [g(0x5a), g(0x58), g(0x5c), g(0x5e), g(0x70), g(0x6e), g(0x6c)]}
        nm, de = text(i, 0), text(i, 1)
        items['%08x' % i] = dict(it, name=nm.hex() if nm else None, desc=de.hex() if de else None, icon=icon_of(elf, it, stats),
                                 stats=stats['v'] if stats else None)

    kinds = [list(struct.unpack('<9i', elf.read(KINDS_AT + 0x24 * k, 0x24))) for k in range(5)]
    layouts = {k: read_layout(elf, v, oplen).hex() for k, v in LAYOUTS.items()}
    layouts['shopHelp'] = read_layout(elf, HELP_LAYOUT, oplen).hex()
    image_ids = {6, 7, 8, 9, 10, 13, 21, 22, 23, 52, 84, 85, 138, 139, 140, 261, 263, 264, 0x27, 0x10a, 0xd1, 0x109, 0x10e}   # the layouts' ids, FUN_003d21c8's
    for it in items.values():
        image_ids.add(it['icon'])
    images, pages = {}, set()
    for i in sorted(image_ids):
        sp, page, kind, lit, rep, cp = struct.unpack_from('<IBBBBI', elf.read(IMAGES_AT + 16 * i, 16), 0)
        cnt = kinds[kind][0] * (2 if lit in (0, 2) else 1)
        slices = [list(struct.unpack('<4h', elf.read(sp + 8 * k, 8))) for k in range(cnt)] if sp else []
        cols = list(struct.unpack('<4I', elf.read(cp, 16))) if cp else None
        images[str(i)] = {'page': page, 'kind': kind, 'lit': lit, 'rep': rep, 'slices': slices, 'colors': cols}
        pages.add(page)
    textures = {}
    for p in sorted(pages):
        name = elf.read(elf.u32(PAGES_AT + 4 * (p + 6)), 8).split(b'\0')[0].decode()
        tx = menu_texture8(menudata, name)
        tx['name'] = name
        textures[str(p)] = tx
    msgs = {}
    for m in MESSAGES:
        try:
            msgs['%#x' % m] = kelstr_message(kel, m).hex()
        except ValueError:
            pass
    # FUN_003c9de8: PTR_DAT_0047c6b0 (thumb), c0 (track), d0, e0 (the ends): pointer to rows of 4 shorts, +4 the page
    scroll = [{'page': elf.read(a_ + 4, 1)[0], 's': list(struct.unpack('<12h', elf.read(elf.u32(a_), 24)))} for a_ in (0x47c6b0, 0x47c6c0, 0x47c6d0, 0x47c6e0)]
    pages |= {x['page'] for x in scroll}
    for p in sorted(pages):
        if str(p) not in textures:
            name = elf.read(elf.u32(PAGES_AT + 4 * (p + 6)), 8).split(b'\0')[0].decode()
            tx = menu_texture8(menudata, name)
            tx['name'] = name
            textures[str(p)] = tx
    # the items the Shop can sell that a player can use: their scripts (FUN_00310718), as items.json's
    scripts = bgd_scripts(bgd, {r['script'] for r in items.values() if r['kind'] == 2 and (r['flags'] >> 2) & 1})
    doc = {'source': 'SLES_541.85 + 06800006.bin + bgd.bin + locale/%s (export_web_shop.py)' % LOCALE, 'shops': S, 'items': items, 'layouts': layouts,
           'images': images, 'textures': textures, 'messages': msgs, 'none': elf.read(STATS_NONE, 8).split(b'\0')[0].hex(), 'scroll': scroll, 'scripts': scripts}
    with open(a.o, 'w') as f:
        json.dump(doc, f)
    print('wrote', a.o, 'shops', [(len(s['buy']), len(s['modify']), len(s['sell'])) for s in S], 'items', len(items), 'images', len(images), 'pages', sorted(pages))


if __name__ == '__main__':
    sys.exit(main())
