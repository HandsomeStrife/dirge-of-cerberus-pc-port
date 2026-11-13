// The menu boxes' effects on the real play.html (worker 0258): what the page draws, read from its render target.
//   1. the objective box (kind 1) open: its effects are fixed on the screen: the layer alone renders the same pixels through
//      the gameplay camera, a camera turned away and an event camera's fov (FUN_002e3300: camera 1), and its corners are the
//      GS corners (native frame buffer) in both.
//   2. stop() outside the box's update (the game over's FUN_003fdd58): the slots go in that frame's end(), before the draw.
//   3. Skip the opening, open a box, pause, Restart: the opening replays without the old effects.
//   node native/web/test_menu_fx_page.mjs
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
for (const f of ['data/stage_info.json', 'data/results.fed', 'data/event/ev0100_stage.json'])
  if (!fs.existsSync(path.join(here, f))) { console.log('SKIP: no ' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = process.env.MENU_FX_ROOT || here;
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const open = async q => {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  pg.errs = [];
  pg.on('pageerror', e => pg.errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&${q}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  return pg;
};
// the layer's state: emitters and what its meshes would draw
const layer = pg => pg.evaluate(() => {
  const si = window.__play.stageInfo, L = si.fxLayer;
  // the event-fade veil (menu_fx.js, worker 0265) is always in the group, its alpha from output.fade: not a box effect
  let vis = 0, lines = 0; const names = [];
  L.group.traverse(o => { if (o.visible && o !== L.group && o !== L.glowGroup && o !== L.depthClear && o.name !== 'event-fade') { if (o.isLine) lines++; else if (o.isMesh) { vis++; if (vis <= 3) names.push((o.name || o.type) + (o.parent && o.parent.name ? '<' + o.parent.name : '')); } } });
  return { emitters: si.fx.title.fx.emitters.length, slots: si.fx.slots.size, vis, lines, clear: L.depthClear.visible, names };
});
try {
  { // 1 + 2
    const pg = await open('intro=0&enemydmg=0&sound=0');
    await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.stage && window.__play.stageInfo, null, { timeout: 180000 });
    await pg.evaluate(() => window.__play.stageInfo.ready);
    await pg.evaluate(() => window.__play.stageInfo.display(1));
    await pg.waitForFunction(() => { const s = window.__play.stageInfo; return s.box && s.box.screen && s.fx.slots.size === 3 && s.fx.slots.get(0).age > 60; }, null, { timeout: 120000 });
    if (process.env.MENU_FX_SHOT) { await pg.screenshot({ path: process.env.MENU_FX_SHOT }); console.log('saved', process.env.MENU_FX_SHOT); }
    const R = await pg.evaluate(async () => {
      const THREE = await import('three');          // before the hiding: no await below, a game frame's roomShow would show the room again
      const P = window.__play, si = P.stageInfo, L = si.fxLayer, cam = P.camera, out = P.output, r = P.renderer;
      const T = L.group.parent, kept = new Map();
      for (const c of T.children) { kept.set(c, c.visible); c.visible = c === L.group; }
      const hud = out.hud; out.hud = null;
      const fb = out.framebuffer;
      const target = new THREE.WebGLRenderTarget(640, 360, { depthBuffer: true });
      const shot = () => {
        out.render(T, cam, target, { keep: false });
        const px = new Uint8Array(640 * 360 * 4);
        r.readRenderTargetPixels(target, 0, 0, 640, 360, px);
        return px;
      };
      const q0 = cam.quaternion.clone(), p0 = cam.position.clone();
      L.group.visible = false; const none = shot(); L.group.visible = true;   // what the layer itself adds (the scene's clear colour fills the target)
      const a = shot();
      const a2 = shot();
      const diff = (x, y) => { let d = 0, n = 0; for (let i = 0; i < x.length; i += 4) { if (x[i] || x[i + 1] || x[i + 2]) n++; if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) d++; } return { d, n }; };
      cam.position.x += 300; cam.rotateY(1.1); cam.rotateX(0.4); cam.updateMatrixWorld();
      const b = shot();
      out.fitCamera(cam, 35);                      // an event camera's fov (FUN_003edce0)
      const c = shot();
      out.fitCamera(cam); cam.position.copy(p0); cam.quaternion.copy(q0); cam.updateMatrixWorld();
      // the corners, in the mode's own pixels: the GS point through the layer's projection = where the menu draw (drawHud) puts
      // that GS point: native the frame buffer (X - 1824, Y - 1792), full (w / 2 + (X - 2037) kx, h / 2 + (Y - 2048) ky)
      const sp = L.last.filter(s => s.verts && !s.line && s.tex);
      const nat = !!out.native, rw = nat ? fb.width : 640, rh = nat ? fb.height : 360;
      r.setRenderTarget(nat ? fb : target); L.fitProj(r); r.setRenderTarget(null);
      const kx = (4 / 3) * rh / 425.5, ky = rh / 512;
      const V = new THREE.Vector4(); let worst = 0, wv = null, hudSize = null;
      for (const s of sp) for (const v of s.verts) {
        V.set(v.pos[0], -v.pos[1], -v.pos[2], 1).applyMatrix4(L.proj2d.value);
        const x = (V.x / V.w + 1) / 2 * rw, y = (1 - V.y / V.w) / 2 * rh;
        const ex = nat ? v.gs[0] - 1824 : rw / 2 + (v.gs[0] - 2037) * kx, ey = nat ? v.gs[1] - 1792 : rh / 2 + (v.gs[1] - 2048) * ky;
        const e = Math.hypot(x - ex, y - ey);
        if (e > worst) { worst = e; wv = { type: s.type, gs: v.gs, x, y }; }
      }
      // output.render holds its target's size across the scene render, in which this layer fits: the HUD pass gets the target's
      out.hud = o => { hudSize = [o.w, o.h]; };
      out.render(T, cam, target, { keep: false });
      for (const [o, v] of kept) o.visible = v;
      out.hud = hud; target.dispose();
      return { turned: diff(a, b), fov: diff(a, c), drawn: diff(a, none), same: diff(a, a2), bbox: (() => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) { const X = (i / 4) % 640, Y = Math.floor(i / 4 / 640); x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); } return [x0, y0, x1, y1]; })(), sprites: sp.length, worst, wv, nat, hudSize, w: rw, h: rh };
    });
    ok(R.drawn.d > 500, `the layer alone draws (${R.drawn.d} pixels, ${R.sprites} sprites)`);
    console.log('  same pose twice:', R.same.d, 'pixels differ; turned bbox', R.bbox);
    ok(R.same.d === 0, `the same pose twice renders the same (${R.same.d})`);
    ok(R.turned.d === 0, `turning the camera moves nothing: ${R.turned.d} pixels differ`);
    ok(R.fov.d === 0, `an event camera's fov moves nothing: ${R.fov.d} pixels differ`);
    ok(R.worst < 0.01, `corners where the menu draw puts their GS points (${R.nat ? 'native' : 'full'}, ${R.w} x ${R.h}): worst ${R.worst.toFixed(5)} px ${JSON.stringify(R.wv)}`);
    ok(R.nat || (R.hudSize && R.hudSize[0] === 640 && R.hudSize[1] === 360), `the HUD pass of a 640 x 360 target render gets its size, the layer's fit in between (${R.hudSize})`);
    // the box lives 3700 ms of game time and the renders above take real time: open it again for the checks below
    await pg.evaluate(() => { const s = window.__play.stageInfo; if (s.isDisplay(-1)) s.stop(); s.display(1); });
    await pg.waitForFunction(() => { const s = window.__play.stageInfo; return s.box && s.box.screen && s.fx.slots.size === 3; }, null, { timeout: 120000 });
    const prims = await pg.evaluate(() => (window.__play.stageInfo.draw() || []).length);
    ok(prims === 100, `the objective's text draws 100 sprites (${prims})`);
    const before = await layer(pg);
    const S = await pg.evaluate(() => new Promise(res => {
      const si = window.__play.stageInfo, em = [...si.fx.slots.values()], end = si.fx.end;
      si.stop();
      const r = { slots0: si.fx.slots.size, kind: si.kind };
      si.fx.end = () => { end(); si.fx.end = end; r.slots = si.fx.slots.size; r.gone = em.every(e => !si.fx.title.fx.emitters.includes(e)); res(r); };
    }));
    ok(before.slots === 3 && S.slots0 === 3 && S.kind === -1, `stop() outside the box's update: the kind clears, the slots wait for the menu update (${S.slots0})`);
    ok(S.slots === 0 && S.gone, `... and go in that frame's end(), before the layer's draw (slots ${S.slots})`);
    await pg.waitForTimeout(600);
    const after = await layer(pg);
    ok(after.vis === 0 && after.lines === 0 && !after.clear, `... and the layer is empty on the next frames (${JSON.stringify(after)})`);
    ok(pg.errs.length === 0, 'no page errors' + (pg.errs.length ? ': ' + pg.errs[0] : ''));
    await pg.close();
  }
  { // 3. Restart replays the opening: this load's frames run no fxEnd until the hand-off
    const pg = await open('enemydmg=0&sound=0');
    await pg.waitForFunction(() => window.__play && window.__play.intro.active && window.__play.stageInfo, null, { timeout: 400000 });
    await pg.evaluate(() => window.__play.stageInfo.ready);
    // worker 0265's stage title card (first_event displayStageInfo(0)) holds the opening and takes no pause input (FUN_003fdb48 ->
    // FUN_00241760(1, 0, 0)): Enter only after the card's fadein
    await pg.waitForFunction(() => { const P = window.__play, r = P.intro && P.intro.rt, si = P.stageInfo; return r && r.log.some(x => /^fadein /.test(x[1])) && (!si || si.kind < 0); }, null, { timeout: 300000 });
    await pg.keyboard.press('Enter');                // the event pause: Skip
    await pg.waitForFunction(() => window.__play.intro.paused, null, { timeout: 60000 });
    await pg.keyboard.press('Space');
    await pg.waitForFunction(() => window.__play.intro.ended > 0 && !window.__play.intro.active, null, { timeout: 120000 });
    await pg.waitForFunction(() => !window.__play.restart.record, null, { timeout: 1000 });
    await pg.evaluate(() => window.__play.stageInfo.display(1));
    await pg.waitForFunction(() => { const s = window.__play.stageInfo; return s.fx.slots.size === 3 && s.fx.slots.get(0).age > 20; }, null, { timeout: 120000 });
    const open1 = await layer(pg);
    ok(open1.vis > 0 && open1.clear, `the box open: the layer draws (${JSON.stringify(open1)})`);
    const n = await pg.evaluate(() => window.__play.restart.count);
    const until = (fn, arg) => pg.waitForFunction(fn, arg, { timeout: 60000 });
    await pg.keyboard.press('Enter');                // pause -> Restart (focus 3) -> ✕ -> OK (focus 6) -> ✕
    await until(() => { const f = window.__play.pause.flow.screen; return f && f.cur === f.total && f.hasFocus && f.focus.id === 3; });
    await pg.keyboard.press('Space');
    await until(() => { const f = window.__play.pause.flow; return !!f.box && f.box.cur === f.box.total; });
    await pg.keyboard.press('ArrowLeft');
    await until(() => window.__play.pause.flow.box.focus.id === 6);
    await pg.keyboard.press('Space');
    await pg.waitForFunction(n0 => window.__play.restart.count > n0 || window.__play.intro.active, n, { timeout: 60000 });
    await pg.waitForTimeout(2000);
    const active = await pg.evaluate(() => window.__play.intro.active);
    ok(active, 'Restart replays the opening');
    // the replayed opening shows its own title card (worker 0265: its effects run through fxEnd while it is up): checked after it
    await pg.waitForFunction(() => { const P = window.__play, r = P.intro && P.intro.rt, si = P.stageInfo; return !P.intro.active || (r && r.log.some(x => /^fadein /.test(x[1])) && si.kind < 0 && si.fx.slots.size === 0); }, null, { timeout: 300000 });
    await pg.waitForTimeout(600);
    const L = await layer(pg);
    ok(L.emitters === 0 && L.vis === 0 && L.lines === 0 && !L.clear, `the opening runs without the box's effects (${JSON.stringify(L)})`);
    ok(pg.errs.length === 0, 'no page errors' + (pg.errs.length ? ': ' + pg.errs[0] : ''));
    await pg.close();
  }
} catch (e) { ok(false, 'threw: ' + e.message); }
finally { await browser.close(); srv.kill(); }
done();
