// The Restart invariant on the real play.html (worker 0254; checkpoint.js 'The Restart invariant', notes/checkpoint-research.md):
// the pause's Restart and the game over's Restart end in the same state, and that state depends on the record alone.
//   1. no record: both zero the section stats and totals (FUN_0030f3d8 -> FUN_0031dae8); the clocks stay; a Zone.exit pending goes.
//   2. a scene_save's record, spoiled afterwards, Restart through the pause: rounds, inventory, selection, gil, taken bits, section
//      stats and totals are the record's, the mark is its stat 14, the clocks stay (T w254), the HUD shows the record's (main's
//      battle(): FUN_00324e70), the placed sounds are new, the voices stopped, nothing is drawn but what the world activated.
//   3. the same through the game over: the same state.
//   4. the level end's last half second: endSection, then a pause Restart: the mark is re-armed, the box gone, endSection works again.
//   5. after Zone.exit the pause doesn't open.
//   node native/web/test_restart_page.mjs (needs playwright + data; else SKIP; network for the three.js CDN). WEB_ROOT: a scratch copy (mutants)
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
for (const f of ['pause.json', 'gameover.json', 'enemies/ai.json', 'results.json', 'event/ev0100_stage.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', process.env.WEB_ROOT || here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  const load = async () => {
    for (let i = 0; ; i++) {
      try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&enemydmg=0`, { waitUntil: 'load' }); break; }
      catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
    }
    await pg.waitForFunction(() => { const P = window.__play; return P && P.stats.ticks > 30 && window.__items && P.enemyAI && P.gameHud && P.stage && P.results && P.stageInfo; }, null, { timeout: 180000 });
    await pg.evaluate(() => Promise.all([window.__play.packsReady, window.__play.stageInfo.ready, window.__play.results.ready]));
  };
  await load();
  const until = (fn, arg, t = 60000) => pg.waitForFunction(fn, arg, { timeout: t });
  const ticks = async n => { const t0 = await pg.evaluate(() => window.__play.stats.ticks); await until(t => window.__play.stats.ticks >= t, t0 + n); };
  // what the user does: Start, Restart, OK. noCount: the frame's restart isn't awaited
  const pauseRestart = async (wait = true) => {
    const n0 = await pg.evaluate(() => window.__play.restart.count);
    await pg.keyboard.press('Enter');
    await until(() => { const s = window.__play.pause.flow.screen; return s && s.cur === s.total && s.hasFocus && s.focus.id === 3; });
    await pg.keyboard.press('Space');
    await until(() => { const f = window.__play.pause.flow; return !!f.box && f.box.cur === f.box.total; });
    await pg.keyboard.press('ArrowLeft');
    await until(() => window.__play.pause.flow.box.focus.id === 6);
    if (!wait) return n0;
    await pg.keyboard.press('Space');
    await until(n => window.__play.restart.count === n + 1 && !window.__play.pause.active, n0);
  };
  const gameOverRestart = async () => {
    const n0 = await pg.evaluate(() => window.__play.restart.count);
    await pg.evaluate(() => { window.__play.php.hp = 0; });
    await until(() => { const m = window.__play.gameOver.go.menu; return m && m.focus && m.focus.id === 3; });
    await pg.waitForTimeout(300);
    await pg.keyboard.press('Space');
    await until(n => window.__play.restart.count === n + 1, n0);
  };
  const state = () => pg.evaluate(() => {
    const P = window.__play, S = P.results.stats, I = window.__items, inv = I.inventory, A = inv.A;
    return { loaded: A.loaded, inv: A.inv, sum: A.sum, count: inv.count(0x62300000), gil: inv.gil, slot0: inv.slots[0].join(), sel: inv.sel, selId: inv.selId, taken: [...I.taken].sort((a, b) => a - b).join(),
      kills: S.sect[0], shots: S.sect[1], start: S.start, end: S.end, koStart: S.koStart, total0: S.total[0], s14: S.sect[14], mark: S.mark };
  });
  // stats moved, clocks noted (all of it must not survive the Restart except the clocks)
  const spoilStats = () => pg.evaluate(() => {
    const S = window.__play.results.stats;
    S.add(0, 100); S.add(1, 100); S.start = 77; S.total[0] = 55;
    return { play: S.playSec, ko: S.ko };
  });
  const spoilItems = () => pg.evaluate(() => {
    const I = window.__items, inv = I.inventory, A = inv.A;
    A.loaded = 7; A.sum = 7; A.inv = 64; inv.gil = 999; inv.slots[0] = [0x69300000, 5]; inv.setSel(0); I.taken.add(33);
  });

  { // 1. no record: both paths
    const c0 = await spoilStats();
    await pauseRestart();
    let s = await state(); const c1 = await pg.evaluate(() => ({ play: window.__play.results.stats.playSec, ko: window.__play.results.stats.ko }));
    ok(s.kills === 0 && s.shots === 0 && s.start === 0 && s.total0 === 0, `no record, pause: stats and totals 0 (FUN_0030f3d8; T w254: kills ${s.kills}, start ${s.start}, total ${s.total0})`);
    ok(c1.play >= c0.play && c1.ko === c0.ko, `no record, pause: the clocks stay (${c0.play} -> ${c1.play} s, KOs ${c1.ko})`);
    ok(s.s14 === 1, `no record, pause: stat 14 = 1 again (T reload0: ${s.s14})`);
    await spoilStats();
    await gameOverRestart();
    const s2 = await state();
    ok(s2.kills === 0 && s2.shots === 0 && s2.start === 0 && s2.total0 === 0 && s2.s14 === 1, `no record, game over: the same (kills ${s2.kills}, start ${s2.start}, total ${s2.total0}, stat 14 ${s2.s14})`);
    ok(await pg.evaluate(() => window.__play.results.stats.ko) === c0.ko + 1, 'no record, game over: its own KO counted, not rewound');
  }
  // a Restart clears a Zone.exit that came with the request in the same frame (the box's OK, then the exit, then the frame's restart)
  { const n0 = await pauseRestart(false);
    // the exit arrives while the Restart is on its way: the pause has closed and the bodies are being attached
    await pg.evaluate(() => { const P = window.__play; const w = () => { if (P.restart.pending) P.results.onExit(181, 0, 0); else requestAnimationFrame(w); }; w(); });
    await pg.keyboard.press('Space');
    await until(n => window.__play.restart.count === n + 1 && !window.__play.pause.active, n0);
    ok(await pg.evaluate(() => window.__play.results.exit) === null, 'Restart clears a pending Zone.exit');
    const t0 = await pg.evaluate(() => window.__play.stats.ticks), z0 = await pg.evaluate(() => window.__play.ctrl.pos.z);
    await pg.keyboard.down('KeyW'); await pg.waitForTimeout(1200); await pg.keyboard.up('KeyW');
    const t = await pg.evaluate(() => ({ t: window.__play.stats.ticks, z: window.__play.ctrl.pos.z }));
    ok(t.t > t0 + 20 && Math.abs(t.z - z0) > 1, `after it the game runs and W walks him (${t.t - t0} frames, ${(t.z - z0).toFixed(2)} u)`);
  }
  await load();   // no-record Restarts put main back at its start: the save's route needs the page's own
  // 2. the record: both Potions used (slot 0 empty, no selection), 3 rounds in the magazine, 40 in all, some gil and a taken bit
  await pg.evaluate(() => { window.__play.php.hp = 300; }); await ticks(3);
  await pg.keyboard.press('KeyE'); await ticks(3);
  await pg.evaluate(() => { window.__play.php.hp = 300; }); await ticks(3);
  await pg.keyboard.press('KeyE'); await ticks(3);
  await pg.evaluate(() => {
    const P = window.__play, S = P.results.stats, I = window.__items, inv = I.inventory, A = inv.A;
    A.loaded = 3; A.sum = 3; A.inv = 40 - inv.other; inv.gil = 7; I.taken.add(22);
    S.add(0, 5); S.add(1, 6); S.start = 11; S.total[0] = 2;
    const W = P.enemyAI; W.eventFlags[0] = 2; W.eventFlags[1] = 5; W.eventFlags[2] = 7; W.eventFlags[46] = 1; W.eventFlags[63] = 6;   // T w254's route, 63: rv_matiawase's trigger
   
  });
  await until(() => { const P = window.__play; return P.stage && P.stage.rt.log.some(([, m]) => m === 'scene_save 1') && !!P.restart.record; }, null, 120000);
  const atSave = await state();
  ok(atSave.slot0 === '-1,0' && atSave.sel === -1 && atSave.loaded === 3 && atSave.count === 40 && atSave.gil === 7, `at the save: slot 0 ${atSave.slot0}, selection ${atSave.sel}, rounds ${atSave.loaded} of ${atSave.count}, gil ${atSave.gil}`);
  await until(() => window.__play.stage.battle && !window.__play.pause.active, null, 60000);
  const same = (a, b) => JSON.stringify({ ...a, mark: 0 }) === JSON.stringify({ ...b, mark: 0 });
  const spoilAll = async () => {
    const c = await spoilStats(); await spoilItems();
    await pg.evaluate(() => { window.__play.results.stats.mark = -1; window.__voiceStops = 0; const v = window.__play.voices; if (v && !v.__spied) { v.__spied = true; const f = v.stopAll.bind(v); v.stopAll = () => { window.__voiceStops++; f(); }; }
      window.__oldPlaced = window.__play.amb.placed; });
    return c;
  };
  const checkRecord = async (how, c0) => {
    const s = await state(), c1 = await pg.evaluate(() => ({ play: window.__play.results.stats.playSec, ko: window.__play.results.stats.ko }));
    ok(s.loaded === 3 && s.count === 40 && s.sum === 3, `${how}: the record's rounds: magazine ${s.loaded}, count ${s.count} (T w254: 3 / 40 after 7 / 100 at the Restart)`);
    ok(s.gil === 7 && s.slot0 === '-1,0' && s.sel === -1 && s.selId === atSave.selId, `${how}: gil ${s.gil}, slot 0 ${s.slot0}, selection ${s.sel}`);
    ok(s.taken === atSave.taken && !s.taken.split(',').includes('33'), `${how}: the taken bits ${s.taken}`);
    ok(s.kills === atSave.kills && s.shots === atSave.shots && s.start === atSave.start && s.total0 === atSave.total0, `${how}: the record's section stats (kills ${s.kills} = ${atSave.kills}, start ${s.start}, total ${s.total0}; T w254: 103 -> 3, 77 -> 11, 55 -> 0)`);
    ok(s.mark === s.s14, `${how}: the mark = the record's stat 14 (${s.mark}; FUN_003fda68)`);
    ok(c1.play >= c0.play, `${how}: the play clock not rewound (${c0.play} -> ${c1.play}; T w254)`);
    const a = await pg.evaluate(() => { const P = window.__play; return { placedNew: P.amb.placed ? P.amb.placed !== window.__oldPlaced : null, stops: window.__voiceStops, hasV: !!P.voices,
      bodies: P.enemies.actors.map(x => x.rec).filter(k => !P.enemyAI.actors.some(w => w.rec === k)), recs: P.enemyAI.actors.map(x => x.rec).sort((p, q) => p - q).join() }; });
    ok(a.placedNew !== false, `${how}: the placed sounds are new objects (FUN_00548788; ${a.placedNew})`);
    ok(!a.hasV || a.stops >= 1, `${how}: the voice channels freed (FUN_003ea5f0; stopAll x ${a.stops})`);
    ok(a.bodies.length === 0, `${how}: no body without its active actor (${a.bodies}; actors ${a.recs}; T w254: 0, 62, 63 have bodies, 41-49 / 66 none)`);
    return s;
  };
  // main's second battle(): FUN_00324e70 -> the HUD refresh
  const hudCheck = async how => {
    await until(() => { const P = window.__play; return P.stage.rt.log.filter(([, m]) => m === 'battle 0' || /^battle \d/.test(m)).length >= 1 && P.stage.battle && Math.abs(P.ctrl.pos.x + 889.2) < 1; }, null, 90000);
    await until(() => window.__play.gameHud.state.find(6, 0x1b).text.length === 0, null, 20000).catch(() => {});
    const h = await pg.evaluate(() => { const st = window.__play.gameHud.state; return { name: st.find(6, 0x1b).text.length, count: JSON.stringify(st.find(6, 0x1c).text) }; });
    ok(h.name === 0 && h.count === '[16]', `${how}: the HUD refreshed at main's battle(): no item (name ${h.name}, count ${h.count}; FUN_00339590 bit 3)`);
  };
  let viaPause;
  { const c0 = await spoilAll();
    await pauseRestart();
    viaPause = await checkRecord('record, pause', c0);
    await hudCheck('record, pause');
    const m = await pg.evaluate(() => window.__play.stage.rt.log.filter(([, s]) => /^music|^area/.test(s)).map(([, s]) => s).join());
    ok(/bgm_001/.test(m), `record, pause: main's flag-18 branch asks for its music (${m})`);
  }
  { const c0 = await spoilAll();
    await gameOverRestart();
    const viaOver = await checkRecord('record, game over', c0);
    ok(same(viaPause, viaOver), 'the two Restarts end in the same state');
    await hudCheck('record, game over');
  }
  { // 4. the level end's last half second (main: endSection, displayStageInfo(2), sleep 500, Zone.exit)
    const call = async (cls, name, desc, args) => pg.evaluate(async ([cls, name, desc, args]) => {
      const P = window.__play, vm0 = P.stage.rt.vm, { EventVM } = await import('./event_vm.js');
      const vm = new EventVM({ classes: vm0.classes }, vm0.natives), hit = vm.findMethod(cls, name, desc);
      if (hit.m.access & 0x100) { vm0.natives[hit.cls + '.' + name + desc](vm, args); return; }
      vm.start(cls, name, desc, args); vm.run(1e7);
    }, [cls, name, desc, args]);
    await call('fake/KerberosIntermission', 'endSection', '()V', []);
    await call('fake/KerberosEvent', 'displayStageInfo', '(I)V', [2]);
    const e0 = await pg.evaluate(() => { const R = window.__play.results; return { mark: R.stats.mark, total0: R.stats.total[0] }; });
    ok(e0.mark === -1, `endSection clears the mark (${e0.mark})`);
    await until(() => !!window.__play.results.box, null, 20000);
    await pauseRestart();
    const e1 = await pg.evaluate(() => { const P = window.__play, R = P.results; return { mark: R.stats.mark, s14: R.stats.sect[14], box: R.box, ended: R.ended, kind: P.stageInfo.kind, total0: R.stats.total[0], sect0: R.stats.sect[0] }; });
    ok(e1.mark === e1.s14 && e1.mark !== -1, `Restart inside the level end: the mark re-armed (${e1.mark})`);
    ok(e1.box === null && e1.ended === false && e1.kind === -1, `Restart inside the level end: no box (kind ${e1.kind}, R.box ${e1.box}, R.ended ${e1.ended})`);
    ok(e1.total0 === atSave.total0, `Restart inside the level end: the totals are the record's, not the ended section's (${e1.total0})`);
    await call('fake/KerberosIntermission', 'endSection', '()V', []);
    const e2 = await pg.evaluate(() => { const S = window.__play.results.stats; return { mark: S.mark, total0: S.total[0] }; });
    ok(e2.mark === -1 && e2.total0 === e1.total0 + e1.sect0, `the next endSection closes the section (totals ${e1.total0} + ${e1.sect0} = ${e2.total0})`);
  }
  { // 5. after Zone.exit the stage program has ended: no pause (FUN_004012c0 returned 1)
    await pg.evaluate(() => window.__play.results.onExit(181, 0, 0));
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(500);
    ok(await pg.evaluate(() => !window.__play.pause.active), 'Enter after Zone.exit: the pause does not open');
  }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await pg.close();
} finally {
  await browser.close(); srv.kill();
}
done();
