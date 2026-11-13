// The game over on the real play.html, in a headless browser (worker 0192):
//   1. HP 0: the pause no longer opens; the Restart / Quit box opens 293 game frames after the death frame's clock
//      (91 to the request, 1 to the sequence, 200 = 4000 ms to the menu); ✕ on Restart goes to the checkpoint 1 s later (no reload).
//      The 293 include the GUESS 'the title file read finishes at once' (the game spends 9 more frames: 302).
//   2. down + ✕ on Quit: a warning, no reload. 3. H (the page's respawn) resets the game over; a new death restarts it.
//   GAMEOVER_SHOT=<png> saves the open box.  node native/web/test_gameover_page.mjs (needs playwright + data; else SKIP)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['pause.json', 'gameover.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open() {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  return { pg, errs, warns };
}
// kill Vincent between two game frames; returns the game over clock at that moment
const kill = pg => pg.evaluate(() => {
  const G = window.__play.gameOver;
  window.__menuAt = null;
  const o = G.go.openMenu.bind(G.go);
  G.go.openMenu = now => { window.__menuAt = now; return o(now); };
  window.__titleAt = null; window.__beginAt = null;      // worker 0198: the title's spawn vs the request
  const b = G.go.begin.bind(G.go);
  G.go.begin = (...x) => { window.__beginAt = G.clock; return b(...x); };
  if (G.title) { const sp = G.title.fx.spawn; G.title.fx.spawn = (...x) => { window.__titleAt = G.clock; return sp(...x); }; }
  window.__play.php.hp = 0;
  return G.clock;
});
const menuOpen = pg => pg.waitForFunction(() => window.__menuAt !== null && window.__play.gameOver.go.menu, null, { timeout: 60000 });
try {
  { // 1
    const { pg, errs } = await open();
    ok(await pg.evaluate(() => !!(window.__play.gameOver && window.__play.gameOver.go.D)), 'game over loaded with its menu data');
    const c0 = await kill(pg);
    await pg.waitForTimeout(300);
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(300);
    ok(!(await pg.evaluate(() => window.__play.pause.active)), 'dead: Start does not open the pause (FUN_00241760(1, 3, 0))');
    // the title reaches the canvas (worker 0198 review): ~1 s after its spawn, render the frame with and without
    // the title's group and count the changed pixels inside the letters' screen box. Without the depth clear
    // before layer 5 (FUN_002f0250 -> FUN_002ee990) the floor hides the letters.
    const hasTitle = await pg.evaluate(() => !!window.__play.gameOver.title);
    if (hasTitle) {
      await pg.waitForFunction(() => window.__titleAt !== null, null, { timeout: 60000 });
      await pg.waitForTimeout(1000);
      const P = await pg.evaluate(() => {
        const { renderer, output, root, camera, gameOver: G } = window.__play, L = G.titleLayer, gl = renderer.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const letters = L.last.filter(s => s.alpha === 0x44 && s.tex && /:1$/.test(s.tex.k));   // (models: untextured items, worker 0206)
        const w = L.camera.matrixWorld.elements, V = camera.position.constructor;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const s of letters) for (const v of s.verts) {
          const [x, y, z] = [v.pos[0], -v.pos[1], -v.pos[2]];
          const q = new V(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14]).applyMatrix4(L.proj2d.value);
          const px = (q.x + 1) / 2 * W, py = (q.y + 1) / 2 * H;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
        const grab = () => { output.render(root, camera); const b = new Uint8Array((x1 - x0) * (y1 - y0) * 4); gl.readPixels(x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const a = grab(); L.group.visible = false; const b = grab(); L.group.visible = true;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
        const kids = L.group.children;
        return { n, area: (x1 - x0) * (y1 - y0), letters: letters.length, clearFirst: kids[0] === L.depthClear && L.depthClear.visible,
          after: root.children.indexOf(L.group) > root.children.indexOf(window.__fx?.layer?.group ?? L.group) || !window.__fx };
      });
      ok(P.letters > 0 && P.n > 0.1 * P.area, `the title's letters reach the canvas ~1 s after the spawn (${P.letters} letter sprites; ${P.n} of ${P.area} px in their box change)`);
      ok(P.clearFirst && P.after, 'the depth clear (FUN_002ee990) is the title group\'s first draw, and the group draws after the 3D effects (scene-graph order)');
    }
    await menuOpen(pg);
    const dt = (await pg.evaluate(() => window.__menuAt)) - c0;
    ok(dt === 293 * 20, `menu opens 293 game frames after the death (clock +${dt} ms; 5860 expected)`);
    await pg.waitForTimeout(400);                  // the 100 ms open
    // the letters' glow (type 35, worker 0202): the title has settled (8 looping glows, RGBA 128, 0, 0, 38, ALPHA 0x48);
    // render with and without the glow meshes: inside their boxes red rises (the previous frame's red x the letter mask,
    // added) and green / blue stay; the page pass needs output.keepFrame / prevFrame (the game's FBP 112)
    if (hasTitle) {
      const Q = await pg.evaluate(() => {
        const { renderer, output, root, camera, gameOver: G } = window.__play, L = G.titleLayer, gl = renderer.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, V = camera.position.constructor;
        const glows = L.last.filter(s => s.glow), on = (L.gpool ?? []).filter(g => g.mesh.visible);
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const g of on) { const P = g.mesh.geometry.attributes.position.array; for (let j = 0; j < 4; j++) {
          const q = new V(P[3 * j], P[3 * j + 1], P[3 * j + 2]).applyMatrix4(L.proj2d.value), px = (q.x + 1) / 2 * W, py = (q.y + 1) / 2 * H;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } }
        if (!on.length) return { glows: glows.length, on: 0 };
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
        const grab = () => { output.render(root, camera); const b = new Uint8Array((x1 - x0) * (y1 - y0) * 4); gl.readPixels(x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const a = grab(); on.forEach(g => { g.mesh.visible = false; }); const b = grab(); on.forEach(g => { g.mesh.visible = true; });
        let nR = 0, nGB = 0;
        for (let i = 0; i < a.length; i += 4) { if (a[i] - b[i] > 4) nR++; if (Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 2) nGB++; }
        return { glows: glows.length, on: on.length, keep: output.keepFrame, prev: !!output.prevFrame, nR, nGB, area: (x1 - x0) * (y1 - y0),
          rt: on[0].rt.width, alpha: glows.map(s => s.alpha), rgba: glows[0].rgba,
          // draw order (sortObjects = false: scene-graph order): every title sprite, then the glows (w198 g4)
          last: L.group.children[L.group.children.length - 1] === L.glowGroup && on.every(g => g.mesh.parent === L.glowGroup),
          // TEX1 0x61: the title's sprites sample bilinear
          linear: L.pool.filter(m => m.visible && m.material && m.material.uniforms?.map).every(m => m.material.uniforms.map.value.magFilter === 1006) };
      });
      ok(Q.glows === 8 && Q.on === 8 && Q.keep && Q.prev && Q.rt === 64, `the 8 letter glows draw through 64 x 64 pages from the previous frame (${Q.glows} glows, ${Q.on} drawn, keepFrame ${Q.keep}, prevFrame ${Q.prev}, page ${Q.rt})`);
      // the copy reads the right pixels (worker 0202 review): render once (output.js keeps this frame + its camera), rebuild
      // the glow pages from it (TitleLayer.glows on the last items: no clock advance), then compare page texels with the kept
      // frame read where the glow's box lies on screen through the render camera (the box corners, interpolated)
      const C = await pg.evaluate(async () => {
        const THREE = await import('three');
        const { renderer, output, root, camera, gameOver: G } = window.__play, L = G.titleLayer;
        output.render(root, camera);
        const Pk = L.proj2d.value;                                        // the screen pixel in the kept frame (TitleLayer proj2d)
        // move both cameras between the kept frame and the glow pass (the game's copy is tied to the screen, not the world)
        const save = [camera, L.camera].map(c => [c.position.clone(), c.quaternion.clone()]);
        for (const c of [camera, L.camera]) { c.position.x += 3; c.position.y -= 2; c.rotateY(0.05); c.updateMatrixWorld(); }
        const items = L.last.filter(s => s.glow);
        L.glows(items, L.camera);
        [camera, L.camera].forEach((c, i) => { c.position.copy(save[i][0]); c.quaternion.copy(save[i][1]); c.updateMatrixWorld(); });
        const prev = output.prevFrame, W = prev.image.width, H = prev.image.height;
        // the kept frame into a readable target
        const dst = new THREE.WebGLRenderTarget(W, H), sc = new THREE.Scene();
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { m: { value: prev } },
          vertexShader: 'varying vec2 u; void main() { u = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'uniform sampler2D m; varying vec2 u; void main() { gl_FragColor = vec4(texture2D(m, u).rgb, 1.0); }', depthTest: false }));
        quad.frustumCulled = false; sc.add(quad);
        const rt0 = renderer.getRenderTarget(); renderer.setRenderTarget(dst); renderer.render(sc, new THREE.Camera()); renderer.setRenderTarget(rt0);
        const all = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(dst, 0, 0, W, H, all);
        const bil = (x, y, c) => {                                         // GL linear filtering at texel coords (x, y)
          const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), ax = x - 0.5 - x0, ay = y - 0.5 - y0;
          const at = (i, j) => all[4 * (Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))) + c];
          return (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
        };
        // the expected pixel from the glow's GS screen box alone: the copy's ST x 512 + the frame's XYOFFSET (1824, 1792) =
        // GS, the GS point as view space (PROJ, the title's depth) through proj2d
        const PR = { fx: 299.972351, fy: 449.958527, cx: 2037, cy: 2048 };   // effects.js PROJ (camera 0)
        const score = () => {
          let n = 0, diff = 0, worst = 0;
          items.forEach((s, gi) => {
            const g = L.gpool[gi], st = s.copy.st;
            for (const px of [16, 24, 32, 40, 48]) for (const py of [16, 24, 32, 40, 48]) {
              const a = new Uint8Array(4); renderer.readRenderTargetPixels(g.rt, px, py, 1, 1, a);
              const fx = (px + 0.5) / g.rt.width, fy = (py + 0.5) / g.rt.height;   // page texel -> copy fraction (page row y = box Y)
              const GX = (st[0] + (st[2] - st[0]) * fx) * 512 + 1824, GY = (st[1] + (st[3] - st[1]) * fy) * 512 + 1792;
              const q = new THREE.Vector3((GX - PR.cx) * s.z / PR.fx, -(GY - PR.cy) * s.z / PR.fy, -s.z).applyMatrix4(Pk);
              const X = (q.x + 1) / 2 * W, Y = (q.y + 1) / 2 * H;
              if (X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1) continue;
              const d = [0, 1, 2].reduce((t, c) => t + Math.abs(a[c] - bil(X, Y, c)), 0);
              n++; diff += d; worst = Math.max(worst, d);
            }
          });
          return { n, mean: n ? diff / n : null, worst: Math.round(worst) };
        };
        const r = score();
        dst.dispose();
        return r;
      }).catch(e => ({ err: e.message }));
      // report.js's capture renders (R) go through output.render with keep: false: the kept frame stays the displayed one
      const K = await pg.evaluate(async () => {
        const THREE = await import('three'); const { output, root, camera } = window.__play;
        const f0 = output.prevFrame, p0 = output.prevProj, rt = new THREE.WebGLRenderTarget(64, 64);
        output.render(root, camera, rt, { keep: false }); rt.dispose();
        return output.prevFrame === f0 && output.prevProj === p0;
      });
      ok(K, 'a render with keep: false (report.js captures) leaves the kept frame as it was');
      ok(C.n >= 100 && C.mean < 6, `the glow pages copy the kept frame at the screen pixels of their GS boxes, with the cameras moved in between (${C.n} page texels: mean |dRGB| ${C.mean?.toFixed?.(1)}, worst ${C.worst}${C.err ? '; ' + C.err : ''})`);
      // worker 0258: the title is fixed on the screen (FUN_002e3300 camera 1): the layer alone, glows included, renders the same
      // pixels with the camera turned (the death camera moves) and through an event fov; corners where the menu draw puts them
      const F = await pg.evaluate(async () => {
        const THREE = await import('three');            // before the hiding: a game frame's roomShow would show the room again
        const { renderer: r, output: out, root: T, camera: cam, gameOver: G } = window.__play, L = G.titleLayer;
        const kept = new Map(), hud = out.hud, target = new THREE.WebGLRenderTarget(640, 360, { depthBuffer: true });
        for (const c of T.children) { kept.set(c, c.visible); c.visible = c === L.group; }
        out.hud = null;
        const shot = () => { out.render(T, cam, target, { keep: false }); const px = new Uint8Array(640 * 360 * 4); r.readRenderTargetPixels(target, 0, 0, 640, 360, px); return px; };
        const diff = (x, y) => { let d = 0; for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) d++; return d; };
        const q0 = cam.quaternion.clone(), p0 = cam.position.clone();
        L.group.visible = false; const none = shot(); L.group.visible = true;
        const a = shot();
        cam.position.x += 300; cam.rotateY(1.1); cam.rotateX(0.4); cam.updateMatrixWorld();
        const b = shot();
        out.fitCamera(cam, 35);
        const c = shot();
        out.fitCamera(cam); cam.position.copy(p0); cam.quaternion.copy(q0); cam.updateMatrixWorld();
        const nat = !!out.native, rw = nat ? out.framebuffer.width : 640, rh = nat ? out.framebuffer.height : 360, kx = (4 / 3) * rh / 425.5, ky = rh / 512;
        r.setRenderTarget(nat ? out.framebuffer : target); L.fitProj(r); r.setRenderTarget(null);
        const V = new THREE.Vector4(); let worst = 0;
        for (const s of L.last.filter(s => s.verts && !s.line && s.tex)) for (const v of s.verts) {
          V.set(v.pos[0], -v.pos[1], -v.pos[2], 1).applyMatrix4(L.proj2d.value);
          const x = (V.x / V.w + 1) / 2 * rw, y = (1 - V.y / V.w) / 2 * rh;
          const ex = nat ? v.gs[0] - 1824 : rw / 2 + (v.gs[0] - 2037) * kx, ey = nat ? v.gs[1] - 1792 : rh / 2 + (v.gs[1] - 2048) * ky;
          worst = Math.max(worst, Math.hypot(x - ex, y - ey));
        }
        for (const [o, v] of kept) o.visible = v;
        out.hud = hud; target.dispose();
        return { drawn: diff(a, none), turned: diff(a, b), fov: diff(a, c), worst, glows: (L.gpool ?? []).filter(g => g.mesh.visible).length };
      });
      ok(F.drawn > 500 && F.glows === 8, `the title's layer alone draws (${F.drawn} pixels, ${F.glows} glows)`);
      ok(F.turned === 0, `the title: turning the camera moves nothing (${F.turned} pixels differ)`);
      ok(F.fov === 0, `the title: an event fov moves nothing (${F.fov} pixels differ)`);
      ok(F.worst < 0.01, `the title's corners where the menu draw puts their GS points: worst ${F.worst.toFixed(5)} px`);
      // worker 0206: the dim backdrop (type 11 tag 40: FED model 4, FUN_002f5c50 kind 4): two gouraud quads over the view,
      // RGBA (24, 8, 8, 64) on the centre line to (0, 0, 0, 64) at the top / bottom, ALPHA 0x44 (w198 dumps g4 / g5). Render
      // with and without its meshes: near the quads' bottom edge every pixel = the frame behind it / 2 + the vertex colour
      // (<= 10 % of (24, 8, 8)) / 2, i.e. the frame is halved there, as the dump's blend
      const B = await pg.evaluate(() => {
        const { renderer, output, root, camera, gameOver: G } = window.__play, L = G.titleLayer, gl = renderer.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, V = camera.position.constructor;
        const list = L.last.filter(s => !s.glow && !s.screen && !s.line), dim = list.map((s, i) => [s, L.pool[i]]).filter(([s]) => s.model === 4 && s.type === 11);
        if (dim.length !== 2) return { n: dim.length };
        let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
        for (const [, m] of dim) { const P = m.geometry.attributes.position.array; for (let j = 0; j < 4; j++) {
          const q = new V(P[3 * j], P[3 * j + 1], P[3 * j + 2]).applyMatrix4(L.proj2d.value);
          x0 = Math.min(x0, (q.x + 1) / 2 * W); x1 = Math.max(x1, (q.x + 1) / 2 * W); y0 = Math.min(y0, (q.y + 1) / 2 * H); y1 = Math.max(y1, (q.y + 1) / 2 * H); } }
        // the bottom 8 % of the quads (readPixels rows count from the bottom), inside the canvas
        const bx0 = Math.max(0, Math.ceil(x0) + 2), bx1 = Math.min(W, Math.floor(x1) - 2), by0 = Math.max(0, Math.ceil(y0) + 2), by1 = Math.min(H, Math.floor(y0 + 0.08 * (y1 - y0)));
        if (bx1 <= bx0 || by1 <= by0) return { n: dim.length, empty: [x0, x1, y0, y1, W, H] };
        const grab = () => { output.render(root, camera, null, { keep: false }); const b = new Uint8Array((bx1 - bx0) * (by1 - by0) * 4); gl.readPixels(bx0, by0, bx1 - bx0, by1 - by0, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const a = grab(); dim.forEach(([, m]) => { m.visible = false; }); const b = grab(); dim.forEach(([, m]) => { m.visible = true; });
        let n = 0, good = 0, sa = 0, sb = 0;
        for (let i = 0; i < a.length; i += 4) {
          n++; sa += a[i] + a[i + 1] + a[i + 2]; sb += b[i] + b[i + 1] + b[i + 2];
          const d = [0, 1, 2].map(c => a[i + c] - b[i + c] / 2);
          if (d[0] >= -1.5 && d[0] <= 3.5 && d[1] >= -1.5 && d[1] <= 2 && d[2] >= -1.5 && d[2] <= 2) good++;
        }
        return { n: dim.length, px: n, good, ratio: sb ? sa / sb : 0, rgba: dim[0][0].verts.map(v => v.rgba.join(',')), alpha: dim[0][0].alpha };
      });
      ok(B.n === 2 && B.px > 1000 && B.good >= 0.95 * B.px && B.ratio > 0.45 && B.ratio < 0.6,
        `the dim backdrop (type 11, model 4) halves the frame near its edge as the dump's blend (${B.good} / ${B.px} px = behind / 2 + colour / 2; brightness ${B.ratio?.toFixed?.(3)} of the frame without it; vertex RGBA ${B.rgba}, ALPHA 0x${B.alpha?.toString(16)})${B.empty ? ' empty ' + B.empty : ''}`);
      ok(Q.last && Q.linear, `the glows draw after every title sprite (their group last: ${Q.last}); the title's sprites sample bilinear (TEX1 0x61: ${Q.linear})`);
      ok(Q.nR > 0.02 * Q.area && Q.nGB === 0, `the glow adds red only (${Q.nR} of ${Q.area} px redder, ${Q.nGB} with green / blue changed; RGBA ${Q.rgba}, ALPHA ${(Q.alpha || []).map(a => '0x' + a.toString(16))})`);
    }
    if (process.env.GAMEOVER_SHOT) await pg.screenshot({ path: process.env.GAMEOVER_SHOT });
    // the GAME OVER title (gameover_title.js, worker 0198)
    const T = await pg.evaluate(() => {
      const G = window.__play.gameOver, L = G.titleLayer;
      if (!G.title || !L) return null;
      const cam = window.__play.camera, THREE_V = cam.position.constructor;
      const vis = L.pool.filter(m => m.visible);
      // the letters (tex1, ALPHA 0x44): their projected centre in NDC
      const letters = L.last.filter(s => s.alpha === 0x44 && s.tex && /:1$/.test(s.tex.k));
      const c = new THREE_V();
      for (const s of letters) for (const v of s.verts) {
        const [x, y, z] = [v.pos[0], -v.pos[1], -v.pos[2]], w = L.camera.matrixWorld.elements;
        c.add(new THREE_V(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14]));
      }
      c.multiplyScalar(1 / Math.max(1, 4 * letters.length)).applyMatrix4(L.proj2d.value);
      return { titleAt: window.__titleAt, beginAt: window.__beginAt, n: L.last.filter(s => !s.glow && !s.line && s.model === undefined).length, lines: L.last.filter(s => s.line && s.type === 103).length, models: L.last.filter(s => s.model !== undefined).length, vis: vis.length, inRoot: L.group.parent === window.__play.root,
        letters: letters.length, ndc: [c.x, c.y] };
    });
    ok(T !== null, 'the title is loaded (data/gameover_title.fed, gameover.json "title")');
    if (T) {
      ok(T.titleAt - T.beginAt === 14 * 20, `title spawned 14 game frames after the request (clock +${T.titleAt - T.beginAt} ms; 280 expected)`);
      // + worker 0206: the models of tags 61 (44 triangles) and 40 (2 quads), as the w198 dumps g4 / g5
      // worker 0241: + type 103's strand lines (24 in the w198 dumps g4 / g5; random points, so only their presence here)
      ok(T.n === 30 && T.models === 46 && T.vis === 76 && T.inRoot, `settled: 30 type-10 sprites and 46 model primitives drawn (${T.n} sprites, ${T.models} model items, ${T.vis} meshes, in the scene)`);
      ok(T.lines > 0, `the title's type 103 strand lines are drawn (${T.lines})`);
      ok(T.letters === 8 && Math.abs(T.ndc[0]) < 0.1 && T.ndc[1] > 0 && T.ndc[1] < 0.2, `the 8 letters centred, a little above the middle (NDC ${T.ndc.map(x => x.toFixed(3))})`);
    }
    ok(await pg.evaluate(() => window.__play.gameOver.go.menu.focus.id === 3), 'Restart focused (layout 0x477c38)');
    // HP read on the new enemy world's first game frame (worker 0204: soldiers 41-43 are active at the checkpoint and
    // may hit him in the frames after it)
    await pg.evaluate(() => {
      window.__marker = 1; window.__firstHp = null;
      const P = window.__play, E = P.enemies, old = P.enemyAI, tick = E.tick.bind(E);
      E.tick = W => { if (W && W !== old && window.__firstHp === null) window.__firstHp = P.php.hp; return tick(W); };
    });
    await pg.keyboard.press('Space');
    await pg.waitForFunction(() => window.__play.restart.count === 1 && window.__firstHp !== null, null, { timeout: 20000, polling: 100 }).catch(() => {});
    ok(await pg.evaluate(() => window.__marker === 1 && window.__play.restart.count === 1 && window.__firstHp === 780),
       '✕ on Restart: the checkpoint, no page reload (checkpoint.js; test_checkpoint_page has the details)');
    // FUN_00534a98 (result 6) -> FUN_002f2098(0x81840000): Restart removes the title
    await pg.waitForTimeout(200);
    if (hasTitle) ok(await pg.evaluate(() => { const G = window.__play.gameOver; return G.title.fx.emitters.length === 0 && G.titleLayer.last.length === 0 && !G.titleLayer.pool.some(m => m.visible) && !G.titleLayer.depthClear.visible
         && !(G.titleLayer.gpool ?? []).some(g => g.mesh.visible) && !window.__play.output.keepFrame && window.__play.output.prevFrame === null; }),
       'Restart: the title is gone (0 emitters, 0 sprites, no depth clear, no glow, no frame copy, the kept frame freed)');
    ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await pg.close();
  }
  { // 2 + 3
    const { pg, warns } = await open();
    const pauseToggles = async () => {             // Start opens the pause, Start again closes it
      await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
      const on = await pg.evaluate(() => window.__play.pause.active);
      await pg.keyboard.press('Enter'); await pg.waitForTimeout(500);
      return on && !(await pg.evaluate(() => window.__play.pause.active));
    };
    ok(await pauseToggles(), 'alive: the pause opens and closes as before');
    await kill(pg);
    await menuOpen(pg);
    await pg.waitForTimeout(300);
    await pg.evaluate(() => { window.__marker = 1; });
    await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(100);
    ok(await pg.evaluate(() => window.__play.gameOver.go.menu.focus.id === 4), 'down: Quit');
    await pg.keyboard.press('Space');
    await pg.waitForFunction(() => !window.__play.gameOver.go.active, null, { timeout: 20000 });
    ok(await pg.evaluate(() => window.__marker === 1), 'Quit: no reload');
    ok(warns.some(w => /Quit; the page has no title/.test(w)), 'Quit: warned (no title on the page)');
    // after Quit the game over stays done (DAT_0047dbb4; the game is at its title); H resets it
    const liveBeforeH = await pg.evaluate(() => { const G = window.__play.gameOver; return !G.title || G.title.fx.emitters.length > 0; });
    ok(liveBeforeH, 'after Quit the title is still up (the page stays on the scene)');
    await pg.keyboard.press('KeyH'); await pg.waitForTimeout(500);
    ok(await pg.evaluate(() => { const g = window.__play.gameOver.go; return g.wm === 2 && !g.pauseBlocked && !g.started && !g.active && window.__play.php.hp === 780; }),
       'H (page respawn) resets the game over');
    ok(await pg.evaluate(() => { const G = window.__play.gameOver; return !G.title || (G.title.fx.emitters.length === 0 && G.titleLayer.last.length === 0 && !G.titleLayer.pool.some(m => m.visible)); }),
       'H: the title is gone (0 emitters, 0 sprites)');
    ok(await pauseToggles(), 'after H: the pause opens again');
    await kill(pg);
    await pg.waitForFunction(() => window.__play.gameOver.go.wm === 3, null, { timeout: 20000 });
    ok(true, 'a death after H starts the timer again');
    await pg.close();
  }
} finally {
  await browser.close(); srv.kill();
}
done();
