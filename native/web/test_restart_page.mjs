// The Restart invariant on the real play.html (worker 0254; checkpoint.js 'The Restart invariant', notes/checkpoint-research.md):
// the pause's Restart and the game over's Restart end in the same state apart from DAT_0046e248 (gil here; FUN_00321480, FUN_00320848), and
// otherwise that state depends on the record alone.
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
  const call = async (cls, name, desc, args) => pg.evaluate(async ([cls, name, desc, args]) => {
    const P = window.__play, vm0 = P.stage.rt.vm, { EventVM } = await import('./event_vm.js');
    const vm = new EventVM({ classes: vm0.classes }, vm0.natives), hit = vm.findMethod(cls, name, desc);
    if (hit.m.access & 0x100) { vm0.natives[hit.cls + '.' + name + desc](vm, args); return; }
    vm.start(cls, name, desc, args); vm.run(1e7);
  }, [cls, name, desc, args]);
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
  // main's hand-back after a record's reload: until then no input reaches him (bit 11)
  const handBack = () => until(() => { const P = window.__play; return P.stage.rt.battle && P.gameState.test(11) === 0; }, null, 180000);
  // an area's living soldiers on, their bodies attached: what a hide or a Restart has to deal with
  const bodiesOn = async () => { await handBack(); await pg.evaluate(() => { const W = window.__play.enemyAI; W.areaSwitch(105, true); W.areaSwitch(2, true); });
    await until(() => window.__play.enemies.actors.some(a => a.body)); };
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
    return { loaded: A.loaded, inv: A.inv, sum: A.sum, count: inv.count(0x62300000), gil: inv.gil, earned: inv.gilEarned, slot0: inv.slots[0].join(), sel: inv.sel, selId: inv.selId, taken: [...I.taken].sort((a, b) => a - b).join(),
      kills: S.sect[0], shots: S.sect[1], start: S.start, end: S.end, koStart: S.koStart, total0: S.total[0], s14: S.sect[14], mark: S.mark };
  });
  // stats moved, clocks noted (all of it must not survive the Restart except the clocks)
  const spoilStats = () => pg.evaluate(() => {
    const S = window.__play.results.stats;
    S.add(0, 100); S.add(1, 100); S.start = 77; S.total[0] = 55;
    return { play: S.playSec, ko: S.ko };
  });
  // +8, +0x28, +0x2c of DAT_0046e248: the page has no writer of +0x2c (the EXP exchange), so a test sets it
  const spoilGil = () => pg.evaluate(() => { const v = window.__items.inventory; v.gil = 700; v.gilBase = 999; v.gilEarned = 33; });
  // a real kill: one of Vincent's shots through FUN_0055c7f8 (hitEnemy -> enemyHP -> enemyDeath), as test_dog_page
  const killRec = rec => pg.evaluate(k => { const W = window.__play.enemyAI, a = W.actors.find(x => x.rec === k);
    if (!a) return { none: W.actors.map(x => x.rec).join() };
    W.t.hitEnemy(a, { damage: 9999, kind: 0, dir: [0, 0, -1], shooter: W.player.id, f148: 0, hit: 0, f120: 0x800 }, a.pos.slice());
    return { hp: a.hp, bit: W.deadBits.has(k) }; }, rec);
  const deadState = recs => pg.evaluate(rs => { const P = window.__play, W = P.enemyAI;
    return rs.map(k => ({ k, hp: W.objects.get(k + 22).hp, active: W.actors.some(a => a.rec === k), body: P.enemies.actors.some(a => a.rec === k), bit: W.deadBits.has(k) })); }, recs);
  const spoilItems = () => pg.evaluate(() => {
    const I = window.__items, inv = I.inventory, A = inv.A;
    A.loaded = 7; A.sum = 7; A.inv = 64; inv.gil = 999; inv.slots[0] = [0x69300000, 5]; inv.setSel(0); I.taken.add(33);
  });

  { // 1. no record: both paths
    const c0 = await spoilStats(); await spoilGil();
    await pauseRestart();
    let s = await state(); const c1 = await pg.evaluate(() => ({ play: window.__play.results.stats.playSec, ko: window.__play.results.stats.ko }));
    ok(s.kills === 0 && s.shots === 0 && s.start === 0 && s.total0 === 0, `no record, pause: stats and totals 0 (FUN_0030f3d8; T w254: kills ${s.kills}, start ${s.start}, total ${s.total0})`);
    ok(c1.play >= c0.play && c1.ko === c0.ko, `no record, pause: the clocks stay (${c0.play} -> ${c1.play} s, KOs ${c1.ko})`);
    ok(s.s14 === 1, `no record, pause: stat 14 = 1 again (T reload0: ${s.s14})`);
    ok(s.gil === 0 && s.earned === 0, `no record, pause: gil 0, +0x2c 0 (FUN_00247508:333 clears bit 0xd, FUN_00320848 zeroes; gil ${s.gil}, +0x2c ${s.earned})`);
    await spoilStats(); await spoilGil();
    await gameOverRestart();
    const s2 = await state();
    ok(s2.gil === 33 && s2.earned === 33, `no record, game over: gil = +0x2c (FUN_00320848 with bit 0xd; gil ${s2.gil}, +0x2c ${s2.earned})`);
    await pg.evaluate(() => { window.__items.inventory.gilEarned = 0; });
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
  // killed in play, before main's event (peace: FUN_0055c7f8 deals nothing while FUN_00325b40 is set)
  const killed1 = await killRec(45);
  ok(killed1.hp === 0 && killed1.bit, `a soldier killed through the damage path: 45 HP ${killed1.hp}, dead bit ${killed1.bit} (FUN_0055cac8 -> FUN_0031e060; actors ${killed1.none || ''})`);
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
  const recDead = await pg.evaluate(() => window.__play.restart.record.dead.slice().sort((a, b) => a - b).join());
  ok(/(^|,)41,42,43(,|$)/.test(recDead) && recDead.split(',').includes('45'), `the record's dead words: ${recDead} (T w254's record: 41, 42, 43, 111, 113, 114)`);
  const atSave = await state();
  ok(atSave.slot0 === '-1,0' && atSave.sel === -1 && atSave.loaded === 3 && atSave.count === 40 && atSave.gil === 7, `at the save: slot 0 ${atSave.slot0}, selection ${atSave.sel}, rounds ${atSave.loaded} of ${atSave.count}, gil ${atSave.gil}`);
  await until(() => window.__play.stage.battle && !window.__play.pause.active, null, 60000);
  const same = (a, b) => JSON.stringify({ ...a, mark: 0, gil: 0, earned: 0 }) === JSON.stringify({ ...b, mark: 0, gil: 0, earned: 0 });   // gil is the one field the kind decides (FUN_00321480)
  const spoilAll = async () => {
    const c = await spoilStats(); await spoilItems();
    await pg.evaluate(() => { const P = window.__play; window.__items.inventory.gilEarned = 33; P.php.hp = 300;
      const W = P.enemyAI; W.eventFlags[33] = 9;   // a stage flag set after the record: it must go
      // every frame until the hand-back: who the world activates (T w242 / w254: 44-49 not active after the record reload)
      window.__woke = new Set(); const t0 = P.restart.count, w = () => { const A = P.enemyAI; if (P.restart.count > t0) for (const a of A.actors) window.__woke.add(a.rec); if (P.restart.count === t0 || !P.ctrl || Math.abs(P.ctrl.pos.x + 889.2) > 1) requestAnimationFrame(w); }; w(); });
    await pg.evaluate(() => { window.__play.results.stats.mark = -1; window.__voiceStops = 0; const v = window.__play.voices; if (v && !v.__spied) { v.__spied = true; const f = v.stopAll.bind(v); v.stopAll = () => { window.__voiceStops++; f(); }; }
      window.__oldPlaced = window.__play.amb.placed; });
    return c;
  };
  const checkRecord = async (how, c0, gilWant, rd = atSave, wantFlags = true) => {
    const s = await state(), c1 = await pg.evaluate(() => ({ play: window.__play.results.stats.playSec, ko: window.__play.results.stats.ko }));
    ok(s.loaded === 3 && s.count === 40 && s.sum === 3, `${how}: the record's rounds: magazine ${s.loaded}, count ${s.count} (T w254: 3 / 40 after 7 / 100 at the Restart)`);
    ok(s.gil === gilWant, `${how}: gil ${s.gil} (want ${gilWant}: FUN_00321480, +0x2c ${s.earned})`);
    ok(s.slot0 === '-1,0' && s.sel === -1 && s.selId === atSave.selId, `${how}: slot 0 ${s.slot0}, selection ${s.sel}`);
    await until(() => (window.__play.enemyAI.eventFlags[9] | 0) === 1, null, 20000).catch(() => {});
    const hf = await pg.evaluate(() => { const P = window.__play, W = P.enemyAI, R = P.restart.record; return { hp: P.php.hp, g18: P.stage.globalFlags[18], f0: W.eventFlags[0], f33: W.eventFlags[33] | 0, f9: W.eventFlags[9] | 0, rec: { ...R.sflags }, stageFlags: Object.fromEntries(Object.entries(R.sflags).map(([k]) => [k, W.eventFlags[k]])) }; });
    ok(hf.hp === 780, `${how}: HP ${hf.hp} (T w242: 780, FUN_00319798's scratch is dropped)`);
    ok(hf.g18 === 0, `${how}: global 18 cleared (${hf.g18}; T w242)`);
    // T w254's route flags. 63 is the tests' stand-in for the trigger, and scripts move it after the reload: left out
    ok(hf.f33 === 0 && [0, 1, 2, 46].every(k => hf.rec[k] === hf.stageFlags[k]) && hf.f9 === 1, `${how}: stage flags = the record's + 9 = 1 (record ${JSON.stringify(hf.rec)}, now ${JSON.stringify(hf.stageFlags)}, 9 = ${hf.f9}, flag set after the save ${hf.f33})`);
    ok(s.taken === rd.taken && !s.taken.split(',').includes('33'), `${how}: the taken bits ${s.taken}`);
    ok(s.kills === rd.kills && s.shots === rd.shots && s.start === rd.start && s.total0 === rd.total0, `${how}: the record's section stats (kills ${s.kills} = ${rd.kills}, start ${s.start}, total ${s.total0}; T w254: 103 -> 3, 77 -> 11, 55 -> 0)`);
    ok(s.mark === s.s14, `${how}: the mark = the record's stat 14 (${s.mark}; FUN_003fda68)`);
    ok(c1.play >= c0.play, `${how}: the play clock not rewound (${c0.play} -> ${c1.play}; T w254)`);
    const a = await pg.evaluate(() => { const P = window.__play; return { placedNew: P.amb.placed ? P.amb.placed !== window.__oldPlaced : null, stops: window.__voiceStops, hasV: !!P.voices,
      bodies: P.enemies.actors.map(x => x.rec).filter(k => !P.enemyAI.actors.some(w => w.rec === k)), recs: P.enemyAI.actors.map(x => x.rec).sort((p, q) => p - q).join() }; });
    ok(a.placedNew !== false, `${how}: the placed sounds are new objects (FUN_00548788; ${a.placedNew})`);
    ok(!a.hasV || a.stops >= 1, `${how}: the voice channels freed (FUN_003ea5f0; stopAll x ${a.stops})`);
    ok(a.bodies.length === 0, `${how}: no body without its active actor (${a.bodies}; actors ${a.recs}; T w254: 0, 62, 63 have bodies, 41-49 / 66 none)`);
    const ds = await deadState([41, 45]);
    ok(ds.every(d => d.hp === 0 && !d.active && !d.body && d.bit), `${how}: killed stays dead: ${JSON.stringify(ds)} (FUN_0031d4d8, FUN_00547ce0 -> FUN_00317420(st, 0))`);
    await until(() => Math.abs(window.__play.ctrl.pos.x + 889.2) < 1, null, 60000).catch(() => {});
    const woke = await pg.evaluate(() => [...window.__woke].filter(k => k >= 41 && k <= 49).join());
    ok(woke === '', `${how}: 41-49 not woken before the hand-back (${woke}; areaHold, T w242)`);
    return s;
  };
  // main's second battle(): FUN_00324e70 -> the HUD refresh
  const hudCheck = async how => {
    await until(() => { const P = window.__play; return P.stage.rt.log.filter(([, m]) => m === 'battle 0' || /^battle \d/.test(m)).length >= 1 && P.stage.battle && Math.abs(P.ctrl.pos.x + 889.2) < 1; }, null, 90000);
    await until(() => window.__play.gameHud.state.find(6, 0x1b).text.length === 0, null, 20000).catch(() => {});
    const h = await pg.evaluate(() => { const st = window.__play.gameHud.state; return { name: st.find(6, 0x1b).text.length, count: JSON.stringify(st.find(6, 0x1c).text) }; });
    const nb = await pg.evaluate(() => { const P = window.__play; return P.enemyAI.actors.filter(w => w.rec < 200 && !P.enemies.actors.some(a => a.rec === w.rec)).map(w => w.rec); });
    ok(nb.length === 0, `${how}: every active actor has its body again (missing: ${nb})`);
    ok(h.name === 0 && h.count === '[16]', `${how}: the HUD refreshed at main's battle(): no item (name ${h.name}, count ${h.count}; FUN_00339590 bit 3)`);
  };
  let viaPause;
  { const c0 = await spoilAll();
    await pauseRestart();
    viaPause = await checkRecord('record, pause', c0, 7);
    await hudCheck('record, pause');
    const m = await pg.evaluate(() => window.__play.stage.rt.log.filter(([, s]) => /^music|^area/.test(s)).map(([, s]) => s).join());
    ok(/bgm_001/.test(m), `record, pause: main's flag-18 branch asks for its music (${m})`);
  }
  { const c0 = await spoilAll();
    await gameOverRestart();
    const viaOver = await checkRecord('record, game over', c0, 7 + 33);
    ok(viaOver.earned === 33 && viaPause.earned === 0, `+0x2c: kept by the game over (${viaOver.earned}), the record's by the pause (${viaPause.earned})`);
    ok(same(viaPause, viaOver), 'apart from gil the two Restarts end in the same state');
    await hudCheck('record, game over');
  }
  { // the area that holds them switched on: the dead stay off (FUN_00559748 refuses), reviewer's case
    await pg.evaluate(() => { const W = window.__play.enemyAI; W.areaSwitch(105, true); W.areaSwitch(2, true); });
    await ticks(3);
    const ds = await deadState([41, 45, 47]);
    ok(ds[0].hp === 0 && !ds[0].active && ds[1].hp === 0 && !ds[1].active, `the area on: 41 and 45 stay off (${JSON.stringify(ds.slice(0, 2))})`);
    ok(ds[2].hp > 0 && ds[2].active, `the area on: living 47 comes on, so the switch did run (${JSON.stringify(ds[2])})`);
  }
  { // a second checkpoint: the later record replaces the first (main calls scene_save(2) at pc 5136; here the native, the same call)
    const killed2 = await killRec(46);
    ok(killed2.hp === 0, `46 killed before the second save (${killed2.hp}; ${killed2.none || ''})`);
    await pg.evaluate(() => { const I = window.__items, inv = I.inventory, A = inv.A; A.loaded = 5; A.sum = 5; A.inv = 50 - inv.other; inv.gil = 21; inv.gilEarned = 4; I.taken.add(23); });
    await call('fake/KerberosZone', 'scene_save', '(I)V', [2]);
    const r2 = await pg.evaluate(() => { const R = window.__play.restart.record, v = window.__items.inventory; return { n: R.n, dead: R.dead.includes(46), base: v.gilBase, earned: v.gilEarned }; });
    ok(r2.n === 2 && r2.dead && r2.base === 21 && r2.earned === 0, `scene_save(2): record ${r2.n}, 46 in it ${r2.dead}, +0x28 = gil ${r2.base}, +0x2c = 0 (${r2.earned}; FUN_00321480's write)`);
    const at2 = await state();
    await spoilStats(); await spoilItems();
    await pauseRestart();
    const s = await state(), ds = await deadState([41, 45, 46]);
    ok(s.loaded === 5 && s.count === 50 && s.gil === 21 && s.taken === at2.taken && s.kills === at2.kills, `second record, pause: its rounds ${s.loaded} / ${s.count}, gil ${s.gil}, taken ${s.taken}, kills ${s.kills} (${at2.kills}), not the first record's`);
    ok(ds.every(d => d.hp === 0 && !d.active && !d.body), `second record: the dead of both saves stay dead (${JSON.stringify(ds)})`);
    ok(await pg.evaluate(() => window.__play.php.hp === 780 && window.__play.restart.record.n === 2), 'second record: HP 780, record 2 still the one');
    // main's setVisibleAll hid everything: the reload's objects are visible (play.js allVisible)
    await bodiesOn();
    await call('fake/KerberosActor', 'setVisibleAll', '(IZ)V', [0, 0]);
    const hid = await pg.evaluate(() => { const A = window.__play.enemies.actors.filter(a => a.body); return { v: window.__play.vin.eventHidden, i: window.__itemsView.hideAll, b: A.length, shown: A.filter(a => a.body.visible).length }; });
    ok(hid.v === true && hid.i === true && hid.b > 0 && hid.shown === 0, `setVisibleAll(0, false) hides Vincent, the items and the ${hid.b} enemy bodies`);
    await pauseRestart();
    const vis = await pg.evaluate(() => ({ v: window.__play.vin.eventHidden, i: window.__itemsView.hideAll }));
    ok(vis.v === false && vis.i === false, `Restart: Vincent and the items visible again (eventHidden ${vis.v}, hideAll ${vis.i})`);
    await bodiesOn();
    const bv = await pg.evaluate(() => { const A = window.__play.enemies.actors.filter(a => a.body); return { n: A.length, hidden: A.filter(a => !a.body.visible).length }; });
    ok(bv.n > 0 && bv.hidden === 0, `record Restart: the rebuilt enemy bodies are visible (swapBodies removes the old; ${bv.n} bodies, ${bv.hidden} hidden)`);
  }
  { // a Phoenix Down armed, then Restart: the status goes with the reload, and the slot is the record's
    await handBack();
    await pg.evaluate(() => { const inv = window.__items.inventory; inv.slots[0] = [0x69300004, 3]; inv.setSel(0); });
    await pg.keyboard.press('KeyE');
    await until(() => window.__play.php.s64 === 8);
    await pauseRestart();
    const a = await pg.evaluate(() => { const P = window.__play, v = window.__items.inventory; return { s64: P.php.s64, hp: P.php.hp, slot0: v.slots[0].join() }; });
    ok(a.s64 === 0 && a.hp === 780 && a.slot0 === '-1,0', `Phoenix Down armed, pause Restart: status ${a.s64}, HP ${a.hp}, slot 0 the record's (${a.slot0})`);
    await pg.evaluate(() => { const P = window.__play; P.php.hp = 0; P.ctrl.death([1, 0, 0], 0x20209, 0x20901f); });
    await until(() => window.__play.gameOver.go.w4c === 1, null, 30000).catch(() => {});
    ok(await pg.evaluate(() => window.__play.gameOver.go.w4c === 1 && window.__play.php.hp === 0), 'then a death is the game over, no revive');
    await until(() => { const m = window.__play.gameOver.go.menu; return m && m.focus && m.focus.id === 3; });
    await pg.waitForTimeout(300);
    const n0 = await pg.evaluate(() => window.__play.restart.count);
    await pg.keyboard.press('Space');
    await until(n => window.__play.restart.count === n + 1, n0);
    ok(await pg.evaluate(() => window.__play.php.hp === 780 && window.__play.php.s64 === 0 && !window.__play.gameOver.go.active), 'and its Restart: HP 780, status 0, no game over');
    // used up: fired by the kill, the revive's status 1 running, then Restart
    await pg.evaluate(() => { const inv = window.__items.inventory; inv.slots[0] = [0x69300004, 3]; inv.setSel(0); });
    await pg.keyboard.press('KeyE');
    await until(() => window.__play.php.s64 === 8);
    await pg.evaluate(() => { const P = window.__play; P.php.hp = 0; P.ctrl.death([1, 0, 0], 0x20209, 0x20901f); });
    await until(() => window.__play.gameOver.go.wm === 2 && window.__play.php.hp === 780 && window.__play.php.s64 === 1, null, 60000);
    await pauseRestart();
    const b = await pg.evaluate(() => { const P = window.__play; return { s64: P.php.s64, hp: P.php.hp, st: P.ctrl.P.state, slot0: window.__items.inventory.slots[0].join() }; });
    ok(b.s64 === 0 && b.hp === 780 && b.slot0 === '-1,0', `Phoenix Down revived him, pause Restart: status ${b.s64}, HP ${b.hp}, state ${b.st}, slot 0 ${b.slot0}`);
  }
  { // 4. the level end's last half second (main: endSection, displayStageInfo(2), sleep 500, Zone.exit)
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
  // the HUD's panel 0 group (hud_core slidePanel): 3, 4 = going / gone out; W held for 60 ticks, what the user does
  const hudSlide = () => pg.evaluate(() => { const st = window.__play.gameHud.state, t = st.slides[0]; return st.chain[t.slot === 'root' ? 0 : st.groupOf[t.slot]].slide[0]; });
  const holdW = async () => { const at = () => pg.evaluate(() => { const p = window.__play.ctrl.pos; return [p.x, p.y, p.z, window.__play.stats.ticks]; }); const a = await at();
    await pg.keyboard.down('KeyW'); await ticks(60); await pg.keyboard.up('KeyW'); const b = await at(); return { d: Math.hypot(b[0] - a[0], b[2] - a[2]), ticks: b[3] - a[3] }; };
  const handedBack = async (name) => { await ticks(30);
    ok(await pg.evaluate(() => window.__play.gameState.test(11) === 0 && window.__play.gameState.test(6) === 0), `${name}: after the hand-back bits 11 and 6 are clear`);
    const s = await hudSlide(); ok(s < 3, `${name}: the HUD is back (FUN_003b01b0(1); slide state ${s})`);
    const w = await holdW(); ok(w.d > 1, `${name}: W walks him again (${w.d.toFixed(2)} u)`); };
  { // 7. record 3's reload (T w254 r07_beat): flag 9 = 9 takes main past Zone.event, and it is event mode anyway, from the teardown until battle2(3000):
    // area asj_035, Zone 1 0, bgm_278, sk_mituketa2, Zone 6 7, battle2; no FUN_0037e048; Vincent ends at (-1762, 0, 1578)
    await load();
    // one synchronous step: main must not run on these flags before the reload (it would clear 18 and save again)
    await pg.evaluate(() => { const P = window.__play, W = P.enemyAI, G = P.stage.globalFlags, g0 = G.slice(), f0 = { ...W.eventFlags }, F = W.eventFlags;
      for (const k of Object.keys(F)) delete F[k];
      for (const [k, v] of [[0, 18], [1, 8], [2, 1], [9, 9], [15, 1], [16, 1], [26, 1], [42, 1], [43, 1], [44, 1], [45, 1], [46, 1], [47, 1], [50, 1], [63, 1]]) F[k] = v;
      G.fill(0); for (const [k, v] of [[0, 1], [1, 18], [18, 1], [30, 1], [55, 1], [56, 7], [58, 2]]) G[k] = v;
      const vm = P.stage.rt.vm; vm.natives['fake/KerberosZone.scene_save(I)V'](vm, [3]);
      for (const k of Object.keys(F)) delete F[k]; Object.assign(F, f0); G.set(g0); });
    ok(await pg.evaluate(() => window.__play.restart.record.n === 3), 'record 3 taken with T\'s flags');
    await pauseRestart();
    const m0 = await pg.evaluate(() => { const P = window.__play; return { battle: P.stage.rt.battle, skip: P.stage.rt.skippable(), ai: P.gameState.test(6), input: P.gameState.test(11) }; });
    ok(m0.battle === false, `record 3: event mode from the reload's first frame (battle ${m0.battle}; T: bit 37 clear from f328)`);
    ok(m0.ai === 1 && m0.input === 1, `record 3: from the first frame the AI waits and no input reaches him (bit 6 ${m0.ai}, bit 11 ${m0.input}; T r1600: no stage object)`);
    await until(() => window.__play.stage.rt.vm.calls.includes('ev0101.sk_mituketa2'), null, 60000);
    await ticks(120);
    const mid = await pg.evaluate(() => { const P = window.__play, r = P.stage.rt; return { battle: r.battle, skip: r.skippable(), view: !!(r.view), vin: P.vin.body.visible, pauseBlocked: !P.pause.active, log: r.log.map(([, m]) => m), t0: P.enemyAI.S.now }; });
    ok(mid.battle === false && mid.skip === true, `record 3, in sk_mituketa2: still event mode, Skip offered (battle ${mid.battle}, skippable ${mid.skip})`);
    ok(mid.view, 'record 3, in sk_mituketa2: the event camera, not the follow camera');
    ok(!mid.log.some(m => /^event /.test(m)), `record 3: no Zone.event on the way, as T (${mid.log.filter(m => /^event /.test(m))})`);
    const order = ['area asj_035', 'zone 128,1,0', 'bgm_278'];
    const at = order.map(o => mid.log.findIndex(m => m.includes(o)));
    ok(at.every(i => i >= 0) && at[0] < at[1] && at[1] < at[2], `record 3: T's order: ${order} (${at}; ${mid.log.filter(m => /^(area|zone|music)/.test(m)).join(' | ')})`);
    console.log('record 3 mid: vin visible', mid.vin, 'log', mid.log.slice(0, 18).join(' | ').slice(0, 500));
    await pg.screenshot({ path: process.env.W254_SHOT || '/dev/null' }).catch(() => {});
    ok(await hudSlide() >= 3, `record 3, in the event: no HUD, the panels are out (slide state ${await hudSlide()}; T r1600)`);
    const held = await holdW();
    ok(held.d < 0.01, `record 3: W held through the event does not move him (${held.d.toFixed(2)} u over ${held.ticks} ticks; bit 11)`);
    const t1 = await pg.evaluate(() => window.__play.enemyAI.S.now); await ticks(30);
    ok(await pg.evaluate(t => window.__play.enemyAI.S.now === t, t1), `record 3: the world waits in the event (manager clock ${t1})`);
    await until(() => window.__play.stage.rt.battle === true, null, 180000).catch(() => {});
    const end = await pg.evaluate(() => { const P = window.__play, r = P.stage.rt, p = P.ctrl.pos; return { battle: r.battle, x: p.x, y: p.y, z: p.z, log: r.log.map(([, m]) => m).filter(m => /^(zone|battle)/.test(m)), pair: P.light && P.light.stream.pair }; });
    ok(end.battle && Math.hypot(end.x + 1762.5, end.z - 1577.7) < 2, `record 3: battle with Vincent at (${end.x.toFixed(1)}, ${end.y.toFixed(1)}, ${end.z.toFixed(1)}) (T r07_walk: -1762.5, 0, 1577.7)`);
    ok(end.log.some(m => m.includes('zone 128,6,7') || m.includes('zone 6,7')), `record 3: Zone 6 7 before the battle (${end.log.join(' | ').slice(0, 200)})`);
    await handedBack('record 3');
  }
  { // 8. record 2's reload, not stranded: main pc 5005 (flag 0 == 13, global 1 < 13, global 18 == 1) -> 5154 heri_toujou -> 5246 usercontrol 1 -> 5266 battle. The flags are the branch's, not a walked state
    await load();
    await pg.evaluate(() => { const P = window.__play, W = P.enemyAI, G = P.stage.globalFlags, g0 = G.slice(), f0 = { ...W.eventFlags }, F = W.eventFlags;
      for (const k of Object.keys(F)) delete F[k];
      for (const [k, v] of [[0, 13], [2, 1], [46, 1], [63, 1]]) F[k] = v;
      G.fill(0); for (const [k, v] of [[0, 1], [1, 12], [18, 1]]) G[k] = v;
      const vm = P.stage.rt.vm; vm.natives['fake/KerberosZone.scene_save(I)V'](vm, [2]);
      for (const k of Object.keys(F)) delete F[k]; Object.assign(F, f0); G.set(g0); });
    await pauseRestart();
    ok(await pg.evaluate(() => window.__play.gameState.test(11) === 1 && !window.__play.stage.rt.battle), 'record 2: the reload starts with no input, in event mode');
    await until(() => window.__play.stage.rt.battle === true, null, 180000).catch(() => {});
    const e2 = await pg.evaluate(() => { const r = window.__play.stage.rt, L = r.log.map(([, m]) => m); return { battle: r.battle, calls: r.vm.calls.includes('ev0103.heri_toujou'), uc: L.indexOf('usercontrol 1') }; });
    ok(e2.battle && e2.calls && e2.uc >= 0, `record 2: main takes pc 5154 to usercontrol 1 and battle (battle ${e2.battle}, heri_toujou ${e2.calls}, usercontrol at log ${e2.uc})`);
    await handedBack('record 2');
  }
  { // 6. with the opening on: the hand-off, the sounds it leaves, a key, a record Restart (no opening), a no-record Restart (the opening again)
    for (let i = 0; ; i++) {
      try { await pg.goto(`http://127.0.0.1:${port}/play.html?enemydmg=0`, { waitUntil: 'load' }); break; }
      catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
    }
    await pg.waitForFunction(() => { const P = window.__play; return P && P.intro && P.intro.active && P.sound && P.sound() && window.__items; }, null, { timeout: 180000 });
    const skip = async () => {
      await until(() => window.__play.intro.active && window.__play.intro.rt.frameNo > 60, null, 120000);
      await pg.keyboard.press('Enter');
      await until(() => window.__play.intro.paused);
      await pg.waitForTimeout(200);
      await pg.keyboard.press('Space');
      await until(() => !window.__play.intro.active, null, 180000);
      await until(() => window.__play.stats.ticks > 5 && !window.__play.restart.pending, null, 60000);
    };
    ok(await pg.evaluate(() => window.__play.sound().event === true), 'the opening: the load-time start is off');
    await skip();
    const h = await pg.evaluate(() => window.__play.sound());
    ok(h.event === false && h.on === false, `after the hand-off the opening's gate is closed (event ${h.event}, on ${h.on})`);
    await pg.evaluate(() => { const s = window.__play.soundStop; s(); });
    await pg.keyboard.press('KeyK');
    await pg.waitForTimeout(600);
    const k = await pg.evaluate(() => window.__play.sound());
    ok(k.music === null && k.area === null, `stopped sounds, then a key: nothing restarts (music ${k.music}, area ${k.area}; was bgm_001 / asj_036)`);
    // the no-record Restart replays the opening, silent until its own sounds
    await pauseRestart(true);
    const r = await pg.evaluate(() => ({ active: window.__play.intro.active, s: window.__play.sound() }));
    ok(r.active && r.s.on && r.s.event, `no record: the opening again, the gate open (active ${r.active}, on ${r.s.on}, event ${r.s.event})`);
    await skip();
    // a record: no opening, the gate stays closed, main's own sounds
    await pg.evaluate(() => { const W = window.__play.enemyAI; W.eventFlags[0] = 2; W.eventFlags[1] = 5; W.eventFlags[2] = 7; W.eventFlags[46] = 1; W.eventFlags[63] = 6; });
    await until(() => { const P = window.__play; return P.stage && P.stage.rt.log.some(([, m]) => m === 'scene_save 1') && !!P.restart.record; }, null, 180000);
    await until(() => window.__play.stage.battle && !window.__play.pause.active, null, 60000);
    await pauseRestart(); await until(() => (window.__play.enemyAI.eventFlags[9] | 0) === 1, null, 20000).catch(() => {});
    const q = await pg.evaluate(() => ({ active: window.__play.intro.active, s: window.__play.sound(), hp: window.__play.php.hp, g18: window.__play.stage.globalFlags[18], f9: window.__play.enemyAI.eventFlags[9] | 0 }));
    ok(!q.active && q.s.on === false && q.s.event === false, `record, opening on: no opening, no stale gate (active ${q.active}, on ${q.s.on}, event ${q.s.event})`);
    ok(q.hp === 780 && q.g18 === 0 && q.f9 === 1, `record, opening on: HP ${q.hp}, global 18 ${q.g18}, stage 9 ${q.f9}`);
    await until(() => window.__play.sound().music === 'bgm_001', null, 30000).catch(() => {});
    ok(await pg.evaluate(() => window.__play.sound().music === 'bgm_001'), 'record, opening on: main starts its music (' + JSON.stringify(await pg.evaluate(() => window.__play.sound())) + ')');
  }
  await pg.close();
} finally {
  await browser.close(); srv.kill();
}
done();
