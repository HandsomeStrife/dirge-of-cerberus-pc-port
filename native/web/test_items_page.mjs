// Item pickups and drops on the real page (worker 0224; notes/items-research.md), headless, default options (?intro=0).
// 1. Section-15 record 22's item (0x69300000, active at the save) is drawn; the test aid moves it to Vincent's feet and W
//    walks him: the sweep takes it (count 2 -> 3), script 246 event 0x3a sets zone flag 2 = 7 and the stage controller's
//    help routine opens the stage-info box (kind 6), as in the game (w224_item22).
// 2. Record 45's soldier is killed (a blast through enemy_ai, the test aid): his fixed drop (0x62300000 x 36) appears with
//    effect 0x4800 and a model; moved to Vincent's feet and walked over, the ammo reserve (aim_core, the HUD) rises by 36.
//   node native/web/test_items_page.mjs     (needs data/items + data/enemies + playwright; else SKIP, exit 0)
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['data/items/items.json', 'data/items/g038.glb', 'data/items/g039.glb', 'data/enemies/ai.json'])
  if (!existsSync(path.join(here, f))) { console.log(`SKIP: ${f} missing (tools/byo/build_web.sh)`); done(); }
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
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__itemsView && window.__play.enemyAI, null, { timeout: 180000 });
  const until = async (fn, arg, ms = 60000) => { await pg.waitForFunction(fn, arg, { timeout: ms }); };
  const s0 = await pg.evaluate(() => {
    const items = window.__items, o = items.list.find(x => x.rec === 22);
    return { active: items.list.filter(x => x.f28 & 1).map(x => x.rec), n: items.inventory.count(0x69300000), flag2: window.__play.enemyAI.eventFlags[2] ?? 0 };
  });
  ok(JSON.stringify(s0.active) === '[22,24,26,27,28,123,141]' && s0.n === 2 && s0.flag2 === 0, `start: active [${s0.active}], count ${s0.n} (2), flag 2 = ${s0.flag2} (0)`);
  await until(() => { const o = window.__items.list.find(x => x.rec === 22); const m = o && window.__itemsView.meshes.get(o); return !!m; });
  // 1. the take
  const walk = async ms => { await pg.keyboard.down('KeyW'); await new Promise(r => setTimeout(r, ms)); await pg.keyboard.up('KeyW'); };
  // worker 0246: the pickup's sound goes out (FUN_0054b158 -> FUN_0033cc90 -> FUN_003e8e18: its name is a resident sdb row,
  // found by FUN_003eb868's slot 0); log the emitter sends (audio.js SoundEmitters.update)
  await pg.keyboard.press('KeyQ');                 // a gesture: the AudioContext (play.js au.resume)
  const sfxOn = await pg.waitForFunction(() => { const P = window.__play; return !!(P.amb && P.amb.sfx && P.pauseSound.audio && P.pauseSound.audio.ctx); }, null, { timeout: 60000 }).then(() => true).catch(() => false);
  ok(sfxOn, 'sound loaded (data/audio)');
  await pg.evaluate(() => { const P = window.__play; if (P.amb.sfx) { P.amb.sfx.log = []; window.__se0 = (P.pauseSound.audio.playing || []).length; } });
  await pg.evaluate(() => { const c = window.__play.ctrl.pos, o = window.__items.list.find(x => x.rec === 22); o.pos = [c.x, c.y, c.z]; });
  await walk(1500);
  await until(() => window.__items.inventory.count(0x69300000) === 3, null, 30000).catch(() => {});
  const s1 = await pg.evaluate(() => ({ n: window.__items.inventory.count(0x69300000), flag2: window.__play.enemyAI.eventFlags[2] ?? 0,
    gone: !window.__items.list.some(x => x.rec === 22) }));
  ok(s1.n === 3 && s1.flag2 === 7 && s1.gone, `walked over record 22: count ${s1.n} (3), flag 2 = ${s1.flag2} (7), the item gone`);
  const box = await pg.waitForFunction(() => window.__play.stageInfo && window.__play.stageInfo.kind === 6, null, { timeout: 60000 }).then(() => true).catch(() => false);
  ok(box, 'the stage-info box opens (kind 6: ev0100 deb_jump on flag 2 = 7)');
  const se = await pg.evaluate(async () => { const P = window.__play, S = (await (await fetch('data/items/items.json')).json()).sounds || {};
    const names = new Set([S.placed, S.dropped, S.nonammo, S.id_6932000b, S.id_6932000c].filter(Boolean));
    return { sent: (P.amb.sfx && P.amb.sfx.log || []).filter(e => names.has(e.name)), names: [...names] }; });
  ok(se.sent.length === 1 && se.sent[0].vol > 0 && se.sent[0].id > 0, `the pickup sound is sent once: ${JSON.stringify(se.sent)} (one of ${se.names})`);
  // worker 0246: with the box up (game-state bit 11: FUN_00331f08 skips FUN_003320c0 / FUN_00333150 / FUN_003343a8, the
  // camera FUN_0032ace0 zeroes its look input) W, R1, R2 and a mouse drag do nothing
  if (box) {
    const snap = () => pg.evaluate(() => { const P = window.__play, c = P.ctrl.pos, w = P.aim && P.aim.core;
      return { b11: P.gameState.test(11), kind: P.stageInfo.kind, pos: [c.x, c.y, c.z], yaw: P.follow.yaw, pitch: P.follow.pitch,
        st: w ? w.P.st : null, drawn: w ? w.P.drawn : null, rounds: w ? w.ammo.rounds() : null, spd: P.ctrl.C.groundSpeed }; });
    const b0 = await snap();
    await pg.keyboard.down('KeyW');
    await pg.evaluate(() => { window.__play.aim.press('r1'); });
    await new Promise(r => setTimeout(r, 300));
    await pg.evaluate(() => { window.__play.aim.press('r1'); window.__play.aim.press('r2'); });
    const bb = await pg.evaluate(() => { const r = window.__play.renderer.domElement.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await pg.mouse.move(bb[0], bb[1]); await pg.mouse.down();
    await pg.mouse.move(bb[0] + 200, bb[1] + 60, { steps: 12 }); await pg.mouse.up();
    await new Promise(r => setTimeout(r, 700));
    const b1 = await snap();
    await pg.keyboard.up('KeyW');
    const moved = Math.hypot(b1.pos[0] - b0.pos[0], b1.pos[2] - b0.pos[2]);
    ok(b0.b11 === 1 && b1.b11 === 1 && b1.kind === 6, `the box is still up with bit 11 set (${b0.b11} / ${b1.b11}, kind ${b1.kind})`);
    ok(moved < 0.01 && b1.spd === 0, `W does not move him (${moved.toFixed(4)} units, speed ${b1.spd})`);
    ok(b1.yaw === b0.yaw && b1.pitch === b0.pitch, `the mouse does not turn the camera (yaw ${(b1.yaw - b0.yaw).toExponential(2)}, pitch ${(b1.pitch - b0.pitch).toExponential(2)})`);
    ok(b1.st === b0.st && b1.drawn === b0.drawn && b1.rounds === b0.rounds, `R1 / R2 do nothing (weapon state ${b0.st} -> ${b1.st}, drawn ${b0.drawn} -> ${b1.drawn}, rounds ${b0.rounds} -> ${b1.rounds})`);
  }
  // worker 0277: Start with the help box up opens nothing (deb_jump's peace -> FUN_0037dc78 -> FUN_003e0d18(1): DAT_004f3044 bit
  // 0x10000, FUN_003de130's FUN_003e0d50 test; T w277_pickup_start: Start at f300 with the box up, no pause)
  if (box) {
    await pg.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 400));
    const p = await pg.evaluate(() => ({ active: window.__play.pause.active, noPause: window.__play.stage && window.__play.stage.rt.noPause, kind: window.__play.stageInfo.kind }));
    ok(!p.active && p.noPause === true && p.kind === 6, `Start during the pickup's help box: no pause (active ${p.active}, peace bit ${p.noPause}, box kind ${p.kind})`);
    if (p.active) { await pg.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 400)); }
  }
  // close it (one cross), so the page runs on
  if (box) { await new Promise(r => setTimeout(r, 1500)); await pg.keyboard.press('Space').catch(() => {});
    await until(() => window.__play.stageInfo.kind === -1, null, 60000).catch(() => {}); }
  const closed = await pg.evaluate(() => window.__play.stageInfo.kind === -1 && window.__play.gameState.test(11) === 0);
  ok(closed, 'the box closed and control is back (bit 11 clear)');
  { const p0 = await pg.evaluate(() => { const c = window.__play.ctrl.pos; return [c.x, c.z]; });
    await walk(800);
    const p1 = await pg.evaluate(() => { const c = window.__play.ctrl.pos; return [c.x, c.z]; });
    ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1, `after the box W moves him again (${Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(2)} units)`); }
  { // worker 0277: after deb_jump's chaos (FUN_003e0d18(0)) Start opens the pause again (T w277_pickup_start f465), and closes it
    await until(() => window.__play.stage && !window.__play.stage.rt.noPause, null, 30000).catch(() => {});
    await pg.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 400));
    const on = await pg.evaluate(() => window.__play.pause.active);
    await pg.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 400));
    const off = await pg.evaluate(() => window.__play.pause.active);
    ok(on && !off, `after the box Start pauses (${on}) and Start again resumes (${!off})`); }
  // 2. kill record 45, take his drop. H first (the page's respawn: aim_core's reset makes a new Ammo; review blocker)
  await pg.keyboard.press('KeyH');
  await new Promise(r => setTimeout(r, 1000));
  const s2 = await pg.evaluate(() => {
    const ai = window.__play.enemyAI, items = window.__items;
    const a = ai.actors.find(x => x.rec === 45);
    if (!a) return { err: 'record 45 not active' };
    const spawned = [], FX = window.__fx && window.__fx.fx, sp0 = FX && FX.spawn;
    if (FX) FX.spawn = (id, p, sc) => { spawned.push(id); return sp0(id, p, sc); };
    a.hp = 1;
    ai.blast.actor(a, { owner: -1, dmg: 9999, kind: 1, flags: 8 }, a.pos.slice(), [1, 0, 0]);
    if (FX) FX.spawn = sp0;
    const d = items.list.find(x => x.ca === 45);
    return { hp: a.hp, id: d ? d.itemId : null, count: d ? d.count : null, fx: spawned, reserve: window.__play.aim.core.ammo.reserve() };
  });
  ok(!s2.err && s2.hp === 0 && s2.id === 0x62300000 && s2.count === 36 && s2.fx.includes(0x4800), `record 45 killed: drop ${s2.id && s2.id.toString(16)} x ${s2.count}, effect 0x4800 ${s2.fx && s2.fx.includes(0x4800)}${s2.err ? ' ' + s2.err : ''}`);
  await until(() => { const d = window.__items.list.find(x => x.ca === 45); return d && !!window.__itemsView.meshes.get(d); }, null, 30000).catch(() => {});
  const mesh = await pg.evaluate(() => { const d = window.__items.list.find(x => x.ca === 45); return !!(d && window.__itemsView.meshes.get(d)); });
  ok(mesh, 'the drop has a model (data/items, table index 5)');
  await pg.evaluate(() => { const c = window.__play.ctrl.pos, d = window.__items.list.find(x => x.ca === 45); d.pos = [c.x, c.y, c.z]; });
  await walk(1500);
  await until(r0 => window.__play.aim.core.ammo.reserve() === r0 + 36, s2.reserve, 30000).catch(() => {});
  const s3 = await pg.evaluate(() => ({ reserve: window.__play.aim.core.ammo.reserve(), gone: !window.__items.list.some(x => x.ca === 45), flag2: window.__play.enemyAI.eventFlags[2] ?? 0 }));
  ok(s3.reserve === s2.reserve + 36 && s3.gone && s3.flag2 === 8, `walked over the drop: reserve ${s2.reserve} -> ${s3.reserve} (+36), gone, flag 2 = ${s3.flag2} (8)`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.kill();
}
done();
