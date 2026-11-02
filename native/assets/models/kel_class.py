#!/usr/bin/env python3
"""kel_class.py -- read the game's event scripts (.class, magic "TTTT") from the user's disc files.

Worker 0205. Translated from the game's code (PAL SLES_541.85); no game data is stored here.

Decryption (the loader FUN_003a7700: magic 0x54545454 -> FUN_003a8320, then the magic becomes "SSSS"):
  FUN_003a8320(file, len): key = FUN_003a82c8(file) = the first 8 bytes read big-endian; FUN_0041c1d8(key, file + 8,
  file + 8, len - 8) -> FUN_0041bb38 (the key schedule: 32 u64 words, word0 from the key's two halves rotated and
  byte-mixed, word k = word k-1 x 5) and FUN_0041c0d8: FUN_0041c010 over the first len - 16 bytes, then over the last
  8 (a checksum block: its +4 word = the running sum of every block's bytes 0 and 4). Per 8-byte block
  (FUN_0041c010): FUN_0041bf78 (each byte: xor the previous cipher byte (the first: from the counter), then 8 rounds
  through the ELF's byte table minus a schedule byte), FUN_0041bf08 (the block as u64: minus a schedule word, xor a
  counter mix plus a constant, xor the word again, halves swapped), counter += 8.
  Every constant (immediates, shift amounts, the table's address and bytes) is read from the user's ELF at run time
  (cipher_consts: each instruction's opcode / registers checked first, as export_web_pause.py kelstr_keys); none is
  kept here.
  Checked: equal to the recompiled FUN_003a8320 (port/oracle) for all 268 "TTTT" files of the disc, checksums pass.

Class image (decrypted; pointers are file offsets, relocated by FUN_003a71c0):
  +0x08 u16 constant count, +0x0c interfaces, +0x0e fields, +0x10 methods; +0x18 constant table (16-byte cells:
  +0 tag (Java tags: 1 utf8 (+8 u16 length, +0xc text), 3 int, 4 float (+8), 7 class, 8 string (+8 utf8 index),
  9 / 10 / 11 refs (+8 class, +0xa name-and-type), 12 name-and-type (+8 name, +0xa descriptor)), +0x30 the method
  table (0x18 each: +0 access, +2 name, +4 descriptor, +6 attribute count, +0x14 attributes); an attribute (0x18):
  +0 name, +8 code length, +0xc code. The code is standard JVM bytecode (the VM FUN_003ad288, table 0x470b80).
"""
import struct

M64 = (1 << 64) - 1

# (name, address, opcode, rs, rt, field): the instruction that carries each cipher constant. field 'imm' = the 16-bit
# immediate, 'sa' = the shift amount (opcode 0 = SPECIAL: rs unused, rt = the shifted register).
CIPHER_INSNS = [
    ('k_add0',   0x41BB84, 0x09, 2, 2, 'imm'),    # FUN_0041bb38: addiu v0, v0, imm   (key byte 0 += imm)
    ('k_add',    0x41BB94, 0x09, 2, 2, 'imm'),    #               addiu v0, v0, imm   (byte i + imm)
    ('k_shl',    0x41BB9C, 0x00, 0, 3, 'sa'),     #               sll   v1, v1, sa    (byte i-1 << sa)
    ('k_xor',    0x41BBA4, 0x0E, 2, 2, 'imm'),    #               xori  v0, v0, imm
    ('k_mul',    0x41BBD4, 0x00, 0, 2, 'sa'),     #               dsll  v1, v0, sa    (word x (2^sa + 1))
    ('m_hi',     0x41BF0C, 0x0D, 0, 8, 'imm'),    # FUN_0041bf08: ori   t0, zero, imm
    ('m_lo',     0x41BF14, 0x0D, 8, 8, 'imm'),    #               ori   t0, t0, imm   (after dsll 16)
    ('m_s1',     0x41BF28, 0x00, 0, 9, 'sa'),     #               dsll  counter << sa
    ('m_s2',     0x41BF30, 0x00, 0, 9, 'sa'),
    ('m_s3',     0x41BF38, 0x00, 0, 9, 'sa'),
    ('t_hi',     0x41BF7C, 0x0F, 0, 3, 'imm'),    # FUN_0041bf78: lui   v1, imm       (the table's address)
    ('t_lo',     0x41BF84, 0x09, 3, 12, 'imm'),   #               addiu t4, v1, imm (signed)
    ('b_xor',    0x41BF90, 0x0E, 2, 2, 'imm'),    #               xori  v0, v0, imm   (counter >> 3 ^ imm)
]


def elf_bytes(elf_path, va, n):
    """n bytes at virtual address va of the ELF (its PT_LOAD segments)."""
    b = open(elf_path, 'rb').read()
    phoff = struct.unpack_from('<I', b, 0x1c)[0]
    phsz, phn = struct.unpack_from('<HH', b, 0x2a)
    for i in range(phn):
        t, off, vaddr, _pa, fsz, _msz = struct.unpack_from('<6I', b, phoff + i * phsz)
        if t == 1 and vaddr <= va and va + n <= vaddr + fsz:
            return b[off + va - vaddr: off + va - vaddr + n]
    raise ValueError('address %#x not in the ELF' % va)


def cipher_consts(elf_path):
    """The cipher's constants and byte table from the ELF's own instructions (refuses another binary)."""
    c = {}
    for name, addr, op, rs, rt, field in CIPHER_INSNS:
        w = int.from_bytes(elf_bytes(elf_path, addr, 4), 'little')
        if w >> 26 != op or (op and (w >> 21) & 31 != rs) or (w >> 16) & 31 != rt:
            raise ValueError('class cipher: unexpected instruction %#010x at %#x (not SLES_541.85?)' % (w, addr))
        c[name] = (w >> 6) & 31 if field == 'sa' else w & 0xffff
    tva = (c['t_hi'] << 16) + (c['t_lo'] - 0x10000 if c['t_lo'] & 0x8000 else c['t_lo'])
    c['table'] = elf_bytes(elf_path, tva, 256)
    c['mix'] = (c['m_hi'] << 16) | c['m_lo']
    return c


def decrypt(data, C):
    """FUN_003a8320 on a "TTTT" class file, C = cipher_consts(elf). Returns (bytes, checksum ok)."""
    table = C['table']
    d = bytearray(data)
    if d[:4] != b'TTTT':
        raise ValueError('not an encrypted class (magic %r)' % bytes(d[:4]))
    k = int.from_bytes(d[0:8], 'big')                                   # FUN_003a82c8
    hi, lo = k >> 32, k & 0xffffffff
    hi = ((hi >> 16) | (hi << 16)) & 0xffffffff
    lo = ((lo << 8) | (lo >> 24)) & 0xffffffff
    c = bytearray(struct.pack('<Q', (lo << 32) | hi))                    # FUN_0041bb38
    c[0] = (c[0] + C['k_add0']) & 255
    for i in range(1, 8):
        c[i] = ((c[i - 1] + c[i] + C['k_add']) ^ (c[i - 1] << C['k_shl']) ^ C['k_xor']) & 255
    sched = [struct.unpack('<Q', bytes(c))[0]]
    for _ in range(1, 32):
        sched.append((sched[-1] * ((1 << C['k_mul']) + 1)) & M64)
    sb = b''.join(struct.pack('<Q', x) for x in sched)
    st = {'cnt': 0, 'sum': 0}

    def block(p):                                                       # FUN_0041c010, one block
        cnt = st['cnt']
        u = ((cnt >> 3) ^ C['b_xor']) & 255                             # FUN_0041bf78
        row = ((cnt & 255) >> 3) * 8
        for i in range(8):
            b = d[p + i]
            x = u ^ b
            for j in range(8):
                x = (table[x] - sb[row + j]) & 255
            d[p + i] = x
            u = b
        K = sched[(cnt & 0xf8) >> 3]                                    # FUN_0041bf08
        v = struct.unpack_from('<Q', d, p)[0]
        v = ((v - K) & M64) ^ (((cnt | (cnt << C['m_s3']) | (cnt << C['m_s2']) | (cnt << C['m_s1'])) + C['mix']) & M64)
        v ^= K
        struct.pack_into('<Q', d, p, ((v << 32) | (v >> 32)) & M64)
        st['cnt'] = cnt + 8
        st['sum'] = (st['sum'] + d[p] + d[p + 4]) & 0xffffffff

    n = len(d) - 8                                                      # FUN_0041c0d8 on file + 8
    if n < 8 or n & 7:
        raise ValueError('bad class length %d' % len(d))
    for p in range(8, 8 + n - 8, 8):
        block(p)
    s0 = st['sum']
    block(8 + n - 8)
    return bytes(d), s0 == struct.unpack_from('<I', d, len(d) - 4)[0]


# JVM instruction lengths (standard opcodes; 0xaa / 0xab / 0xc4 handled in code())
_LEN = {op: 1 for op in range(256)}
for op in (0x10, 0x12, 0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xa9, 0xbc):
    _LEN[op] = 2
for op in [0x11, 0x13, 0x14, 0x84, 0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7] + list(range(0x99, 0xa9)) + list(range(0xb2, 0xb9)):
    _LEN[op] = 3
_LEN[0xc5] = 4
for op in (0xb9, 0xba, 0xc8, 0xc9):
    _LEN[op] = 5


class KClass:
    def __init__(self, d):
        self.d = d
        self.ncp = struct.unpack_from('<H', d, 0x08)[0]
        self.cp = struct.unpack_from('<I', d, 0x18)[0]

    def cell(self, i):
        o = self.cp + i * 16
        return self.d[o], self.d[o + 8:o + 16]

    def utf(self, i):
        t, v = self.cell(i)
        if t != 1:
            return None
        ln, off = struct.unpack_from('<HxxI', v, 0)
        return self.d[off:off + ln].decode('latin-1')

    def const(self, i):
        """('float', v) / ('int', v) / ('str', s) / ('ref', class, name, descriptor) / (tag,)."""
        t, v = self.cell(i)
        if t == 4:
            return ('float', struct.unpack_from('<f', v)[0])
        if t == 3:
            return ('int', struct.unpack_from('<i', v)[0])
        if t == 8:
            return ('str', self.utf(struct.unpack_from('<H', v)[0]))
        if t in (9, 10, 11):
            c, nt = struct.unpack_from('<HH', v)
            _tn, vn = self.cell(nt)
            a, b = struct.unpack_from('<HH', vn)
            return ('ref', c, self.utf(a), self.utf(b))
        return (t,)

    def methods(self):
        d = self.d
        mp, n = struct.unpack_from('<I', d, 0x30)[0], struct.unpack_from('<H', d, 0x10)[0]
        out = {}
        for i in range(n):
            _acc, ni, di, na = struct.unpack_from('<HHHH', d, mp + i * 0x18)
            ap = struct.unpack_from('<I', d, mp + i * 0x18 + 0x14)[0]
            for j in range(na):
                a = ap + j * 0x18
                if self.utf(struct.unpack_from('<H', d, a)[0]) == 'Code':
                    ln, cp = struct.unpack_from('<II', d, a + 8)
                    out[self.utf(ni)] = (self.utf(di), d[cp:cp + ln])
        return out

    @staticmethod
    def code(code):
        """[(pc, opcode, operand bytes)] in order."""
        out, pc = [], 0
        while pc < len(code):
            op = code[pc]
            if op in (0xaa, 0xab):                                      # table / lookup switch (aligned)
                q = (pc + 4) & ~3
                if op == 0xaa:
                    lo, hi = struct.unpack_from('>ii', code, q + 4)
                    n = q + 12 + 4 * (hi - lo + 1) - pc
                else:
                    np_ = struct.unpack_from('>i', code, q + 4)[0]
                    n = q + 8 + 8 * np_ - pc
            elif op == 0xc4:
                n = 6 if code[pc + 1] == 0x84 else 4
            else:
                n = _LEN[op]
            out.append((pc, op, code[pc + 1:pc + n]))
            pc += n
        return out
