#!/usr/bin/env python3
"""(worker 0239) The event windows' and the event pause's draws from GS dumps -> a test reference (game-derived:
write it under tools/trace/out, which is gitignored). test_event_vm.mjs compares event_window.js with it.

    python3 -I tools/trace/window_ref.py VN2_DUMP SK_DUMP PAUSE_DUMP -o tools/trace/out/w239/window_ref.json

The dumps are grab_gs.py captures of scripts/w239_sub.json (0210's start1704 state): f596 (MES_10109VN2 open), f1400
(MES_10110SK open) and f1453 (the event pause, Start at f1420). Per dump, the last full frame's draws (as
export_web_pause.dump_reference): vn2 / sk = the font-page sprites (TEX0 TBP 0, PSMT4HH) above y 8000 / 16 (the
off-screen help line at y 523 is left out); pause = the frame's last three draws (the dim and widgets 0x22 / 0x23).
Each draw: [x0, y0, x1, y1, u0, v0, u1, v1, rgba, cbp, tex1] (drawable 1/16 px, XYOFFSET removed)."""
import argparse, json, os, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'gsdump', 'src'))
import gsparse as G  # noqa: E402


def load(p):
    return subprocess.run(['zstd', '-dc', p], capture_output=True, check=True).stdout if p.endswith('.zst') else open(p, 'rb').read()


class Interp(G.GIFInterp):
    def __init__(self):
        super().__init__()
        self.extra = {}

    def write_reg(self, addr, data):
        if addr in (0x06, 0x14):
            self.extra[addr] = data
        return super().write_reg(addr, data)

    def _new_draw(self):
        super()._new_draw()
        self._cur['extra'] = dict(self.extra)


def frame_draws(path):
    buf = load(path)
    h = G.read_header(buf)
    g = Interp()
    off, vs = h['packets_at'], []
    while off < len(buf):
        t = buf[off]; off += 1
        if t == 0:
            off += 1
            n, = struct.unpack_from('<I', buf, off); off += 4
            g.feed(buf[off:off + n]); off += n
        elif t == 1:
            off += 1; vs.append(len(g.draws))
        elif t == 2:
            off += 4
        elif t == 3:
            off += 0x2000
        else:
            break
    out = []
    for d in g.draws[vs[-2]:vs[-1]]:
        if not d['verts']:
            continue
        xo = d['xyoffset']
        ox, oy = xo & 0xffff, (xo >> 32) & 0xffff
        tex0 = d['extra'].get(0x06, 0)
        v = d['verts']
        out.append(dict(tme=d['tme'], tbp=tex0 & 0x3fff, psm=(tex0 >> 20) & 0x3f, ptype=d['ptype'],
                        row=[v[0]['x'] - ox, v[0]['y'] - oy, v[-1]['x'] - ox, v[-1]['y'] - oy, v[0]['u'], v[0]['vv'],
                             v[-1]['u'], v[-1]['vv'], [v[0]['r'], v[0]['g'], v[0]['b'], v[0]['a']],
                             (tex0 >> 37) & 0x3fff, d['extra'].get(0x14, 0)]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('vn2'); ap.add_argument('sk'); ap.add_argument('pause')
    ap.add_argument('-o', required=True)
    a = ap.parse_args()
    font = lambda ds: [d['row'] for d in ds if d['tme'] and d['tbp'] == 0 and d['psm'] == 0x2c and d['row'][1] < 8000]
    ref = {'vn2': font(frame_draws(a.vn2)), 'sk': font(frame_draws(a.sk)), 'pause': [d['row'] for d in frame_draws(a.pause)[-3:]]}
    os.makedirs(os.path.dirname(os.path.abspath(a.o)), exist_ok=True)
    json.dump(ref, open(a.o, 'w'))
    print('wrote', a.o, {k: len(v) for k, v in ref.items()})


if __name__ == '__main__':
    main()
