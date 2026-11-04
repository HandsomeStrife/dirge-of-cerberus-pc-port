#!/usr/bin/env python3
"""(worker 0179) Run a trace script in the pcsx2trace unit; at given frames press Shift+F8 (GS dump) and
F1 (save state), then F2 (next slot), and move the dumps / states to OUTDIR (game-derived: keep them
out of the repo). Each GS dump stalls the emulator, so later grabs land late (grab_log.json has the
frames); the dump's frame is 4 game frames after its save state (notes/effects-research.md).
Usage (under the trace lock): flock tools/trace/out/.pcsx2.lock python3 -I tools/trace/grab_gs.py
    SCRIPT.json OUTDIR frame[,frame...]   (an older 4-argument form with TRACE_SCRATCH second is still accepted)"""
import json, struct, os, sys, time, subprocess, glob, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import trace as T, fields, hook
from p2s import read_p2s, write_p2s
from pine import Pine
args_ = sys.argv[1:]; scratch = T.scratch_dir(args_.pop(1) if len(args_) == 4 else None)
script_path, outdir, grab = args_[0], args_[1], [int(x) for x in args_[2].split(",")]
# the dumps and states are game data: OUTDIR must be outside the repo or gitignored (the repo is public)
repo = os.path.dirname(os.path.dirname(HERE)); oabs = os.path.abspath(outdir)
if oabs == repo or oabs.startswith(repo + os.sep):
    probe = os.path.join(os.path.relpath(oabs, repo), "grab_log.json")
    if subprocess.run(["git", "-C", repo, "check-ignore", "-q", probe]).returncode != 0:
        sys.exit("grab_gs: %s is inside the repo and not gitignored (use tools/trace/out/... or a scratch dir)" % outdir)
script = json.load(open(script_path)); os.makedirs(outdir, exist_ok=True); state = os.environ.get("TRACE_STATE", T.DEFAULT_STATE)   # TRACE_STATE: another start state (worker 0218)
mem = read_p2s(state); ee = bytearray(mem["eeMemory.bin"])
bases = fields.resolve_bases(ee); table = fields.field_table(bases)
frames = T.build_frames(script); log_from = len(frames) - 2
rec = hook.patch_memory(ee, frames, table, log_from)
# TRACE_POKE="addr=word,..." (hex), as trace.py (worker 0209: w209_barrel moves the barrel)
for item in filter(None, os.environ.get("TRACE_POKE", "").split(",")):
    a_, w_ = (int(x, 16) for x in item.split("="))
    struct.pack_into("<I", ee, a_, w_)
tstate = os.path.join(scratch, "trace_%s.p2s" % script["name"])
write_p2s(tstate, {"eeMemory.bin": bytes(ee)}, state)
env = os.path.join(scratch, "trace.env")
lines = [l for l in open(env).read().splitlines() if not l.startswith("STATEFILE=")] + ["STATEFILE=" + tstate]
open(env, "w").write("\n".join(lines) + "\n")
snaps = os.path.join(scratch, "cfg", "PCSX2", "snaps"); sst = os.path.join(scratch, "cfg", "PCSX2", "sstates")
before = set(glob.glob(snaps + "/*")) | set(glob.glob(sst + "/*"))
T.systemctl("stop", T.UNIT)
sock = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "pcsx2.sock")
if os.path.exists(sock): os.unlink(sock)
T.systemctl("start", T.UNIT)
p = None; dl = time.time() + 1500; gi = 0
envx = dict(os.environ, DISPLAY=":97")
def key(k):
    w = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", "."], env=envx, capture_output=True, text=True).stdout.split()
    for wid in w[-1:]:
        subprocess.run(["xdotool", "windowactivate", "--sync", wid], env=envx)
        subprocess.run(["xdotool", "key", "--window", wid, k], env=envx)
log = []
while time.time() < dl and gi < len(grab):
    try:
        p = p or Pine(); fr = p.read32(hook.CTRL + 4)
    except (OSError, IOError):
        p = None; time.sleep(0.5); continue
    if fr >= grab[gi]:
        f0 = p.read32(hook.CTRL + 4); key("shift+F8"); f1 = p.read32(hook.CTRL + 4)
        key("F1"); f2 = p.read32(hook.CTRL + 4); time.sleep(2); key("F2")
        log.append(dict(want=grab[gi], gs=[f0, f1], state=f2)); print(log[-1], flush=True)
        gi += 1; time.sleep(1)
    time.sleep(0.05)
if gi < len(grab): print("grab_gs: deadline passed with %d of %d grabs" % (gi, len(grab)), flush=True)
# let the script run out (bounded: a stalled or dead emulator must not hang the trace lock)
end = time.time() + 600
while time.time() < end:
    try:
        p = p or Pine()
        if p.read32(hook.CTRL + 4) >= len(frames): break
    except (OSError, IOError):
        p = None
    time.sleep(0.5)
else:
    print("grab_gs: the script did not finish within 600 s; stopping", flush=True)
time.sleep(3)
T.systemctl("stop", T.UNIT)
new = sorted((set(glob.glob(snaps + "/*")) | set(glob.glob(sst + "/*"))) - before)
for f in new:
    shutil.move(f, outdir); print("got", f)
json.dump(log, open(os.path.join(outdir, "grab_log.json"), "w"))
os.unlink(tstate)
