// test_event_cape_page.mjs -- Vincent's cape on his event body (worker 0280; notes/story-cutscenes.md 'Vincent's cape in events').
// ?warp=heli plays heri_taijou, whose Vincent is the event-loaded p000 (07700001.bin). The game draws its cloth block 0x19f70
// (FUN_005b2ef8 -> FUN_005b2550 -> FUN_005b06d0 / FUN_005b0d30); p000.glb has no cape, event_actors.js capeOf adds it.
//   node native/web/test_event_cape_page.mjs   (playwright + data; network for the three.js CDN; sandbox off)
//   CAPE_SHOT=<file.png>: a screenshot when the cape is first on screen
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m, info = '') => { console.log((c ? 'ok   ' : 'FAIL ') + m + (info ? '  (' + info + ')' : '')); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['event/ev0100_stage.json', 'event/actors/p000.glb', 'vincent/cloth.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// The lent p_Vin (heri_dgsol, getbattleactor p_Vin): the slot holds Vincent's own MP, so its clip requests run FUN_005a95f0 on
// his gameplay window too. Vincent runs (a flag-2 clip: the window armed), the event lends him, its p000 clips (flag 0) clear the
// window, and after battle() he stands: total 0, k = 1, the cape pinned to its keyed target (event_actors.js capeRequest)
async function lend() {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&warp=heridgsol`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 5 && window.__play.warp, null, { timeout: 400000 });
  // run: the gameplay window armed by his run clip (cloth.json clip_windows flag 2)
  await pg.keyboard.down('KeyW');
  await pg.waitForFunction(() => window.__play.cape.cloth.total > 0, null, { timeout: 30000, polling: 50 }).catch(() => null);
  const run = await pg.evaluate(() => window.__play.cape.state());
  // as test_heri_kita_page heridgsol: Dragonfly's record activated, its event 0x23, then flag 0 = 14 (main plays heri_dgsol)
  await pg.evaluate(() => { const A = window.__play.enemyAI, h = A.objects.get(53); A.t.send(h, -2, 0x108, [0, 0, 0, 0]); A.runEvent(A.objects.get(53), 0x23); });
  await pg.waitForFunction(() => window.__play.enemies.actors.some(a => a.rec === 31), null, { timeout: 300000, polling: 100 });
  await pg.evaluate(() => {
    const P = window.__play, A = P.enemyAI; A.t.send(A.objects.get(53), -2, 0xb, [0, 14, 0, 0]);
    const E = window.__lend = { clips: [], totalAtClip: null, totals: new Set(), after: [] };
    const f = () => {
      const R = P.stage && P.stage.rt;
      if (R) {
        const a = R.actors.slots.find(s => s.lent && s.lent.tag === 'p_Vin' && s.mp.clip);
        if (a) {
          if (E.clips[E.clips.length - 1] !== a.mp.clip) E.clips.push(a.mp.clip);
          if (E.totalAtClip == null && P.stageView.bodyOf(a)) E.totalAtClip = P.cape.cloth.total;
          if (E.totalAtClip != null) E.totals.add(P.cape.cloth.total);
        }
        if (E.totalAtClip != null && R.battle && !P.vin.eventHidden) E.after.push(P.cape.state());
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await pg.keyboard.up('KeyW');                       // he stands: h_st (flag 1, the window left alone)
  await pg.waitForFunction(() => window.__lend.after.length > 60, null, { timeout: 900000, polling: 200 });
  const E = await pg.evaluate(() => { const E = window.__lend; return { clips: E.clips, totalAtClip: E.totalAtClip, totals: [...E.totals], after: E.after.slice(-60) }; });
  console.log('     ' + JSON.stringify({ run, clips: E.clips, totalAtClip: E.totalAtClip, totals: E.totals, last: E.after[E.after.length - 1] }));
  ok(run.total > 0, 'heridgsol: running arms the gameplay cape window (a flag-2 clip)', JSON.stringify(run));
  ok(E.clips.length > 0, 'heri_dgsol: the lent p_Vin slot plays its clips', E.clips.join());
  ok(E.totals.every(t => t === 0), 'the lent slot\'s clip requests clear the gameplay window (FUN_005a95f0 on his own MP, flag 0)', E.totals.join());
  ok(E.after.every(x => x.total === 0 && x.remaining === 0 && x.k === 1), 'after battle() he stands with the cape pinned: total 0, k 1', JSON.stringify(E.after.find(x => x.k !== 1) || E.after[0]));
  ok(!errs.length, 'heridgsol: no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&warp=heli`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 5, null, { timeout: 240000 });
  // per animation frame in heri_taijou: the p000 slot, its body's cape meshes, and whether the cape corners are on screen
  await pg.evaluate(() => {
    const P = window.__play, E = window.__cape = { frames: 0, p000: 0, withCape: 0, onScreen: 0, finite: true, maxOff: 0, hit: null };
    const v = new (P.camera.position.constructor)();
    const f = () => {
      const R = P.stage && P.stage.rt;
      if (R && R.vm.frames.some(F => F.m.name === 'heri_taijou')) {
        E.frames++;
        for (const a of R.actors.slots) {
          if (a.model !== 'p000' || !a.drawn || !a.drawn.shown) continue;
          const b = P.stageView.bodyOf(a);
          if (!b || !b.visible) continue;                              // not spawned (its model loading) / not placed yet: not drawn
          E.p000++;                                                    // a drawn p000 body
          const capes = [];
          if (b) b.traverse(o => { if (o.userData && o.userData.cloth && o.visible) capes.push(o); });
          if (!capes.length) { E.miss = E.miss || { id: a.id, mask: a.partMask, clip: a.drawn.clip, fr: a.drawn.frame, tick: R.frameNo, n: 0, all: 0 }; E.miss.n++; b.traverse(o => { if (o.userData && o.userData.cloth) E.miss.all++; }); continue; }
          E.withCape++;
          // the corners in world: finite, and near the body (the pinned edge is on the shoulders)
          // (the body's origin can be 0 with the clip's root bone carrying him: kmb20vn) -> the distance to the nearest joint
          const o = capes[0], pos = o.geometry.attributes.position, V3 = P.camera.position.constructor, J = [];
          b.traverse(n => { if (n.isBone) J.push(new V3().setFromMatrixPosition(n.matrixWorld)); });
          let inside = 0;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            if (!Number.isFinite(v.x + v.y + v.z)) E.finite = false;
            const d = Math.min(...J.map(j => v.distanceTo(j)));
            if (d > E.maxOff) { E.maxOff = d; E.hit = { frame: E.frames, id: a.id, clip: a.drawn.clip, fr: a.drawn.frame, v: v.toArray().map(x => +x.toFixed(1)), tick: R.frameNo }; }
            v.project(P.camera);
            if (Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && v.z < 1) inside++;
          }
          if (inside > pos.count * 0.8) E.onScreen++;
        }
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  // wait on the event having drawn p000, not on the cape: a missing cape fails the asserts below, not the wait (review of 0280)
  await pg.waitForFunction(() => window.__cape.p000 > 50, null, { timeout: 400000, polling: 100 });
  await pg.waitForFunction(() => window.__cape.onScreen > 5, null, { timeout: 60000, polling: 100 }).catch(() => null);
  if (process.env.CAPE_SHOT) await pg.screenshot({ path: process.env.CAPE_SHOT });
  // what the player sees: the same frame drawn with the cape and without it, read back from the canvas
  const px = await pg.evaluate(() => {
    const P = window.__play, R = P.stage.rt, a = R.actors.slots.find(s => s.model === 'p000' && s.drawn && s.drawn.shown);
    const b = a && P.stageView.bodyOf(a), capes = [];
    if (b) b.traverse(o => { if (o.userData && o.userData.cloth) capes.push(o); });
    const gl = P.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { P.output.render(P.root, P.camera); const d = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, d); return d; };
    const vis = capes.map(o => o.visible);
    const on = grab();
    capes.forEach(o => { o.visible = false; });
    const off = grab();
    capes.forEach((o, i) => { o.visible = vis[i]; });
    let n = 0;
    for (let i = 0; i < on.length; i += 4) if (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]) > 24) n++;
    return { n, total: W * H, capes: capes.length };
  });
  const s = await pg.evaluate(() => JSON.parse(JSON.stringify(window.__cape)));   // before the hide below (its draws have no cape)
  // hide_model_l(id, 3, 0): MP+0x180 bit 3 = the cape's smd list entry (actors.json blocks[3] = 0x19f70): FUN_005b2ef8 skips it,
  // the body stays. Set as the native sets it, two draws later the cape meshes are off; cleared, back on
  const hide = await pg.evaluate(async () => {
    const P = window.__play, R = P.stage.rt, a = R.actors.slots.find(s => s.model === 'p000' && s.drawn && s.drawn.shown);
    const b = a && P.stageView.bodyOf(a), capes = [];
    if (b) b.traverse(o => { if (o.userData && o.userData.cloth) capes.push(o); });
    const draws = async n => { const f0 = R.frameNo; while (R.frameNo < f0 + n) await new Promise(r => requestAnimationFrame(r)); };
    const st = () => capes.map(o => o.visible).join();
    const before = st();
    a.partMask = (a.partMask | 8) >>> 0;
    await draws(2);
    const hidden = st(), body = b.visible && a.drawn.shown;
    a.partMask = (a.partMask & ~8) >>> 0;
    await draws(2);
    return { before, hidden, body, after: st(), shownAfter: a.drawn.shown };
  });
  console.log('     ' + JSON.stringify(s), JSON.stringify(px));
  ok(s.p000 > 50, 'heri_taijou draws the event p000', `${s.p000} samples`);
  ok(s.withCape === s.p000, 'every drawn p000 frame has its cape (FUN_005b2ef8 draws block 0x19f70)', `${s.withCape} of ${s.p000}`);
  ok(px.capes === 2, 'the cape is two passes (GS alpha test / alpha fail)', String(px.capes));
  ok(s.finite && s.maxOff < 10, 'cape corners finite and on the body (each within 10 u of a joint)', `max ${s.maxOff.toFixed(1)} u`);
  ok(px.n > px.total * 0.01, 'the cape changes what is on screen (> 1% of the pixels)', `${px.n} of ${px.total}`);
  ok(hide.before === 'true,true' && hide.hidden === 'false,false' && hide.body, 'hide_model_l bit 3 hides the cape, not the body (FUN_005b2ef8 skips MP+0x180 entries)', JSON.stringify(hide));
  ok(!hide.shownAfter || hide.after === 'true,true', 'bit 3 cleared: the cape is drawn again', JSON.stringify(hide));
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
  await lend();
} catch (e) { ok(false, 'exception', e.message); }
await browser.close(); srv.kill();
done();
