#!/usr/bin/env python3
"""export_web_event.py -- the z128 opening event's script class + the event library classes -> native/web/data/event/.

Worker 0210 (notes/event-vm-research.md). Reads the user's ELF and disc files at run time and writes a gitignored file;
no game data (and no decrypted script text) is stored in the repo.

  python3 -I export_web_event.py --elf ELF --nopath extract/_KEL/noPath -o native/web/data/event/ev0100_scr001.json

What the game does (decoded):
  Event scripts are Java class files run by the game's JVM subset (dispatcher FUN_003ad288, handler table 0x470b80).
  A call `invoke* fake/KerberosX.name(desc)` is resolved by FUN_003a6bb8: the class by name in the 32-slot registry
  DAT_004ef498 (FUN_003a6928, hash FUN_003a8828), the method by (name, descriptor) (FUN_003a88b8). The `fake/*`
  classes are the event library: 15 encrypted class images compiled into the ELF at 0x383f20..0x39bfa0 (each one's
  byte length 0x10 before its "TTTT" magic, as FUN_003ff0c0 passes DAT_00383f10 for the first one), loaded at boot
  through the same loader FUN_003a7700. Their methods are bytecode, except the `*_l` / native ones: method +0x0c
  holds a C function (FUN_003aa7b8 / FUN_003aa998: +0x0c != 0 -> call it with the VM, which pops the arguments).
  The page's VM (native/web/event_vm.js) runs the bytecode of both; the native functions are translated there.
  The opening event of z128 is ev0100's class scr001 (FileCode 0x0c064001; its class name is "ev0101").

Class image layout (decrypted, relocated by FUN_003a71c0; offsets from the image start):
  +0x08 u16 constant count, +0x0e fields, +0x10 methods; +0x18 constant table (16-byte cells: +0 tag; utf8 +8 length,
  +0xc text; int / float +8; class +8 = the name's offset; string +8 = utf8 index; refs +8 class, +0xa name-and-type;
  name-and-type +8 name, +0xa descriptor); +0x1c this-class cell, +0x24 super-class cell (0 = none), +0x2c fields
  (0x18 each: +0 access, +2 name, +4 descriptor), +0x30 methods (0x18 each: +0 access, +2 name, +4 descriptor,
  +6 attribute count, +0x14 attributes); a Code attribute (0x18): +0 name, +2 max stack, +4 max locals (FUN_003a99f0
  reserves this many 8-byte local slots), +8 code length, +0xc code.
"""
import argparse, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kel_class as K                       # noqa: E402

EVENT, SCRIPT = 100, 1
CLASS_ID = 0x0C000000 | (EVENT << 12) | SCRIPT
LIB_LO, LIB_HI = 0x383F00, 0x3A0000          # the library images' range in the ELF (found by their "TTTT" magic)


def cstr(d, o):
    return d[o:d.index(b'\0', o)].decode('latin-1')


def read_class(d):
    """Decrypted class image -> {name, super, cp, fields, methods} (JSON-ready)."""
    u16 = lambda o: struct.unpack_from('<H', d, o)[0]
    u32 = lambda o: struct.unpack_from('<I', d, o)[0]
    ncp, cpo = u16(0x08), u32(0x18)
    cp = [None] * ncp
    for i in range(1, ncp):
        o = cpo + i * 16
        t = d[o]
        if t == 1:
            cp[i] = ['utf', d[u32(o + 0xc):u32(o + 0xc) + u16(o + 8)].decode('latin-1')]
        elif t == 3:
            cp[i] = ['int', struct.unpack_from('<i', d, o + 8)[0]]
        elif t == 4:
            cp[i] = ['float', struct.unpack_from('<f', d, o + 8)[0]]
        elif t == 7:
            cp[i] = ['class', cstr(d, u32(o + 8))]
        elif t == 8:
            cp[i] = ['str', u16(o + 8)]
        elif t in (9, 10, 11):
            cp[i] = ['ref', u16(o + 8), u16(o + 0xa)]
        elif t == 12:
            cp[i] = ['nat', u16(o + 8), u16(o + 0xa)]
        elif t in (5, 6):
            cp[i] = ['wide']                    # long / double: the VM stubs every long / double op (0x3aa048 / 0x3aa050)
    utf = lambda i: cp[i][1]
    for i, c in enumerate(cp):                  # resolve strings and refs to names
        if c and c[0] == 'str':
            cp[i] = ['str', utf(c[1])]
    for i, c in enumerate(cp):
        if c and c[0] == 'ref':
            nt = cp[c[2]]
            cp[i] = ['ref', cp[c[1]][1], utf(nt[1]), utf(nt[2])]
    this = cstr(d, u32(u32(0x1c) + 8))
    sup = cstr(d, u32(u32(0x24) + 8)) if u32(0x24) else None
    fields = []
    for i in range(u16(0x0e)):
        e = u32(0x2c) + i * 0x18
        fields.append(dict(access=u16(e), name=utf(u16(e + 2)), desc=utf(u16(e + 4))))
    methods = []
    for i in range(u16(0x10)):
        e = u32(0x30) + i * 0x18
        m = dict(access=u16(e), name=utf(u16(e + 2)), desc=utf(u16(e + 4)))
        for j in range(u16(e + 6)):
            a = u32(e + 0x14) + j * 0x18
            if utf(u16(a)) == 'Code':
                m.update(maxLocals=u16(a + 4), code=d[u32(a + 0xc):u32(a + 0xc) + u32(a + 8)].hex())
        methods.append(m)
    return dict(name=this, super=sup, cp=[c if c and c[0] != 'utf' else None for c in cp], fields=fields,
                methods=methods)


def camera_loads(cls):
    """The camera file numbers the class loads: each `invokevirtual fake/KerberosCamera.load(I)I` with a constant
    argument right before it (iconst / bipush / sipush). Refuses a class with any other form (the file would be missed)."""
    out = set()
    for m in cls['methods']:
        code = bytes.fromhex(m.get('code', ''))
        prev = None
        for pc, op, arg in K.KClass.code(code):
            if op == 0xb6:
                r = cls['cp'][struct.unpack('>H', arg)[0]]
                if r and r[1:] == ['fake/KerberosCamera', 'load', '(I)I']:
                    if prev is None:
                        raise SystemExit('%s.%s pc %d: KerberosCamera.load with a computed argument' % (cls['name'], m['name'], pc))
                    out.add(prev)
            prev = (op - 3 if 0x02 <= op <= 0x08 else struct.unpack('b', arg)[0] if op == 0x10
                    else struct.unpack('>h', arg)[0] if op == 0x11 else None)
    return sorted(out)


def library(elf, consts):
    """The event library classes compiled into the ELF (each: u32 length at magic - 0x10, then the image)."""
    b = open(elf, 'rb').read()
    out = []
    va = LIB_LO
    blob = K.elf_bytes(elf, LIB_LO, LIB_HI - LIB_LO)
    i = 0
    while True:
        j = blob.find(b'TTTT', i)
        if j < 0:
            break
        n = struct.unpack_from('<I', blob, j - 0x10)[0]
        d, ok = K.decrypt(blob[j:j + n], consts)
        if not ok:
            raise SystemExit('library class at %#x: checksum fails' % (va + j))
        out.append(read_class(d))
        i = j + n
    del b
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', required=True)
    ap.add_argument('--nopath', required=True)
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()
    consts = K.cipher_consts(a.elf)
    libs = library(a.elf, consts)
    raw = open(os.path.join(a.nopath, '%08x.bin' % CLASS_ID), 'rb').read()
    d, ok = K.decrypt(raw, consts)
    if not ok:
        raise SystemExit('ev%04d/scr%03d: the class checksum fails (wrong ELF or file?)' % (EVENT, SCRIPT))
    scr = read_class(d)
    classes = {c['name']: c for c in libs}
    if scr['name'] in classes:
        raise SystemExit('class name clash: %s' % scr['name'])
    classes[scr['name']] = scr
    # the event's camera files (KerberosCamera.load_l -> command 8, FUN_003838b8: FileCode FUN_00250838(n, event) =
    # 0x0c000200 + event x 0x1000 + n; FUN_00374720 reads them): header +0 channel count, +8 must be 0, +0xc channel
    # offsets; a channel: +0 type (0-2 eye, 3-5 aim, 6-8 up point, 9 fov, 10 the VU0 form), +4 key count, then 16-byte
    # keys (+0 time, +4 value; FUN_00373908 uses those two)
    cams = {}
    for n in camera_loads(scr):
        fp = os.path.join(a.nopath, '%08x.bin' % (0x0C000200 + (EVENT << 12) + n))
        b = open(fp, 'rb').read()
        nch, _w1, w2 = struct.unpack_from('<iIi', b, 0)
        chans = []
        for o in struct.unpack_from('<%di' % nch, b, 12):
            typ, cnt = struct.unpack_from('<ii', b, o)
            chans.append(dict(type=typ, keys=[list(struct.unpack_from('<2f', b, o + 12 + 16 * k)) for k in range(cnt)]))
        cams[n] = dict(file='%08x' % (0x0C000200 + (EVENT << 12) + n), hdr8=w2, channels=chans)
    # DAT_0046be00: the spline's flat-segment threshold (FUN_002616f0 stores it, FUN_00261a90 compares |dv| with it)
    eps = struct.unpack('<f', K.elf_bytes(a.elf, 0x46BE00, 4))[0]
    out = dict(source='ev%04d/scr%03d (FileCode %08x) + the ELF event library; export_web_event.py' % (EVENT, SCRIPT, CLASS_ID),
               main=scr['name'], splineEps=eps, cameraFiles=cams, classes=classes)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(out, open(a.out, 'w'), separators=(',', ':'))
    print('wrote %s: script class %s, %d library classes (%s), camera files %s' % (
        a.out, scr['name'], len(libs), ' '.join(c['name'].split('/')[-1] for c in libs), ' '.join(sorted(v['file'] for v in cams.values()))))


if __name__ == '__main__':
    main()
