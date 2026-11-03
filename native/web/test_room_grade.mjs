// test_room_grade.mjs -- the room's blended pixels (worker 0213; notes/room-blend-streaming.md):
//   1. room.js materials against the GS formulas, pixel by pixel (always runs):
//      additive (chain blend m 1, ALPHA 0x48): clamp(Cd + Cs * As / 128), As up to 255 / 128
//      blend + ATE (m 0, ALPHA 0x44): (Cs - Cd) * As / 128 + Cd
//   2. GS-dump grades (when tools/trace/out/room_grade has the fixtures; room_grade_fixture.py):
//      c09  chunk 09's reported view (Vincent poked to (22, -40, 797); the game streamed 0 / 8 / 9):
//           the street left of Vincent, page vs gsrender2, with a control that draws the blended
//           chains opaque (the old orange wall) to show the grade sees it
//      c0b  chunk 0b, where ff88 (additive fire) shows: what the additive draws add, game
//           (render - render with them zeroed) vs page (render - render without ff88): coverage
//           IoU and sign; brightness (per-pixel correlation, total) with ff88's UV scroll
//           (room.js RoomUVAnim, worker 0226) set from the state's times (tools/trace/uvanim_fixture.py).
//      Both views hide the chain groups the page's own visibility probe gives from the fixture camera's eye
//      (room_vis.js, worker 0225; the export no longer drops the start mask), checked against the state's DAT_004e8710.
// Run: node native/web/test_room_grade.mjs   (needs playwright and the three.js CDN)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.ROOM_GRADE || path.join(here, '../../tools/trace/out/room_grade');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch (e) { console.log('SKIP: no playwright'); process.exit(0); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const HTML = `<!doctype html><meta charset="utf-8"><script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js" } }</script><body></body>`;
try {
  const pg = await browser.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/__grade.html', r => r.fulfill({ contentType: 'text/html', body: HTML }));
  await pg.route('**/xfix/**', r => {
    const f = path.join(FIX, decodeURIComponent(new URL(r.request().url()).pathname.replace(/^\/xfix\//, '')));
    if (!existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: readFileSync(f), contentType: f.endsWith('.json') ? 'application/json' : 'image/png' });
  });
  for (let k = 0; ; k++) { try { await pg.goto(`http://127.0.0.1:${port}/__grade.html`, { waitUntil: 'load' }); break; } catch (e) { if (k > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.evaluate(async () => {
    const THREE = await import('three');
    const room = await import('./room.js');
    const rv = await import('./room_vis.js');
    const visData = await fetch('data/z128_vis.json').then(r => r.ok ? r.json() : null);
    const roomVis = visData && rv.createRoomVis(visData);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
    renderer.setSize(432, 512, false); renderer.sortObjects = false; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const read = () => {
      const gl = renderer.getContext(), px = new Uint8Array(432 * 512 * 4);
      gl.readPixels(0, 0, 432, 512, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out = new Uint8Array(432 * 512 * 3);                // top row first
      for (let y = 0; y < 512; y++) for (let x = 0; x < 432; x++) for (let c = 0; c < 3; c++) out[(y * 432 + x) * 3 + c] = px[((511 - y) * 432 + x) * 4 + c];
      return out;
    };
    // untextured quads in an orthographic 432 x 512 view (no fog): a background quad (opaque) then the test quad
    const quad = (x, y, w, h, rgba, z) => {
      const g = new THREE.BufferGeometry(), c = rgba.map(v => v / 255);
      g.setAttribute('position', new THREE.Float32BufferAttribute([x, y, z, x + w, y, z, x + w, y + h, z, x, y, z, x + w, y + h, z, x, y + h, z], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute([].concat(...Array(6).fill(c)), 4));
      return g;
    };
    window.blendCases = (cases) => {
      const scene = new THREE.Scene(), sc = { fog: null };
      const cam = new THREE.OrthographicCamera(0, 432, 0, 512, -100, 100); cam.position.z = 10; cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      cases.forEach(({ cd, cs, a, blend }, i) => {
        const x = 2 + (i % 50) * 8, y = 2 + Math.floor(i / 50) * 8;
        const bg = new THREE.Mesh(quad(x, y, 7, 7, [cd, cd, cd, 128], 0), room.makeMaterial(sc, null, { kind: 'x', aref: -1, fog: false }, 0));
        scene.add(bg);
        const d = blend === 'add' ? { kind: 'x', aref: -1, fog: false, blend: 'add' } : { kind: 'x', aref: 96 / 128 - 0.5 / 128, fog: false };
        for (const mode of blend === 'add' ? [0] : [1, 2]) scene.add(new THREE.Mesh(quad(x, y, 7, 7, [...cs, a], 1), room.makeMaterial(sc, null, d, mode)));
      });
      renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, cam);
      const px = read();
      return cases.map((_, i) => { const x = 2 + (i % 50) * 8 + 3, y = 2 + Math.floor(i / 50) * 8 + 3; return [...px.slice((y * 432 + x) * 3, (y * 432 + x) * 3 + 3)]; });
    };
    let R = null;
    window.roomShot = async (meta, opts = {}) => {
      if (!R) { R = await room.loadRoom({ skip: d => d.kind === 'char' }); renderer.setClearColor(new THREE.Color().setRGB(...R.scene.clear, THREE.LinearSRGBColorSpace), 1); }
      // FUN_00264ee0 from the fixture camera's eye over its loaded chunks (opts.noMask: every group drawn)
      const vm = rv.createVisMask();
      if (roomVis) vm.setCamera(roomVis.probe(meta.cam.slice(0, 3), meta.chunks).mask);
      window.probeBits = roomVis ? vm.bits() : null;
      room.showChunks(R.root, meta.chunks, opts.noMask || !roomVis ? null : vm);
      // scrolling UVs (room.js RoomUVAnim; worker 0226): the state's times (meta.uv = uvanim_NAME.json's slots), then
      // meta.uv.frames page frames (the dump's last frame); opts.noScroll: every offset 0 (the page before the decode)
      if (R.uvAnim) {
        const ua = R.uvAnim; ua.time.clear(); ua.frame(meta.chunks, 0);
        if (meta.uv) {
          for (const sl of meta.uv.slots) { const T = ua.time.get(sl.chunk); if (T) ua.byChunk.get(sl.chunk).forEach((ai, k) => { T[k] = sl.times[ua.anims[ai].index]; }); }
          for (let k = 0; k < meta.uv.frames; k++) ua.frame(meta.chunks);
        }
        if (opts.noScroll || !meta.uv) { ua.off.fill(0); ua.tex.needsUpdate = true; }
      }
      for (const m of R.root.children) {
        const d = R.scene.draws[m.userData.draw];
        m.visible = !(opts.skipTex && d.tex === opts.skipTex);
        // control: blended draws drawn opaque (what the page did before the decoded chain blend)
        if (m.userData.saved === undefined) m.userData.saved = { b: m.material.blending, dw: m.material.depthWrite, add: m.material.uniforms.uAdd.value, cull: m.material.uniforms.uCull.value };
        const s = m.userData.saved;
        m.material.uniforms.uCull.value = s.cull && !opts.noCull;     // opts.noCull: both sides (the page before 0227)
        if (opts.opaque && (d.aref >= 0 || d.blend)) {
          m.material.blending = THREE.NoBlending; m.material.depthWrite = true; m.material.uniforms.uAdd.value = false;
          m.visible = m.visible && m.userData.mode !== 2;
          m.material.uniforms.uAMode.value = 0;
        } else {
          m.material.blending = s.b; m.material.depthWrite = s.dw; m.material.uniforms.uAdd.value = s.add;
          m.material.uniforms.uAMode.value = m.userData.mode;
        }
        m.material.needsUpdate = true;
      }
      const FB_W = 432, FB_H = 512, SCR_W = 448, FOV = 73.5, AY = 1.5, CX = 213, CY = 256;
      const SCRZ = SCR_W * 0.5 / Math.tan(FOV * 0.008726647);
      const cam = new THREE.PerspectiveCamera(60, 1, 1, R.lo.distanceTo(R.hi) * 1.2);
      const hw = Math.max(CX, FB_W - CX), hh = Math.max(CY, FB_H - CY);
      cam.fov = 2 * Math.atan(hh / (SCRZ * AY)) * 180 / Math.PI;
      cam.setViewOffset(2 * hw, 2 * hh, hw - CX, hh - CY, FB_W, FB_H);
      cam.aspect = (2 * hw / SCRZ) / (2 * hh / (SCRZ * AY)); cam.near = Math.max(0.5, cam.far * 0.0005);
      const v = meta.cam; cam.position.set(v[0], v[1], v[2]); cam.up.set(v[6], v[7], v[8]); cam.lookAt(v[3], v[4], v[5]);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      renderer.clear(); renderer.render(R.root, cam);
      return [...read()];
    };
    // back faces (worker 0227): one triangle with a cull tag, drawn alone; is the pixel at image (px, py) covered?
    window.cullCase = (tri, tag, px, py) => {
      const scene = new THREE.Scene(), sc = { fog: null, meshes: { m: { cul: 'x' } } };
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flat(), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(6).fill(0), 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(12).fill(1), 4));
      g.setAttribute('cullN', new THREE.BufferAttribute(new Int16Array([...tag, ...tag, ...tag]), 4));
      scene.add(new THREE.Mesh(g, room.makeMaterial(sc, null, { kind: 'room', mesh: 'm', aref: -1, fog: false }, 0)));
      renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, window.cullCam);
      const gl = renderer.getContext(), out = new Uint8Array(4);
      gl.readPixels(px, 511 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out[0] > 128;
    };
    // the game's view convention: y down, camera up (0, -1, 0) (play.js), perspective
    window.cullCam = new THREE.PerspectiveCamera(60, 432 / 512, 1, 1000);
    window.cullCam.up.set(0, -1, 0); window.cullCam.position.set(0, 0, 0); window.cullCam.lookAt(0, 0, 100); window.cullCam.updateMatrixWorld();
    window.project = (p) => { const v = new THREE.Vector3(...p).project(window.cullCam); return [(v.x + 1) / 2 * 432, (1 - v.y) / 2 * 512]; };
    window.png = async (url) => {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, out = [];
      for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2]);
      return out;
    };
  });

  // 1. the GS formulas
  {
    const cases = [];
    for (const cd of [0, 40, 128, 220]) for (const a of [16, 64, 128, 160, 192, 255]) for (const cs of [[255, 128, 30], [60, 60, 60], [200, 200, 255]]) {
      cases.push({ cd, cs, a, blend: 'add' });
      if (a <= 128) cases.push({ cd, cs, a, blend: 'ate' });
    }
    const got = await pg.evaluate(c => window.blendCases(c), cases);
    let worst = 0, wcase = null, worstA = 0;
    cases.forEach((c, i) => {
      const want = c.cs.map(s => c.blend === 'add' ? Math.min(255, c.cd + Math.floor(s * c.a / 128))
                                                  : Math.floor((s - c.cd) * c.a / 128) + c.cd);
      const e = Math.max(...want.map((w, k) => Math.abs(w - got[i][k])));
      if (e > worst) { worst = e; wcase = { ...c, want, got: got[i] }; }
      if (c.blend === 'add' && c.a > 128) worstA = Math.max(worstA, e);
    });
    ok(worst <= 3, `room.js blends = the GS formulas on ${cases.length} cases (worst ${worst}${wcase ? ': ' + JSON.stringify(wcase) : ''})`);
    ok(worstA <= 3, `additive with As > 1 (vertex alpha 160 / 192 / 255) is not capped (worst ${worstA})`);
  }

  // 1b. back faces (worker 0227; export_z128_room.py cull_tag, VU1 program A instr 100-106 / 249-260): random
  // non-planar strip quads (v0, v1, v2) + (v2, v1, v3) seen by a game-convention camera. The game's rule on the
  // projected (GS, y down) vertices: a triangle is front when (v0 - v1) x (v1 - v2) z >= 0; mode 1 draws it only
  // then, mode 2 also when the quad's other triangle is front, mode 0 always. room.js gets the exporter's tags
  // (partner game-front normal, mode; the second triangle emitted as (v3, v2, v1)) and must agree pixel by pixel.
  {
    const res = await pg.evaluate(() => {
      let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
      const sub = (a, b) => a.map((v, k) => v - b[k]);
      const cross = (a, b, c) => { const u = sub(b, a), v = sub(c, a); return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
      const tagOf = (a, b, c, mode) => { const n = cross(a, b, c), l = Math.hypot(...n); return [...n.map(x => Math.round(-x / l * 32767)), mode]; };
      const area = (a, b, c) => { const [p, q, r] = [a, b, c].map(window.project); return (p[0] - q[0]) * (q[1] - r[1]) - (p[1] - q[1]) * (q[0] - r[0]); };
      const out = { n: 0, bad: [], mixed: 0, back: 0, front: 0 };
      for (let k = 0; k < 1500 && out.n < 300; k++) {
        const c = [(rnd() - 0.5) * 20, (rnd() - 0.5) * 24, 30 + rnd() * 20];
        // a random plane basis
        const nrm = [rnd() - 0.5, rnd() - 0.5, (rnd() - 0.5) * (k % 2 ? 0.15 : 1)], l = Math.hypot(...nrm); nrm.forEach((v, i) => nrm[i] = v / l);
        const t0 = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const ux = cross([0, 0, 0], nrm, t0), lu = Math.hypot(...ux); ux.forEach((v, i) => ux[i] = v / lu);
        const uy = cross([0, 0, 0], nrm, ux);
        const P = (a, b, h) => c.map((v, i) => v + 5 * (a * ux[i] + b * uy[i]) + h * nrm[i]);
        const v0 = P(-1, -1, 0), v1 = P(1, -1, 0), v2 = P(-1, 1, 0), v3 = P(1, 1, (rnd() - 0.5) * 8);   // v3 off the plane
        const A1 = area(v0, v1, v2), A2 = area(v2, v1, v3);
        if (Math.abs(A1) < 400 || Math.abs(A2) < 400) continue;
        const f1 = A1 >= 0, f2 = A2 >= 0;
        out.mixed += f1 !== f2; out.back += !f1 && !f2; out.front += f1 && f2;
        const tris = [[[v0, v1, v2], tagOf(v2, v1, v3, 2), f1 || f2, 'tri1 mode 2'], [[v3, v2, v1], tagOf(v0, v1, v2, 2), f1 || f2, 'tri2 mode 2'],
                      [[v0, v1, v2], [0, 0, 0, 1], f1, 'tri1 mode 1'], [[v0, v1, v2], [0, 0, 0, 0], true, 'tri1 mode 0']];
        for (const [tri, tag, want, what] of tris) {
          const pr = tri.map(window.project), px = Math.round((pr[0][0] + pr[1][0] + pr[2][0]) / 3 - 0.5), py = Math.round((pr[0][1] + pr[1][1] + pr[2][1]) / 3 - 0.5);
          if (px < 2 || py < 2 || px > 429 || py > 509) continue;
          const got = window.cullCase(tri, tag, px, py);
          out.n++;
          if (got !== want) out.bad.push({ what, A1: Math.round(A1), A2: Math.round(A2), got, want });
        }
      }
      return out;
    });
    ok(res.n >= 300 && res.bad.length === 0, `back faces: room.js = the VU rule on ${res.n} triangles of random quads (${res.front} front / ${res.back} back / ${res.mixed} mixed quads)${res.bad.length ? ' BAD ' + JSON.stringify(res.bad.slice(0, 3)) : ''}`);
    ok(res.mixed >= 5 && res.back >= 5 && res.front >= 5, `back faces: the sample has front, back and mixed quads`);
  }

  // 2. GS-dump grades
  const have = n => existsSync(path.join(FIX, n + '.json')) && existsSync(path.join(FIX, n + '_game.png'));
  if (!existsSync(path.join(here, 'data/scene.json'))) console.log('SKIP dump grades: no data/scene.json');
  else if (!have('c09') || !have('c0b')) console.log(`SKIP dump grades: no fixtures in ${FIX} (tools/gsdump/src/room_grade_fixture.py)`);
  else {
    const meta = n => JSON.parse(readFileSync(path.join(FIX, n + '.json'), 'utf8'));
    // c09: the street left of Vincent (x 0..170, y 120..500 of the 432 x 512 frame; the HUD and Vincent are outside it)
    {
      const m = meta('c09');
      const game = await pg.evaluate(u => window.png(u), 'xfix/c09_game.png');
      const page = await pg.evaluate(mm => window.roomShot(mm), m);
      const bits = await pg.evaluate(() => window.probeBits);
      ok(bits && bits.join() === m.mask.join(), `c09: the page's probe from the fixture eye gives {${bits}} = the state's DAT_004e8710 {${m.mask}}`);
      const ctl = await pg.evaluate(mm => window.roomShot(mm, { opaque: true }), m);
      const all = await pg.evaluate(mm => window.roomShot(mm, { noMask: true }), m);
      const diff = (a, b) => { let s = 0, n = 0; for (let y = 120; y < 500; y++) for (let x = 0; x < 170; x++) { const i = (y * 432 + x) * 3; for (let c = 0; c < 3; c++) s += Math.abs(a[i + c] - b[i + c]); n += 3; } return s / n; };
      const dp = diff(page, game), dc = diff(ctl, game);
      ok(dp < 12, `c09 (chunk 09's reported view): street region |page - game| ${dp.toFixed(1)} < 12`);
      ok(dc > dp + 20, `c09 control: with the blended chains opaque the same region is off by ${dc.toFixed(1)} (the orange wall)`);
      const full = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
      const masked = full(page, game), unmasked = full(all, game);
      let changed = 0; for (let i = 0; i < page.length; i += 3) changed += (page[i] !== all[i] || page[i + 1] !== all[i + 1] || page[i + 2] !== all[i + 2]);
      console.log(`info c09: whole frame |page - game| ${masked.toFixed(2)} with the probe's mask, ${unmasked.toFixed(2)} with every group drawn (${changed} px differ)`);
      ok(masked <= unmasked, `c09: the mask does not move the whole frame away from the game (${masked.toFixed(2)} <= ${unmasked.toFixed(2)})`);
    }
    // c0b: what the additive draws add
    {
      const m = meta('c0b');
      const uvf = path.join(FIX, 'uvanim_c0b.json');     // tools/trace/uvanim_fixture.py; the dump's last frame = state + 3
      if (existsSync(uvf)) m.uv = { slots: JSON.parse(readFileSync(uvf, 'utf8')).slots, frames: 3 };
      const g1 = await pg.evaluate(u => window.png(u), 'xfix/c0b_game.png'), g0 = await pg.evaluate(u => window.png(u), 'xfix/c0b_noadd.png');
      const p1 = await pg.evaluate(mm => window.roomShot(mm), m), p0 = await pg.evaluate(mm => window.roomShot(mm, { skipTex: 't_0680ff88' }), m);
      const bits = await pg.evaluate(() => window.probeBits);
      ok(bits && bits.join() === m.mask.join(), `c0b: the page's probe gives {${bits}} = the state's DAT_004e8710 {${m.mask}}`);
      let gm = 0, pm = 0, both = 0, neg = 0, gsum = 0, psum = 0;
      for (let i = 0; i < 432 * 512; i++) {
        let gd = 0, pd = 0, pmin = 0;
        for (let c = 0; c < 3; c++) { gd = Math.max(gd, g1[i * 3 + c] - g0[i * 3 + c]); pd = Math.max(pd, p1[i * 3 + c] - p0[i * 3 + c]); pmin = Math.min(pmin, p1[i * 3 + c] - p0[i * 3 + c]); gsum += g1[i * 3 + c] - g0[i * 3 + c]; psum += p1[i * 3 + c] - p0[i * 3 + c]; }
        const a = gd > 4, b = pd > 4; gm += a; pm += b; both += a && b; neg += pmin < -2;
      }
      const iou = both / (gm + pm - both);
      ok(gm > 10000 && pm > 10000, `c0b: ff88 adds light to ${gm} game / ${pm} page pixels`);
      ok(iou > 0.5, `c0b: the page's ff88 covers the game's (IoU ${iou.toFixed(2)})`);
      ok(neg < 50, `c0b: ff88 only adds (pixels made darker: ${neg})`);
      // brightness (worker 0226): with the decoded UV scroll the page's ff88 samples the game's texels. Graded:
      // the per-pixel structure (correlation of the added light with the game's) against the page without the
      // scroll, and the total (0.83: with the raw PS2 texture alpha, export_web_room.py --raw-alpha / room.js uTexA;
      // OPEN: the rest; notes/room-blend-streaming.md "Scrolling UVs").
      const ratio = psum / gsum;
      if (m.uv) {
        const q0 = await pg.evaluate(mm => window.roomShot(mm, { noScroll: true }), m);
        const corr = (pa) => {      // Pearson r of the per-pixel added light (channel sum)
          let sg = 0, sp = 0, sgg = 0, spp = 0, sgp = 0; const n = 432 * 512;
          for (let i = 0; i < n; i++) {
            let gd = 0, pd = 0;
            for (let c = 0; c < 3; c++) { gd += g1[i * 3 + c] - g0[i * 3 + c]; pd += pa[i * 3 + c] - p0[i * 3 + c]; }
            sg += gd; sp += pd; sgg += gd * gd; spp += pd * pd; sgp += gd * pd;
          }
          return (sgp - sg * sp / n) / Math.sqrt((sgg - sg * sg / n) * (spp - sp * sp / n));
        };
        let qsum = 0; for (let i = 0; i < q0.length; i++) qsum += q0[i] - p0[i];
        const rS = corr(p1), rN = corr(q0);
        ok(rS > 0.8 && rS > rN + 0.15, `c0b: ff88's added light follows the game's per pixel: r ${rS.toFixed(3)} with the scroll, ${rN.toFixed(3)} without`);
        ok(ratio > 0.75 && ratio > qsum / gsum + 0.2, `c0b: page / game added light ${ratio.toFixed(3)} (${(qsum / gsum).toFixed(3)} without the scroll; 0.61 with the texture alpha capped at 0x80; OPEN: the rest of the gap, see the notes)`);
      } else console.log(`SKIP c0b brightness: no ${uvf} (tools/trace/uvanim_fixture.py); page / game added light ${ratio.toFixed(2)}`);
    }
    // back faces (worker 0227): on the pixels the cull changes, the culled page must be nearer the game than both
    // sides drawn. npc = worker 0223's NPC view (w223_npcview f100: the grey face in front of the eye).
    for (const name of ['c09', 'c0b', 'npc']) {
      if (!have(name)) { console.log(`SKIP back faces at ${name}: no fixture (room_grade_fixture.py)`); continue; }
      const m = meta(name);
      const uvf = path.join(FIX, `uvanim_${name}.json`);
      if (existsSync(uvf)) m.uv = { slots: JSON.parse(readFileSync(uvf, 'utf8')).slots, frames: 3 };
      const game = await pg.evaluate(u => window.png(u), `xfix/${name}_game.png`);
      const on = await pg.evaluate(mm => window.roomShot(mm), m), off = await pg.evaluate(mm => window.roomShot(mm, { noCull: true }), m);
      let n = 0, eOn = 0, eOff = 0, better = 0, worse = 0;
      for (let i = 0; i < 432 * 512; i++) {
        let d = 0, a = 0, b = 0;
        for (let c = 0; c < 3; c++) { d += Math.abs(on[i * 3 + c] - off[i * 3 + c]); a += Math.abs(on[i * 3 + c] - game[i * 3 + c]); b += Math.abs(off[i * 3 + c] - game[i * 3 + c]); }
        if (d <= 6) continue;
        n++; eOn += a / 3; eOff += b / 3; better += a < b; worse += a > b;
      }
      ok(n > 0 && eOn < eOff, `back faces at ${name}: ${n} px change; |page - game| there ${(eOn / Math.max(n, 1)).toFixed(1)} culled vs ${(eOff / Math.max(n, 1)).toFixed(1)} both sides (${better} px nearer, ${worse} farther)`);
    }
  }
  ok(errs.length === 0, `no page errors (${errs.slice(0, 2).join(' | ')})`);
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
