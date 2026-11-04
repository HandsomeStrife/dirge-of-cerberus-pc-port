// Restart -> the checkpoint on the real play.html, in a headless browser (worker 0201; checkpoint.js):
//   1. a soldier changed, Vincent dead, the game over's ✕ on Restart: the same page instance goes on (no reload), HP 780,
//      Vincent at the checkpoint in state 2, a new enemy world with the save's soldiers (44 alive again) and 41-43 from
//      the stage-load pass (worker 0204: state 3 at their placements, 42 brain mode 1, 41 mode 2 eighty frames on), the
//      game over reset, and play resumes (W walks him, game frames run).
//      The drawn bodies are the start's again (record 50, activated before, gone), the world's event flags {} and its
//      frame counter from 24, the HUD rebuilt. 2. a second Restart in a row through the pause's OK. 3. H after it.
//   node native/web/test_checkpoint_page.mjs (needs playwright + data; else SKIP; network for the three.js CDN)
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
for (const f of ['pause.json', 'gameover.json', 'enemies/ai.json', 'checkpoint.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', process.env.WEB_ROOT || here], { stdio: 'ignore' });   // WEB_ROOT: a scratch copy with a mutant (worker 0242)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open() {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  await pg.evaluate(() => { window.__instance = Math.random(); });
  return { pg, errs, warns };
}
const until = (pg, fn, arg, timeout = 30000) => pg.waitForFunction(fn, arg, { timeout });
// what the restart must undo: soldier 44 shot dead and moved, Vincent walked off, record 50 activated by the AI
// (a body the start doesn't have), the old world kept for the identity check
const spoil = pg => pg.evaluate(async () => {
  const P = window.__play, W = P.enemyAI, a = W.actors.find(x => x.rec === 44);
  a.hp = 0; a.pos[0] += 40;
  P.ctrl.pos.x += 30;
  if (window.__items) window.__items.inventory.remove(0, 2);   // both Potions used: slot empty, nothing selected (worker 0255)
  const r50 = [...W.objects.values()].find(o => o.kind === 'record' && o.rec === 50);
  W.setActive(r50, 1);                               // FUN_00559748 -> onActivate: its body
  window.__oldWorld = W;
});
// the new world's first game frame, seen synchronously (play.js calls enemies.tick(enemyAI) each frame): are all the
// start bodies attached when it first ticks? (the bodies load asynchronously; the restore waits for them)
const watchFirstTick = pg => pg.evaluate(() => {
  const E = window.__play.enemies, old = window.__play.enemyAI, tick = E.tick.bind(E);
  window.__first = null;
  E.tick = W => {
    if (W && W !== old && !window.__first) window.__first = { frame: W.S.frame, bodies: E.actors.map(a => a.rec).sort((p, q) => p - q).join(), hp: window.__play.php.hp,
      state: window.__play.ctrl.P.state, pos: [window.__play.ctrl.pos.x, window.__play.ctrl.pos.y, window.__play.ctrl.pos.z],
      hud: window.__play.gameHud ? window.__play.gameHud.state.hp.slice() : null,
      l: [41, 42, 43].map(k => { const a = W.actors.find(x => x.rec === k); return a && { astate: a.astate, mode: a.ai.mode, hp: a.hp, pos: a.pos.slice(), t: a.t3c[1] }; }),
      // worker 0240: the stage init's pass (checkpoint.js initWorld): 81-86's 0x113 periods (objects 103-108) and 44 / 66
      per: W.delayed.filter(e => e.code === -2 && e.id >= 103 && e.id <= 108).map(e => [e.id - 22, e.due]), mgr20: W.S.mgr20,
      a4466: [44, 66].map(k => { const a = W.actors.find(x => x.rec === k); return a ? a.flags28 & 1 : -1; }) };
    return tick(W);
  };
});
const bodies = pg => pg.evaluate(() => window.__play.enemies.actors.map(x => x.rec).sort((p, q) => p - q).join());
const after = pg => pg.evaluate(() => {
  const P = window.__play, W = P.enemyAI, a = W && W.actors.find(x => x.rec === 44);
  return { inv: window.__items ? { sel: window.__items.inventory.sel, id0: window.__items.inventory.slots[0][0], n: window.__items.inventory.countAt(0) } : null, instance: window.__instance, count: P.restart.count, hp: P.php.hp, pos: [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z],
           state: P.ctrl.P.state, newWorld: W !== window.__oldWorld, recs: W ? W.actors.map(x => x.rec).sort((p, q) => p - q) : null,
           a44: a ? { hp: a.hp, x: a.pos[0] } : null, flags: W ? JSON.stringify(W.eventFlags) : null, frame: W ? W.S.frame : null,
           goActive: P.gameOver.go.active, goWm: P.gameOver.go.wm, hudHp: P.gameHud ? P.gameHud.state.hp[0] : null };
});
// the HUD's HP gauge right at the restore ([cur, max, from, shown, timer]: a rebuilt HUD shows 780 with no drain running)
function hudCheck(h, how) {
  ok(h === null || (h[0] === 780 && h[3] === 780 && h[4] === 0), `${how}: the HUD rebuilt: HP gauge ${JSON.stringify(h)} (780 shown, no 0 -> 780 drain)`);
}
// the opening event's hand-off (worker 0205; data/checkpoint.json, checkpoint.js handOff): Vincent's start (y on the
// ground: T record 11 -98.6444) and 41-43's places from S.frame 38 (24 + SOLDIER_RELEASE)
const CK = await import(new URL('./checkpoint.js', import.meta.url).href);
const HO = JSON.parse(fs.readFileSync(path.join(here, 'data/checkpoint.json'), 'utf8'));
const VS = CK.handOff(HO.actors.p_Vin);
const CHK = [VS.pos[0], -98.64443969726562, VS.pos[2]];
const HAND = ['e_Sol_11', 'e_Sol_12', 'e_Sol_13'].map(t => CK.handOff(HO.actors[t]).pos);
const handCheck = async (pg, how) => {
  await until(pg, () => window.__play.enemyAI.S.frame >= 40, null, 60000);
  const l = await pg.evaluate(() => [41, 42, 43].map(k => window.__play.enemyAI.actors.find(x => x.rec === k)).map(a => a && a.pos.slice()));
  const d = Math.max(...l.map((p, i) => p ? Math.max(...p.map((v, j) => Math.abs(v - HAND[i][j]))) : Infinity));
  ok(d < 1e-3, `${how}: 41-43 at the hand-off after S.frame 38 (within ${d.toFixed(5)} u)`);
};
const SAVE44 = -1038.98;
// 41-43's section-1 placements (ai.json records)
const PLACE = (j => [41, 42, 43].map(k => j.records[k].pos))(JSON.parse(fs.readFileSync(path.join(here, 'data/enemies/ai.json'), 'utf8')));
const START_PLUS = s => [...s.split(','), '41', '42', '43'].map(Number).sort((p, q) => p - q).join();
// 41's timer: brain mode 2 at the new world's frame 24 + 80 (event 1); 43 stays in mode 0 until 24 + 150
const timerCheck = async (pg, how) => {
  await until(pg, () => window.__play.enemyAI.S.frame >= 106, null, 60000);
  const m = await pg.evaluate(() => { const W = window.__play.enemyAI; return { f: W.S.frame, m: [41, 43].map(k => W.actors.find(x => x.rec === k).ai.mode) }; });
  ok(m.m[0] === 2 && (m.f >= 174 || m.m[1] === 0), `${how}: 41 in brain mode 2 after its 80-frame timer (frame ${m.f}: modes 41 / 43 = ${m.m})`);
};
function check(s, how, n, f) {
  ok(s.count === n && s.instance !== undefined, `${how}: restored in the same page instance (restart count ${s.count}, no reload)`);
  // HP at the new world's first tick (41-43 shoot from then on)
  ok(f && f.hp === 780 && f.state === 2, `${how}: HP ${f && f.hp} (780), state ${f && f.state} (2) at the first tick`);
  ok(f && f.pos[0] === CHK[0] && f.pos[2] === CHK[2] && Math.abs(f.pos[1] - CHK[1]) < 1e-3,
     `${how}: Vincent at the hand-off at the first tick ${f && f.pos.map(v => v.toFixed(4))}`);
  ok(s.newWorld && JSON.stringify(s.recs) === JSON.stringify([41, 42, 43, 44, 45, 46, 47, 48, 49, 66]), `${how}: __play.enemyAI is a new world with the save's soldiers and 41-43 (${s.recs})`);
  // 41-43 at the first tick: the stage-load pass (FUN_00558f68 -> FUN_00559748(1, 1) -> event 3; T w204_reload record 10)
  const l = f && f.l;
  ok(l && l.every(Boolean) && l.map(a => a.astate).join() === '3,3,3' && l.map(a => a.mode).join() === '0,1,0' && l.map(a => a.hp).join() === '10,28,24',
     `${how}: 41-43 active at the first tick: state ${l && l.map(a => a && a.astate)}, brain mode ${l && l.map(a => a && a.mode)}, HP ${l && l.map(a => a && a.hp)}`);
  ok(l && l.every((a, i) => a && a.pos.every((v, j) => Math.abs(v - PLACE[i][j]) < 1e-3)), `${how}: 41-43 at their placements at the first tick (their hand-off comes at S.frame 38)`);
  ok(l && l.map(a => a && a.t).join() === '79,0,149', `${how}: their script timers after the first tick ${l && l.map(a => a && a.t)} (80 / 0 / 150 set by event 3, minus one frame)`);
  // the stage init's 0x22 / 0x23 (FUN_0053ca50(mgr, 1), T w240_init): 44 / 66 active, 81-86's periods due at clock 0 + 59 /
  // 67 / 73 / 77; still those at the first tick: no later 0x23 re-armed them (main's battle() at the hand-off sends none)
  ok(f && f.a4466.join() === '1,1' && JSON.stringify(f.per) === '[[85,59],[81,67],[82,73],[83,77]]' && f.mgr20 < 59,
     `${how}: the stage init's pass: 44 / 66 active ${f && f.a4466}, 81-86's periods ${f && JSON.stringify(f.per)} at clock ${f && f.mgr20}`);
  ok(s.flags === '{}', `${how}: the new world's event flags ${s.flags} ({}: FUN_004039d0)`);
  ok(s.frame >= 24 && s.frame < 24 + 200, `${how}: its frame counter started at the placement's 24 (now ${s.frame})`);
  ok(s.a44 && s.a44.hp > 0 && Math.abs(s.a44.x - SAVE44) < 0.05, `${how}: soldier 44 back alive at its place (${JSON.stringify(s.a44)})`);
  ok(!s.goActive && s.goWm === 2, `${how}: game over reset`);
  ok(!s.inv || (s.inv.sel === 0 && s.inv.id0 === 0x69300000 && s.inv.n === 2), `${how}: both Potions back and selected (FUN_0030f3d8; slot ${s.inv && s.inv.sel}, count ${s.inv && s.inv.n})`);
  // (at the first tick: 41-43 may hit him soon after)
  ok(!f || f.hud === null || f.hud[0] === 780, `${how}: the HUD rebuilt with HP 780 (${f && f.hud && f.hud[0]})`);
}
try {
  const { pg, errs, warns } = await open();
  const start = await bodies(pg);
  ok(await pg.evaluate(() => JSON.stringify(window.__play.enemyAI.eventFlags)) === '{}', 'the page start: event flags {} (the save\'s all 0; worker 0224: 2 = 7 comes from the pickup)');
  { const lr = await pg.evaluate(() => JSON.stringify(window.__play.enemies.loadRecs));
    ok(lr === '[41,42,43]', `enemies.loadRecs ${lr} (the stage-load statuses without Vincent's record 0)`); }
  { // 1. game over -> Restart
    await spoil(pg);
    await until(pg, () => window.__play.enemies.actors.some(x => x.rec === 50));
    ok(true, 'record 50 activated: its body is drawn');
    await pg.evaluate(() => { window.__play.php.hp = 0; });
    await until(pg, () => window.__play.gameOver.go.menu && window.__play.gameOver.go.menu.focus && window.__play.gameOver.go.menu.focus.id === 3, null, 60000);
    await pg.waitForTimeout(300);
    await watchFirstTick(pg);
    await pg.keyboard.press('Space');                 // ✕ on Restart
    await until(pg, () => window.__play.restart.count === 1, null, 30000);
    await until(pg, () => !!window.__first);
    hudCheck(await pg.evaluate(() => window.__first.hud), 'game over');
    await until(pg, s => window.__play.enemies.actors.map(x => x.rec).sort((p, q) => p - q).join() === s, START_PLUS(start)).catch(() => {});
    { const f = await pg.evaluate(() => window.__first);
      check(await after(pg), 'game over', 1, f);
      ok(f && f.bodies === START_PLUS(start) && f.frame === 25, `game over: the new world's first tick (S.frame ${f && f.frame}) has every start body and 41-43 attached (${f && f.bodies})`); }
    ok(await bodies(pg) === START_PLUS(start), `game over: the drawn bodies are the start's again plus 41-43 (${await bodies(pg)})`);
    ok(warns.some(w => /restart: the stage-result Status screen/.test(w)) && !warns.some(w => /stay at their placements|checkpoint.json.*missing/.test(w))
       && !warns.some(w => /41-43.*not activated/.test(w)), 'game over: the left-out screens warn; the hand-off is on the page');
    await handCheck(pg, 'game over');
    await timerCheck(pg, 'game over');
    const x0 = await pg.evaluate(() => ({ t: window.__play.stats.ticks, z: window.__play.ctrl.pos.z }));
    await pg.keyboard.down('KeyW'); await pg.waitForTimeout(1500); await pg.keyboard.up('KeyW');
    const x1 = await pg.evaluate(() => ({ t: window.__play.stats.ticks, z: window.__play.ctrl.pos.z }));
    ok(x1.t > x0.t + 20, `game over: game frames run after the restart (${x1.t - x0.t})`);
    ok(Math.abs(x1.z - x0.z) > 3, `game over: W moves him (${(x1.z - x0.z).toFixed(2)} u along z)`);
  }
  { // 2. a second Restart in a row: pause -> Restart -> OK
    await spoil(pg);
    await until(pg, () => window.__play.enemies.actors.some(x => x.rec === 50));
    const boxOpen = () => until(pg, () => { const f = window.__play.pause.flow; return !!f.box && f.box.cur === f.box.total; });
    await pg.keyboard.press('Enter');
    await until(pg, () => { const s = window.__play.pause.flow.screen; return s && s.cur === s.total && s.hasFocus && s.focus.id === 3; });
    await pg.keyboard.press('Space'); await boxOpen();
    await pg.keyboard.press('ArrowLeft');
    await until(pg, () => window.__play.pause.flow.box.focus.id === 6);
    await watchFirstTick(pg);
    await pg.keyboard.press('Space');                 // OK
    await until(pg, () => window.__play.restart.count === 2 && !window.__play.pause.active);
    await until(pg, () => !!window.__first);
    hudCheck(await pg.evaluate(() => window.__first.hud), 'pause');
    await until(pg, s => window.__play.enemies.actors.map(x => x.rec).sort((p, q) => p - q).join() === s, START_PLUS(start)).catch(() => {});
    { const f = await pg.evaluate(() => window.__first);
      check(await after(pg), 'pause (second Restart)', 2, f);
      ok(f && f.bodies === START_PLUS(start) && f.frame === 25, `pause: the new world's first tick (S.frame ${f && f.frame}) has every start body and 41-43 attached (${f && f.bodies})`); }
    ok(await bodies(pg) === START_PLUS(start), `pause: the drawn bodies are the start's again plus 41-43 (${await bodies(pg)})`);
    await handCheck(pg, 'pause');
  }
  { // 3. H after a Restart: the page's own spawn, HP 780, play goes on
    // read on the first game frame after H (41-43 keep shooting): HP is lowered first, the first tick whose HP is no
    // longer 400 is the one after H
    await pg.evaluate(() => {
      const P = window.__play, E = P.enemies, tick = E.tick.bind(E);
      P.php.hp = 400; window.__afterH = null;
      E.tick = W => { if (!window.__afterH && P.php.hp !== 400) window.__afterH = { hp: P.php.hp, pos: [P.ctrl.pos.x, P.ctrl.pos.z], spawn: [P.ctrl.spawn.x, P.ctrl.spawn.z], state: P.ctrl.P.state }; return tick(W); };
    });
    await pg.keyboard.press('KeyH');
    await until(pg, () => !!window.__afterH);
    const h = await pg.evaluate(() => window.__afterH);
    ok(h.hp === 780 && h.state === 2 && Math.hypot(h.pos[0] - h.spawn[0], h.pos[1] - h.spawn[1]) < 0.5 && Math.abs(h.spawn[0] - (-1395.63)) < 1e-6,
       `H after a Restart: the page spawn ${h.spawn.map(v => v.toFixed(2))} (not the checkpoint), HP ${h.hp}`);
  }
  { // 4. worker 0242: a mid-level checkpoint. Stage flags 0 = 2 / 63 = 6 (script 88's start deck cleared): main's beat runs
    // rv_matiawase and scene_save(1) -> the record; then pause -> Restart -> OK reloads from it (checkpoint.js restoreRecord):
    // main from its top with the record's global flags takes its flag-18 branch (T w242: Vincent (-889.2, -0.0636, -599)
    // facing -x, HP 780, stage flags = the record's + 9 = 1, global 18 cleared), no opening, no stage-start soldiers 41-43
    await pg.evaluate(() => { const W = window.__play.enemyAI; W.eventFlags[0] = 2; W.eventFlags[63] = 6; });
    await until(pg, () => { const P = window.__play; return P.stage && P.stage.rt.log.some(([, m]) => m === 'scene_save 1') && !!P.restart.record; }, null, 90000);
    const R0 = await pg.evaluate(() => { const r = window.__play.restart.record; return { n: r.n, g18: r.gflags[18], sf: JSON.stringify(r.sflags), pair: r.pair }; });
    ok(R0.n === 1 && R0.g18 === 1 && /"0":2/.test(R0.sf), `scene_save(1) on the page: the record (n ${R0.n}, global 18 = ${R0.g18}, stage flags ${R0.sf}, chunks ${R0.pair})`);
    await until(pg, () => window.__play.stage.battle && !window.__play.pause.active, null, 60000);
    await pg.evaluate(() => { const P = window.__play; P.php.hp = 300; P.ctrl.pos.x += 20; window.__oldStage = P.stage; });
    const n0 = await pg.evaluate(() => window.__play.restart.count);
    const boxOpen = () => until(pg, () => { const f = window.__play.pause.flow; return !!f.box && f.box.cur === f.box.total; });
    await pg.keyboard.press('Enter');
    await until(pg, () => { const s = window.__play.pause.flow.screen; return s && s.cur === s.total && s.hasFocus && s.focus.id === 3; });
    await pg.keyboard.press('Space'); await boxOpen();
    await pg.keyboard.press('ArrowLeft');
    await until(pg, () => window.__play.pause.flow.box.focus.id === 6);
    await pg.keyboard.press('Space');                 // OK
    await until(pg, n => window.__play.restart.count === n + 1 && !window.__play.pause.active, n0);
    const r1 = await pg.evaluate(() => { const P = window.__play, W = P.enemyAI;
      return { hp: P.php.hp, intro: P.intro.active, newStage: P.stage !== window.__oldStage, recs: W.actors.map(a => a.rec).sort((p, q) => p - q).join(),
               g18: P.stage.globalFlags[18] }; });
    ok(r1.hp === 780 && !r1.intro && r1.newStage, `record Restart: HP ${r1.hp} (780), no opening (${r1.intro}), a new stage controller (${r1.newStage})`);
    ok(!/\b4[123]\b/.test(r1.recs), `record Restart: no stage-start stand-ins (41-43 loadPass / wakeSave): actors ${r1.recs}`);
    await until(pg, () => { const P = window.__play; return Math.abs(P.ctrl.pos.x + 889.2) < 0.01 && Math.abs(P.ctrl.pos.z + 599) < 0.01 && P.stage.battle; }, null, 60000).catch(() => {});
    const r2 = await pg.evaluate(() => { const P = window.__play, W = P.enemyAI;
      return { pos: [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z], face: [P.ctrl.C.face.x, P.ctrl.C.face.z], g18: P.stage.globalFlags[18], f9: W.eventFlags[9] | 0, f0: W.eventFlags[0] | 0,
               mat: P.stage.rt.vm.calls.includes('ev0101.rv_matiawase'), battle: P.stage.battle }; });
    ok(Math.abs(r2.pos[0] + 889.2) < 0.01 && Math.abs(r2.pos[2] + 599) < 0.01 && Math.abs(r2.pos[1] + 0.0636) < 0.05 && r2.face[0] < -0.999,
       `record Restart: main's flag-18 branch places Vincent at ${r2.pos.map(v => v.toFixed(3))} facing ${r2.face.map(v => v.toFixed(3))} (T (-889.2, -0.0636, -599) facing -x)`);
    // worker 0251: the area pass waits for this hand-back (play.js areaHold), then runs from his place: current area 87
    // (on 87 / 0 / 53 / 6), so 52-54 (area 0) come on and 41-49 (105 / 2) stay off
    await until(pg, () => window.__play.areas.cur === 87, null, 10000).catch(() => {});
    const r3 = await pg.evaluate(() => { const P = window.__play, W = P.enemyAI; return { cur: P.areas.cur, recs: W.actors.map(a => a.rec).sort((p, q) => p - q).join() }; });
    ok(r3.cur === 87 && /\b52,53,54\b/.test(r3.recs) && !/\b4[1-9]\b/.test(r3.recs), `record Restart: areas after the hand-back (current ${r3.cur}; actors ${r3.recs})`);
    ok(r2.g18 === 0 && r2.f9 === 1 && r2.f0 === 2 && !r2.mat && r2.battle, `record Restart: global 18 -> ${r2.g18}, stage flag 9 -> ${r2.f9}, flag 0 ${r2.f0}, rv_matiawase not replayed (${!r2.mat}), battle ${r2.battle}`);
  }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
  await pg.close();
} finally {
  await browser.close(); srv.kill();
}
done();
