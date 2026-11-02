#!/usr/bin/env python3
"""export_web_checkpoint.py -- the opening cutscene's hand-off to play (z128) -> native/web/data/checkpoint.json.

Worker 0205 (notes/checkpoint-research.md "The opening cutscene's hand-off"). Reads the user's disc files at run time
and writes a gitignored file; nothing from the game is stored in the repo.

  python3 -I export_web_checkpoint.py --elf ELF --nopath extract/_KEL/noPath \
      --placements native/web/data/enemies/placements.json -o native/web/data/checkpoint.json

What the game does (decoded; T = PCSX2 traces w201_reload / w204_reload / w205_reload from the state saved at the
stage reload after Restart):
  The stage's opening event ev0100 runs its script class scr001 (FileCode 0x0c064001 = 0x0c000000 | 100 << 12 | 1;
  T: in RAM in the reload state). Its first_event() ends, per actor, with setpos / setdir / setmotionofbattle (a
  battle clip), then setbattlename (the event-actor tags) and set_battlemode.
  Each battle actor's body plays its battle clip; when it ends (FUN_00343de8: C+0x564 bit 0x10000000 and
  FUN_00346150() == 0) FUN_00344d68 places the actor (FUN_003157b0(status, 1), FUN_00558cc0). GUESS (matches T):
  the page composes the status matrix with FUN_003157b0's param-0 form, root (the setpos origin) x bone 1 of the clip's
  last frame (FUN_005ad9c0 -> FUN_005b29c0, bone y zeroed); the call that brings bone 1 in is not found. T: Vincent's
  start (record 10) and 41-43's moves (record 24) to the float.
This exporter decodes the class (kel_class.py), runs a linear pass over first_event for those calls, finds each
battle clip in the event's motion files (FileCodes 0x0c064400 + n, by the clip's name as setmotionofbattle passes it)
and evaluates the clip's last frame on the actor's skeleton (anim_rot, as the page's clips): bone 1's matrix.
The page (checkpoint.js handOff) does FUN_003157b0 / FUN_00558cc0 with these.
"""
import argparse, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kel_class as K                       # noqa: E402

# GUESS: the stage start's event is ev0100 / scr001 (T: that class's image at 0x9f2ec0 in the reload state; which class
# the stage program runs is not decoded)
EVENT, SCRIPT = 100, 1
CLASS_ID = 0x0C000000 | (EVENT << 12) | SCRIPT
EVM_BASE = 0x0C000000 | (EVENT << 12) | 0x400


def n_params(desc):
    """Parameter count of a JVM method descriptor."""
    s, i, n = desc[1:desc.index(')')], 0, 0
    while i < len(s):
        while s[i] == '[':
            i += 1
        i = s.index(';', i) + 1 if s[i] == 'L' else i + 1
        n += 1
    return n


def branch_into(edges, lo, pc):
    """Branch edges (from, to) that enter the span (lo, pc] from outside [lo, pc]."""
    return [(f, t) for f, t in edges if lo < t <= pc and not (lo <= f <= pc)]


def selftest():
    e = [(5, 20), (12, 18), (40, 15), (30, 50)]
    assert branch_into(e, 10, 30) == [(5, 20), (40, 15)], branch_into(e, 10, 30)
    assert branch_into([(12, 18), (30, 50)], 10, 30) == []
    print('selftest ok')


def handoff_calls(cls):
    """Linear pass over first_event(): per actor local, the setpos / setdir in force at its setmotionofbattle, its
    battle name and battle direction. Values are tracked on a small operand stack for the ops these calls use; any
    other op clears it (the hand-off section has no branches between a call's operands and the call)."""
    _desc, code = cls.methods()['first_event']
    ins = cls.code(code)
    # branch edges (if* / goto / goto_w): a jump from outside an actor's setpos..setmotionofbattle span into it would
    # make the straight-line reading wrong; such a class is refused below. GUESS: exception handlers are not followed.
    edges = []
    for pc, op, arg in ins:
        if 0x99 <= op <= 0xa7 or op in (0xc6, 0xc7):
            edges.append((pc, pc + struct.unpack('>h', arg)[0]))
        elif op == 0xc8:
            edges.append((pc, pc + struct.unpack('>i', arg)[0]))
    stack, pos, dirs, out, names, bdir, at = [], {}, {}, {}, {}, {}, {}
    for pc, op, arg in ins:
        if op == 0x19:                                                   # aload n
            stack.append(('local', arg[0]))
        elif 0x2a <= op <= 0x2d:
            stack.append(('local', op - 0x2a))
        elif op in (0x12, 0x13):                                         # ldc / ldc_w
            stack.append(cls.const(arg[0] if op == 0x12 else struct.unpack('>H', arg)[0]))
        elif op == 0x11:
            stack.append(('int', struct.unpack('>h', arg)[0]))
        elif op == 0x10:
            stack.append(('int', struct.unpack('>b', arg)[0]))
        elif 0x02 <= op <= 0x08:
            stack.append(('int', op - 3))
        elif 0x0b <= op <= 0x0d:
            stack.append(('float', float(op - 0x0b)))
        elif op == 0xbb:                                                 # new
            stack.append(('new',))
        elif op == 0x59:                                                 # dup
            stack.append(stack[-1] if stack else None)
        elif op in (0xb6, 0xb7, 0xb8):                                   # invoke
            ref = cls.const(struct.unpack('>H', arg)[0])
            _t, _c, name, desc = ref
            n = n_params(desc) + (0 if op == 0xb8 else 1)
            if len(stack) < n:
                stack = []
                continue
            args = stack[-n:]
            del stack[-n:]
            if name == '<init>' and desc == '(FFF)V' and args and all(a and a[0] == 'float' for a in args[1:]):
                if stack and stack[-1] == ('new',):
                    stack[-1] = ('vec', tuple(a[1] for a in args[1:]))
                continue
            if not args or not args[0] or args[0][0] != 'local':
                continue
            who = args[0][1]
            if name == 'setpos' and args[1] and args[1][0] == 'vec':
                pos[who] = args[1][1]; at.setdefault(who, {})['pos'] = pc
            elif name == 'setdir' and desc == '(I)V':
                dirs[who] = args[1][1]; at.setdefault(who, {})['dir'] = pc
            elif name == 'setmotionofbattle':
                lo = min(at.get(who, {}).get('pos', pc), at.get(who, {}).get('dir', pc))
                bad = branch_into(edges, lo, pc)
                if bad or who not in pos:
                    raise SystemExit('first_event: actor local %d: a branch enters its setpos..setmotionofbattle span (%s) or '
                                     'no setpos; the straight-line pass would be wrong' % (who, bad))
                out[who] = dict(clip=args[1][1], origin=list(pos[who]), dir=dirs.get(who), pc=pc)
            elif name == 'setbattlename':
                names[who] = args[1][1]
            elif name == 'setdirofbattle':
                bdir[who] = args[1][1]
            if not desc.endswith(')V'):
                stack = []                                               # a result we don't model
        else:
            stack = []
    res = {}
    for who, h in out.items():
        if who in names:
            res[names[who]] = dict(h, battleDir=bdir.get(who), local=who)
    return res


def find_clip(nopath, clip):
    """The event's motion file that holds `clip` (FileCode 0x0c064400 + n)."""
    import anim_rot as AR
    for n in range(0x100):
        f = os.path.join(nopath, '%08x.bin' % (EVM_BASE + n))
        if os.path.exists(f) and clip.encode() in open(f, 'rb').read():         # names fill 8 bytes, no NUL then
            try:
                AR.find_clip(f, clip)
                return f
            except ValueError:
                pass
    raise SystemExit('no event motion file holds clip %s' % clip)


def bone1_last(nopath, model, clip):
    """Bone 1's matrix at the clip's last frame, in the game's row layout (rows 0-2 = axes, row 3 = translation)."""
    import anim_rot as AR
    from skd_skeleton import load_skeleton
    if model == 'p000':
        import export_web_vincent as V
        cont = V.CONT
    else:
        import export_web_enemy as E
        cont = E.paths(model)['cont']
    sk = load_skeleton(cont, trans_scale=1.0)
    cf = find_clip(nopath, clip)
    cbuf, CP = AR.find_clip(cf, clip)
    nf = AR.clip_frames(cbuf, CP)
    W = AR.compose(sk, AR.decode_frame_trs(cbuf, CP, sk['bone_count'], nf - 1), root_motion=True)[1]
    rows = [[float(W[r][c]) for r in range(3)] for c in range(4)]       # column-vector numpy -> the game's rows
    return rows, nf, os.path.basename(cf)


def main():
    if sys.argv[1:] == ['--selftest']:
        return selftest()
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', required=True)
    ap.add_argument('--nopath', required=True)
    ap.add_argument('--placements', required=True)
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()
    consts = K.cipher_consts(a.elf)
    raw = open(os.path.join(a.nopath, '%08x.bin' % CLASS_ID), 'rb').read()
    d, ok = K.decrypt(raw, consts)
    if not ok:
        raise SystemExit('ev%04d/scr%03d: the class checksum fails (wrong ELF or file?)' % (EVENT, SCRIPT))
    cls = K.KClass(d)
    calls = handoff_calls(cls)
    pl = json.load(open(a.placements))
    tags = {r['tag']: r for r in pl['load_flag_records']}
    actors = {}
    for tag, h in sorted(calls.items()):
        r = tags.get(tag)
        if r is None:
            print('skip %s: no placement with that tag' % tag)
            continue
        rows, nf, cf = bone1_last(a.nopath, r['model'], h['clip'])
        actors[tag] = dict(rec=r['rec'], model=r['model'], origin=h['origin'], dir=h['dir'], battleDir=h['battleDir'],
                           clip=h['clip'], frames=nf, clipFile=cf, bone1=rows)
    out = dict(source='ev%04d/scr%03d (FileCode %08x) first_event + the battle clips\' last frames; export_web_checkpoint.py'
               % (EVENT, SCRIPT, CLASS_ID), actors=actors)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(out, open(a.out, 'w'), indent=1)
    print('wrote %s: %s' % (a.out, ', '.join('%s %s (%d f)' % (t, v['clip'], v['frames']) for t, v in actors.items())))


if __name__ == '__main__':
    main()
