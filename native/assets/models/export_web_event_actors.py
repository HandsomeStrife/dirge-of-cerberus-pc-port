#!/usr/bin/env python3
"""export_web_event_actors.py -- the opening event's actors (models + event motion files) -> native/web/data/event/actors.

Worker 0218 (notes/event-vm-research.md "Event actors"). Reads the user's disc files at run time and writes gitignored
files only; nothing from the game is stored in the repo.

  python3 -I export_web_event_actors.py --event native/web/data/event/ev0100_scr001.json -o native/web/data/event/actors

What the game does (decoded):
  KerberosActor.load_l(name, id, f) (FUN_0039e2f0 -> FUN_00379c68) loads character `name` (its 0x07 container, as the
  enemies: export_web_enemy.file_id) into event actor `id` (64 slots of 0x200 at event +0x1800, FUN_00376308).
  loadmotion_l(id, n) (FUN_003a13a8 -> FUN_0037b368, command 0x12 -> FUN_00382220) loads the event motion file
  FUN_00250898(n, event) = 0x0c000400 + event x 0x1000 + n for that actor; setmotion*_l name a clip, looked up by name
  (FUN_005a7390) in the actor's motion player.
What is exported:
  - per model named by a string constant of the script class (a 0x07 container on the disc): MODEL.glb / MODEL.json
    (export_web_enemy.export, the enemies' pipeline, variant 0);
  - per (model, motion file n): MODEL_mNN_local.bin, the local-pose pack (export_web_vincent.local_pose) of the clips of
    file n that the script names, with bone 1's root motion KEPT (the event's motion player draws the actor at its
    actor matrix with the clip's bone 1; T: worker 0205's hand-off = origin x bone 1 of the clip's last frame).
  Which files: FILES, scr001's loadmotion_l arguments (the class also names clips of other branches' files). Which pairs: those whose every clip walks
  the model's bone count exactly to its segment ends (the track layout of FUN_005aefd0 / FUN_005af618: 3 tracks per
  bone). That is only a size filter: the page applies the game's own rule at run time (the actor's loadmotion files,
  then the clip by name), and warns when a pack it needs was not exported.
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anim_eval as A                        # noqa: E402
import anim_rot as AR                        # noqa: E402
import export_web_enemy as E                 # noqa: E402
import export_web_vincent as V              # noqa: E402
from skd_skeleton import load_skeleton      # noqa: E402

EVENT = 100                                  # ev0100 (the class file 0x0c064001; export_web_event.py)
MOT_BASE = 0x0C000400 + EVENT * 0x1000       # FUN_00250898(n, event)
# p000 is the page's own Vincent (play.js): his event actor is left out on the page (warned there)
SKIP = {'p000'}
# scr001's loadmotion_l files (n), but p000's 0xfe: the class also names clips of other branches' files. T: the page
# VM's run of scr001 (test_event_vm 'loadmotion files' checks every loadmotion_l argument is here or p000's)
FILES = (0x01, 0x02, 0x04, 0x05, 0x1d, 0x22, 0xc6)
# scr001's load_l models (the class names other branches' models too; same test checks the VM run's load_l names)
MODELS = ('e027', 'e048', 'e063', 'g000', 'g013', 'n013', 'p005', 'p014', 'w003')


def mod_entries(buf):
    """(name, payload offset, next entry offset) of each MOD clip of a motion container."""
    offs = sorted(A._u32(buf, 0x14 + 4 * i) for i in range(A._u16(buf, 0x10))) + [len(buf)]
    out = []
    for i, o in enumerate(offs[:-1]):
        if buf[o + 8:o + 11] == b'mod' and buf[o + 0x10:o + 0x14] == b'MOD\x00':
            out.append((buf[o:o + 8].split(b'\0')[0].decode('latin-1'), o + 0x10, offs[i + 1]))
    return out


def fits(buf, P, end, bc):
    """True when bc bones' tracks (P1, P2, Q per bone) end each segment within its 16-byte padding."""
    nseg = A._u32(buf, P + 0x10)
    ends = [A._seg_ptr(buf, P, s) for s in range(1, nseg)] + [end]
    for s in range(nseg):
        p = A._seg_ptr(buf, P, s)
        try:
            for _b in range(bc):
                p = AR.read_vec_keys(buf, p)[0]; p = AR.read_vec_keys(buf, p)[0]; p = AR.read_keys(buf, p)[0]
        except Exception:                    # ran off the file: another skeleton
            return False
        if not (ends[s] - 16 < p <= ends[s]):
            return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--event', required=True, help='data/event/ev0100_scr001.json (export_web_event.py)')
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    V.check_ignored(out); os.makedirs(out, exist_ok=True)
    ev = json.load(open(a.event))
    script = next(c for n, c in ev['classes'].items() if not n.startswith('fake/'))
    strs = {e[1] for e in script['cp'] if e and e[0] == 'str'}
    listed = E.LISTED
    need = lambda f: os.path.basename(f) in listed or sys.exit('%s: not in tools/byo/disc.py INPUTS' % os.path.basename(f))
    # the event's motion files that hold a clip the script names
    files = {}
    for n in FILES:
        f = E.NOPATH + '%08x.bin' % (MOT_BASE + n)
        if not os.path.exists(f):
            continue
        buf = open(f, 'rb').read()
        ents = [x for x in mod_entries(buf) if x[0] in strs]
        if ents:
            need(f)
            files[n] = (f, buf, mod_entries(buf))
    models = [m for m in MODELS if m in strs]
    index = dict(source='ev%04d: models named by the script class, event motion files 0x%08x + n; '
                 'export_web_event_actors.py' % (EVENT, MOT_BASE), event=EVENT, models={})
    for m in models:
        if m in SKIP:
            print('%s: skipped (the page\'s own body)' % m)
            continue
        need(E.paths(m)['cont']); need(E.paths(m)['tex'])
        try:
            E.export(m, out, [])
        except SystemExit as e:
            print('%s: not exported (%s)' % (m, e))
            continue
        sk = load_skeleton(E.paths(m)['cont'], trans_scale=1.0)
        bc = sk['bone_count']
        packs = {}
        for n, (f, buf, ents) in sorted(files.items()):
            if not ents or not all(fits(buf, P, end, bc) for _nm, P, end in ents):
                continue
            clips = {nm: dict(cont=f, nf=AR.clip_frames(buf, P), zero_y=False) for nm, P, _e in ents if nm in strs}
            if not clips:
                continue
            name = '%s_m%02x_local.bin' % (m, n)
            lp = V.local_pose(sk, list(sk['parent']), clips, out, name, in_place=False)
            lp['clipFrames'] = {c: d['nf'] for c, d in clips.items()}
            lp['container'] = os.path.basename(f)
            packs['%d' % n] = lp
        # marker.mkd (FUN_0030bef8 -> the socket of an attached actor, FUN_005ab8f0 / FUN_005ad508): [bone, x, y, z]
        import export_cerberus as EC
        try:
            mk = [[int(b)] + [float(v) for v in xyz] for xyz, b in EC.markers(open(E.paths(m)['cont'], 'rb').read())]
        except (ValueError, AssertionError):  # no marker.mkd / not the mk2 layout: no sockets (the page warns)
            mk = []
        index['models'][m] = dict(glb=m + '.glb', side=m + '.json', bones=bc, parent=[int(x) for x in sk['parent']],
                                  markers=mk, packs=packs)
        print('%s: %d bones, packs %s' % (m, bc, ' '.join('%02x(%s)' % (int(n), ','.join(p['clipFrames']))
                                                            for n, p in packs.items())))
    json.dump(index, open(os.path.join(out, 'actors.json'), 'w'), indent=1)
    print('wrote %s/actors.json: %d models' % (a.out, len(index['models'])))


if __name__ == '__main__':
    main()
