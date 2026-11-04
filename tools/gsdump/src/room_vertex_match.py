#!/usr/bin/env python3
"""room_vertex_match.py -- the room per chunk, vertex by vertex, against a GS dump (worker 0260).

Matches every textured vertex of the dump's last frame to the page's room vertices (native/web/data: scene.json +
room_g*.bin) by UV and screen position, fits the frame's real camera (Kabsch on eye-space (x, y, w) <-> world; the state's camera
is a frame or two older than the dump), then reports for the matched vertices: RGBA against the export, F against the
chain's env slot (room.js), FOGCOL, which page texture each TBP binds to; and what is left: dump vertices with no page vertex (per TBP; actors and
effects land here too) and on-screen page triangles the dump does not draw (per chunk / visibility group / tree node).
  python3 -I tools/gsdump/src/room_vertex_match.py DUMP.bin FIXTURE.json [OUT_FIXTURE.json]
OUT_FIXTURE.json = FIXTURE + the fitted camera (cam), for native/web/test_room_chunks.mjs.
"""
import json, os, struct, sys
from collections import Counter, defaultdict
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
import gsrender2 as G
from gsparse import read_header
DATA = os.path.join(REPO, 'native', 'web', 'data')
SCRZ = 448 * 0.5 / np.tan(np.radians(73.5 / 2)); AY = 1.5; CX = 213.0; CY = 256.0   # test_room_grade's projection


class Probe(G.DepthInterp):
    # keeps F and FOGCOL per vertex in the (for FST = 0 draws unused) UV fields v[6], v[7]
    fogcol = 0

    def write_reg(self, addr, data):
        if addr == 0x3d:
            self.fogcol = data & 0xffffff
        super().write_reg(addr, data)

    def _emit_vertex(self, x, y, z, f=None, drawkick=True, adc=False):
        save = self.uv
        if not (self.prim >> 8) & 1:
            self.uv = (-1 if f is None else f, self.fogcol)
        super()._emit_vertex(x, y, z, f, drawkick, adc)
        self.uv = save


def load_dump(path):
    keep = G.DepthInterp
    G.DepthInterp = Probe
    buf = open(path, 'rb').read(); h = read_header(buf); gif = G.build(buf, h, sprite_uv=True)
    G.DepthInterp = keep
    a, b = G.pick_frame(gif, 'last')
    rows, tri = [], []
    for i in range(a, b):
        t = gif.tris[i]; c = t[3]
        if not c.get('tme') or c.get('fst'):
            continue
        ox, oy = c['xyoffset'] & 0xffff, (c['xyoffset'] >> 32) & 0xffff
        for v in t[:3]:
            q = v[5]
            if not q or q <= 0:
                break
            rows.append(((v[0] - ox) / 16, (v[1] - oy) / 16, 1 / q, v[3] / q, v[4] / q, v[8], v[9], v[10], v[11], v[6], v[7], c['tex0'] & 0x3fff, i, c['abe'], (c.get('tex1', 0) >> 2) & 7, (c.get('tex1', 0) >> 6) & 7, ((c.get('tex1', 0) >> 32) & 0xfff)))
    return np.array(rows, float)


def load_page(chunks):
    s = json.load(open(os.path.join(DATA, 'scene.json')))
    P, UV, COL, ENV, R, DI = [], [], [], [], [], []
    for di, d in enumerate(s['draws']):
        if d['kind'] != 'room' or not d.get('chunks'):
            continue
        m = s['meshes'][d['mesh']]
        v = np.fromfile(os.path.join(DATA, m['file']), '<f4').reshape(-1, 12)
        e = np.fromfile(os.path.join(DATA, m['env']), '<u1') if m.get('env') else np.zeros(len(v), np.uint8)
        for r in d['chunks']:
            if r[0] not in chunks:
                continue
            f, n = r[1], r[2]
            P.append(v[f:f + n, :3]); UV.append(v[f:f + n, 6:8]); COL.append(v[f:f + n, 8:12]); ENV.append(e[f:f + n])
            R.append(np.tile([r[0], r[3], r[4] if len(r) > 4 else -1, di], (n, 1)))
    return s, np.concatenate(P).astype(float), np.concatenate(UV).astype(float), np.concatenate(COL), np.concatenate(ENV), np.concatenate(R)


def project(Rm, T, P):
    e = (P - T) @ Rm.T
    w = e[:, 2]
    w_ = np.where(np.abs(w) < 1e-3, 1e-3, w)
    return CX + SCRZ * e[:, 0] / w_, CY + SCRZ * AY * e[:, 1] / w_, w


def eye_of(g):
    w = g[:, 2]
    return np.stack(((g[:, 0] - CX) * w / SCRZ, (g[:, 1] - CY) * w / (SCRZ * AY), w), 1)


def kabsch(world, eye):
    wc, ec = world.mean(0), eye.mean(0)
    u, _, vt = np.linalg.svd((world - wc).T @ (eye - ec))
    D = np.diag([1, 1, np.sign(np.linalg.det(u @ vt))])
    Rw2e = (vt.T @ D @ u.T)
    return Rw2e, wc - Rw2e.T @ ec


def main(argv):
    dump, fx = argv[:2]
    meta = json.load(open(fx))
    g = load_dump(dump)
    s, P, UV, COL, ENV, RG = load_page(meta['chunks'])
    # the state's hidden groups (DAT_004e8710) can't match: chunk 00's group 69 sits exactly on chunk 09's slot-23 copy, which read as a wrong fog slot
    vis = ~np.isin(RG[:, 1], meta['mask'])
    P, UV, COL, ENV, RG = P[vis], UV[vis], COL[vis], ENV[vis], RG[vis]
    print('dump verts %d, page verts %d (chunks %s)' % (len(g), len(P), meta['chunks']))
    # uv index: fractional part, quantised
    def qk(u, v, q=512):
        return (np.round(u * q).astype(np.int64) % q) * q + (np.round(v * q).astype(np.int64) % q)
    idx = defaultdict(list)
    for i, k in enumerate(qk(UV[:, 0], UV[:, 1])):
        idx[k].append(i)
    gk = qk(g[:, 3], g[:, 4])
    c = meta['cam']; eye0 = np.array(c[:3]); fwd = np.array(c[3:6]) - eye0; fwd /= np.linalg.norm(fwd)
    up = -np.array(c[6:9])                 # the row CAM+0x70 (room is -Y up)
    # the image's +y is the row's -(up) ... try both handedness signs of x, keep what matches
    best = None
    for sx in (1, -1):
        for sy in (1, -1):
            right = sx * np.cross(up, fwd); right /= np.linalg.norm(right)
            u2 = sy * np.cross(fwd, right)
            Rm = np.stack((right, u2, fwd))
            n = 0
            x, y, w = project(Rm, eye0, P)
            for i in range(0, len(g), 7):
                cand = idx.get(gk[i])
                if cand:
                    d = np.hypot(x[cand] - g[i, 0], y[cand] - g[i, 1])
                    n += d.min() < 8
            if best is None or n > best[0]:
                best = (n, Rm)
    Rm, T = best[1], eye0
    # the camera may have turned between the state and the dump: a coarse yaw / pitch search on unambiguous UVs first
    gi_, pi_ = [], []
    for i in range(0, len(g), 3):
        cand = idx.get(gk[i])
        if cand and len(cand) <= 60:
            gi_.extend([i] * len(cand)); pi_.extend(cand)
    gi_, pi_ = np.array(gi_), np.array(pi_)
    bestc = (-1, Rm)
    def rot(ax, a):
        c_, s_ = np.cos(a), np.sin(a)
        return {0: np.array([[1, 0, 0], [0, c_, -s_], [0, s_, c_]]), 1: np.array([[c_, 0, s_], [0, 1, 0], [-s_, 0, c_]])}[ax]
    for dy in np.radians(np.arange(-12, 12.01, 0.4)):
        for dp in np.radians(np.arange(-6, 6.01, 0.4)):
            R2 = rot(1, dy) @ rot(0, dp) @ Rm
            e = (P[pi_] - T) @ R2.T
            wv_ = np.where(e[:, 2] > 0.1, e[:, 2], np.inf)
            xx, yy = CX + SCRZ * e[:, 0] / wv_, CY + SCRZ * AY * e[:, 1] / wv_
            hit = np.hypot(xx - g[gi_, 0], yy - g[gi_, 1]) < 4
            n = len(np.unique(gi_[hit]))
            if n > bestc[0]:
                bestc = (n, R2)
    Rm = bestc[1]
    print('coarse search: %d dump vertices within 4 px' % bestc[0])
    thr = 12.0
    for it in range(6):
        x, y, w = project(Rm, T, P)
        pair = np.full(len(g), -1, int)
        for i in range(len(g)):
            cand = idx.get(gk[i])
            if not cand:
                continue
            cand = np.array(cand)
            cand = cand[w[cand] > 0.1]
            if not len(cand):
                continue
            d = np.hypot(x[cand] - g[i, 0], y[cand] - g[i, 1]) + np.abs(w[cand] - g[i, 2]) * 0.005
            j = d.argmin()
            if d[j] < thr:
                pair[i] = cand[j]
        ok = pair >= 0
        if ok.sum() < 20:
            print('too few matches', ok.sum()); return
        Rm, T = kabsch(P[pair[ok]], eye_of(g[ok]))
        thr = max(3.0, thr * 0.4)
    # Kabsch's eye space weighs far vertices by their w (dump w has a small scale error): finish on pixels (Gauss-Newton on 6 DOF)
    for it in range(8):
        x, y, w = project(Rm, T, P)
        pair = np.full(len(g), -1, int)
        for i in range(len(g)):
            cand = idx.get(gk[i])
            if cand:
                cand = np.array(cand); cand = cand[w[cand] > 0.1]
                if len(cand):
                    d = np.hypot(x[cand] - g[i, 0], y[cand] - g[i, 1]); j = d.argmin()
                    if d[j] < (3.0 if it < 4 else 1.5):
                        pair[i] = cand[j]
        ok = pair >= 0
        e = (P[pair[ok]] - T) @ Rm.T; X, Y, Z = e[:, 0], e[:, 1], e[:, 2]
        fx, fy = SCRZ, SCRZ * AY
        rx = fx * X / Z + CX - g[ok, 0]; ry = fy * Y / Z + CY - g[ok, 1]
        # d(eye) = dw x eye - dt (eye-space rotation dw, translation dt)
        J = np.zeros((2 * len(X), 6))
        J[::2, 0] = -fx * X * Y / Z ** 2; J[::2, 1] = fx * (1 + X ** 2 / Z ** 2); J[::2, 2] = -fx * Y / Z
        J[1::2, 0] = -fy * (1 + Y ** 2 / Z ** 2); J[1::2, 1] = fy * X * Y / Z ** 2; J[1::2, 2] = fy * X / Z
        J[::2, 3] = -fx / Z; J[::2, 5] = fx * X / Z ** 2; J[1::2, 4] = -fy / Z; J[1::2, 5] = fy * Y / Z ** 2
        r = np.empty(2 * len(X)); r[::2] = rx; r[1::2] = ry
        dx = np.linalg.lstsq(J, -r, rcond=None)[0]
        wx, wy, wz = dx[:3]
        dR = np.array([[1, -wz, wy], [wz, 1, -wx], [-wy, wx, 1]])
        u_, _, vt_ = np.linalg.svd(dR @ Rm); Rnew = u_ @ vt_
        T = T + Rm.T @ dx[3:]
        Rm = Rnew
    x, y, w = project(Rm, T, P)
    ok = pair >= 0
    err = np.hypot(x[pair[ok]] - g[ok, 0], y[pair[ok]] - g[ok, 1])
    print('matched %d / %d, reprojection median %.3f max %.2f px; camera moved %.2f u, %.3f deg from the state' % (ok.sum(), len(g), np.median(err), err.max(), np.linalg.norm(T - eye0), np.degrees(np.arccos(np.clip(Rm[2] @ fwd, -1, 1)))))
    # RGBA against the export
    gc = g[ok, 5:9]; pc = COL[pair[ok]] * 255
    dc = np.abs(gc - pc)
    print('RGBA |game - export|: mean %s, max %s; > 3: %d verts' % (dc.mean(0).round(2), dc.max(0).round(0), (dc.max(1) > 3).sum()))
    # per (chunk, draw): where they differ
    bad = Counter()
    pr = RG[pair[ok]]
    for r, b in zip(pr, dc.max(1) > 3):
        if b:
            bad[(int(r[0]), s['draws'][int(r[3])]['tex'])] += 1
    print('  worst (chunk, tex):', bad.most_common(6))
    # F against the chain's slot
    es = ENV[pair[ok]]
    tab = s['env_fog']
    pf = np.zeros(ok.sum()); wv = g[ok, 2]
    fc = np.zeros(ok.sum(), int)
    for k, e in enumerate(tab):
        m = es == k
        if not m.any():
            continue
        fc[m] = e['color'][0] | e['color'][1] << 8 | e['color'][2] << 16
        pf[m] = 255 if e['far'] == e['near'] else np.clip((e['far'] - wv[m]) / (e['far'] - e['near']), e['min'], 1) * 255
    has = g[ok, 9] >= 0
    df = np.abs(g[ok, 9] - pf)[has]
    print('F |game - env slot ramp|: mean %.2f, p99 %.1f, max %.1f; FOGCOL differs on %d' % (df.mean(), np.percentile(df, 99), df.max(), (g[ok, 10].astype(int) != fc).sum()))
    for k in sorted(set(es.tolist())):
        m = (es == k) & has
        if m.any():
            print('  slot %2d: n %6d  game F %3d..%3d, |dF| mean %.2f  game FOGCOL %s' % (k, m.sum(), g[ok, 9][m].min(), g[ok, 9][m].max(), np.abs(g[ok, 9] - pf)[m].mean(), Counter(g[ok, 10][m].astype(int).tolist()).most_common(2)))
    # TBP -> page texture
    by = defaultdict(Counter)
    for t, r in zip(g[ok, 11].astype(int), pr):
        by[t][s['draws'][int(r[3])]['tex']] += 1
    multi = {t: c.most_common(3) for t, c in by.items() if len(c) > 1}
    print('TBP -> page texture: %d TBPs; bound to more than one page texture: %s' % (len(by), dict(list(multi.items())[:8])))
    # TEX1 per page texture, through the TBP's majority binding (a stray UV match binds a few vertices elsewhere): for test_room_chunks.mjs
    if len(argv) > 2:
        tex1s = {}
        for t, c_ in by.items():
            tx, n_ = c_.most_common(1)[0]
            if n_ < 8 or n_ < 0.6 * sum(c_.values()):
                continue
            row = g[g[:, 11] == t][0]
            tex1s.setdefault(tx, set()).add((int(row[14]), int(row[15]), int(row[16])))
        json.dump({k: sorted(v) for k, v in tex1s.items()}, open(os.path.splitext(argv[2])[0] + '_tex1.json', 'w'))
    # dump verts with no page vertex, per TBP
    un = Counter(g[~ok, 11].astype(int).tolist()); tot = Counter(g[:, 11].astype(int).tolist())
    print('dump verts with no page vertex, per TBP (count / TBP total; page tex if known):')
    for t, n in un.most_common(12):
        o = g[(~ok) & (g[:, 11] == t)]
        print('  tbp %6d  %6d / %6d  %s  screen x %d..%d y %d..%d w %.0f..%.0f' % (t, n, tot[t], by[t].most_common(1) if t in by else '-', o[:, 0].min(), o[:, 0].max(), o[:, 1].min(), o[:, 1].max(), o[:, 2].min(), o[:, 2].max()))
    # on-screen page triangles the dump does not draw
    used = np.zeros(len(P), bool)
    gidx = defaultdict(list)
    for i, k in enumerate(gk):
        gidx[k].append(i)
    for j, k in enumerate(qk(UV[:, 0], UV[:, 1])):
        c_ = gidx.get(k)
        if c_ and w[j] > 0.1 and np.hypot(g[c_, 0] - x[j], g[c_, 1] - y[j]).min() < 2:
            used[j] = True
    n = len(P) // 3
    tri_on = (x[:n * 3].reshape(-1, 3), y[:n * 3].reshape(-1, 3), w[:n * 3].reshape(-1, 3))
    inside = ((tri_on[2] > 1).all(1) & (tri_on[0] > 0).all(1) & (tri_on[0] < 432).all(1) & (tri_on[1] > 0).all(1) & (tri_on[1] < 512).all(1))
    area = (tri_on[0][:, 0] - tri_on[0][:, 1]) * (tri_on[1][:, 1] - tri_on[1][:, 2]) - (tri_on[1][:, 0] - tri_on[1][:, 1]) * (tri_on[0][:, 1] - tri_on[0][:, 2])
    miss = inside & (np.abs(area) > 200) & (used[:n * 3].reshape(-1, 3).sum(1) < 2)
    print('on-screen page triangles (screen area > 100 px^2): %d, not in the dump: %d' % ((inside & (np.abs(area) > 200)).sum(), miss.sum()))
    mm = set(meta['mask']); ct = Counter()
    rgt = RG[::3][:n]
    for r, a_ in zip(rgt[miss], np.abs(area[miss]) / 2):
        ct[(int(r[0]), int(r[1]), int(r[2]), 'masked' if int(r[1]) in mm else 'shown', s['draws'][int(r[3])]['tex'])] += a_
    print('  largest (chunk, group, node, state mask, tex): screen area')
    for k, v in ct.most_common(14):
        print('   ', k, int(v))
    # what the page shows that differs from the game: a 1/2-res z-buffer of the page's triangles (hidden groups out), per pixel the front
    # triangle; pixels where page and game differ by > 40 (channel sum), summed per (chunk, group, node, tex, in dump)
    pg = os.path.splitext(argv[2])[0] + '_page.png' if len(argv) > 2 else ''
    gm = os.path.splitext(argv[2])[0] + '_game.png' if len(argv) > 2 else ''
    if pg and os.path.exists(pg) and os.path.exists(gm):
        from PIL import Image
        A = np.asarray(Image.open(gm).convert('RGB')).astype(int); B = np.asarray(Image.open(pg).convert('RGB')).astype(int)
        D = np.abs(A - B).sum(2); D[A.sum(2) == 0] = 0
        zb = np.full((256, 216), np.inf); idb = np.full((256, 216), -1)
        X, Y, W_ = tri_on
        seen_ = np.where((W_ > 1).all(1) & (X.max(1) > 0) & (X.min(1) < 432) & (Y.max(1) > 0) & (Y.min(1) < 512))[0]
        for t in seen_:
            if int(rgt[t][1]) in mm:
                continue
            x0, y0, x1, y1, x2, y2 = X[t, 0] / 2, Y[t, 0] / 2, X[t, 1] / 2, Y[t, 1] / 2, X[t, 2] / 2, Y[t, 2] / 2
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(den) < 1e-6:
                continue
            a0, b0 = int(max(0, min(x0, x1, x2))), int(min(215, max(x0, x1, x2)))
            a1, b1 = int(max(0, min(y0, y1, y2))), int(min(255, max(y0, y1, y2)))
            if a0 > b0 or a1 > b1:
                continue
            xx, yy = np.meshgrid(np.arange(a0, b0 + 1) + .5, np.arange(a1, b1 + 1) + .5)
            l0 = ((y1 - y2) * (xx - x2) + (x2 - x1) * (yy - y2)) / den
            l1 = ((y2 - y0) * (xx - x2) + (x0 - x2) * (yy - y2)) / den
            l2 = 1 - l0 - l1
            ins = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            if not ins.any():
                continue
            zv = 1 / (l0 / W_[t, 0] + l1 / W_[t, 1] + l2 / W_[t, 2])
            sub = zb[a1:b1 + 1, a0:b0 + 1]; idb_ = idb[a1:b1 + 1, a0:b0 + 1]
            near = ins & (zv < sub)
            sub[near] = zv[near]; idb_[near] = t
        ct2 = Counter()
        for yy in range(256):
            for xx in range(216):
                t = idb[yy, xx]
                if t >= 0 and D[yy * 2:yy * 2 + 2, xx * 2:xx * 2 + 2].mean() > 40:
                    r = rgt[t]
                    ct2[(int(r[0]), int(r[1]), int(r[2]), s['draws'][int(r[3])]['tex'], int(used[t * 3:t * 3 + 3].sum()), int(ENV[t * 3]))] += 4
        print('page vs game > 40 (chunk, group, node, tex, verts seen in the dump, env): pixels; total %d of %d' % (sum(ct2.values()), (A.sum(2) > 0).sum()))
        for k, v in ct2.most_common(10):
            print('   ', k, v)
    # the game's room alone (NAME_game.png stays the whole frame): only draws with a TBP some room vertex matched
    if len(argv) > 2:
        from PIL import Image
        keep = set(k for k, n_ in Counter(g[ok, 11].astype(int).tolist()).items() if n_ >= 3)
        keepc = G.DepthInterp; G.DepthInterp = Probe; G.GS_FULL = True
        buf = open(dump, 'rb').read(); h = read_header(buf); gif = G.build(buf, h, sprite_uv=True)
        G.DepthInterp = keepc
        a, b = G.pick_frame(gif, 'last'); nz = 0
        for i in range(a, b):
            t = gif.tris[i]; c_ = t[3]
            # the sky is chunk 00's chains: env slot 2 (opaque, FOGCOL 0, F 255) and slot 1 (FOGCOL 76, 76, 76). Their scrolled UVs and VU-clipped vertices rarely match
            v0 = t[0]
            sky = c_.get('tme') and not c_.get('fst') and v0[5] > 0 and (v0[7] == 0x4c4c4c or (v0[7] == 0 and v0[6] == 255 and not c_.get('abe') and 1 / v0[5] > 1000))
            if not sky and (not c_.get('tme') or c_.get('fst') or (c_['tex0'] & 0x3fff) not in keep):
                gif.tris[i] = (t[0], t[0], t[0], c_); nz += 1
        img, _ = G.render_frame(buf, h, gif, G.TexCache(dump, uploads=gif.uploads), frame='last', fb='main')
        Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.splitext(argv[2])[0] + '_game.png')
        print('room-only game frame: %d of %d triangles dropped' % (nz, b - a))
    # the page camera for the fixture
    if len(argv) > 2:
        f = Rm[2]; row_u = Rm[1]
        # meta up: as the fixture has it, -(CAM+0x70); keep the same sign relation as the state's
        sgn = 1 if np.dot(row_u, up) > 0 else -1
        cam = T.tolist() + (T + 100 * f).tolist() + (-(sgn * row_u)).tolist()
        json.dump(dict(meta, cam=cam, cam_state=c), open(argv[2], 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
