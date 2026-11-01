// test_hud_page.mjs -- hud.js (the HUD's GS stand-in) in a headless browser:
//   1. blend: As > 1 (font CLUT alpha up to 0xb0) against the GS formula ((Cs - Cd) As >> 7) + Cd,
//      clamped 0..255, pixel by pixel over dark and bright backgrounds, mixed channels included
//   2. pixel centres: our HUD at native scale against a HUD the GS drew (the walk dump's frozen
//      display buffer), on the pixels that are opaque in ours (same over black and over white)
//   3. cost: render calls and vertex upload bytes per frame on play.html
// Run: node native/web/test_hud_page.mjs   (needs playwright; data/hud/hud.json; check 2 needs
// tools/gsdump/dumps/z128_walk_185126.bin)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
if (!existsSync(path.join(here, 'data/hud/hud.json'))) { console.log('SKIP: no data/hud/hud.json (export_web_hud.py)'); process.exit(0); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch (e) { console.log('SKIP: no playwright'); process.exit(0); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const base = `http://127.0.0.1:${port}/`;
const HTML = `<!doctype html><meta charset="utf-8"><script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js" } }</script><body></body>`;
try {
  const pg = await browser.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/__hud_test.html', r => r.fulfill({ contentType: 'text/html', body: HTML }));
  for (let k = 0; ; k++) {
    try { await pg.goto(base + '__hud_test.html', { waitUntil: 'load' }); break; } catch (e) { if (k > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  // a HudLayer drawing into a 432 x 512 target (native mapping), read back top row first
  await pg.evaluate(async () => {
    const THREE = await import('three');
    const { HudLayer } = await import('./hud.js');
    const data = await (await fetch('data/hud/hud.json')).json();
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    const rt = new THREE.WebGLRenderTarget(432, 512, { type: THREE.UnsignedByteType, depthBuffer: false });
    const o = { renderer, w: 432, h: 512, x0: 213, y0: 256, cx: 213, cy: 256, kx: 1, ky: 1, native: true };
    window.T = {
      THREE, renderer, rt, data,
      layer: () => new HudLayer(data),
      draw(layer, prims, bg) {
        if (prims) layer.state.prims = () => prims;
        renderer.setRenderTarget(rt);
        renderer.setClearColor(new THREE.Color().setRGB(bg / 255, bg / 255, bg / 255, THREE.LinearSRGBColorSpace), 1);
        renderer.autoClear = false; renderer.clear();
        layer.draw(renderer, o);
        const px = new Uint8Array(432 * 512 * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, 432, 512, px);
        const out = new Uint8Array(432 * 512 * 3);
        for (let y = 0; y < 512; y++) for (let x = 0; x < 432; x++) for (let c = 0; c < 3; c++)
          out[(y * 432 + x) * 3 + c] = px[((511 - y) * 432 + x) * 4 + c];
        renderer.setRenderTarget(null);
        return out;
      },
    };
  });

  // 1. blend. Cells of 6 x 6 frame px: a background sprite (As = 1: writes Cd), then the test sprite
  // (untextured: Cs = Cf, As = Af / 128). Want the GS: clamp(((Cs - Cd) As >> 7) + Cd).
  {
    const cases = [];
    for (const cd of [0, 40, 128, 200, 255])
      for (const a of [64, 128, 129, 150, 176, 255])
        for (const cs of [[255, 255, 255], [16, 16, 16], [255, 100, 0], [220, 160, 64], [128, 128, 128], [0, 0, 0]]) cases.push({ cd, a, cs });
    const r = await pg.evaluate((cases) => {
      const prims = [];
      cases.forEach(({ cd, a, cs }, i) => {
        const x = 2 + (i % 60) * 7, y = 2 + Math.floor(i / 60) * 7;
        prims.push({ kind: 'sprite', tex: null, v: [[x, y, 0, 0], [x + 6, y + 6, 0, 0]], c: [cd, cd, cd, 128] });
        prims.push({ kind: 'sprite', tex: null, v: [[x, y, 0, 0], [x + 6, y + 6, 0, 0]], c: [...cs, a] });
        // draw order: a later sprite over the As > 1 one (half its alpha), 2 px down and right
        if (i % 3 === 0) prims.push({ kind: 'sprite', tex: null, v: [[x + 2, y + 2, 0, 0], [x + 6, y + 6, 0, 0]], c: [40, 200, 90, 96] });
      });
      // scissor (frame px, inclusive): a white sprite 100..130 x 440..470 clipped to x 105..112, y 450..457
      prims.push({ kind: 'sprite', tex: null, v: [[100, 440, 0, 0], [130, 470, 0, 0]], c: [255, 255, 255, 128], scissor: [105, 112, 450, 457] });
      const L = T.layer();
      const img = T.draw(L, prims, 0);
      const lit = []; for (let y = 438; y < 472; y++) for (let x = 98; x < 132; x++) if (img[(y * 432 + x) * 3] > 128) lit.push([x, y]);
      window.__sc = lit.length ? [Math.min(...lit.map(q => q[0])), Math.max(...lit.map(q => q[0])), Math.min(...lit.map(q => q[1])), Math.max(...lit.map(q => q[1])), lit.length] : [];
      return { batches: L.lastBatches, px: cases.map((_, i) => { const x = 5 + (i % 60) * 7, y = 5 + Math.floor(i / 60) * 7; return Array.from(img.slice((y * 432 + x) * 3, (y * 432 + x) * 3 + 3)); }) };
    }, cases);
    const gs = (cs, cd, a) => Math.max(0, Math.min(255, (((cs - cd) * a) >> 7) + cd));
    let worst = 0, where = '', n = 0, nOver = 0;
    cases.forEach(({ cd, a, cs }, i) => {
      for (let c = 0; c < 3; c++) {
        let want = gs(cs[c], cd, a);
        if (i % 3 === 0) want = gs([40, 200, 90][c], want, 96);       // the later sprite, blended after
        const d = Math.abs(r.px[i][c] - want);
        if (d > worst) { worst = d; where = `Cs ${cs[c]} Cd ${cd} As ${a}${i % 3 ? '' : ' + later sprite'}: got ${r.px[i][c]}, GS ${want}`; }
        n++; if (a > 128 && cs[c] * a / 128 > 255) nOver++;
      }
    });
    const sc = await pg.evaluate(() => window.__sc);
    ok(sc.join() === '105,112,450,457,64', `scissor: exactly frame px x 105..112, y 450..457 lit (${sc})`);
    ok(worst <= 2, `blend: ${n} channel values (${nOver} with Cs As > 255; a third with a later sprite on top) within 2 levels (two 8-bit roundings) of the GS formula (worst ${worst}${where ? ': ' + where : ''})`);
  }

  // 2. pixel centres. The walk dump's freeze snapshot holds the previous displayed frame (DISPFB FBP
  // 112, PSMCT24, FBW 7) with the HUD the GS drew (HP 780 / 780, the save's values). Pixels where our
  // HUD is the same over black and over white are background-independent; on those, count how many
  // equal the GS frame (within 2 levels), with the +0.5 px shift (hud.js) and without it.
  const DUMP = path.join(here, '../../tools/gsdump/dumps/z128_walk_185126.bin');
  if (!existsSync(DUMP)) console.log('skip pixel centres: no ' + DUMP);
  else {
    const buf = readFileSync(DUMP);
    const memAt = 8 + buf.readUInt32LE(4) + 0x1a9;
    const B32 = [[0, 1, 4, 5, 16, 17, 20, 21], [2, 3, 6, 7, 18, 19, 22, 23], [8, 9, 12, 13, 24, 25, 28, 29], [10, 11, 14, 15, 26, 27, 30, 31]];
    const C32 = [[0, 1, 4, 5, 8, 9, 12, 13], [2, 3, 6, 7, 10, 11, 14, 15], [16, 17, 20, 21, 24, 25, 28, 29], [18, 19, 22, 23, 26, 27, 30, 31],
      [32, 33, 36, 37, 40, 41, 44, 45], [34, 35, 38, 39, 42, 43, 46, 47], [48, 49, 52, 53, 56, 57, 60, 61], [50, 51, 54, 55, 58, 59, 62, 63]];
    const gsPx = (x, y) => {                     // PSMCT32 page layout, FBP 112, FBW 7
      const wa = (112 + (x >> 6) + (y >> 5) * 7) * 2048 + B32[(y & 31) >> 3][(x & 63) >> 3] * 64 + C32[y & 7][x & 7];
      return [buf[memAt + 4 * wa], buf[memAt + 4 * wa + 1], buf[memAt + 4 * wa + 2]];
    };
    const res = await pg.evaluate(() => {
      const out = {};
      for (const h of [0.5, 0]) {
        const L = T.layer(); if (h === 0) L.pixelCentre = 0; L.state.now = 1000;   // 0.5: hud.js's own default
        const k = T.draw(L, null, 0), w = T.draw(L, null, 255);
        out[h] = { k: Array.from(k), w: Array.from(w) };
      }
      return out;
    });
    // the HP panel (gauge frame, bars, "780/780"): x 0..215, y 20..64
    const score = (h) => {
      const { k, w } = res[h];
      let n = 0, eq = 0;
      for (let y = 20; y < 64; y++) for (let x = 0; x < 216; x++) {
        const i = (y * 432 + x) * 3;
        if (k[i] !== w[i] || k[i + 1] !== w[i + 1] || k[i + 2] !== w[i + 2]) continue;
        if (k[i] + k[i + 1] + k[i + 2] < 30) continue;      // dark opaque pixels: too close to the scene to tell
        n++;
        const g = gsPx(x, y);
        if (Math.max(...[0, 1, 2].map(c => Math.abs(g[c] - k[i + c]))) <= 2) eq++;
      }
      return { n, eq };
    };
    const a = score(0.5), b = score(0);
    console.log(`     opaque HUD pixels (HP panel) equal to the GS's: +0.5 px ${a.eq} / ${a.n}, no shift ${b.eq} / ${b.n}`);
    ok(a.eq / a.n >= 0.97 && a.eq > b.eq, `pixel centres: with the +0.5 px shift ${(100 * a.eq / a.n).toFixed(1)} % of the opaque HUD pixels equal the GS frame (no shift: ${(100 * b.eq / b.n).toFixed(1)} %)`);
  }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join('; ') : ''));
  await pg.close();

  // 3. cost on play.html: WebGL calls made inside output.hud (the game HUD only: the reticle and the
  // pause layer draw there too, so the hook wraps hud.js's HudLayer.draw)
  {
    const pg2 = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await pg2.addInitScript(() => {
      const st = window.__hudCost = { on: false, draws: 0, bytes: 0, frames: 0, ms: 0 };
      const P = WebGL2RenderingContext.prototype;
      for (const f of ['drawArrays', 'drawElements']) { const o = P[f]; P[f] = function (...a) { if (st.on) st.draws++; return o.apply(this, a); }; }
      const bd = P.bufferData; P.bufferData = function (t, d, ...a) { if (st.on && d && d.byteLength) st.bytes += d.byteLength; return bd.call(this, t, d, ...a); };
      const bs = P.bufferSubData; P.bufferSubData = function (t, off, d, so, len) { if (st.on) st.bytes += len ? len * (d.BYTES_PER_ELEMENT || 1) : d.byteLength - (so || 0) * (d.BYTES_PER_ELEMENT || 1); return bs.call(this, t, off, d, so, len); };
    });
    await pg2.goto(base + 'play.html?sound=0', { waitUntil: 'load' });
    await pg2.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
    const cost = await pg2.evaluate(async () => {
      const mod = await import('./hud.js');
      const P = mod.HudLayer.prototype, d0 = P.draw, st = window.__hudCost;
      P.draw = function (r, o) {
        const gl = r.getContext(); st.on = true; const t = performance.now();
        d0.call(this, r, o); gl.finish(); st.ms += performance.now() - t; st.on = false; st.frames++;
      };
      await new Promise(r => setTimeout(r, 4000));
      P.draw = d0;
      return { ...st };
    });
    const f = Math.max(cost.frames, 1);
    console.log(`     per HUD frame (${cost.frames} frames): ${(cost.draws / f).toFixed(1)} draw calls, ${(cost.bytes / f / 1024).toFixed(1)} KiB uploaded, ${(cost.ms / f).toFixed(2)} ms (with gl.finish)`);
    ok(cost.frames > 0 && cost.draws / f <= 120 && cost.bytes / f <= 64 * 1024,
      `play.html: the game HUD draws (${cost.frames} frames) with <= 120 draw calls and <= 64 KiB of uploads per frame (before the fix: 188 and 101 MB)`);
    await pg2.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
