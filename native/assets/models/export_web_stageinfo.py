#!/usr/bin/env python3
"""export_web_stageinfo.py -- the stage-info boxes (displayStageInfo) for the web page (worker 0220).

    python3 -I native/assets/models/export_web_stageinfo.py [--elf ELF] [--disc extract/_KEL] [-o native/web/data/stage_info.json]

Reads the user's ELF and disc files at run time; writes game data into the gitignored native/web/data (never commit it).
Decoded in notes/message-research.md:
  displayStageInfo_l FUN_0039e8e8: the event string (resolved by FUN_003a6698 in the event's message file) is copied to
  DAT_0047d968, then FUN_00380788 -> FUN_003fdb48(kind). FUN_003fdf00 reads the box's effect file and opens a box of kind
  DAT_004a8250[kind] (FUN_003b66c0 -> FUN_003c52b0 -> FUN_003c5358, the sequence screen). FUN_003c54f8 picks its step
  table: kind 0x2b (stage-info 6, the MES_ITEM_xx help box) 0x47a220, or 0x51cfd8 when FUN_003e2760() (language != 0:
  PAL); kind 0x1f (stage-info 1, the objective) 0x47a0a0. Steps are 0x14 bytes (FUN_003c6050): +0 start ms, +4 life,
  +8 s8 op (>= 0: effect slot, < 0: command (op + 0x1d) of FUN_003c6600), +0xc arg, +0x10 / +0x12 s16 x, y.
  The ✕ in mode 1 steps past the -1 end mark (FUN_003c72f8), so a table holds one more section per mode-1 command
  (op -19 = case 10, op -22 = case 7): the reader keeps that many end marks.
Kind 0x1e (stage-info 0, the stage title card; worker 0265): steps 0x47a028, layout 0x479190 (widget 4: the title text
DAT_0047a340[stat 0xe], FUN_003fd578), its effects 0x81740000 / 0x81740400 in a0093.fed (file 0x31000fc for the uk build),
which export_web_results.py already writes (results.fed).
Output: kinds, scripts, item effect ids (FUN_003c6f98 table 0x51d090 / 0x47a528), layouts 0x479610 (kind 0x2b) and
0x479168 (kind 0x1f) with the language's rect override (FUN_003ca488 param_6 table 0x51f9a0 / 0x51f960), the '$' codes
(FUN_003d1d98 table 0x47abb0, colours DAT_0047a7c0, inline images PTR_0047a990 -> FUN_003d1c90 / FUN_003cb300), the
MES_ITEM_xx texts (ev0100's message file, FUN_003a6520 / FUN_003a6698) and the effect file a0211.fed (FileCode 0x3100085,
FUN_003fdf00 kind 6 with language != 0; FED id 0x834c0000) copied to stage_info.fed.
"""
import argparse
import json
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
from export_web_menu import Elf, read_layout, OPLEN_AT, OPLEN_N  # noqa: E402
import kel_class as K  # noqa: E402
from export_web_pause import LOCALE, kelstr_decode, kelstr_keys, kelstr_message  # noqa: E402

LANGUAGE = 2                                    # FUN_00242450 for the uk build (as export_web_pause.py)
KIND_BOX_AT = 0x4a8250                          # FUN_003fdf00: box kind = DAT_004a8250[stage-info kind] (7 bytes)
SCRIPTS = {0x2b: (0x47a220, 0x51cfd8), 0x1f: (0x47a0a0, 0x47a0a0), 0x1e: (0x47a028, 0x47a028)}   # (FUN_003e2760() == 0, != 0); 0x1e: stage-info 0, the stage title card (worker 0265)
ITEM_FX_AT = (0x47a528, 0x51d090)               # FUN_003c6f98: slot 1's effect id by event flag 55 (12)
LAYOUTS = {0x2b: (0x479610, 0x51f9a0), 0x1f: (0x479168, None), 0x1e: (0x479190, None)}   # FUN_003c6600 case 0x1a: script, override table (FUN_003c5d10's third argument; kind 0x1f passes 0)
# FUN_003c6600 case 0x1a, kind 0x1e (worker 0265): widget 4's vt+0xcc FUN_003d71b8 -> FUN_003d03a0(id | 0x80000000) = FUN_003fd578(DAT_0047a340[+0x1028]),
# +0x1028 = stat 0xe (FUN_003c54f8), for stat < 0x11 and an id != -1
TITLES_AT, TITLES_N = 0x47a340, 0x11
OBJECTIVES_AT, OBJECTIVES_N = 0x47a388, 0x28     # FUN_003c6600 case 0x1a, kind 0x1f: DAT_0047a388[stat 0x32], kelstr ids (FUN_003fd578)
COLOURS_AT, CODES_AT, INLINE_AT, IMAGES_AT = 0x47a7c0, 0x47abb0, 0x47a990, 0x47bfc0
MSG_FILE = 'noPath/0c0641ca.bin'                # ev0100's message file: the one the game had loaded (save RAM equal)
MSG_KEYS = ['MES_ITEM_%02d' % i for i in range(1, 12)]
FED_FILE = 'data/effect/anything/a0200/a0211/fer/a0211.fed'   # FileCode 0x3100085 (FILELIST)
FED_ID = 0x834c0000
# FUN_003a6520's first key: built by lui / ori / dsll in its prologue; read from the ELF (none kept here).
MSG_KEY_INSNS = [(0x3a6524, 0x0d, 0, 4, 'imm'), (0x3a6528, 0x00, 0, 4, 'sa'), (0x3a652c, 0x0d, 4, 4, 'imm'),
                 (0x3a6530, 0x00, 0, 4, 'sa'), (0x3a6534, 0x0d, 4, 4, 'imm'), (0x3a6538, 0x00, 0, 4, 'sa'),
                 (0x3a653c, 0x0d, 4, 4, 'imm')]


def steps(elf, at):
    """Step records from `at`: 1 + (mode-1 commands) sections, each ending at an op -1 step."""
    out, ends, need = [], 0, 1
    for i in range(64):
        t, life, op, arg, x, y = struct.unpack('<Iib3xihh', elf.read(at + 0x14 * i, 0x14))
        out.append([t, life, op, arg, x, y])
        if op in (-19, -22):
            need += 1
        if op == -1:
            ends += 1
            if ends == need:
                return out
    raise ValueError('step table %#x: no end' % at)


def msg_key(elf):
    k = 0
    for addr, op, rs, rt, field in MSG_KEY_INSNS:
        w = elf.u32(addr)
        if w >> 26 != op or (op and (w >> 21) & 31 != rs) or (w >> 16) & 31 != rt:
            raise ValueError('FUN_003a6520: unexpected instruction %#010x at %#x' % (w, addr))
        if field == 'imm':
            k |= w & 0xffff
        else:
            if w & 63 not in (0x38, 0x3c):      # dsll / dsll32
                raise ValueError('FUN_003a6520: not a dsll at %#x' % addr)
            k = (k << (((w >> 6) & 31) + (32 if w & 63 == 0x3c else 0))) & ((1 << 64) - 1)
    return k


def name_hash(s):
    """FUN_003a6628: bytes XORed into a word at shift 8 x (i & 3), at most 23 bytes."""
    h = 0
    for i, c in enumerate(s[:23]):
        h ^= (c << (8 * (i & 3))) & 0xffffffff
    return h


def messages(path, elfpath, elf, keys):
    """FUN_003a6520 (decrypt: header with the fixed key, the rest with the header's first word) + FUN_003a6698
    (zlib when byte +0xb != 0; FUN_003a6390: binary search on the hash over (hash, name, text) records, count +8)."""
    C = K.cipher_consts(elfpath)
    f = open(path, 'rb').read()
    if len(f) & 7:
        raise ValueError('%s: length not a multiple of 8' % path)
    h, ok = K.cipher(f[:0x20], msg_key(elf), C)
    n = len(f) - struct.unpack_from('<I', h, 0xc)[0] - 0x20
    body, ok2 = K.cipher(f[0x20:0x20 + n], struct.unpack_from('<Q', h, 0)[0], C)
    if not (ok and ok2):
        raise ValueError('%s: checksum fails' % path)
    raw = zlib.decompress(body) if h[0xb] else body
    count = struct.unpack_from('<h', h, 8)[0]
    recs = [struct.unpack_from('<III', raw, 12 * i) for i in range(count)]
    cs = lambda o: raw[o - 0x20:raw.index(b'\0', o - 0x20)]
    out = {}
    for key in keys:
        hk = name_hash(key.encode())
        lo, hi, hit = 0, count - 1, None
        while lo <= hi:                         # FUN_003a6390
            mid = (lo + hi) >> 1
            if hk < recs[mid][0]:
                hi = mid - 1
            elif hk > recs[mid][0]:
                lo = mid + 1
            else:
                hit = mid
                break
        if hit is None:                         # FUN_003a6698 returns 0: FUN_0039e8e8 copies nothing
            out[key] = None
            continue
        while hit > 0 and recs[hit - 1][0] == hk:
            hit -= 1
        while cs(recs[hit][1]) != key.encode():     # same hash: the name decides (LAB_003a6428)
            hit += 1
            if hit >= count or recs[hit][0] != hk:
                raise ValueError('%s: no %s' % (path, key))
        out[key] = cs(recs[hit][2]).hex()
    return out


def dump_reference(path, rect=(14, 104, 420, 400)):
    """The open box's draws in the last full frame of a GS dump (test_stage_info.mjs compares them): the font (TBP 0,
    PSMT4HH) and menu page 2 (TBP 0x2a4c) sprites inside widget 0x35's rect (drawable px, a 6 px margin), in order, as
    1/16 drawable units (XYOFFSET removed), UV / RGBA per vertex, TEX0 / TEX1. Game-derived: gitignored data/."""
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
    x0, x1, y0, y1 = rect[0] * 16, rect[2] * 16, rect[1] * 16, rect[3] * 16
    out = []
    for d in g.draws[vs[-2]:vs[-1]]:
        if not d['verts'] or not d['tme'] or d['ptype'] != 6:   # sprites (the frame's last draw is a flat strip here)
            continue
        t0 = d['tex0']
        tbp, psm = t0 & 0x3fff, (t0 >> 20) & 0x3f
        if not ((tbp == 0 and psm == 0x2c) or tbp == 0x2a4c):
            continue
        xo = d['xyoffset']
        ox, oy = xo & 0xffff, (xo >> 32) & 0xffff
        v = [{'x': p['x'] - ox, 'y': p['y'] - oy, 'u': p['u'], 'v': p['vv'], 'c': [p['r'], p['g'], p['b'], p['a']]}
             for p in d['verts']]
        if not all(x0 <= q['x'] <= x1 and y0 <= q['y'] <= y1 for q in v):
            continue
        out.append({'prim': d['ptype'], 'tbp': tbp, 'cbp': (t0 >> 37) & 0x3fff, 'psm': psm,
                    'tex1': d['extra'].get(0x14, 0), 'v': v})
    return {'source': os.path.basename(path), 'draws': out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', default=os.path.join(ROOT, 'elf/SLES_541.85'))
    ap.add_argument('--disc', default=os.path.join(ROOT, 'extract/_KEL'))
    ap.add_argument('-o', default=os.path.join(ROOT, 'native/web/data/stage_info.json'))
    ap.add_argument('--dump', help='GS dump (.gs, unpacked) of the open MES_ITEM_07 box: also write stage_info_ref.json')
    ap.add_argument('--dump-objective', help='GS dump (.gs, unpacked) of the open objective box: also write stage_info_k1_ref.json (worker 0258)')
    a = ap.parse_args()
    elf = Elf(open(a.elf, 'rb').read())
    oplen = list(elf.read(OPLEN_AT, OPLEN_N))
    pal = 1 if LANGUAGE != 0 else 0             # FUN_003e2760: language != 0 and FUN_003d4030() == 0 (taken as 0)
    doc = {'source': 'export_web_stageinfo.py (worker 0220)', 'language': LANGUAGE,
           'kinds': list(elf.read(KIND_BOX_AT, 7)),
           'scripts': {str(k): steps(elf, v[pal]) for k, v in SCRIPTS.items()},
           'itemFx': list(struct.unpack('<12i', elf.read(ITEM_FX_AT[pal], 48))),
           'layouts': {}, 'overrides': {},
           'colours': list(struct.unpack('<16I', elf.read(COLOURS_AT, 64))),
           'codes': [list(elf.read(CODES_AT + 3 * i, 3)) for i in range(13)],
           'inline': [], 'fed': 'stage_info.fed', 'fedId': FED_ID}
    for k, (lay, tab) in LAYOUTS.items():
        doc['layouts'][str(k)] = read_layout(elf, lay, oplen).hex()
        ov = elf.u32(tab + 4 * LANGUAGE) if pal and tab else 0     # FUN_003ca488: param_6[language] when FUN_003e2760()
        b, q, n = read_layout(elf, lay, oplen), 0, 0
        while b[q] != 0xff:                     # one override rect per op 0x0e (FUN_003ca488)
            n += b[q] == 0x0e
            q += oplen[b[q]]
        doc['overrides'][str(k)] = list(struct.unpack('<%dh' % (4 * n), elf.read(ov, 8 * n))) if ov else None
    i = 0
    while elf.u32(INLINE_AT + 12 * i + 4):      # FUN_003d1c90 -> FUN_003cb300 per (name, image id, colour)
        p, img, col = struct.unpack('<3I', elf.read(INLINE_AT + 12 * i, 12))
        sp = elf.u32(IMAGES_AT + 16 * (img & 0xffff))
        u, v, w, h = struct.unpack('<4h', elf.read(sp, 8)) if sp else (0, 0, 0, 0)
        page = elf.read(IMAGES_AT + 16 * (img & 0xffff) + 4, 1)[0] + 6   # FUN_003cb2e0
        doc['inline'].append({'name': elf.read(p, 2).decode('latin-1'), 'page': page, 'u': u, 'v': v, 'w': w, 'h': h,
                              'col': col})
        i += 1
    doc['messages'] = messages(os.path.join(a.disc, MSG_FILE), a.elf, elf, MSG_KEYS)
    kelstr = kelstr_decode(open(os.path.join(a.disc, 'data/etc/locale', LOCALE, 'kelstr.bin'), 'rb').read(), kelstr_keys(elf))
    doc['objectives'] = [kelstr_message(kelstr, elf.u32(OBJECTIVES_AT + 4 * i)).hex() for i in range(OBJECTIVES_N)]
    doc['titles'] = [None if elf.u32(TITLES_AT + 4 * i) == 0xffffffff else kelstr_message(kelstr, elf.u32(TITLES_AT + 4 * i)).hex() for i in range(TITLES_N)]
    fed = open(os.path.join(a.disc, FED_FILE), 'rb').read()
    if fed[:4] != b'FED\x08' or struct.unpack_from('<I', fed, 4)[0] != FED_ID:
        raise SystemExit('%s: not FED %#x' % (FED_FILE, FED_ID))
    os.makedirs(os.path.dirname(os.path.abspath(a.o)), exist_ok=True)
    with open(os.path.join(os.path.dirname(os.path.abspath(a.o)), 'stage_info.fed'), 'wb') as f:
        f.write(fed)
    with open(a.o, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    if a.dump:
        ref = dump_reference(a.dump)
        with open(os.path.join(os.path.dirname(os.path.abspath(a.o)), 'stage_info_ref.json'), 'w') as f:
            json.dump(ref, f, separators=(',', ':'))
        print('reference: %d draws from %s' % (len(ref['draws']), ref['source']))
    if a.dump_objective:
        ref = dump_reference(a.dump_objective, (14, 225, 420, 290))     # widget 2's rect (drawable px) with a margin
        with open(os.path.join(os.path.dirname(os.path.abspath(a.o)), 'stage_info_k1_ref.json'), 'w') as f:
            json.dump(ref, f, separators=(',', ':'))
        print('objective reference: %d draws from %s' % (len(ref['draws']), ref['source']))
    print('stage info: kinds %s, %d / %d steps, %d messages, %d inline images -> %s' % (
        doc['kinds'], len(doc['scripts']['43']), len(doc['scripts']['31']), sum(1 for v in doc['messages'].values() if v), len(doc['inline']), a.o))


if __name__ == '__main__':
    main()
