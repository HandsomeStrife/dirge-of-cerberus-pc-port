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
# worker 0248: p000 (Vincent's own event actor) is exported too: rv_matiawase (the same class ev0101, run by the stage
# controller) loads it into a slot with motion files 0x0d / 0x7b
SKIP = set()
# scr001's loadmotion_l files (n); the class also names clips of other branches' files. T: the page VM's run of scr001
# (test_event_vm 'loadmotion files' checks every loadmotion_l argument is here). Worker 0248: 0x0d / 0x7b
# (rv_matiawase's loadmotion(13) / (123)) and 0xfe (the opening's p000, now exported)
FILES = (0x01, 0x02, 0x04, 0x05, 0x0d, 0x1d, 0x22, 0x7b, 0xc6, 0xfe)
# scr001's load_l models (the class names other branches' models too; same test checks the VM run's load_l names)
MODELS = ('e027', 'e048', 'e063', 'g000', 'g013', 'n013', 'p000', 'p005', 'p014', 'w003')


def texanims(model, out):
    """The model's texture animations (worker 0248): the container's `texanm` tad entry (0x646174), read by the MP
    set-up FUN_005a8850 and played per draw by FUN_005a9938 (FUN_005aa9e8 then FUN_005aa838; FUN_00414290 /
    FUN_00414568 build the GS copy). Payload: +8 count, +0xc table of offsets (from the payload) to the animations:
      +0 u8 source texture entry, +1 u8 target entry (indices into the texture container, FUN_00414290 via
      FUN_00253370(.., MP+0x3d8) +0x14), +4 s16 x 2 the target rect's corner (TRXPOS DSAX / DSAY), +8 s16 x 2 its size
      (TRXREG), +0xc u16 frames, +0xe s16 key count, +0x10 name (8 bytes; '@' first = on at set-up), +0x18 / +0x1a s16
      the random wait range after a cycle, +0x20 keys of 8 bytes: s16 source x, y (TRXPOS SSAX / SSAY), s16 the frame
      the key runs to.
    The copy is local -> local in the source's PSM (BITBLTBUF SPSM = DPSM): palette indices move, the target's CLUT
    colours them. So each (source, target) pair is exported as the source image decoded with the TARGET's CLUT
    (smd_material.texture_rgba with that entry's CLUT swapped in): MODEL_tad_S_D.png. The target texture is named by
    its entry (the glb image name = the material's entry name). A target whose entry +0x22 mask has the MP's variant
    bit (MP+0x44b) is skipped by FUN_00414290: `mask` is exported, the page draws variant 0."""
    import struct
    from PIL import Image
    import smd_material as SM
    b = open(E.paths(model)['cont'], 'rb').read()
    u16 = lambda o: struct.unpack_from('<H', b, o)[0]
    s16 = lambda o: struct.unpack_from('<h', b, o)[0]
    u32 = lambda o: struct.unpack_from('<I', b, o)[0]
    offs = [u32(0x14 + 4 * i) for i in range(u16(0x10))]
    tad = next((o for o in offs if b[o + 8:o + 11] == b'tad'), None)
    if tad is None:
        return None
    P = tad + 0x10
    anims = []
    for i in range(u32(P + 8)):
        A_ = P + u32(P + u32(P + 0xc) + 4 * i)
        nk = s16(A_ + 0xe)
        anims.append(dict(name=b[A_ + 0x10:A_ + 0x18].split(b'\0')[0].decode('latin-1'), src=b[A_], dst=b[A_ + 1],
                          d=[s16(A_ + 4), s16(A_ + 6)], wh=[s16(A_ + 8), s16(A_ + 0xa)], frames=u16(A_ + 0xc),
                          wait=[s16(A_ + 0x18), s16(A_ + 0x1a)],
                          keys=[[s16(A_ + 0x20 + 8 * k), s16(A_ + 0x22 + 8 * k), s16(A_ + 0x24 + 8 * k)] for k in range(nk)]))
    if not anims:
        return dict(anims=[], images={}, targets={})
    tex = E.paths(model)['tex']
    ents = SM.texture_entries(tex)
    images, targets = {}, {}
    for an in anims:
        k = '%d_%d' % (an['src'], an['dst'])
        if k not in images:
            rgba = SM.texture_rgba(tex, dict(name=ents[an['src']]['name'], image_entry=an['src'], clut_entry=an['dst']))
            f = '%s_tad_%s.png' % (model, k)
            Image.fromarray(rgba, 'RGBA').save(os.path.join(out, f))
            images[k] = f
        targets['%d' % an['dst']] = dict(name=ents[an['dst']]['name'], mask=ents[an['dst']].get('mask', 0))
    return dict(anims=anims, images=images, targets=targets)


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
        # worker 0248: the character's own (resident) motion files (export_web_enemy CLIP_KS: FUN_00249cb8 k) that hold a
        # clip the script names (the opening's p000 plays h_st, Vincent's stand): pack 'rK' (K = k in hex), listed in
        # `resident`; the page puts them before the event files in the actor's search (FUN_005a7390 takes the first file
        # holding the name; the names are unique across them)
        resident = []
        for k in E.CLIP_KS:
            f = E.NOPATH + '%08x.bin' % E.file_id(m, k)
            if os.path.basename(f) not in listed or not os.path.exists(f):
                continue
            buf = open(f, 'rb').read()
            ents = [x for x in mod_entries(buf) if x[0] in strs]
            if not ents or not all(fits(buf, P, end, bc) for _nm, P, end in ents):
                continue
            key = 'r%x' % k
            if any(key == r for r in resident) or any(nm in p_.get('clipFrames', {}) for p_ in packs.values() for nm, _P, _e in ents):
                continue
            clips = {nm: dict(cont=f, nf=AR.clip_frames(buf, P), zero_y=False) for nm, P, _e in ents}
            lp = V.local_pose(sk, list(sk['parent']), clips, out, '%s_%s_local.bin' % (m, key), in_place=False)
            lp['clipFrames'] = {c: d['nf'] for c, d in clips.items()}
            lp['container'] = os.path.basename(f)
            packs[key] = lp
            resident.append(key)
        # marker.mkd (FUN_0030bef8 -> the socket of an attached actor, FUN_005ab8f0 / FUN_005ad508): [bone, x, y, z]
        import export_cerberus as EC
        try:
            mk = [[int(b)] + [float(v) for v in xyz] for xyz, b in EC.markers(open(E.paths(m)['cont'], 'rb').read())]
        except (ValueError, AssertionError):  # no marker.mkd / not the mk2 layout: no sockets (the page warns)
            mk = []
        index['models'][m] = dict(glb=m + '.glb', side=m + '.json', bones=bc, parent=[int(x) for x in sk['parent']],
                                  markers=mk, packs=packs, resident=resident)
        ta = texanims(m, out)                                         # worker 0248: texanm.tad (the faces' animations)
        if ta and ta['anims']:
            index['models'][m]['texanim'] = ta
            print('%s: texanm %s' % (m, ' '.join(x['name'] for x in ta['anims'])))
        print('%s: %d bones, packs %s' % (m, bc, ' '.join('%s(%s)' % (n if n.startswith('r') else '%02x' % int(n), ','.join(p['clipFrames']))
                                                            for n, p in packs.items())))
    json.dump(index, open(os.path.join(out, 'actors.json'), 'w'), indent=1)
    print('wrote %s/actors.json: %d models' % (a.out, len(index['models'])))


if __name__ == '__main__':
    main()
