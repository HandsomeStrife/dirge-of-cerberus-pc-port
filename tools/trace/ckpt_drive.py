#!/usr/bin/env python3
"""(worker 0242) ckpt_drive.py OUTDIR STATE (env TRACE_SCRATCH = the pcsx2trace unit's scratch; run under flock out/.pcsx2.lock).
OUTDIR must be gitignored (game-derived states). STATE: worker 0223's grab95/s826.p2s.
Driver: s826 + the w229 rescue route (scene_save(1) at ~f702, box answered), then a pause
Restart (OK) after the rescue's battle(), cross every 60 frames only while the game is outside state 0x15, and PINE
save states at: the record filled (after scene_save), just before the Restart, the reload's first 0x15 frame and
+150 / +400 / +800 frames after it. Output: OUT/w242_<tag>.p2s and OUT/w242_log.json (polled values)."""
import glob, json, os, shutil, struct, sys, time
sys.path.insert(0, '/srv/games/dirge-port/tools/trace')
import fields, hook
import trace as T
from p2s import read_p2s, write_p2s
from route import PineW, unpatch, u32, stick_byte

SCR = os.environ['TRACE_SCRATCH']
OUT = sys.argv[1]
STATE = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
N = 6000
ee = bytearray(read_p2s(STATE)['eeMemory.bin'])
unpatch(ee)
bases = fields.resolve_bases(ee)
P = bases['P']; PS = u32(ee, P + 0x17C)
print('HP in state', u32(ee, PS + 0x20))
pokes = [(0xa06338, 0x91379f02), (PS + 0x20, 500)]
for ad, w in pokes:
    print('poke %#x: %#x -> %#x' % (ad, u32(ee, ad), w)); struct.pack_into('<I', ee, ad, w)
script = json.load(open('/srv/games/dirge-port/tools/trace/scripts/w229_rescue.json'))
script = dict(script, frames=N, events=script['events'] + [
    dict({'from': 2200, 'to': 2204, 'buttons': ['start']}),
    dict({'from': 2270, 'to': 2274, 'buttons': ['cross']}),
    dict({'from': 2400, 'to': 2404, 'buttons': ['left']}),
    dict({'from': 2420, 'to': 2424, 'buttons': ['cross']})])
frames = T.build_frames(script)
hook.LOG = (hook.SCRIPT + N * hook.SCRIPT_STRIDE + 15) & ~15
rec = hook.patch_memory(ee, frames, [(bases['C'] + 0x30, 3)], N - 4)
tstate = os.path.join(SCR, 'trace_w242.p2s')
write_p2s(tstate, {'eeMemory.bin': bytes(ee)}, STATE)
env = os.path.join(SCR, 'trace.env')
lines = [l for l in open(env).read().splitlines() if not l.startswith('STATEFILE=')] + ['STATEFILE=' + tstate]
open(env, 'w').write('\n'.join(lines) + '\n')
cfg = os.path.join(SCR, 'cfg', 'PCSX2')
T.systemctl('stop', T.UNIT)
sock = os.path.join(os.environ.get('XDG_RUNTIME_DIR', '/tmp'), 'pcsx2.sock')
if os.path.exists(sock): os.unlink(sock)
T.systemctl('start', T.UNIT)
p = None; dl = time.time() + 120
while time.time() < dl:
    try:
        p = PineW(); p.read32(hook.CTRL + 4); break
    except (OSError, IOError):
        p = None; time.sleep(0.5)
if p is None:
    T.systemctl('stop', T.UNIT); sys.exit('no PINE')


def entry(f, buttons=()):
    bits = 0
    for b in buttons: bits |= 1 << T.BUTTONS[b]
    bits ^= 0xFFFF
    e = hook.SCRIPT + f * hook.SCRIPT_STRIDE
    p.write32(e, bits | stick_byte(0) << 16 | stick_byte(0) << 24)
    p.write32(e + 4, stick_byte(0) | stick_byte(0) << 8)
    p.write32(e + 12, 0xFF if 'cross' in buttons else 0)


def save(tag):
    before = set(glob.glob(cfg + '/sstates/*'))
    p.save_state(9); time.sleep(4)
    for _ in range(20):
        new = sorted(set(glob.glob(cfg + '/sstates/*')) - before)
        new = [n for n in new if n.endswith('.p2s')] or new
        if new: break
        time.sleep(1)
    for fn in new:
        dst = os.path.join(OUT, 'w242_%s.p2s' % tag); shutil.move(fn, dst); print('saved', tag, dst, flush=True); return


log, saved, t_reload, last_cross, restarted = [], set(), None, -999, False
t0 = time.time()
while time.time() - t0 < 3000:
    try:
        f = p.read32(hook.CTRL + 4)
    except (OSError, IOError):
        time.sleep(0.5); continue
    if f >= N - 10: break
    gs = p.read32(0x4b8b2c); zone = p.read32(0x47dbb0)
    r41 = p.read_block(0x4b2680, 0x48)[0x41]
    b0b8 = p.read32(0x46b0b8)
    pc = p.read32(zone + 0xc) if zone else -1
    z18 = p.read32(zone + 0x18) if zone else -1
    row = dict(f=f, gs=gs, zone=zone, pc=pc, z18=z18, r41=r41, b0b8=b0b8)
    if not log or any(log[-1][k] != row[k] for k in ('gs', 'zone', 'pc', 'z18', 'r41', 'b0b8')):
        print(row, flush=True)
    log.append(row)
    if r41 == 1 and 'rec' not in saved and f > 720:
        saved.add('rec'); save('rec')
    if f >= 2150 and 'prerestart' not in saved:
        saved.add('prerestart'); p.write32(PS + 0x20, 300); save('prerestart')
    if f > 2430 and gs != 0x15:
        restarted = True
        if f - last_cross >= 60:
            for k in range(2, 6): entry(f + k, ('cross',))
            last_cross = f
    if restarted and gs == 0x15 and t_reload is None:
        t_reload = f; save('reload0')
    if t_reload is not None:
        for d in (150, 400, 800, 1500):
            if f >= t_reload + d and ('r%d' % d) not in saved:
                saved.add('r%d' % d); save('r%d' % d)
        if f >= t_reload + 1520: break
    time.sleep(0.4)
json.dump(log, open(os.path.join(OUT, 'w242_log.json'), 'w'))
T.systemctl('stop', T.UNIT)
os.unlink(tstate)
print('done', time.time() - t0)
