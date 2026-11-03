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
    for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html${q}${q ? '&' : '?'}intro=0`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
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
  // worker 0200: a bullet's hit on Vincent (enemy_ai playerHandler = FUN_005720c8) spawns r0000's 0x1000 through the
  // 15-frame gate; its type 107 particle draws the full-screen sprite (EffectLayer.screens) for its 11 frames
  {
    const h = await pg.evaluate(async () => {
      const { fx, layer } = window.__fx, AI = window.__play.enemyAI;
      const P = [-1066.5, -157.1, -1103.2];
      const b = () => ({ f120: 0, start: [-1000, -160, -1100], dir: [-1, 0, 0], from: { ai: { W: { cls: 3 } } } });
      const n0 = fx.emitters.filter(e => e.id === 0x1000).length;
      AI.t.playerHandler(b(), { point: P });
      const n1 = fx.emitters.filter(e => e.id === 0x1000).length;
      AI.t.playerHandler(b(), { point: P });                    // same frame: the gate holds
      const n2 = fx.emitters.filter(e => e.id === 0x1000).length;
      const t0 = window.__play.stats.ticks, seen = [];
      const up = layer.update.bind(layer);
      layer.update = cam => { up(cam); if (layer.flush) layer.flush(); const s = layer.last.find(x => x.screen);   // flush: the meshes this draw pass builds (play.js defers them to the drawn frame)
         const m = (layer.spool ?? []).find(x => x.visible);
        seen.push(s ? { rgba: s.rgba, alpha: s.alpha, mesh: !!m && m.material.uniforms.rgba.value.toArray() } : null); };
      await new Promise(r => { const k = () => window.__play.stats.ticks > t0 + 14 ? r() : setTimeout(k, 20); k(); });
      layer.update = up;
      return { n0, n1, n2, seen, fed0: fx.feds.has(0) };
    });
    ok(h.fed0 && h.n1 === h.n0 + 1 && h.n2 === h.n1, `hit on Vincent: r0000 loaded, one 0x1000 per gate (${h.n0} -> ${h.n1} -> ${h.n2})`);
    const drawn = h.seen.filter(Boolean);
    ok(drawn.length >= 8 && drawn.length <= 11 && drawn.every(s => s.alpha === 0x48 && s.rgba[0] === 128 && JSON.stringify(s.mesh) === JSON.stringify(s.rgba)),
      `hit on Vincent: the screen sprite drawn for its life (${drawn.length} of ${h.seen.length} draws), ALPHA 0x48, mesh colour = the item's: ${JSON.stringify(drawn.slice(0, 2))}`);
    // review (worker 0200): one draw order over sprites / lines / screen sprites: the game's spawn order at a hit is
    // 0x40c00, 0x1000, 0x41800 (w193_fxsrc f789), so the flash draws after the hit's sprites and before the bullet-end's
    const o = await pg.evaluate(async () => {
      const { fx, layer } = window.__fx, AI = window.__play.enemyAI, P = [-1066.5, -157.1, -1103.2];
      window.__play.enemyAI.S.mgr20 += 100;                      // past the 15-tick gate of the hit above (the manager clock)
      AI.t.playerHandler({ f120: 0, start: [-1000, -160, -1100], dir: [-1, 0, 0], from: { ai: { W: { cls: 3 } } } }, { point: P });
      fx.spawn(0x41800, P);                                      // FUN_00554ea8's bullet-end effect (as enemy_ai endEffect)
      const t0 = window.__play.stats.ticks;
      await new Promise(r => { const k = () => window.__play.stats.ticks > t0 + 2 ? r() : setTimeout(k, 20); k(); });
      const list = layer.last.filter(s => !s.line && !s.screen), ro = { 0x40c00: [], 0x41800: [] };
      list.forEach((s, i) => { if (ro[s.id]) ro[s.id].push(layer.pool[i].renderOrder); });
      const sm = (layer.spool ?? []).find(m => m.visible);
      return { a: ro[0x40c00], b: ro[0x41800], s: sm ? sm.renderOrder : null };
    });
    ok(o.s !== null && o.a.length && o.b.length && Math.max(...o.a) < o.s && o.s < Math.min(...o.b),
      `draw order: 0x40c00 sprites ${Math.min(...o.a)}-${Math.max(...o.a)} < the flash ${o.s} < 0x41800 sprites ${Math.min(...o.b)}-${Math.max(...o.b)}`);
  }
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
    // worker 0200: type 107's screen sprite (flat, ZTST ALWAYS) over the whole target: game RGBA (128, 30, 7, 24), 0x48
    {
      const s = { screen: true, rect: [0, 0, 448, 512], buf: { w: 448, h: 512 }, rgba: [128, 30, 7, 24], alpha: 0x48 };
      const layer = new EffectLayer(THREE, { sprites: () => [s], warn: () => {} });
      const scene = new THREE.Scene(); scene.add(layer.group);
      const cam = new THREE.PerspectiveCamera(60, 1, 1, 1000);
      layer.update(cam);
      r.setRenderTarget(rt); r.setClearColor(new THREE.Color().setRGB(40 / 255, 80 / 255, 160 / 255, THREE.LinearSRGBColorSpace), 1); r.clear(); r.render(scene, cam);
      const b = new Uint8Array(16 * 4); r.readRenderTargetPixels(rt, 0, 0, 4, 4, b);
      res.screen = [0, 15].map(i => Array.from(b.slice(4 * i, 4 * i + 3)));
    }
    r.dispose();
    return res;
  });
  {
    const want = [128, 30, 7].map((c, k) => Math.min(255, ((c * 24) >> 7) + [40, 80, 160][k]));
    ok(px.screen && px.screen.every(p => p.every((x, k) => Math.abs(x - want[k]) <= 1)), `type 107 screen sprite: corner pixels ${JSON.stringify(px.screen)} = the GS's ${want} (+-1)`);
  }
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
  // --- worker 0208: the z128 stage fire (the level manager's engine, play.js fxStage)
  {
    const zlib = await import('node:zlib'), fs = await import('node:fs');
    const png = buf => {                                           // 8-bit RGB / RGBA, non-interlaced (playwright screenshots)
      let o = 8, w = 0, h = 0, ct = 0; const idat = [];
      while (o < buf.length) { const n = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8);
        if (t === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); ct = buf[o + 17]; }
        if (t === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + n)); o += 12 + n; }
      const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * bpp), st = w * bpp;
      for (let y = 0; y < h; y++) { const ft = raw[y * (st + 1)];
        for (let x = 0; x < st; x++) { const a = x >= bpp ? out[y * st + x - bpp] : 0, b = y ? out[(y - 1) * st + x] : 0, c = x >= bpp && y ? out[(y - 1) * st + x - bpp] : 0;
          let v = raw[y * (st + 1) + 1 + x]; const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][ft]) & 255; out[y * st + x] = v; } }
      return { w, h, bpp, px: out };
    };
    // pixels the stage layer changes in this view: two screenshots, the layer shown / hidden (the same frame state: the
    // engine is paused for both, play.js keeps drawing the scene)
    const fireDiff = async () => {
      await pg.evaluate(() => { const st = window.__fx.stage; window.__fxHold = [st.begin, st.end]; st.begin = () => {}; st.end = () => {}; });
      const shot = async vis => { await pg.evaluate(v => { window.__fx.stageLayer.group.visible = v; }, vis); await new Promise(r => setTimeout(r, 400)); return png(await pg.screenshot()); };
      const a = await shot(true), b = await shot(false);
      await pg.evaluate(() => { const st = window.__fx.stage; window.__fx.stageLayer.group.visible = true; [st.begin, st.end] = window.__fxHold; delete window.__fxHold; });
      let n = 0, warm = 0;
      for (let i = 0; i < a.w * a.h; i++) { const d = Math.abs(a.px[i * a.bpp] - b.px[i * b.bpp]) + Math.abs(a.px[i * a.bpp + 1] - b.px[i * b.bpp + 1]) + Math.abs(a.px[i * a.bpp + 2] - b.px[i * b.bpp + 2]);
        if (d > 12) { n++; if (a.px[i * a.bpp] > b.px[i * b.bpp] && a.px[i * a.bpp] >= a.px[i * a.bpp + 2]) warm++; } }
      return { n, warm, a };
    };
    const S0 = await pg.evaluate(() => {
      const { stage, stageLayer, ids } = window.__fx;
      if (!stage) return null;
      return { n: stage.emitters.length, codes: [...new Set(stage.emitters.map(e => e.F.code.toString(16)))], stage: ids.stage, hidden: ids.hidden,
        list: stage.emitters.map(e => [e.F.code, e.ei, e.param, e.f0a & 0x380]), drawn: stageLayer.last.length };
    });
    if (!S0) ok(false, 'stage fire: window.__fx.stage missing (data/effects has no stage FEDs? re-run export_web_effects.py)');
    else {
      ok(S0.n === 76 && S0.codes.join() === '20000000,20040000,20080000', `stage load (FUN_002f15d0 -> FUN_002e4e38): 76 emitters of the three area FEDs (${S0.n}, ${S0.codes})`);
      const save = path.join(here, '../../tools/trace/out/w208_fire/save.json');
      if (existsSync(save)) {
        const R = JSON.parse(fs.readFileSync(save, 'utf8')).emitters;
        ok(R.length === S0.n && R.every((e, i) => e.code === S0.list[i][0] && e.ei === S0.list[i][1] && e.rec === S0.list[i][2]), 'stage load: the sea-of-flames save\'s emitter list, in order (FED, emitter, param record)');
        // the page engine's cull (FUN_002ea6a0) run once with the save's own camera (the engine paused around it, so the earlier
        // steps' camera / position don't matter), compared both ways with the save's +0x0a flags, 0x200 included: as in the
        // game (FUN_00269868 in the room draw, then FUN_002ea6a0) the room occluder volumes are first rebuilt from the same
        // camera, with the save's slots 0 / 1 / 2 (as test_effects); the page's next frame rebuilds them from its own camera.
        const SV = JSON.parse(fs.readFileSync(save, 'utf8')).cam.view;
        const pf = await pg.evaluate(V => {
          const st = window.__fx.stage, f = Math.fround, occl = window.__play.roomOccl;
          if (!occl) return null;
          occl.frame(Float32Array.from(V), [0, 1, 2]);
          const view = { toView: p => [0, 1, 2].map(j => f(f(f(p[0] * V[j]) + f(p[1] * V[4 + j])) + f(f(p[2] * V[8 + j]) + V[12 + j]))),
            toViewMatrix: () => Float32Array.from(V), eye: [0, 1, 2].map(i => -(V[12] * V[4 * i] + V[13] * V[4 * i + 1] + V[14] * V[4 * i + 2])) };
          const keep = st.emitters.map(e => [e.f0a, e.col.slice()]);
          st.end(view);
          const flags = st.emitters.map(e => e.f0a & 0x380);
          st.emitters.forEach((e, i) => { e.f0a = keep[i][0]; e.col = keep[i][1]; });
          return { flags, eye: [...occl.eye], count: occl.count, want: view.eye };
        }, SV);
        if (!pf) ok(false, 'start view: window.__play.roomOccl missing (data/scene.json has no occl? re-run the room export)');
        else {
          const bad = []; let occl = 0;
          const de = Math.max(...pf.eye.map((v, j) => Math.abs(v - pf.want[j])));
          ok(de < 1e-2, `start view: the occluder volumes the cull tested were built from the save's camera (eye off by ${de.toExponential(1)} u, ${pf.count} volumes)`);
          R.forEach((e, i) => { const a = pf.flags[i], b = e.f0a & 0x380; if (b === 0x200) occl++; if (a !== b) bad.push(`#${i} page ${a.toString(16)} save ${b.toString(16)}`); });
          ok(bad.length === 0, `start view (the save's camera and its occluder volumes): the page's cull flags = the save's, both ways, 0x200 included (${bad.join(', ') || 'all equal'}; ${occl} occluder-culled in the save)`);
        }
      } else console.log('  (no tools/trace/out/w208_fire/save.json: the save comparison is skipped)');
      // the frame order on the real page (play.js): per game frame fx.begin (the reseed) < fxStage.begin < fx.end < fxStage.end, and
      // the stage's begin draws no random numbers once its timeline has spawned (FUN_002efc78 ages; the evals draw in end)
      const ord = await pg.evaluate(async () => {
        const { fx, stage } = window.__fx, r = fx.rng, log = [], draws = {}, undo = [];
        let phase = 'other';
        for (const k of ['next', 'vrInt', 'vrSpan', 'mtNext']) { const o = r[k]; r[k] = function (...a) { draws[phase] = (draws[phase] ?? 0) + 1; return o.apply(this, a); }; undo.push(() => { r[k] = o; }); }
        for (const [o, k, nm] of [[fx, 'begin', 'fx.begin'], [stage, 'begin', 'stage.begin'], [fx, 'end', 'fx.end'], [stage, 'end', 'stage.end']]) {
          const g = o[k]; o[k] = (...a) => { log.push(nm); const pv = phase; phase = nm; try { return g(...a); } finally { phase = pv; } }; undo.push(() => { o[k] = g; });
        }
        await new Promise(res => setTimeout(res, 2000));
        undo.forEach(u => u());
        return { log, draws };
      });
      const want = ['fx.begin', 'stage.begin', 'fx.end', 'stage.end'];
      const k0 = ord.log.indexOf('fx.begin'), cyc = ord.log.slice(k0, k0 + 4 * Math.floor((ord.log.length - k0) / 4));
      ok(cyc.length >= 8 && cyc.every((x, i) => x === want[i % 4]), `frame order: ${want.join(' < ')} every game frame (${cyc.length / 4} frames)`);
      ok(!ord.draws['stage.begin'] && ord.draws['stage.end'] > 0, `fxStage.begin draws no random numbers (${ord.draws['stage.begin'] ?? 0}); its end does (${ord.draws['stage.end']}), after fx.end's (${ord.draws['fx.end'] ?? 0})`);
      const d0 = await fireDiff();
      ok(S0.drawn > 0 && d0.n > 0, `start view: the stage layer draws (${S0.drawn} primitives) and changes ${d0.n} pixels (the far embers / smoke, E15)`);
      // the burning window behind the start (the game's camera at w208_still f201 when that fixture is there, else 180 degrees)
      const still = path.join(here, '../../tools/trace/out/w208_still/state1.json');
      const V = existsSync(still) ? JSON.parse(fs.readFileSync(still, 'utf8')).cam.view : null;
      await pg.evaluate(async ([V]) => {
        const P = window.__play, wait = ms => new Promise(r => setTimeout(r, ms));
        if (!V) { P.follow.yaw += Math.PI; await wait(1500); return; }
        const fwd = [V[2], V[6], V[10]], ang = () => { const d = P.follow.M[2]; const a = Math.atan2(d[0], d[2]) - Math.atan2(fwd[0], fwd[2]); return Math.atan2(Math.sin(a), Math.cos(a)); };
        const pit = () => Math.asin(P.follow.M[2][1]) - Math.asin(fwd[1]);
        for (let it = 0; it < 8; it++) {
          const e0 = ang(); P.follow.yaw += 0.05; await wait(120); const k = (ang() - e0) / 0.05 || 1; P.follow.yaw -= ang() / k; await wait(120);
          const p0 = pit(); P.follow.pitch += 0.02; await wait(120); const kp = (pit() - p0) / 0.02 || 1; P.follow.pitch -= pit() / kp; await wait(120);
        }
        await wait(1500);
      }, [V]);
      const S1 = await pg.evaluate(() => { const { stage, stageLayer } = window.__fx; const t = {}; for (const s of stageLayer.last) t[s.type] = (t[s.type] ?? 0) + 1;
        return { vis: stage.emitters.filter(e => !(e.f0a & 0x380)).map(e => e.ei), types: t }; });
      const d1 = await fireDiff();
      ok((S1.types[20] ?? 0) > 20 && (S1.types[21] ?? 0) > 20 && (S1.types[11] ?? 0) > 0, `fire view: flame models (type 20 ${S1.types[20]}), bursts (21 ${S1.types[21]}), glow models (11 ${S1.types[11]}) drawn; visible emitters ${S1.vis}`);
      ok(d1.warm > 1500, `fire view: the fire is on screen (${d1.n} pixels changed by the stage layer, ${d1.warm} of them warmer)`);
      if (process.env.FIRE_SHOT) fs.writeFileSync(process.env.FIRE_SHOT, await pg.screenshot());
    }
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
  // review (worker 0200): an export without r0000.fed (ids.json has no "feds"): r0000.fed is not requested, effects still load
  fxReq.length = 0; warns.length = 0; errs.length = 0;
  await pg.route('**/data/effects/ids.json', async rt => { const r = await rt.fetch(); const j = await r.json(); delete j.feds; await rt.fulfill({ response: r, json: j }); });
  await open('?enemydmg=0&sound=0');
  ok(!fxReq.some(u => u.includes('r0000.fed')) && fxReq.some(u => u.includes('r0001.fed')) && errs.length === 0 && (await pg.evaluate(() => !!window.__fx && !window.__fx.fx.feds.has(0))) && warns.some(w => w.includes('no r0000.fed')),
    `ids.json without "feds": no r0000.fed request (${fxReq.filter(u => u.includes('r0000')).length}), r0001 loaded, no console error (${errs.slice(0, 2).join(' | ')}), warned`);
  await pg.unroute('**/data/effects/ids.json');
} finally {
  // a crashed renderer ('Target crashed', low memory) can leave close() pending: bounded, then the server goes and node exits
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
  srv.kill();
}
done();
