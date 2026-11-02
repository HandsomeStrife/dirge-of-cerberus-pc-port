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
  // 5. OPTION widehud (full mode, output.js -> hud.js): a panel's bounding box (lit pixels) per canvas size.
  // Left panel = slot 5 (HP), right panel = slot 4 (hidden at the start: shown here). Want: with the option,
  // the left panel's left edge sits as far from the canvas edge as in the 4:3 picture from the picture's
  // edge, the right panel's right edge likewise; without it, today's mapping (the 4:3 layout centred).
  {
    const r = await pg.evaluate(async () => {
      const { createOutputStage } = await import('./output.js');
      const { panelAnchors } = await import('./hud.js');
      const { THREE, renderer, data } = T;
      const L = T.layer(), st = L.state;
      const gi = s => st.chain.findIndex(e => e.depth === 0 && e.slot === s);
      for (const e of st.chain) if (e.inGroup === gi(4)) e.flags &= ~1;
      const all = st.prims.bind(st);
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1, 1, 10);
      renderer.setClearColor(0x000000, 1);
      const box = (w, h, wide, slot) => {
        const stage = createOutputStage(renderer, { enabled: false, native: false, wideHud: wide });
        st.prims = () => all().filter(p => p.panel === gi(slot));
        stage.hud = o => L.draw(o.renderer, o);
        const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
        stage.render(scene, cam, rt);
        const px = new Uint8Array(w * h * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
        rt.dispose();
        let x0 = w, x1 = -1, n = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (px[i] + px[i + 1] + px[i + 2] > 0) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
        }
        return { x0, x1, n, w };
      };
      const out = { anchors: {}, prims4: all().filter(p => p.panel === gi(4)).length };
      const A = panelAnchors(st.chain);
      for (const s of ['root', 1, 3, 4, 5, 6, 7, 8, 9, 10]) out.anchors[s] = A[gi(s)];
      for (const [w, h] of [[1200, 900], [1600, 900], [1000, 900], [960, 720], [1280, 720]])
        for (const wide of [false, true]) for (const s of [5, 4]) out[`${w}x${h} ${wide ? 'on' : 'off'} ${s}`] = box(w, h, wide, s);
      st.prims = all;
      return out;
    });
    const B = (w, h, on, s) => r[`${w}x${h} ${on ? 'on' : 'off'} ${s}`];
    console.log('     widehud boxes (x0..x1): ' + ['1200x900', '1600x900', '1000x900', '960x720', '1280x720'].map(k => { const [w, h] = k.split('x').map(Number);
      return `${k} on L ${B(w, h, 1, 5).x0} R ${B(w, h, 1, 4).x1} / off L ${B(w, h, 0, 5).x0} R ${B(w, h, 0, 4).x1}`; }).join('; '));
    ok(JSON.stringify(r.anchors) === JSON.stringify({ 1: 1, 3: 0, 4: 1, 5: -1, 6: -1, 7: -1, 8: -1, 9: -1, 10: -1, root: 0 }),
      `widehud anchors per panel: slots 5 6 7 8 9 10 left, 1 4 right, root (reticle / ring) and 3 centred (${JSON.stringify(r.anchors)})`);
    ok(r.prims4 > 0 && B(1200, 900, 1, 4).n > 0 && B(1200, 900, 1, 5).n > 0, `both test panels draw (slot 4: ${r.prims4} prims)`);
    const same = (a, b) => a.x0 === b.x0 && a.x1 === b.x1 && a.n === b.n;
    let good = true;
    for (const [w43, w, h] of [[1200, 1600, 900], [960, 1280, 720]]) {
      // 4:3 canvas: the option changes nothing
      good &&= same(B(w43, h, 1, 5), B(w43, h, 0, 5)) && same(B(w43, h, 1, 4), B(w43, h, 0, 4));
      // 16:9, on: left edge / right margin as on the 4:3 canvas; the panels keep their size
      const l = B(w, h, 1, 5), r4 = B(w, h, 1, 4);
      ok(l.x0 === B(w43, h, 1, 5).x0 && w - r4.x1 === w43 - B(w43, h, 1, 4).x1 && l.x1 - l.x0 === B(w43, h, 1, 5).x1 - B(w43, h, 1, 5).x0 && l.n === B(w43, h, 1, 5).n,
        `widehud on, ${w}x${h}: left panel's left edge ${l.x0} px from the canvas edge, right panel's right edge ${w - 1 - r4.x1} px (4:3: ${B(w43, h, 1, 5).x0} / ${w43 - 1 - B(w43, h, 1, 4).x1}); same size`);
      // 16:9, off: today's mapping = the 4:3 layout moved by the side margin
      const m = (w - w43) / 2;
      ok(B(w, h, 0, 5).x0 === B(w43, h, 0, 5).x0 + m && B(w, h, 0, 4).x1 === B(w43, h, 0, 4).x1 + m,
        `widehud off, ${w}x${h}: the 4:3 layout centred (left ${B(w, h, 0, 5).x0}, right ${B(w, h, 0, 4).x1}; 4:3 + ${m})`);
    }
    ok(good, 'widehud on a 4:3 canvas: positions as without it');
    ok(same(B(1000, 900, 1, 5), B(1000, 900, 0, 5)) && same(B(1000, 900, 1, 4), B(1000, 900, 0, 4)), 'widehud on a canvas narrower than 4:3 (1000 x 900): no shift');
  }
  // 7. widehud while the HUD slides (worker 0203): the slide moves a whole panel (FUN_003cb380 on its group) and the
  // option shifts by panel, so at every slide time a panel's lit pixels on 1600 x 900 (on) are the 4:3 canvas's
  // (1200 x 900) moved by the margin: same box size, same count, left edge at the same distance from the canvas edge
  {
    const r = await pg.evaluate(async () => {
      const { createOutputStage } = await import('./output.js');
      const { THREE, renderer } = T;
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1, 1, 10);
      renderer.setClearColor(0x000000, 1);
      const out = {};
      for (const t of [0, 60, 150, 250, 400, 600]) {
        const L = T.layer(), st = L.state;
        const gi = s => st.chain.findIndex(e => e.depth === 0 && e.slot === s);
        st.now = st.mnow = 50000; st.hideAll(); st.mnow += t; st.slideFrame();
        const all = st.prims.bind(st);
        for (const slot of [5, 6]) for (const [w, wide] of [[1200, false], [1600, true]]) {
          const stage = createOutputStage(renderer, { enabled: false, native: false, wideHud: wide });
          st.prims = () => all().filter(p => p.panel === gi(slot));
          stage.hud = o => L.draw(o.renderer, o);
          const rt = new THREE.WebGLRenderTarget(w, 900, { type: THREE.UnsignedByteType, depthBuffer: false });
          stage.render(scene, cam, rt);
          const px = new Uint8Array(w * 900 * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, w, 900, px);
          rt.dispose();
          let x0 = w, x1 = -1, y0 = 900, y1 = -1, n = 0;
          for (let y = 0; y < 900; y++) for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (px[i] + px[i + 1] + px[i + 2] > 0) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          }
          out[`${t} ${slot} ${w}`] = { x0, x1, y0, y1, n };
        }
      }
      // a slot-5 sprite moved past the frame's right edge (frame x 440..): the game's full-frame scissor cuts it; with
      // widehud on, its panel is shifted and the canvas is the frame, so it shows (as a panel sliding out to the right)
      {
        const L = T.layer(), st = L.state, gi = st.chain.findIndex(e => e.depth === 0 && e.slot === 5);
        const sp = st.prims().filter(p => p.panel === gi && p.kind === 'sprite' && !p.scissor);
        const p0 = JSON.parse(JSON.stringify(sp[0])), x0 = Math.min(p0.v[0][0], p0.v[1][0]);
        for (const v of p0.v) v[0] += 440 - x0;
        st.prims = () => [p0];
        for (const [w, wide] of [[1600, true], [1600, false]]) {
          const stage = createOutputStage(renderer, { enabled: false, native: false, wideHud: wide });
          stage.hud = o => L.draw(o.renderer, o);
          const rt = new THREE.WebGLRenderTarget(w, 900, { type: THREE.UnsignedByteType, depthBuffer: false });
          stage.render(scene, cam, rt);
          const px = new Uint8Array(w * 900 * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, w, 900, px);
          rt.dispose();
          let n = 0, x0c = w;
          for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 0) { n++; x0c = Math.min(x0c, (i / 4) % w); }
          out['edge ' + (wide ? 'on' : 'off')] = { n, x0: x0c };
        }
      }
      return out;
    });
    ok(r['edge on'].n > 0 && r['edge on'].x0 >= 1200 && r['edge off'].n === 0,
       `widehud: a shifted panel past the frame's right edge still draws (on: ${r['edge on'].n} px from x ${r['edge on'].x0}; off: ${r['edge off'].n}, the game's frame scissor)`);
    const bad = [];
    let lit = 0;
    for (const t of [0, 60, 150, 250, 400, 600]) for (const slot of [5, 6]) {
      const a = r[`${t} ${slot} 1200`], b = r[`${t} ${slot} 1600`];
      if (a.n) lit++;
      if (a.n !== b.n || (a.n && (a.x0 !== b.x0 || a.x1 - a.x0 !== b.x1 - b.x0 || a.y0 !== b.y0 || a.y1 !== b.y1))) bad.push(`t ${t} slot ${slot}`);
    }
    ok(lit >= 6 && bad.length === 0 && r['600 5 1200'].n === 0 && r['600 6 1200'].n === 0,
       `widehud during the slide-out: HP (slot 5) and weapon (slot 6) panels move as units at t 0 / 60 / 150 / 250 / 400 ms, gone at 600${bad.length ? ': differ ' + bad.join(', ') : ''}`);
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
    // 4. the hit-direction ring on play.html: a soldier's bullet (enemy_ai enemyBulletHit, the real hit test and
    // handler) from 100 u to Vincent's +X -> playerHandler -> opts.hudHit -> hud.js -> drawn in the frame
    const shot = async () => pg2.screenshot({ clip: { x: 240, y: 170, width: 480, height: 260 } });
    const ring = await pg2.evaluate(async () => {
      const P = window.__play, wait = n => new Promise(r => { const t0 = P.stats.ticks; const f = () => P.stats.ticks >= t0 + n ? r() : setTimeout(f, 20); f(); });
      if (!P.gameHud || !P.enemyAI) return { skip: !P.gameHud ? 'no game HUD' : 'no enemy AI' };
      const st = P.gameHud.state, before = st.prims().filter(p => p.ring).length;
      const p = P.php.pos, hits = [];
      for (const h of [8, 10, 12, 6]) for (const d of [0.5, 1, -1, 2]) {
        if (hits.length) break;
        const b = { start: [p[0] + 100, p[1] - h, p[2] + d], prev: [p[0] + 40, p[1] - h, p[2] + d], pos: [p[0] - 40, p[1] - h, p[2] + d],
                    f120: 0x2000, shooter: 0x2c, from: {}, damage: 1, kind: 0, dir: [-1, 0, 0], f148: 0, hit: 0 };
        if (P.enemyAI.t.enemyBulletHit(b) === 1) hits.push([h, d]);
      }
      // a second shot from +Z (Vincent's +Z side: a = 1024 -> sector 0)
      if (hits.length) {
        const [h, d] = hits[0];
        const b = { start: [p[0], p[1] - h, p[2] + 100], prev: [p[0] + d, p[1] - h, p[2] + 40], pos: [p[0] + d, p[1] - h, p[2] - 40],
                    f120: 0x2000, shooter: 0x2c, from: {}, damage: 1, kind: 0, dir: [0, 0, -1], f148: 0, hit: 0 };
        if (P.enemyAI.t.enemyBulletHit(b) === 1) hits.push(['+Z', d]);
      }
      await wait(8);
      return { before, hits, after: st.prims().filter(p => p.ring).length, timers: st.ring.timers.map(t => t ? t - st.now : 0), phase: st.ring.phase };
    });
    if (ring.skip) console.log('SKIP ring on play.html: ' + ring.skip);
    else {
      ok(ring.before === 0 && ring.hits.length === 2 && ring.after === 14 && ring.phase === 2 && ring.timers.filter(t => t > 0).length === 2 && ring.timers[2] > 1500 && ring.timers[0] === ring.timers[2],
        `play.html: bullet hits from +X and +Z light segments 2 and 0 for 2 s and the ring is drawn (6 grey segments x 2 halves + 2 arrows = 14 strips) (${JSON.stringify(ring)})`);
      const a = await shot();
      await pg2.evaluate(() => new Promise(r => { const P = window.__play, t0 = P.stats.ticks; const f = () => P.stats.ticks >= t0 + 120 ? r() : setTimeout(f, 20); f(); }));
      const b = await shot();
      const orange = await pg2.evaluate(async ([a64, b64]) => {
        const px = async s => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode();
          const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
        const A = await px(a64), B = await px(b64);
        let n = 0;
        for (let i = 0; i < A.length; i += 4) if (A[i] - B[i] > 25 && A[i] - A[i + 2] > 25) n++;
        return n;
      }, [a.toString('base64'), b.toString('base64')]);
      ok(orange > 50, `the arrow shows on screen while lit and is gone 2.4 s later (${orange} pixels redder before)`);
    }
    // 6. play.js wiring of OPTION widehud: on by default, ?widehud=0 off
    const wideOn = await pg2.evaluate(() => window.__play.output.wideHud);
    await pg2.close();
    const pg3 = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await pg3.goto(base + 'play.html?sound=0&widehud=0', { waitUntil: 'load' });
    await pg3.waitForFunction(() => window.__play && window.__play.stats.ticks > 2, null, { timeout: 120000 });
    const wideOff = await pg3.evaluate(() => window.__play.output.wideHud);
    await pg3.close();
    ok(wideOn === true && wideOff === false, `play.html: widehud on by default (${wideOn}), off with ?widehud=0 (${wideOff})`);
  }
  // 8. play.html, the game over (worker 0203): gameover.js 'begin' (FUN_003fdb48(3)) -> hud.js hideAll -> the panels
  // slide out from that frame's clock (FUN_003aff20); Restart (checkpoint.js -> hud.js reset) slides them back in
  // (FUN_003ad560) to the start layout; H does the same, also during the slide
  {
    const pg4 = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errs4 = [];
    pg4.on('pageerror', e => errs4.push(e.message));
    await pg4.goto(base + 'play.html?sound=0', { waitUntil: 'load' });
    await pg4.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
    const skip = await pg4.evaluate(async () => {
      const P = window.__play;
      if (!P.gameHud || !P.gameOver) return !P.gameHud ? 'no game HUD' : 'no game over';
      const H = await import('./hud_core.js');
      const data = await (await fetch('data/hud/hud.json')).json();
      const log = window.__hlog = [];
      const t0 = P.gameHud.tick;
      // per game frame, after hud.js tick: the HUD clock, slots 5 / 8's group, whether this frame began the game over
      P.gameHud.tick = () => {
        t0();
        const st = P.gameHud.state, g = s => st.chain[st.groupOf[s]];
        log.push({ now: st.now, y5: g(5).rect[1], st5: g(5).slide[0], t5: g(5).slide[6], x8: g(8).rect[0], begin: P.gameOver.go.events.includes('begin'), restarts: P.restart.count });
      };
      window.__ref = { H, data };
      return null;
    });
    if (skip) console.log('SKIP game over slide on play.html: ' + skip);
    else {
      await pg4.evaluate(() => { window.__play.php.hp = 0; });
      await pg4.waitForFunction(() => { const L = window.__hlog, i = L.findIndex(r => r.begin); return i >= 0 && L.length > i + 30; }, null, { timeout: 60000 });
      const A = await pg4.evaluate(() => {
        const L = window.__hlog, i = L.findIndex(r => r.begin), { H } = window.__ref;
        const an = [2, 5, 0, 0, 0, -100, 0], tab = window.__ref.data.slides[0], want = [];
        H.slideStart(an, tab, L[i].now, true);
        for (let k = 0; k <= 30; k++) { const xy = H.slideAt(an, L[i + k].now); if (xy) want.push(xy[1]); else want.push(want[want.length - 1]); }
        return { t5: L[i].t5, now: L[i].now, ys: L.slice(i, i + 31).map(r => r.y5), want, x8: L[i + 10].x8, st5: [L[i + 24].st5, L[i + 25].st5],
                 before: L[i - 1].y5 };
      });
      ok(A.t5 === A.now && A.before === 0 && A.ys[0] === 0, `the slide-out starts in the frame gameover.js begins (FUN_003fdb48(3) -> FUN_003ad5b0; start ${A.t5} = that frame's clock ${A.now})`);
      ok(A.ys.join() === A.want.join() && A.x8 === -496 && A.st5.join() === '3,4',
         `HP panel per frame = FUN_003d0d50 (${A.ys.slice(0, 26).join(' ')}); slots 8-10 gone after 10 frames, 5 / 6 after 25`);
      // Restart from the game over menu
      await pg4.waitForFunction(() => window.__play.gameOver.go.menu, null, { timeout: 60000 });
      await pg4.waitForTimeout(300);
      await pg4.keyboard.press('Space');
      await pg4.waitForFunction(() => { const L = window.__hlog, i = L.findIndex(r => r.restarts === 1); return i >= 0 && L.length > i + 30; }, null, { timeout: 60000 });
      const R = await pg4.evaluate(() => {
        const L = window.__hlog, i = L.findIndex(r => r.restarts === 1), P = window.__play, { H, data } = window.__ref;
        const ref = new H.HudState(data), st = P.gameHud.state;
        return { ys: L.slice(i, i + 14).map(r => r.y5), x8: L[i].x8,
                 same: st.chain.every((e, k) => e.rect.join() === ref.chain[k].rect.join() && e.box.join() === ref.chain[k].box.join() && e.flags === ref.chain[k].flags) };
      });
      ok(R.ys[0] < 0 && R.ys[0] > -100 && R.ys[12] === 0 && R.x8 === 16 && R.same,
         `Restart: the rebuilt HUD slides in (HP panel ${R.ys.join(' ')}; slots 8-10 already in), then the start layout`);
      // H during a new slide-out (5 frames in): back in, then the start layout
      await pg4.evaluate(() => { window.__hlog.length = 0; window.__play.php.hp = 0; });
      await pg4.waitForFunction(() => { const L = window.__hlog, i = L.findIndex(r => r.begin); return i >= 0 && L.length > i + 5; }, null, { timeout: 60000 });
      await pg4.keyboard.press('KeyH');
      await pg4.waitForTimeout(1500);
      const Hh = await pg4.evaluate(() => {
        const P = window.__play, { H, data } = window.__ref, ref = new H.HudState(data), st = P.gameHud.state;
        return { hp: P.php.hp, same: st.chain.every((e, k) => e.rect.join() === ref.chain[k].rect.join() && e.box.join() === ref.chain[k].box.join() && e.flags === ref.chain[k].flags) };
      });
      ok(Hh.hp === 780 && Hh.same, 'H during the slide-out: the HUD comes back to the start layout');
      // the pause during the slide-in: FUN_0023c1f0 (the slides' clock) runs on through the game's pause, so after a
      // 1.5 s pause the first game frame has the slide done (the page's game frames stop while paused)
      await pg4.evaluate(() => { window.__hlog.length = 0; });
      await pg4.keyboard.press('KeyH');
      await pg4.keyboard.press('Enter');
      await pg4.waitForTimeout(1500);
      const pz = await pg4.evaluate(() => ({ open: window.__play.pause.active, n: window.__hlog.length, y: window.__hlog.map(r => r.y5) }));
      await pg4.keyboard.press('Enter');
      await pg4.waitForTimeout(500);
      const pa = await pg4.evaluate(() => window.__hlog.map(r => [r.y5, r.st5]));
      const after = pa.slice(pz.n);
      ok(pz.open && pz.y.length < 12 && pz.y.every(y => y < 0) && after.length > 0 && after[0][0] === 0 && after[0][1] === 2,
         `pause during the slide-in (H): paused after ${pz.n} frames (y ${pz.y.join(' ')}), the first frame after it at the start layout (${after.slice(0, 3).map(a => a.join('/')).join(' ')})`);
    }
    ok(errs4.length === 0, 'no page errors (play.html game over)' + (errs4.length ? ': ' + errs4.join('; ') : ''));
    await pg4.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
