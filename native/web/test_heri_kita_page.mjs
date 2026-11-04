// test_heri_kita_page.mjs -- heri_toujou, heri_dgsol, heri_lastst, heri_lasted, kita_ev0145 on the real play.html (worker 0262; notes/story-cutscenes.md): the page aids
// ?warp=heritoujou etc. set main's flags at each beat; main plays the event, unskipped. Checks what a player sees: the actors drawn (with the lent objects' own models in their
// clips), Vincent's gameplay body hidden, the event camera, subtitles, no Skip, then where main goes next. Page aid ?warp only starts the beat.
//   node native/web/test_heri_kita_page.mjs   (needs playwright + data; network for the three.js CDN; sandbox off)   HK_ONLY=heritoujou,chunk0b,.. a subset   HK_SHOT=<dir>: one screenshot per event (HK_AT=clock ms)
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
for (const f of ['event/ev0100_stage.json', 'event/actors/g033.glb', 'audio/voice/10701rv.flac'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const SHOT = process.env.HK_SHOT, ONLY = process.env.HK_ONLY && process.env.HK_ONLY.split(','), AT = +(process.env.HK_AT || 4000);
// warp, the event(s), models that must be drawn in them, a window's event (null: none), what main does after
const CASES = [
  // trigger 14's event: script 87 activates Dragonfly, flag 0 = 13
  { warp: 'heritoujou', ev: ['heri_toujou'], trigger: 14, shown: ['p000', 'e023', 'g013', 'g071'], after: R => R.gflags[1] === 13 && R.battle, g1: 13 },
  // the market with Dragonfly up (event 0x23 as test_heli_page), then flag 0 = 14 (script 29 event 0x16's last leg); no paratrooper objects yet, as T w262_dgac under the same poke; Vincent's lent model is visible and has no clip until a later shot: his gameplay body stands for it
  { warp: 'heridgsol', ev: ['heri_dgsol'], heli: true, vinStands: true, shown: ['p000', 'e023', 'g013', 'g033'], after: R => R.gflags[1] === 14 && R.battle, g1: 14 },
  // trigger 29's event (script 35: flag 0 = 36)
  { warp: 'chunk0b', ev: ['heri_lastst'], trigger: 29, shown: ['p000', 'e024', 'g013'], after: R => R.gflags[1] === 29 && R.battle, g1: 29 },
  { warp: 'herilasted', ev: ['heri_lasted', 'kita_ev0145'], shown: ['p000', 'e024', 'p001', 'n043', 'p005'], win: 'kita_ev0145', after: R => R.log.some(x => x[1] === 'endSection') },
];
let cur = null;
try {
  for (const C of CASES) {
    if (ONLY && !ONLY.includes(C.warp)) continue;
    const pg = cur = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errs = [], warns = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
    for (let i = 0; ; i++) {
      try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&warp=${C.warp}`, { waitUntil: 'load' }); break; }
      catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
    }
    await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 5, null, { timeout: 900000 });
    await pg.waitForFunction(() => window.__play.warp, null, { timeout: 900000 });
    if (C.heli) {   // as test_heli_page: object 53 = Dragonfly's record: activate, its event 0x23, then flag 0 = 14
      await pg.evaluate(() => { const A = window.__play.enemyAI, h = A.objects.get(53); A.t.send(h, -2, 0x108, [0, 0, 0, 0]); A.runEvent(A.objects.get(53), 0x23); });
      await pg.waitForFunction(() => window.__play.enemies.actors.some(a => a.rec === 31), null, { timeout: 300000, polling: 100 });
      await pg.evaluate(() => { const A = window.__play.enemyAI; A.t.send(A.objects.get(53), -2, 0xb, [0, 14, 0, 0]); });
    }
    // the trigger volume's event, as stepping into it (FUN_00550918 -> event 13): the warp's spot is on its far side and the walk there is not this test's business
    if (C.trigger != null) await pg.evaluate(k => { const A = window.__play.enemyAI; A.runEvent(A.objects.get('t' + k), 13); }, C.trigger);
    await pg.evaluate((C) => { const P = window.__play; window.__ev = { n: {}, shown: new Set(), vin: 0, cam: 0, win: 0, gameBody: 0 };
      const f = () => { const R = P.stage.rt, E = window.__ev, w = R.vm.frames.map(F => F.m.name), k = C.ev.find(e => w.includes(e));
        if (k) { E.n[k] = (E.n[k] || 0) + 1;
          for (const a of R.actors.slots) if (a.drawn && a.drawn.shown && (!a.lent || a.mp.clip)) E.shown.add(a.model);
          if (P.stageView.active && P.vin && P.vin.body && P.vin.body.visible) E.vin++;   // from the first shot; before it the fade is black
          if (P.stageView.active) E.cam++;
          // a lent object: its gameplay body is off while its slot plays (records 31, 32 by status name, ai.json)
          for (const a of R.actors.slots) if (a.lent && a.mp.clip && a.lent.tag !== 'p_Vin') { const rk = { e_Heri: 31, e_HobH: 32 }[a.lent.tag], d = P.enemies && P.enemies.actors.find(x => x.rec === rk); if (d && d.body && d.body.visible) E.gameBody++; }
          if (P.stageWin && P.stageWin.drawAll(performance.now()).length && k === C.win) E.win++; }
        requestAnimationFrame(f); };
      requestAnimationFrame(f); }, { ev: C.ev, win: C.win || null });
    if (SHOT) {
      fs.mkdirSync(SHOT, { recursive: true });
      for (const m of C.ev) {
        await pg.waitForFunction(m => window.__play.stage.rt.vm.frames.some(F => F.m.name === m), m, { timeout: 500000, polling: 100 });
        const t0 = await pg.evaluate(() => window.__play.stage.rt.clock);
        await pg.waitForFunction(t => window.__play.stage.rt.clock >= t, t0 + AT, { timeout: 300000, polling: 50 });
        await pg.screenshot({ path: path.join(SHOT, m + '.png') });
      }
    }
    if (process.env.HK_DEBUG) { await pg.waitForFunction(m => { const R = window.__play.stage.rt; return R.vm.frames.some(F => F.m.name === m) && R.view; }, C.ev[0], { timeout: 900000, polling: 100 }); await pg.waitForTimeout(+process.env.HK_DEBUG);
      console.log('     debug: ' + await pg.evaluate(() => { const P = window.__play, R = P.stage.rt; return JSON.stringify({ slots: R.actors.slots.map(a => [a.id, a.model, a.lent ? a.lent.tag : 0, a.mp.clip, a.visible, a.drawn && a.drawn.shown]), eh: P.vin.eventHidden, vis: P.vin.body.visible, en: P.enemies.actors.map(d => [d.rec, d.body && d.body.visible]), log: R.log.filter(x => /getbattle/.test(x[1])).map(x => x[1]) }); })); }
    await pg.waitForFunction(`(${C.after.toString()})(window.__play.stage.rt)`, null, { timeout: 1500000, polling: 500 });
    const s = await pg.evaluate(() => { const P = window.__play, R = P.stage.rt, E = window.__ev;
      return { n: E.n, shown: [...E.shown], vin: E.vin, cam: E.cam, win: E.win, gameBody: E.gameBody, log: R.log.map(x => x[1]), pos: [P.ctrl.pos.x, P.ctrl.pos.z], vis: P.vin.body.visible, eh: !!P.vin.eventHidden, g1: R.gflags[1] }; });
    const total = C.ev.reduce((t, e) => t + (s.n[e] || 0), 0);
    ok(C.ev.every(e => s.n[e] > 20), `${C.warp}: ${C.ev.join(', ')} ran on the page's frames`, JSON.stringify(s.n));
    ok(!s.log.some(m => /^skip /.test(m)), `${C.warp}: no Skip`, s.log.filter(m => /^skip /.test(m)).join());
    ok(C.shown.every(m => s.shown.includes(m)), `${C.warp}: draws its actors`, s.shown.join());
    if (!C.vinStands) ok(s.vin <= 3, `${C.warp}: Vincent's gameplay body hidden through it (the first shot's frame aside)`, s.vin + ' samples');
    ok(s.gameBody <= 2, `${C.warp}: no gameplay enemy body drawn while a slot plays its model (the clip's first frame aside: rAF samples between the tick and its draw)`, s.gameBody + ' samples');
    ok(s.cam >= total * 0.75, `${C.warp}: the event camera is the render camera`, `${s.cam} of ${total}`);
    if (C.win) ok(s.win > 0, `${C.warp}: subtitles open in ${C.win}`, String(s.win));
    if (C.g1) { ok(s.g1 === C.g1, `${C.warp}: global 1 = ${C.g1}`, String(s.g1)); ok(s.vis && !s.eh, `${C.warp}: after it Vincent is drawn again`); }
    ok(!errs.length, `${C.warp}: no page errors`, errs.slice(0, 3).join(' | '));
    console.log('     warnings: ' + [...new Set(warns.filter(w => /event actor|motion file|not exported/.test(w)))].slice(0, 8).join(' | '));
    await pg.close();
  }
} catch (e) {
  ok(false, 'exception', e.message);
  if (cur) console.log('     state: ' + await cur.evaluate(() => { const P = window.__play; return JSON.stringify(P && { ticks: P.stats.ticks, warp: P.warp, pos: P.ctrl && [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z], f0: P.enemyAI && P.enemyAI.eventFlags[0], g1: P.stage && P.stage.rt.gflags[1], battle: P.stage && P.stage.rt.battle, log: P.stage && P.stage.rt.log.slice(-6).map(x => x[1]) }); }).catch(x => x.message));
}
await browser.close(); srv.kill();
done();
