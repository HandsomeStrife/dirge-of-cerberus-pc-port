#!/usr/bin/env python3
"""room_chunk_grade.py -- game-vs-page numbers and montage per chunk (worker 0260).
For each NAME: DIR/NAME_game.png (room_grade_fixture.py) against DIR/NAME_page.png (native/web/test_room_chunks.mjs):
mean |diff|, mean signed diff, SSIM (luma, 8 x 8 windows), edge correlation (Sobel magnitude, Pearson r), and the worst 16 x 16 tiles.
  python3 -I tools/gsdump/src/room_chunk_grade.py DIR NAME [NAME ...]    (writes DIR/NAME_cmp.png + DIR/montage.png)
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw


def luma(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def blocks(a, n):
    h, w = a.shape[0] // n, a.shape[1] // n
    return a[:h * n, :w * n].reshape(h, n, w, n).swapaxes(1, 2).reshape(h, w, n * n)


def ssim_map(a, b, n=8):
    A, B = blocks(a, n), blocks(b, n)
    ma, mb = A.mean(2), B.mean(2)
    va, vb = A.var(2), B.var(2)
    cov = ((A - ma[..., None]) * (B - mb[..., None])).mean(2)
    c1, c2 = 6.5025, 58.5225
    return (2 * ma * mb + c1) * (2 * cov + c2) / ((ma ** 2 + mb ** 2 + c1) * (va + vb + c2))


def sobel(a):
    gx = a[1:-1, 2:] - a[1:-1, :-2]
    gy = a[2:, 1:-1] - a[:-2, 1:-1]
    return np.hypot(gx, gy)


def grade(g, p, rows=(0, 512)):
    g, p = g[rows[0]:rows[1]].astype(float), p[rows[0]:rows[1]].astype(float)
    p = np.where(g.sum(2, keepdims=True) == 0, 0, p)     # the room-only game frame leaves the sky black: not graded here
    lg, lp = luma(g), luma(p)
    r = np.corrcoef(sobel(lg).ravel(), sobel(lp).ravel())[0, 1]
    return dict(mad=float(np.abs(g - p).mean()), sgn=float((p - g).mean()), ssim=float(ssim_map(lg, lp).mean()), edge=float(r),
                mean_g=g.reshape(-1, 3).mean(0).round(1).tolist(), mean_p=p.reshape(-1, 3).mean(0).round(1).tolist())


def main(d, names):
    rows = []
    for n in names:
        g = np.asarray(Image.open(os.path.join(d, n + '_game.png')).convert('RGB'))
        p = np.asarray(Image.open(os.path.join(d, n + '_page.png')).convert('RGB'))
        m = grade(g, p)
        diff = np.where(g.sum(2) == 0, 0, np.abs(g.astype(int) - p.astype(int)).sum(2))
        t = blocks(diff, 16).mean(2)
        worst = np.argsort(t.ravel())[::-1][:3]
        ws = ' '.join('(%d,%d)=%d' % (i % t.shape[1] * 16, i // t.shape[1] * 16, t.ravel()[i]) for i in worst)
        print('%-12s mad %5.1f sgn %+6.1f ssim %.3f edge %.3f  game %s page %s  worst %s' % (n, m['mad'], m['sgn'], m['ssim'], m['edge'], m['mean_g'], m['mean_p'], ws))
        d3 = np.clip(diff[..., None].repeat(3, 2), 0, 255).astype(np.uint8)
        row = Image.new('RGB', (432 * 3, 512))
        for k, im in enumerate((g, p, d3)):
            row.paste(Image.fromarray(im), (432 * k, 0))
        ImageDraw.Draw(row).text((4, 4), '%s game | page | diff  ssim %.3f edge %.3f mad %.1f' % (n, m['ssim'], m['edge'], m['mad']), fill=(255, 255, 0))
        row.save(os.path.join(d, n + '_cmp.png'))
        rows.append(row)
    W = 3
    th = [r.resize((648, 256)) for r in rows]
    h = (len(th) + 1) // 2
    sheet = Image.new('RGB', (648 * 2, 256 * h))
    for i, r in enumerate(th):
        sheet.paste(r, (648 * (i % 2), 256 * (i // 2)))
    sheet.save(os.path.join(d, 'montage.png'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
