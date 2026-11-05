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
const ai = JSON.parse(fs.readFileSync(path.join(here, 'data/enemies/ai.json'), 'utf8'));
const REC = Object.fromEntries(ai.records.map((r, k) => [r.tag, k]));   // status name -> record: Dragonfly, the boss, the paratroopers ...
const CASES = [
  // trigger 14's event: script 87 activates Dragonfly, flag 0 = 13
  { warp: 'heritoujou', ev: ['heri_toujou'], trigger: 14, live: 31, shown: ['p000', 'e023', 'g013', 'g071'], after: R => R.gflags[1] === 13 && R.battle, g1: 13 },
  // the market with Dragonfly up (event 0x23 as test_heli_page), then flag 0 = 14 (script 29 event 0x16's last leg); no paratrooper objects yet, as T w262_dgac under the same poke; Vincent's lent model is visible and has no clip until a later shot: his gameplay body stands for it
  { warp: 'heridgsol', ev: ['heri_dgsol'], heli: true, vinStands: true, live: 31, shown: ['p000', 'e023', 'g013', 'g033'], after: R => R.gflags[1] === 14 && R.battle, g1: 14 },
  // trigger 29's event (script 35: flag 0 = 36)
  { warp: 'chunk0b', ev: ['heri_lastst'], trigger: 29, shown: ['p000', 'e024', 'g013'], after: R => R.gflags[1] === 29 && R.battle, g1: 29 },
  { warp: 'herilasted', ev: ['heri_lasted', 'kita_ev0145'], shown: ['p000', 'e024', 'p001', 'n043', 'p005'], win: 'kita_ev0145', box: true, after: R => R.log.some(x => x[1] === 'endSection') },
];
// the level's end: the Status box comes up over the event's black (displayStageInfo(2)), the fade doesn't cover it, ✕ closes it and the page stops (Zone.exit(181))
async function statusBox(pg, name, fadedOut = false) {
  await pg.waitForFunction(() => window.__play.results.box && window.__play.stageInfo.kind >= 0, null, { timeout: 300000, polling: 200 });
  // the box's timeline swaps layouts (title, points, rows); the rows are up by step 60 (test_results_page)
  await pg.waitForFunction(() => { const b = window.__play.results.box; return b.screen && b.step >= 60; }, null, { timeout: 120000, polling: 200 }).catch(() => null);
  await pg.waitForTimeout(3000);
  const s = await pg.evaluate(() => { const P = window.__play, B = P.results.box; return { fade: P.output.fade, rows: B.texts().length, kind: P.stageInfo.kind, step: B.step, screen: !!B.screen, table: !!B.table, closed: B.closed, state: P.stageInfo.state, now: P.stageInfo.now, start: B.start, mode: B.mode, hold: B.hold, ticks: P.stats.ticks, exit: P.results.exit }; });
  const shot = await pg.screenshot({ type: 'jpeg', quality: 80 });
  if (SHOT) fs.writeFileSync(path.join(SHOT, name + '_box.jpg'), shot);
  ok(s.rows > 0, `${name}: the Status box has its rows`, JSON.stringify(s));
  // after heri_lasted the screen is black (fade 1), so only the box can light its rectangle (the rows, 960 x 540: x 170..560, y 145..390; the debug text is above it).
  // Skipped into, the fade is 0 and the world lights it: the rows are the check there
  if (fadedOut) {
    const lit = await pg.evaluate(async b64 => { const im = new Image(); im.src = 'data:image/jpeg;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const x = Math.round(im.width * 170 / 960), y = Math.round(im.height * 145 / 540), w = Math.round(im.width * 390 / 960), h = Math.round(im.height * 245 / 540), d = g.getImageData(x, y, w, h).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n / (d.length / 4); }, shot.toString('base64'));
    ok(s.fade === 1, `${name}: the fade is at 1 under the box`, JSON.stringify(s));
    ok(lit > 0.05, `${name}: the fade doesn't cover the Status box: its rectangle is lit`, 'lit ' + lit.toFixed(3));
  }
  for (let i = 0; i < 12 && !(await pg.evaluate(() => { const P = window.__play; return !!P.results.exit && P.stageInfo.kind < 0; })); i++) { await pg.keyboard.press('Space'); await pg.waitForTimeout(1500); }
  const e = await pg.evaluate(() => window.__play.results.exit);
  ok(e && e[0] === 181, `${name}: ✕ closes it, Zone.exit(181)`, JSON.stringify(e));
}
// Skip mid-event, die at the boss, Restart from scene_save(5), Skip again, the boss fights, beat it, Skip heri_lasted, the Status box
async function bossRestart() {
  const pg = cur = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('crash', () => errs.push('the renderer crashed')); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&warp=chunk0b`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  const until = (f, a, t = 600000) => pg.waitForFunction(f, a, { timeout: t, polling: 200 });
  const skip = async (m) => {
    await until(m => { const R = window.__play.stage.rt; return R.vm.frames.some(F => F.m.name === m) && R.vm.pending && R.skippable() && R.view; }, m);
    await pg.waitForTimeout(1500);
    await pg.keyboard.press('Enter');
    await until(() => window.__play.stagePaused, null, 20000);
    await pg.keyboard.press('Space');
  };
  await until(() => window.__play && window.__play.warp && window.__play.stats.ticks > 5);
  await pg.evaluate(() => { const A = window.__play.enemyAI; A.runEvent(A.objects.get('t29'), 13); });
  await skip('heri_lastst');
  await until(() => { const P = window.__play; return P.enemyAI.bossPlugin && P.stage.rt.battle; });
  ok(await pg.evaluate(() => !!window.__play.restart.record), 'boss: scene_save(5) took a record');
  ok(await pg.evaluate(() => window.__play.stage.rt.log.some(x => /^skip .*heri_lastst/.test(x[1]))), 'boss: Skip went in mid heri_lastst');
  // what a player does: dies, Restart on the game over menu
  const n0 = await pg.evaluate(() => window.__play.restart.count);
  await pg.evaluate(() => { window.__play.php.hp = 0; });
  await until(() => { const m = window.__play.gameOver.go.menu; return m && m.focus && m.focus.id === 3; }, null, 120000);
  await pg.waitForTimeout(300);
  await pg.keyboard.press('Space');
  await until(n => window.__play.restart.count === n + 1, n0, 120000);
  await skip('heri_lastst');
  await until(() => { const P = window.__play; return P.enemyAI.bossPlugin && P.stage.rt.battle; });
  const brain = await pg.waitForFunction(() => { const a = window.__play.enemyAI.objects.get(54); return a.ai && a.ai.mode === 0x100 && a.ai.boss && a.ai.boss.st >= 2 ? { mode: a.ai.mode, st: a.ai.boss.st, hp: a.hp } : false; }, null, { timeout: 120000, polling: 200 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!brain, 'Restart at the boss: record 32 has its brain (mode 0x100) and fights', JSON.stringify(brain) + ' ' + await pg.evaluate(() => { const a = window.__play.enemyAI.objects.get(54); return JSON.stringify({ kind: a.kind, hp: a.hp, mode: a.ai && a.ai.mode }); }));
  const fired = await pg.waitForFunction(() => window.__play.enemyAI.bullets.some(b => b.shooter === 54), null, { timeout: 300000, polling: 50 }).then(() => true).catch(() => false);
  ok(fired, 'Restart at the boss: it fires');
  await pg.evaluate(() => { window.__play.enemyAI.objects.get(54).hp = 10000; });
  const beaten = await until(() => (window.__play.enemyAI.eventFlags[0] | 0) >= 40, null, 180000).then(() => true).catch(() => false);
  ok(beaten, 'Restart at the boss: beaten, stage flag 0 reaches 40');
  if (beaten) {
    await skip('heri_lasted');
    await until(() => window.__play.stage.rt.log.some(x => x[1] === 'endSection'));
    ok(await pg.evaluate(() => !window.__play.stage.rt.vm.calls.includes('ev0145.kita_ev0145')), 'Skip in heri_lasted: no kita_ev0145');
    await statusBox(pg, 'boss restart');
  }
  ok(!errs.length, 'boss restart: no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
let cur = null;
try {
  if (!ONLY || ONLY.includes('bossrestart')) await bossRestart();
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
          // the live enemy behind the slot: FUN_00344ec0(C, 1): its own update stops, its clip frame and place stay (FUN_00343160's first test)
          if (C.live != null) { const b = P.enemyAI.actors.find(x => x.rec === C.live);
            if (b && (b.C.f564 & 0x80000000)) { const j = JSON.stringify([b.C.motion && b.C.motion.cls, b.C.motion && b.C.motion.phase, b.C.mp && b.C.mp.frame, b.C.mp && b.C.mp.clip]);   /* not the place: the hand-back writes it (FUN_003157b0) before the pass clears the bit */ E.lent = (E.lent || 0) + 1; if (E.lastLent && E.lastLent !== j) E.lentMoved = (E.lentMoved || 0) + 1; E.lastLent = j; } }
          for (const a of R.actors.slots) if (a.drawn && a.drawn.shown && (!a.lent || a.mp.clip)) E.shown.add(a.model);
          if (P.stageView.active && P.vin && P.vin.body && P.vin.body.visible) E.vin++;   // from the first shot; before it the fade is black
          if (P.stageView.active) E.cam++;
          // a lent object: its gameplay body is off while its slot plays (records 31, 32 by status name, ai.json)
          for (const a of R.actors.slots) if (a.lent && a.mp.clip && a.lent.tag !== 'p_Vin') { const rk = C.rec[a.lent.tag], d = P.enemies && P.enemies.actors.find(x => x.rec === rk); if (d && d.body && d.body.visible) E.gameBody++; }
          if (P.stageWin && P.stageWin.drawAll(performance.now()).length && k === C.win) E.win++; }
        requestAnimationFrame(f); };
      requestAnimationFrame(f); }, { ev: C.ev, win: C.win || null, rec: REC, live: C.live ?? null });
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
    // the live enemy after the hand-back: the stage pass gave the body back and its AI runs (play.js battleObject, enemy_ai)
    if (C.live != null) {
      const E = await pg.evaluate(() => ({ lent: window.__ev.lent || 0, moved: window.__ev.lentMoved || 0 }));
      ok(E.lent > 20 && E.moved === 0, `${C.warp}: record ${C.live} stands while lent (FUN_00344ec0(C, 1))`, JSON.stringify(E));
      const look = () => pg.evaluate(k => { const P = window.__play, b = P.enemyAI.actors.find(x => x.rec === k); return b && { bit: !!(b.C.f564 & 0x80000000), cls: b.C.motion && b.C.motion.cls, clip: b.C.mp && b.C.mp.clip, frame: b.C.mp && b.C.mp.frame, pos: b.pos.slice(), hp: b.hp, mode: b.ai && b.ai.mode }; }, C.live);
      const a0 = await look(), t0 = await pg.evaluate(() => window.__play.stats.ticks);
      await pg.waitForFunction(t => window.__play.stats.ticks > t + 200, t0, { timeout: 300000, polling: 200 }).catch(() => null);
      const a1 = await look();
      ok(a0 && !a0.bit && a1 && a0.cls === 0x42, `${C.warp}: after the hand-back the bit is clear and it is in its flight class`, JSON.stringify(a0));
      ok(a1 && Math.hypot(a1.pos[0] - a0.pos[0], a1.pos[2] - a0.pos[2]) > 1 && (a1.frame !== a0.frame || a1.clip !== a0.clip), `${C.warp}: its AI runs after the hand-back: it flies on`, JSON.stringify([a0, a1]));
    }
    if (C.box) await statusBox(pg, C.warp, true);
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
