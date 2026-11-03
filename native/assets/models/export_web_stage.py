#!/usr/bin/env python3
"""export_web_stage.py -- z128's stage controller classes (ev0100 scr000 `main` + the event classes it calls,
scr001..scr007) and the ELF's event library -> native/web/data/event/ev0100_stage.json (stage_controller.js).

Worker 0219 (notes/stage-controller.md). Reads the user's ELF and disc files at run time and writes a gitignored file;
no game data (and no decrypted script text) is stored in the repo.

  python3 -I export_web_stage.py --elf ELF --nopath extract/_KEL/noPath -o native/web/data/event/ev0100_stage.json

What the game loads (decoded): the stage program 06800000 (interpreter FUN_00401b90) runs command 0x11 for event 100
scripts 1..7 (FileCodes 0x0c064001..7) and command 0xa for event 100 (scr000, class "ev0100"), whose `main` is the
stage controller. Each class image goes through the event VM's loader FUN_003a7700 into the 32-slot registry
DAT_004ef498; an `invokestatic evNNNN.method` resolves there by class name (FUN_003a6bb8). The class reader and the
library are worker 0210's (export_web_event.py).
"""
import argparse, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kel_class as K                       # noqa: E402
import export_web_event as E                # noqa: E402

EVENT = 100
SCRIPTS = range(0, 8)                       # scr000 (main) + the stage program's 0x11 loads 1..7


def camera_loads(cls):
    """Constant-argument KerberosCamera.load(I)I calls (export_web_event.camera_loads, but a computed argument is
    reported, not fatal: the page warns at run time if such a file is asked for)."""
    out, comp = set(), 0
    for m in cls['methods']:
        prev = None
        for pc, op, arg in K.KClass.code(bytes.fromhex(m.get('code', ''))):
            if op == 0xb6:
                r = cls['cp'][struct.unpack('>H', arg)[0]]
                if r and r[1:] == ['fake/KerberosCamera', 'load', '(I)I']:
                    if prev is None:
                        comp += 1
                    else:
                        out.add(prev)
            prev = (op - 3 if 0x02 <= op <= 0x08 else struct.unpack('b', arg)[0] if op == 0x10
                    else struct.unpack('>h', arg)[0] if op == 0x11 else None)
    return out, comp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', required=True)
    ap.add_argument('--nopath', required=True)
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()
    consts = K.cipher_consts(a.elf)
    classes = {c['name']: c for c in E.library(a.elf, consts)}
    main_cls, cams, comp = None, {}, 0
    for s in SCRIPTS:
        cid = 0x0C000000 | (EVENT << 12) | s
        d, ok = K.decrypt(open(os.path.join(a.nopath, '%08x.bin' % cid), 'rb').read(), consts)
        if not ok:
            raise SystemExit('ev%04d/scr%03d: the class checksum fails (wrong ELF or file?)' % (EVENT, s))
        c = E.read_class(d)
        if c['name'] in classes:
            raise SystemExit('class name clash: %s' % c['name'])
        classes[c['name']] = c
        if s == 0:
            main_cls = c['name']
        ns, k = camera_loads(c)
        comp += k
        for n in ns:                        # camera files: FileCode 0x0c000200 + event x 0x1000 + n (export_web_event)
            fp = os.path.join(a.nopath, '%08x.bin' % (0x0C000200 + (EVENT << 12) + n))
            b = open(fp, 'rb').read()
            nch, _w1, w2 = struct.unpack_from('<iIi', b, 0)
            chans = []
            for o in struct.unpack_from('<%di' % nch, b, 12):
                typ, cnt = struct.unpack_from('<ii', b, o)
                chans.append(dict(type=typ, keys=[list(struct.unpack_from('<2f', b, o + 12 + 16 * q)) for q in range(cnt)]))
            cams[n] = dict(file='%08x' % (0x0C000200 + (EVENT << 12) + n), hdr8=w2, channels=chans)
    eps = struct.unpack('<f', K.elf_bytes(a.elf, 0x46BE00, 4))[0]
    # the event windows' texts (worker 0248, as export_web_event.py `messages`, worker 0239): the 'MES_' string constants
    # of the classes whose events the page plays (stage_controller.js PLAYS: rv_matiawase, class ev0101 = scr001), looked
    # up in ev0100's message file 0c0641ca (FUN_003a6698; misses -> null). Widen PLAYED_CLASSES with PLAYS (and run
    # tools/hygiene_text.py: the other events' texts hold runs that match ordinary words in the repo)
    import export_web_stageinfo as SI       # noqa: E402
    PLAYED_CLASSES = ('ev0101',)
    keys = sorted({x[1] for c in classes.values() if c['name'] in PLAYED_CLASSES for x in c['cp']
                   if isinstance(x, list) and len(x) == 2 and isinstance(x[1], str) and x[1].startswith('MES_')})
    msgs = SI.messages(os.path.join(a.nopath, '%08x.bin' % (0x0C0001CA + (EVENT << 12))), a.elf,
                       SI.Elf(open(a.elf, 'rb').read()), keys)
    out = dict(source='ev%04d scr000..scr%03d + the ELF event library; export_web_stage.py' % (EVENT, SCRIPTS[-1]),
               main=main_cls, splineEps=eps, cameraFiles=cams, classes=classes, messages=msgs)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(out, open(a.out, 'w'), separators=(',', ':'))
    print('wrote %s: main class %s, %d classes, %d camera files (%d computed loads)' % (
        a.out, main_cls, len(classes), len(cams), comp))


if __name__ == '__main__':
    main()
