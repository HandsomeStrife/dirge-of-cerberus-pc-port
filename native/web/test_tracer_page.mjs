// node native/web/test_tracer_page.mjs   (needs data/effects, data/enemies, data/aim + playwright; else SKIP)
// The bullet tracers on the real page (worker 0278; notes/effects-research.md 'Bullet tracers'): left clicks on the canvas (R1: the
// first raises the gun, the next fire) shoot Vincent's pellets, each with a tracer (no record: FUN_005534f0 -> FUN_002d77c0) drawn
// through the effect layer in blue (+0x120 bit 0x400: his +0x28 & 4), 8 quads of core_ef.bin texture 7 a moved tracer; a soldier's
// shot (spawnShot, the AI's FUN_005694f8 path) draws an orange one; both are freed with their bullets; ?fx=0 draws none.
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
for (const d of ['data/effects/core_ef.bin', 'data/enemies/ai.json', 'data/aim/weapon.json'])
  if (!existsSync(path.join(here, d))) { console.log(`SKIP: ${d} missing`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const open = async q => {
    for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html${q}${q ? '&' : '?'}intro=0`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
    await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 180000 });
  };
  await open('?enemydmg=0&sound=0');
  // every draw pass: the tracer items the layer got (colour, quads), and the visible meshes they became
  await pg.evaluate(() => {
    const { layer } = window.__fx, up = layer.update.bind(layer), log = window.__trLog = [];
    layer.update = cam => {
      up(cam);
      const tr = layer.last.filter(s => s.tracer);
      if (!tr.length) return;
      const by = new Map(); for (const s of tr) by.set(s.tracer, (by.get(s.tracer) ?? 0) + 1);
      log.push({ t: window.__play.stats.ticks, n: tr.length, colours: [...by.keys()].map(t => t.colour), quads: [...by.values()],
        moved: [...by.keys()].filter(t => t.len > 0.01).length, tex: tr.every(s => s.tex && s.tex.k === 7 && s.alpha === 0x48) });
    };
    // the deferred layer builds its meshes once per drawn frame (flush -> build): the tracer quads' meshes, visible, additive
    const build = layer.build.bind(layer), mlog = window.__trMesh = [];
    layer.build = (c, w, all) => {
      build(c, w, all);
      const list = all.filter(s => !s.glow && !s.screen && !s.line);
      const idx = list.map((s, i) => s.tracer ? i : -1).filter(i => i >= 0);
      if (idx.length) mlog.push({ n: idx.length, vis: idx.filter(i => layer.pool[i].visible && layer.pool[i].material.blending !== undefined).length });
    };
  });
  // 1. Vincent: clicks on the canvas until a shot has been fired (a click takes the pointer lock or is the drag fallback's tap)
  const shots0 = await pg.evaluate(() => window.__play.stats.ticks);
  for (let i = 0; i < 16; i++) {      // worker 0289: 16 (was 8): soldiers 41-43 near him at the start can take the first pellets
    await pg.mouse.click(480, 270);
    await pg.waitForTimeout(500);
    if (await pg.evaluate(() => window.__trLog.some(e => e.colours.includes(0) && e.moved))) break;
  }
  const v = await pg.evaluate(() => ({ log: window.__trLog.slice(), live: window.__play.shotFx.tracers.length,
    bullets: window.__play.enemyAI.bullets.filter(b => b.shooter === 0x16).length }));
  const blue = v.log.filter(e => e.colours.includes(0));
  const movedBlue = blue.find(e => e.moved > 0);
  ok(blue.length > 0, `clicks fire Vincent's gun: tracers in ${blue.length} draw passes (from tick ${shots0})`);
  ok(movedBlue && movedBlue.quads.every(q => q === 8) && movedBlue.tex, `a moved tracer is drawn: ${movedBlue ? movedBlue.quads.join(' / ') : '-'} quads each, texture 7, ALPHA 0x48`);
  ok(blue.every(e => e.colours.every(c => c === 0)), 'his tracers are colour 0 (blue: +0x120 bit 0x400)');
  const ms = await pg.evaluate(() => window.__trMesh.slice());
  ok(ms.length > 0 && ms.every(m => m.vis === m.n), `the layer builds them: ${ms.length} drawn frames, every tracer quad a visible mesh (${ms.map(m => m.vis + '/' + m.n).slice(0, 6).join(' ')})`);
  await pg.waitForTimeout(1500);
  const after = await pg.evaluate(() => ({ live: window.__play.shotFx.tracers.length, bullets: window.__play.enemyAI.bullets.filter(b => b.shooter === 0x16).length }));
  ok(after.bullets === 0 && after.live === 0, `his bullets end and their tracers are freed (${after.bullets} bullets, ${after.live} tracers left)`);

  // 2. a soldier's shot from 200 u away toward Vincent: an orange tracer, drawn while it flies. worker 0289: up to 6 shots, as
  // spawnShot aims through the weapon's cone (spreadAim, FUN_005405b0: 24 deg for e027), so a shot can fly off the screen and
  // draw no quad (it failed so 3 runs in 7, page code unchanged)
  const shoot = () => pg.evaluate(() => {
    const P = window.__play, AI = P.enemyAI, a = AI.actors.find(x => x.ai && x.ai.W && !AI.dead(x));
    if (!a) return null;
    const p = P.ctrl.pos, at = [p.x, p.y - 10, p.z], from = [p.x + 200, p.y - 10, p.z];
    AI.t.spawnShot(a, at, from, a.ai.W);
    const b = AI.bullets[AI.bullets.length - 1];
    return { id: a.id, colour: P.shotFx.live.get(b)?.tr?.colour, f120: b.f120 };
  });
  await pg.evaluate(() => { window.__trLog.length = 0; });
  const s = await shoot();
  ok(s && s.colour === 1 && !(s.f120 & 0x400), `soldier #${s?.id}'s shot: a tracer, colour 1 (orange: +0x120 0x${s?.f120.toString(16)} has no 0x400)`);
  const drawnOrange = () => pg.evaluate(() => window.__trLog.filter(e => e.colours.includes(1)));
  await pg.waitForTimeout(800);
  for (let i = 1; i < 6 && s && !(await drawnOrange()).some(e => e.moved > 0 && e.quads.some(q => q > 0)); i++) { await shoot(); await pg.waitForTimeout(800); }
  const o = await drawnOrange();
  // (it flies at the camera: quads past the screen box are dropped, as FUN_002f5c50's clip)
  ok(o.some(e => e.moved > 0 && e.quads.some(q => q > 0)), `drawn while it flies: ${o.filter(e => e.moved > 0).length} draw passes with a moved orange tracer (${o.filter(e => e.moved > 0).map(e => e.quads.join('+')).join(', ')} quads)`);
  ok(errs.length === 0, `no page errors (${errs.slice(0, 2).join(' | ')})`);

  // 3. ?fx=0: no effect engine, no tracer list, the shots still fly
  await open('?fx=0&enemydmg=0&sound=0');
  const n = await pg.evaluate(() => { const P = window.__play; P.enemyAI.queueShot([P.ctrl.pos.x, P.ctrl.pos.y - 10, P.ctrl.pos.z], [P.ctrl.pos.x + 300, P.ctrl.pos.y - 10, P.ctrl.pos.z], { pellets: 1, speed10: 400, range10: 100, damage: 1, flags: 0x100, spread: [0, 0, 0] }); return new Promise(r => setTimeout(() => r({ fx: !!window.__fx, tr: P.shotFx.tracers.length }), 300)); });
  ok(!n.fx && n.tr <= 1, `?fx=0: no effect layer (${n.tr} tracer kept in the list, none drawn)`);
} finally {
  await browser.close();
  srv.kill();
}
done();
