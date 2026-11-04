// test_story_cutscenes_page.mjs -- heri_taijou and sk_mituketa2 on the real play.html (worker 0261; notes/story-cutscenes.md): the page aid
// ?warp=heli puts the story where Dragonfly was just beaten (stage flag 0 = 16); main plays both events, then back to battle at (6, 7).
//   node native/web/test_story_cutscenes_page.mjs   (needs playwright + data; network for the three.js CDN; sandbox off)
//   STORY_SHOT=<dir>: screenshots of both events (STORY_SHOT_AT=heri clock,sk clock in ms; default 3000,9000)
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
for (const f of ['event/ev0100_stage.json', 'event/actors/e050.glb', 'audio/voice/10401sk.flac'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const SHOT = process.env.STORY_SHOT, AT = (process.env.STORY_SHOT_AT || '3000,9000').split(',').map(Number);
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&warp=heli`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 5, null, { timeout: 240000 });
  // sampled each animation frame
  await pg.evaluate(() => { const P = window.__play; window.__ev = { heri: 0, sk: 0, shown: {}, vin: {}, win: new Set(), cam: 0, en: 0 };
    const f = () => { const R = P.stage.rt, E = window.__ev;
      const w = R.vm.frames.map(F => F.m.name), k = w.includes('heri_taijou') ? 'heri' : w.includes('sk_mituketa2') ? 'sk' : null;
      if (k) { E[k]++; E.shown[k] ??= new Set(); E.vin[k] = (E.vin[k] || 0) + (P.vin && P.vin.body && P.vin.body.visible ? 1 : 0);
        for (const a of R.actors.slots) if (a.drawn && a.drawn.shown && !a.lent) E.shown[k].add(a.model);
        if (P.stageView.active) E.cam++;
        if (P.enemies && P.enemies.actors.some(d => d.body && d.body.visible)) E.en++; }
      if (P.stageWin && P.stageWin.drawAll(performance.now()).length && k) E.win.add(k);
      requestAnimationFrame(f); };
    requestAnimationFrame(f); });
  if (SHOT) {
    fs.mkdirSync(SHOT, { recursive: true });
    for (const [k, m, ms] of [['heri', 'heri_taijou', AT[0]], ['sk', 'sk_mituketa2', AT[1]]]) {
      await pg.waitForFunction(m => window.__play.stage.rt.vm.frames.some(F => F.m.name === m), m, { timeout: 400000, polling: 100 });
      const t0 = await pg.evaluate(() => window.__play.stage.rt.clock);
      await pg.waitForFunction(t => window.__play.stage.rt.clock >= t, t0 + ms, { timeout: 200000, polling: 50 });
      await pg.screenshot({ path: path.join(SHOT, k + '.png') });
    }
  }
  await pg.waitForFunction(() => { const R = window.__play.stage.rt; return R.gflags[1] === 20 && R.battle; }, null, { timeout: 500000, polling: 500 });
  await pg.waitForFunction(() => window.__play.stats.ticks > 0, null, { timeout: 1000 });
  const s = await pg.evaluate(() => { const P = window.__play, R = P.stage.rt, E = window.__ev;
    return { heri: E.heri, sk: E.sk, cam: E.cam, enHidden: E.en, vin: E.vin, win: [...E.win], shown: Object.fromEntries(Object.entries(E.shown).map(([k, v]) => [k, [...v]])),
      log: R.log.map(x => x[1]), pos: [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z], vis: P.vin && P.vin.body && P.vin.body.visible, slots: R.actors.slots.map(a => a.model),
      en: P.enemies ? P.enemies.actors.filter(d => d.body).map(d => d.body.visible) : [] }; });
  ok(s.heri > 50 && s.sk > 50, `both events ran on the page's frames`, `heri ${s.heri}, sk ${s.sk} samples`);
  ok(!s.log.some(m => /^skip /.test(m)), 'no Skip in them', s.log.filter(m => /^skip /.test(m)).join());
  ok(['p000', 'e023'].every(m => s.shown.heri.includes(m)), 'heri_taijou draws its actors', s.shown.heri.join());
  ok(['n013', 'g000', 'e050'].every(m => s.shown.sk.includes(m)), 'sk_mituketa2 draws Shelke, her gun, Azul', s.shown.sk.join());
  ok(s.vin.heri === 0 && s.vin.sk === 0, 'Vincent\'s own body hidden in both (setVisibleAll, setVisible_l)', JSON.stringify(s.vin));
  ok(s.enHidden === 0, 'enemies hidden in both (setVisibleAll: FUN_00408900)', s.enHidden + ' samples with one drawn');
  ok(s.cam >= s.heri + s.sk - 80, 'the event camera is the render camera through them (the loads before the first shots aside)', `${s.cam} of ${s.heri + s.sk}`);
  ok(s.win.includes('sk'), 'subtitles open in sk_mituketa2', s.win.join());
  ok(s.vis === true, 'after them: Vincent drawn again');
  // T r06_heli5 (w217): (-1762.5, 0, 1577.7), the same setpos under Skip and not
  ok(Math.hypot(s.pos[0] + 1762.5, s.pos[2] - 1577.7) < 0.5, 'main\'s setpos: Vincent at chunk 07\'s door', s.pos.map(v => v.toFixed(1)).join());
  ok(s.en.some(Boolean), 'after them: enemies drawn again', String(s.en.filter(Boolean).length));
  // Restart through the pause (Start, Restart, OK) from where the player now stands: scene_save(3)'s record. Whatever main replays, it ends in battle with everything drawn
  const until = (f, a) => pg.waitForFunction(f, a, { timeout: 240000, polling: 100 });
  const n0 = await pg.evaluate(() => window.__play.restart.count);
  await pg.keyboard.press('Enter');
  await until(() => { const f = window.__play.pause.flow.screen; return f && f.cur === f.total && f.hasFocus && f.focus.id === 3; });
  await pg.keyboard.press('Space');
  await until(() => { const f = window.__play.pause.flow; return !!f.box && f.box.cur === f.box.total; });
  await pg.keyboard.press('ArrowLeft');
  await until(() => window.__play.pause.flow.box.focus.id === 6);
  await pg.keyboard.press('Space');
  await until(n => window.__play.restart.count === n + 1 && !window.__play.pause.active, n0);
  // the replay's event, Skipped by the player if it plays again, then battle
  const rs = await pg.waitForFunction(() => { const R = window.__play.stage.rt; return R.battle && R.gflags[1] === 20; }, null, { timeout: +process.env.STORY_TO || 500000, polling: 200 }).catch(async (e) => { console.log('     Restart stuck:', JSON.stringify(await pg.evaluate(() => { const P = window.__play, R = P.stage.rt; return { w: R.vm.where(), g1: R.gflags[1], f0: P.enemyAI.eventFlags[0], battle: R.battle, skip: R.skip, fade: R.fade, pend: !!R.vm.pending, calls: R.vm.calls, log: R.log.slice(-12).map(x => x.join(' ')) }; }))); throw e; }).then(() => pg.evaluate(() => {
    const P = window.__play, R = P.stage.rt;
    return { eh: !!P.vin.eventHidden, vis: P.vin.body.visible, g1: R.gflags[1], s0: P.enemyAI.eventFlags[0], cam: !!R.view, calls: R.vm.calls, pos: [P.ctrl.pos.x, P.ctrl.pos.z] };
  }));
  console.log('     after Restart', JSON.stringify(rs));
  ok(!rs.eh && rs.vis, 'Restart from the record: Vincent drawn, not left hidden', JSON.stringify(rs));
  ok(rs.g1 === 20 && !rs.cam, 'Restart: main in battle at the same beat', `global 1 = ${rs.g1}`);
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
  // A player's Skip in each event (Start, cross on the pause's Skip: FUN_003de130 -> FUN_003dfdc8): back to battle, everything drawn; in heri_taijou main's branch past sk_mituketa2
  for (const [m, later] of [['heri_taijou', false], ['sk_mituketa2', true]]) {
    const p2 = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const e2 = []; p2.on('pageerror', e => e2.push(e.message));
    for (let i = 0; ; i++) { try { await p2.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&warp=heli`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
    await p2.waitForFunction(() => window.__play && window.__play.stats.ticks > 5, null, { timeout: 240000 });
    await p2.waitForFunction(m => { const R = window.__play.stage.rt; return R.vm.frames.some(F => F.m.name === m) && R.skippable() && R.view; }, m, { timeout: 400000, polling: 100 });
    await p2.keyboard.press('Enter');
    await p2.waitForFunction(() => window.__play.stagePaused, null, { timeout: 20000, polling: 50 });
    await p2.waitForTimeout(600);
    await p2.keyboard.press('Space');
    await p2.waitForFunction(() => { const R = window.__play.stage.rt; return R.gflags[1] === 20 && R.battle; }, null, { timeout: 300000, polling: 200 });
    const t = await p2.evaluate(() => { const P = window.__play, R = P.stage.rt; return { skip: R.log.filter(x => /^skip /.test(x[1])).map(x => x[1]), calls: R.vm.calls, vis: P.vin.body.visible, pos: [P.ctrl.pos.x, P.ctrl.pos.z], en: P.enemies.actors.filter(d => d.body && d.body.visible).length, slots: R.actors.slots.length }; });
    ok(t.skip.some(x => x.includes(m)), `Skip in ${m} went through the game's path`, t.skip.join());
    ok(t.calls.includes('ev0101.sk_mituketa2') === later, later ? 'sk_mituketa2 ran up to the Skip' : 'Skip in heri_taijou: sk_mituketa2 never called (pc 6355)', t.calls.join());
    ok(t.vis && t.en > 0 && Math.hypot(t.pos[0] + 1762.5, t.pos[1] - 1577.7) < 0.5, `after the Skip in ${m}: Vincent drawn at chunk 07's door, enemies drawn`, JSON.stringify(t));
    ok(!e2.length, 'no page errors', e2.slice(0, 3).join(' | '));
    await p2.close();
  }
} catch (e) { ok(false, 'exception', e.message); }
await browser.close(); srv.kill();
done();
