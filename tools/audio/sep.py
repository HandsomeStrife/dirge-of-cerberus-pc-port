#!/usr/bin/env python3
"""sep.py -- parse and disassemble Dirge of Cerberus SE programs ("SeSep" blocks).

Run with python3 -I. Reads game files; writes nothing (print only).

  python3 -I tools/audio/sep.py list  <sep.bin>            ids, bank, tracks
  python3 -I tools/audio/sep.py dis   <sep.bin> <id> ...   disassemble programs
  python3 -I tools/audio/sep.py check <sep.bin> ...        every track must end on its length

Formats (decoded from the code, see notes/audio-research.md):
- SE block (zone file 06zz0005 = data/zone/zNNN/sound/sep.bin): u16 count, u16 index[count]
  (sorted by SE id), entry k at block + index[k]*16. Binary search FUN_003e7ed8.
- Entry: "SeSep" (5 bytes, checked by FUN_0041a190 / FUN_004479e8), +8 u32 SE id, +0xc u32 size
  (bit 31 masked off by FUN_0041a190), +0x10 program.
- Program (iopsound.irx FUN_000082d0): b0 & 0x7f track count, b1..b2 u16 wave bank (wave%4.4u.wd),
  b3 priority, b4 flags (bit 3: volume forced to 0x7f; & 0x27 kept), then count x u16 track
  length table; tracks follow the table. A table entry with bit 0x4000 is a skip, not a track:
  it moves the track pointer by (value & 0x7fff) and lowers the count.
- Track: MIDI-like stream: VLQ delta (FUN_00006c34), opcode byte (& 0x7f indexes the handler
  table at irx 0x1acf0), operands; the next VLQ delta follows each event.
"""
import struct
import sys

# Operand layout per opcode, from the handler table at irx 0x1acf0 (handler address in the comment).
# 'b' = one byte, 'v' = VLQ (FUN_00006c34), '' = none. END = track end (FUN_000034a0).
END = 'END'
OPS = {
    0x00: (END, 'end'),                 # 34a0 (returns to a pushed call if +0x28 set)
    0x01: ('', 'mark'),                 # 3688
    0x03: ('', 'stop_flag'),            # 39a0
    0x04: ('', 'loop_begin'),           # 39b4 push (4 levels)
    0x05: ('b', 'loop_end_n'),          # 3a00 count (0 = 256)
    0x06: ('', 'loop_end'),             # 3a90 jump back, endless
    0x07: ('b', 'cue'),                 # 3ac4
    0x08: ('b', 'tempo'),               # 3b4c seq+0x358 = b << 12
    0x09: ('bb', 'tempo_slide'),        # 3b74
    0x0a: ('b', 'tempo_rel'),           # 3bec signed
    0x0b: ('bb', 'tempo_rel_slide'),    # 3c24
    0x0c: ('bb', 'time_sig'),           # 3c9c
    0x0d: ('b', 'pitch_table'),         # 3d14
    0x0e: ('b', 'skip1'),               # 3da0
    0x10: ('', 'note_on'),              # 3db4 previous key + velocity
    0x11: ('bb', 'note_on_kv'),         # 3df4 key -> +0x2c, velocity -> +0x2d
    0x12: ('b', 'note_on_k'),           # 3e58
    0x13: ('b', 'note_on_v'),           # 3eac
    0x18: ('', 'note_off'),             # 3f00
    0x19: ('bb', 'note_off_k_'),        # 3f20 (second byte skipped)
    0x1a: ('b', 'note_off_k'),          # 3f54
    0x1b: ('b', 'note_off_'),           # 3f88
    0x1e: ('bb', 'program16'),          # 3fb4 u16 instrument index into the WD (+0x20 table)
    0x20: ('b', 'program'),             # 4044 instrument index
    0x21: ('bb', 'bank_program'),       # 40c8 loaded-bank slot, instrument
    0x22: ('b', 'volume'),              # 4150 s8 * 0x80000 (+0x7f000 if > 0) -> trk[0xc]
    0x23: ('vb', 'volume_slide'),       # 41a0
    0x24: ('b', 'expression'),          # 4210 same scale -> trk[0xf]
    0x25: ('vb', 'expression_slide'),   # 4260
    0x26: ('b', 'pan'),                 # 42d0 u8 << 12 -> trk[0x12]
    0x27: ('vb', 'pan_slide'),          # 4374
    0x28: ('v', 'set_168'),             # 446c
    0x29: ('', 'clr_168'),              # 4498
    0x2a: ('', 'flag_on_80000'),        # 44a8
    0x2b: ('', 'flag_off_80000'),       # 44c8
    0x2c: ('vb', 'pitch_slide'),        # 44e0 s8 << 8 over v ticks -> trk[0x59]
    0x2d: ('b', 'flag_200000'),         # 459c
    0x2e: ('', 'flag_on_200000'),       # 45e0
    0x2f: ('', 'flag_off_200000'),      # 45f4
    0x30: ('', 'adsr_reset'),           # 460c instrument ADSR back to SPU regs 0x300 / 0x400
    0x31: ('b', 'adsr_ar'),             # 46b0 ADSR1 bits 8..14
    0x32: ('b', 'adsr_32'), 0x33: ('b', 'adsr_33'), 0x34: ('b', 'adsr_34'), 0x35: ('b', 'adsr_35'),
    0x36: ('b', 'adsr_36'), 0x37: ('b', 'adsr_37'), 0x38: ('b', 'adsr_38'),
    0x39: ('bb', 'adsr_39'),
    0x3c: ('b', 'op3c'), 0x3d: ('b', 'op3d'), 0x3e: ('b', 'op3e'), 0x3f: ('b', 'op3f'),
    0x40: ('bbb', 'lfo40'), 0x41: ('', 'lfo41'), 0x42: ('b', 'lfo42'), 0x43: ('vb', 'lfo43'),
    0x44: ('b', 'lfo44'), 0x45: ('vb', 'lfo45'), 0x46: ('b', 'lfo46'), 0x47: ('bb', 'lfo47'),
    0x48: ('bbb', 'lfo48'), 0x49: ('', 'lfo49'), 0x4a: ('b', 'lfo4a'), 0x4b: ('vb', 'lfo4b'),
    0x4c: ('b', 'lfo4c'), 0x4d: ('vb', 'lfo4d'), 0x4e: ('b', 'lfo4e'), 0x4f: ('bb', 'lfo4f'),
    0x50: ('bbb', 'lfo50'), 0x51: ('', 'lfo51'), 0x52: ('b', 'lfo52'), 0x53: ('vb', 'lfo53'),
    0x54: ('b', 'lfo54'), 0x55: ('vb', 'lfo55'), 0x56: ('b', 'lfo56'),
    0x58: ('b', 'op58'), 0x59: ('b', 'op59'), 0x5a: ('b', 'op5a'), 0x5b: ('b', 'op5b'),
    0x5c: ('bb', 'op5c'), 0x5d: ('b', 'op5d'),
    0x60: ('', 'op60'), 0x61: ('', 'op61'), 0x62: ('bb', 'op62'), 0x64: ('', 'op64'),
    0x65: ('', 'op65'), 0x68: ('', 'op68'), 0x6c: ('b', 'op6c'),
    0x70: ('b', 'op70'), 0x71: ('b', 'op71'), 0x72: ('b', 'op72'), 0x73: ('bbb', 'op73'),
    0x74: ('bbb', 'op74'), 0x75: ('bbb', 'op75'), 0x76: ('vb', 'op76'), 0x77: ('vb', 'op77'),
    0x78: ('bb', 'op78'), 0x79: ('b', 'op79'),
    0x7e: ('', 'nop'), 0x7f: ('', 'nop'),
}
for _k in (0x0f, 0x14, 0x15, 0x16, 0x17, 0x1c, 0x1d, 0x1f, 0x3a, 0x3b, 0x57, 0x5e, 0x5f, 0x63,
           0x66, 0x67, 0x6a, 0x6b, 0x6d, 0x6e, 0x6f, 0x7a, 0x7b):
    OPS[_k] = (END, 'end')              # these slots all point at 0x3478 -> FUN_000034a0


def vlq(b, p):
    """FUN_00006c34: 7 bits per byte, high bit = more."""
    v = b[p] & 0x7f
    while b[p] & 0x80:
        p += 1
        v = (v << 7) | (b[p] & 0x7f)
    return v, p + 1


def read_block(data):
    n = struct.unpack_from('<H', data, 0)[0]
    idx = struct.unpack_from('<%dH' % n, data, 2)
    out = {}
    for k in idx:
        o = k * 16
        if data[o:o + 5] != b'SeSep':
            raise ValueError('no SeSep at 0x%x' % o)
        sid, size = struct.unpack_from('<II', data, o + 8)
        out[sid] = data[o + 0x10:o + 0x10 + (size & 0x7fffffff)]
    return out


def tracks(prog):
    """FUN_000082d0's track walk. Returns (bank, prio, flags, [(start, length)])."""
    cnt = prog[0] & 0x7f
    bank = prog[1] | prog[2] << 8
    p = 5 + cnt * 2
    out = []
    for i in range(cnt):
        v = prog[5 + 2 * i] | prog[6 + 2 * i] << 8
        if v & 0x4000:
            p += v & 0x7fff
            continue
        out.append((p, v & 0x3fff))
        p += v & 0x3fff
    return bank, prog[3], prog[4], out


def disasm(prog, start, length):
    """Yield (offset, delta, op, name, operands). Raises on an unknown opcode."""
    p, end = start, start + length
    delta, p = vlq(prog, p)          # FUN_000082d0 reads the first delta (FUN_00006c34)
    while p < end:
        at = p
        op = prog[p] & 0x7f
        p += 1
        if op not in OPS:
            raise ValueError('unknown opcode 0x%02x at 0x%x' % (op, at))
        lay, name = OPS[op]
        args = []
        if lay == END:
            yield at, delta, op, name, args
            return
        for c in lay:
            if c == 'b':
                args.append(prog[p]); p += 1
            else:
                v, p = vlq(prog, p); args.append(v)
        yield at, delta, op, name, args
        if p >= end:
            return
        delta, p = vlq(prog, p)


def check(prog):
    bank, prio, flags, trs = tracks(prog)
    for s, n in trs:
        last = None
        for ev in disasm(prog, s, n):
            last = ev
        if last is None or last[2] != 0x00 and OPS[last[2]][0] != END:
            return False
    return True


def main(argv):
    cmd, path = argv[1], argv[2]
    blk = read_block(open(path, 'rb').read())
    if cmd == 'list':
        for sid, prog in blk.items():
            bank, prio, flags, trs = tracks(prog)
            print('%6d bank %4d prio %3d flags 0x%02x tracks %d' % (sid, bank, prio, flags, len(trs)))
    elif cmd == 'dis':
        for a in argv[3:]:
            prog = blk[int(a)]
            bank, prio, flags, trs = tracks(prog)
            print('SE %s: bank %d prio %d flags 0x%02x, %d tracks' % (a, bank, prio, flags, len(trs)))
            for t, (s, n) in enumerate(trs):
                print('  track %d @0x%x len %d' % (t, s, n))
                for at, d, op, name, args in disasm(prog, s, n):
                    print('    %04x +%-4d %02x %-16s %s' % (at, d, op, name, ' '.join(map(str, args))))
    elif cmd == 'check':
        bad = tot = 0
        from collections import Counter
        ops = Counter()
        for p in argv[2:]:
            for sid, prog in read_block(open(p, 'rb').read()).items():
                tot += 1
                try:
                    ok = check(prog)
                    for s, n in tracks(prog)[3]:
                        for ev in disasm(prog, s, n):
                            ops[ev[2]] += 1
                except (ValueError, IndexError) as e:
                    ok = False
                    if bad < 5:
                        print('bad', p, sid, e)
                if not ok:
                    bad += 1
        print('programs %d bad %d' % (tot, bad))
        print('opcodes used:', ' '.join('%02x:%d' % kv for kv in sorted(ops.items())))


if __name__ == '__main__':
    main(sys.argv)
