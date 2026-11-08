#!/usr/bin/env python3
"""extract.py -- Dirge of Cerberus sound effects -> native/web/data/audio/ (gitignored game data).

  python3 -I tools/audio/extract.py [--kel extract/_KEL] [--zone 128] [--out native/web/data/audio]
  python3 -I tools/audio/extract.py --wav <dir> --bank 0 --region <instrument> ...   raw region -> WAV

Writes (all game-derived; native/web/data/** is excluded by .gitignore):
  driver.json      tables read from data/sound/lib/iopsound.irx: semitone pitch (irx 0x1af7c, 12 x u32),
                   fine pitch (0x1afac, 256 x u32), pan law (0x1b55c, s16), random bytes (0x1b45c, 256)
  waveNNNN.bin     SPU-ADPCM sample area of data/sound2/waveNNNN.wd (what the IOP uploads to SPU RAM)
  waveNNNN.json    instruments -> regions (32-byte records, fields named in notes/audio-research.md)
  se_zNNN.json     sdb.bin names -> SE id, and the SE programs of the zone's sep.bin (hex)
  se_evNNN.json    the event SE block of event file group NNN (--event, default 100 = z128's ev0100): FileCode
                   0x0c000800 + NNN x 0x1000 (FUN_002508b0), loaded into SE block slot 1 over the zone's sep.bin by
                   loadSoundEffectEx_l(0, NNN, 0) (FUN_003825e8 -> FUN_003e78a8(mgr, 1, code, 0)); its names are rows of
                   the zone's sdb.bin (asj_041 .., asj_154 ..)
  se_res.json      the resident SE block data/sound2/resident.bin (FileCode 0x02810001, loaded at boot by
                   FUN_003e78a8 request 4) and the resident names data/etc/ressddb.bin (0x03100034, sdb slot 0:
                   FUN_00244db0 -> FUN_003eb7a8(0, ...)); "menu" = the menu sound names FUN_003e1d90 plays,
                   PTR_DAT_0047d5c8[id] read from the ELF (--elf; left out with a warning when there is none)

Formats are decoded from the game's code (EE FUN_003e8e18 / FUN_003e7ed8 / FUN_0041a190, IOP
iopsound.irx FUN_000082d0 / FUN_0000b578 / FUN_00001c5c / FUN_00001d0c / FUN_00001380 / FUN_000012b0).
"""
import argparse
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sep  # noqa: E402

# iopsound.irx is a relocatable IOP module whose sections sit at their own addresses from base 0.
IRX_SECTIONS = ((0x0, 0xB0, 0x19170), (0x19170, 0x19220, 0xF30), (0x1A0A0, 0x1A150, 0x1A70))


def irx_read(irx, va, n):
    for base, off, size in IRX_SECTIONS:
        if base <= va and va + n <= base + size:
            return irx[off + va - base:off + va - base + n]
    raise ValueError('irx va 0x%x not in a section' % va)


def driver_tables(irx):
    return {
        # FUN_000012b0: pitch = (SEMI[n % 12] >> (10 - octave)) * FINE[frac] >> 16
        'semitone': list(struct.unpack('<12I', irx_read(irx, 0x1AF7C, 48))),
        'fine': list(struct.unpack('<256I', irx_read(irx, 0x1AFAC, 1024))),
        # FUN_00001380: L = v * PAN[p] >> 8, R = v * PAN[p ^ 0x7f] >> 8 (s16 entries; p & 0xff)
        'pan': list(struct.unpack('<256h', irx_read(irx, 0x1B55C, 512))),
        # FUN_0000a870: random byte = RNG[counter++] (u8 counter)
        'rng': list(irx_read(irx, 0x1B45C, 256)),
        'source': 'data/sound/lib/iopsound.irx',
    }


def wd_parse(d):
    """FUN_0000b578: header 0x20 (+2 bank, +4 sample-area size, +8 instruments, +0xc regions,
    +0x10 SPU address filled in at load); instrument offset table padded to 4 entries; regions x 0x20;
    the sample area follows and is uploaded to SPU RAM."""
    if d[:2] != b'WD':
        raise ValueError('not a WD bank')
    size, ninst, nreg = struct.unpack_from('<III', d, 4)
    hdr = ((ninst + 3) & ~3) * 4 + nreg * 0x20 + 0x20
    offs = struct.unpack_from('<%dI' % ninst, d, 0x20)
    reg_lo, reg_hi = hdr - nreg * 0x20, hdr
    insts = []
    starts = sorted(set(offs))
    for o in offs:
        regs = []
        p = o
        nxt = next((s for s in starts if s > o), reg_hi)
        while reg_lo <= p < reg_hi:
            flags, start, loop, adsr, tune = struct.unpack_from('<IIIIi', d, p)
            key_hi, vel_hi, vol, pan, mode = d[p + 0x14], d[p + 0x15], d[p + 0x16], d[p + 0x17], d[p + 0x18]
            regs.append(dict(flags=flags, start=start, loop=loop, adsr=adsr, tune=tune,
                             keyHi=key_hi, velHi=vel_hi, vol=vol, pan=pan, mode=mode))
            p += 0x20
            if flags & 0x200 or p >= nxt:
                break
        insts.append(regs)
    return dict(size=size, header=hdr, instruments=insts), d[hdr:hdr + size]


def sdb_names(d):
    """sdb.bin: 24-byte rows. FUN_003e8e18 plays row +0x10 as an SE id unless +0xc bit 1 is set
    (then the row names an ATRAC stream, played by +8)."""
    out = {}
    for i in range(len(d) // 24):
        r = d[i * 24:i * 24 + 24]
        name = r[:8].split(b'\0')[0].decode('latin1')
        f0c, f10, f14 = struct.unpack_from('<III', r, 12)
        if f0c & 2:
            continue
        out[name] = dict(id=f10, flags=f0c, f14=f14)
    return out


MENU_NAMES, MENU_COUNT = 0x47D5C8, 34        # FUN_003e1d90: (&PTR_DAT_0047d5c8)[id] (ids 0..0x21; 0x22 is a stream)


def elf_menu_names(elf):
    """FUN_003e1d90's name table: id -> sdb name (None for a null / empty entry)."""
    phoff, = struct.unpack_from('<I', elf, 0x1c)
    phnum, = struct.unpack_from('<H', elf, 0x2c)
    segs = [struct.unpack_from('<8I', elf, phoff + 32 * i) for i in range(phnum)]

    def rd(va, n):
        for t, off, vaddr, _p, fsz, _m, _f, _a in segs:
            if t == 1 and vaddr <= va and va + n <= vaddr + fsz:
                return elf[off + va - vaddr:off + va - vaddr + n]
        raise ValueError('ELF va 0x%x not loaded' % va)
    out = []
    for i in range(MENU_COUNT):
        p, = struct.unpack('<I', rd(MENU_NAMES + 4 * i, 4))
        name = rd(p, 8).split(b'\0')[0].decode('latin1') if p else ''
        out.append(name or None)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kel', default='extract/_KEL')
    ap.add_argument('--zone', type=int, default=128)
    ap.add_argument('--out', default='native/web/data/audio')
    ap.add_argument('--elf', default='elf/SLES_541.85')
    ap.add_argument('--event', type=int, nargs='*', default=[100])
    ap.add_argument('--wav')
    ap.add_argument('--bank', type=int, default=0)
    ap.add_argument('--region', type=int, nargs='*', default=[])
    a = ap.parse_args()

    if a.wav:
        import adpcm
        info, data = wd_parse(open(os.path.join(a.kel, 'data/sound2/wave%04d.wd' % a.bank), 'rb').read())
        os.makedirs(a.wav, exist_ok=True)
        for k in a.region:
            r = info['instruments'][k][0]
            pcm, loop = adpcm.decode(data, r['start'])
            adpcm.write_wav(os.path.join(a.wav, 'wave%04d_%03d.wav' % (a.bank, k)), pcm, 44100)
            print('instrument %d: %d samples, loop %s' % (k, len(pcm), loop))
        return

    os.makedirs(a.out, exist_ok=True)
    irx = open(os.path.join(a.kel, 'data/sound/lib/iopsound.irx'), 'rb').read()
    json.dump(driver_tables(irx), open(os.path.join(a.out, 'driver.json'), 'w'))

    code = 0x06000000 | a.zone << 16          # FUN_0024a828: 06zz0005 sep.bin, 06zz0008 sdb.bin
    nopath = os.path.join(a.kel, 'noPath')
    blk = sep.read_block(open(os.path.join(nopath, '%08x.bin' % (code | 5)), 'rb').read())
    names = sdb_names(open(os.path.join(nopath, '%08x.bin' % (code | 8)), 'rb').read())
    banks = sorted({sep.tracks(p)[0] for p in blk.values()})
    sp = os.path.join(a.out, 'se_z%03d.json' % a.zone)
    se = dict(zone=a.zone, names=names, banks=banks, programs={str(k): v.hex() for k, v in blk.items()})
    if os.path.exists(sp) and 'bgm' in json.load(open(sp)):
        se['bgm'] = json.load(open(sp))['bgm']             # the BGM tracks tools/audio/bgm.py declared: keep them
    json.dump(se, open(sp, 'w'))
    print('zone %d: %d programs, %d names, banks %s' % (a.zone, len(blk), len(names), banks))
    # resident block + names (menu sounds; notes/audio-research.md "Menu sounds")
    rblk = sep.read_block(open(os.path.join(a.kel, 'data/sound2/resident.bin'), 'rb').read())
    rnames = sdb_names(open(os.path.join(a.kel, 'data/etc/ressddb.bin'), 'rb').read())
    rbanks = sorted({sep.tracks(p)[0] for p in rblk.values()})
    res = dict(names=rnames, banks=rbanks, programs={str(k): v.hex() for k, v in rblk.items()})
    if os.path.exists(a.elf):
        res['menu'] = elf_menu_names(open(a.elf, 'rb').read())
    else:
        print('  no ELF %s: se_res.json without the menu sound names (no menu sounds on the page)' % a.elf)
    json.dump(res, open(os.path.join(a.out, 'se_res.json'), 'w'))
    print('resident: %d programs, %d names, banks %s, menu names %s' % (len(rblk), len(rnames), rbanks, 'menu' in res))
    # the event SE blocks (FUN_003825e8 case 0: FUN_002508b0(b) + c; every z128 event passes b = 100, c = 0)
    ebanks = set()
    for ev in a.event:
        ep = os.path.join(nopath, '%08x.bin' % (ev * 0x1000 + 0xc000800))
        if not os.path.exists(ep):
            print('  event %d: no %s (the events\' own SEs stay silent)' % (ev, ep))
            continue
        eblk = sep.read_block(open(ep, 'rb').read())
        eb = sorted({sep.tracks(p)[0] for p in eblk.values()})
        ebanks |= set(eb)
        json.dump(dict(event=ev, code=ev * 0x1000 + 0xc000800, banks=eb, programs={str(k): v.hex() for k, v in eblk.items()}),
                  open(os.path.join(a.out, 'se_ev%03d.json' % ev), 'w'))
        print('event %d: %d programs, banks %s' % (ev, len(eblk), eb))
    banks = sorted(set(banks) | set(rbanks) | ebanks)
    for b in banks:
        p = os.path.join(a.kel, 'data/sound2/wave%04d.wd' % b)
        if not os.path.exists(p):
            print('  bank %d: no %s' % (b, p))
            continue
        info, data = wd_parse(open(p, 'rb').read())
        open(os.path.join(a.out, 'wave%04d.bin' % b), 'wb').write(data)
        json.dump(dict(bank=b, instruments=info['instruments']), open(os.path.join(a.out, 'wave%04d.json' % b), 'w'))
        print('  bank %d: %d instruments, %d bytes of ADPCM' % (b, len(info['instruments']), len(data)))


if __name__ == '__main__':
    main()
