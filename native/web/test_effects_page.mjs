// node native/web/test_effects_page.mjs   (needs data/effects, data/enemies, data/aim + playwright; else SKIP)
// The wall-impact path on the real page (worker 0179): Vincent's shot (enemy_ai queueShot -> playerShot, as
// aim.js onShot) from his muzzle in w172_sound3 f834 (emitter 0's position in save state 1) at the wall his
// pellets hit there; each pellet's room probe ends on the wall (material 2), enemy_ai wallSound ->
// opts.effect.wall -> effects.js: emitter 12 (id 0x43400) spawns at the end point and its flash sprites are
// drawn (EffectLayer). With ?fx=0 nothing is loaded.
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const d of ['data/effects/r0001.fed', 'data/enemies/ai.json', 'data/aim/weapon.json'])
  if (!existsSync(path.join(here, d))) { console.log(`SKIP: ${d} missing`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const MUZZLE = [-1057.85, -161.31, -1105.18], WALL = [-926.8, -135.0, -1102.7];
try {
  const pg = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const fxWarns = []; pg.on('console', m => { if (m.type() === 'warning' && /no rand\(\) state|no effect twister/.test(m.text())) fxWarns.push(m.text()); });
  const open = async q => {
    for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html${q}`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
    await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 180000 });
  };
  await open('?enemydmg=0&sound=0');
  ok(await pg.evaluate(() => !!window.__fx && !!window.__fx.fx), 'effects loaded (window.__fx)');
  ok(fxWarns.length === 0, `ids.json has rand + twister: no "no rand() state" / twister warning (${fxWarns.join(' | ')})`);
  await pg.evaluate(async ([m, w]) => {
    const W = await fetch('data/aim/weapon.json').then(r => r.json());
    window.__fxShot = { t0: window.__play.stats.ticks, seen: {}, lines: 0 };
    const { layer } = window.__fx, up = layer.update.bind(layer);   // every draw pass's types (0188)
    layer.update = cam => { up(cam); for (const s of layer.last) window.__fxShot.seen[s.type] = (window.__fxShot.seen[s.type] ?? 0) + 1;
      window.__fxShot.lines = Math.max(window.__fxShot.lines, (layer.lpool ?? []).filter(l => l.visible).length); };
    window.__play.enemyAI.queueShot(m, w, W);
  }, [MUZZLE, WALL]);
  await pg.waitForFunction(() => window.__play.stats.ticks > window.__fxShot.t0 + 12, null, { timeout: 60000 });
  const r = await pg.evaluate(w => {
    const { fx, layer } = window.__fx;
    const near = fx.emitters.filter(e => Math.hypot(e.p120[0] - w[0], e.p120[1] - w[1], e.p120[2] - w[2]) < 20);
    const types = {}; for (const s of layer.last) types[s.type] = (types[s.type] ?? 0) + 1;
    return { near: near.map(e => [e.ei, e.id, +e.age.toFixed(1)]), drawn: layer.pool.filter(m => m.visible).length,
      seen: window.__fxShot.seen, lines: window.__fxShot.lines };
  }, WALL);
  // worker 0188: the burst (type 21, FUN_0027cd68) and the sparks (type 137, VU1 line strips) reach the layer
  ok(r.seen[21] > 0, `type 21 burst sprites drawn: ${JSON.stringify(r.seen)}`);
  ok(r.seen[137] > 0 && r.lines > 0, `type 137 spark lines drawn (${r.seen[137]} over the frames, up to ${r.lines} line objects at once)`);
  ok(r.near.length >= 1 && r.near.every(e => e[0] === 12 && e[1] === 0x43400), `impact emitters at the wall: ${JSON.stringify(r.near)} (emitter 12, id 0x43400)`);
  ok(r.drawn > 0, `sprites drawn: ${r.drawn}`);
  // worker 0193: a floor hit (FUN_00260c38 on the game's normal; play.js roomRay negates the page's): fired down at the
  // floor point the game's f833 pellet hit (w193_floor: material 3 floor -> 0x45400), the page's impacts there take
  // the floor id (with the page's normal unnegated they would take the wall id 0x45000)
  const FLOOR = [-1049.0, -145.9375, -1108.7];
  await pg.evaluate(async f => {
    const W = await fetch('data/aim/weapon.json').then(r => r.json());
    window.__fxFloor = window.__play.stats.ticks;
    window.__play.enemyAI.queueShot([f[0], f[1] - 20, f[2]], [f[0], f[1] + 20, f[2]], W);
  }, FLOOR);
  await pg.waitForFunction(() => window.__play.stats.ticks > window.__fxFloor + 8, null, { timeout: 60000 });
  const fl = await pg.evaluate(f => window.__fx.fx.emitters.filter(e => Math.hypot(e.p120[0] - f[0], e.p120[1] - f[1], e.p120[2] - f[2]) < 10).map(e => [e.ei, e.id]), FLOOR);
  ok(fl.length >= 1 && fl.every(e => e[1] === 0x45400), `floor impacts: ${JSON.stringify(fl)} (id 0x45400 = material 3 floor, as the game's f833-835)`);
  // the draw pass uses this game frame's camera (follow.tick at the frame's start), not the last rendered one:
  // walk so the camera moves, then the layer's camera must sit at follow's eye of the last game frame
  const cam = await pg.evaluate(async () => {
    const pl = window.__play, { layer } = window.__fx, out = [];
    pl.keys.add('KeyW');
    for (let i = 0; i < 40; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const e = pl.follow.eye, c = layer.camera.position, r = pl.camera.position;
      out.push([Math.hypot(c.x - e[0], c.y - e[1], c.z - e[2]), Math.hypot(r.x - e[0], r.y - e[1], r.z - e[2])]);
    }
    pl.keys.delete('KeyW');
    return { worst: Math.max(...out.map(x => x[0])), moved: Math.max(...out.map(x => x[1])) };
  });
  ok(cam.worst < 1e-4 && cam.moved > 0.05, `effect draw with this frame's camera: layer camera vs follow eye ${cam.worst.toExponential(1)} u (the render camera was up to ${cam.moved.toFixed(2)} u off)`);
  // the blend and modulate (EffectLayer.material) on real WebGL against the GS: TFX MODULATE Cs = (Ct Cf) >> 7
  // (alpha too, TCC 1), then ALPHA 0x44 = ((Cs - Cd) As >> 7) + Cd, 0x48 = ((Cs - 0) As >> 7) + Cd, clamped
  const px = await pg.evaluate(async () => {
    const THREE = await import('three'), { EffectLayer } = await import(location.origin + '/effects.js');
    const r = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    const rt = new THREE.WebGLRenderTarget(4, 4);
    const res = {};
    for (const alpha of [0x44, 0x48, 0x42, 0x00]) {           // 0x00: not translated -> not drawn (0188)
      const sprite = { alpha, tex: { k: 'test', W: 1, H: 1, rgba: new Uint8Array([200, 100, 50, 0x80]) },
        verts: [[-100, -100], [100, -100], [-100, 100], [100, 100]].map(([x, y]) => ({ pos: [x, y, 10], uv: [0.5, 0.5], rgba: [128, 128, 128, 64] })) };
      const layer = new EffectLayer(THREE, { sprites: () => [sprite], warn: () => {} });
      const scene = new THREE.Scene(); scene.add(layer.group);
      const cam = new THREE.PerspectiveCamera(60, 1, 1, 1000);
      layer.update(cam);
      r.setRenderTarget(rt); r.setClearColor(new THREE.Color().setRGB(40 / 255, 80 / 255, 160 / 255, THREE.LinearSRGBColorSpace), 1); r.clear(); r.render(scene, cam);
      const b = new Uint8Array(16 * 4); r.readRenderTargetPixels(rt, 0, 0, 4, 4, b);
      res[alpha] = Array.from(b.slice(4 * 5, 4 * 5 + 3));
    }
    r.dispose();
    return res;
  });
  const gs = (alpha, Ct, Cf, Cd) => {
    const Cs = Ct.map((t, k) => Math.min(255, (t * Cf[k]) >> 7)), As = Cs[3];
    const A = k => alpha === 0x42 ? 0 : Cs[k], B = k => alpha === 0x44 ? Cd[k] : alpha === 0x42 ? Cs[k] : 0;   // 0x42: (0 - Cs) As + Cd
    return [0, 1, 2].map(k => Math.max(0, Math.min(255, ((((A(k) - B(k)) * As) >> 7) + Cd[k]))));
  };
  ok(px[0] && px[0].every((x, k) => Math.abs(x - [40, 80, 160][k]) <= 1), `GS ALPHA 0x0 (not translated): not drawn, pixel ${px[0]} = the background`);
  for (const alpha of [0x44, 0x48, 0x42]) {
    const want = gs(alpha, [200, 100, 50, 0x80], [128, 128, 128, 64], [40, 80, 160]), got = px[alpha];
    ok(got && got.every((x, k) => Math.abs(x - want[k]) <= 1), `GS ALPHA 0x${alpha.toString(16)}: pixel ${got} = the GS's ${want} (+-1)`);
  }
  ok(errs.length === 0, `no page errors (${errs.slice(0, 3).join(' | ')})`);
  await open('?fx=0&enemydmg=0&sound=0');
  ok(await pg.evaluate(() => !window.__fx), '?fx=0: no effects');
  // not exported (scene.json without "effects", as before export_web_effects.py): nothing fetched, no console error
  const fxReq = [], warns = [];
  errs.length = 0;
  await pg.route('**/data/scene.json', async rt => { const r = await rt.fetch(); const j = await r.json(); delete j.effects; await rt.fulfill({ response: r, json: j }); });
  pg.on('request', q => { if (q.url().includes('/data/effects/')) fxReq.push(q.url()); });
  pg.on('console', m => { if (m.type() === 'warning' && m.text().startsWith('effects:')) warns.push(m.text()); });
  await open('?enemydmg=0&sound=0');
  ok(fxReq.length === 0 && errs.length === 0 && !(await pg.evaluate(() => !!window.__fx)) && warns.some(w => w.includes('not exported')),
    `no "effects" in scene.json: no data/effects request (${fxReq.length}), no console error (${errs.slice(0, 2).join(' | ')}), one warning`);
  await pg.unroute('**/data/scene.json');
} finally { await browser.close(); srv.kill(); }
done();
