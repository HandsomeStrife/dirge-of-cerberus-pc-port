// The stage-info box on the real play.html (worker 0220), in a headless browser:
//   zone flag 2 = 7 (as Vincent's script 246, event 0x3a, sets it on the item pickup of record 22; pickups are not on the
//   page yet: the test sets it) -> the stage controller's deb_jump: peace (bit 6), free_usercontrol(1) (bit 11),
//   displayStageInfo(6, 'MES_ITEM_07') -> the box opens; the AI clock stops (FUN_00365008), Vincent takes no input
//   (FUN_00331f08); ✕ (Space) -> the box closes 1000 ms of game time later; chaos clears bit 6, the AI clock runs again.
//   node native/web/test_stage_info_page.mjs   (needs playwright, data/stage_info.json, data/event/ev0100_stage.json)
//   STAGE_INFO_SHOT=<png> saves the open box.
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
for (const f of ['data/stage_info.json', 'data/pause.json', 'data/event/ev0100_stage.json'])
  if (!fs.existsSync(path.join(here, f))) { console.log('SKIP: no ' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.stage && window.__play.stageInfo, null, { timeout: 180000 });
  await pg.evaluate(() => window.__play.stageInfo.ready);
  const until = (fn, arg, t = 60000) => pg.waitForFunction(fn, arg, { timeout: t });
  const st = () => pg.evaluate(() => {
    const P = window.__play, si = P.stageInfo, gs = P.gameState;
    return { kind: si.kind, focus: !!(si.box && si.box.screen), b6: gs.test(6), b11: gs.test(11), ai: P.enemyAI.S.now,
             ticks: P.stats.ticks, pos: [P.ctrl.pos.x, P.ctrl.pos.z], f46: P.enemyAI.eventFlags[46], g55: P.stage.globalFlags[55] };
  });
  ok(await pg.evaluate(() => window.__play.stageInfo.kind === -1 && !!window.__play.stageInfo.D), 'stage info loaded, no box at the start');
  // the record-22 pickup's flag (script 246 event 0x3a: flag 2 = 7), 46 not yet set (the w220_box trace: both 0 before)
  await pg.evaluate(() => { const f = window.__play.enemyAI.eventFlags; f[46] = 0; f[2] = 7; });
  await until(() => window.__play.stageInfo.kind === 6);
  const a = await st();
  ok(a.f46 === 1 && a.g55 === 7, `deb_jump set zone flag 46 = 1 and global flag 55 = 7 (${a.f46}, ${a.g55})`);
  ok(a.b6 === 1 && a.b11 === 1, `peace / free_usercontrol: game-state bits 6 and 11 set (${a.b6}, ${a.b11})`);
  await until(() => !!(window.__play.stageInfo.box && window.__play.stageInfo.box.screen));
  const b = await st();
  // the AI is paused: its clock does not move over 60 game frames
  await until(t0 => window.__play.stats.ticks >= t0 + 60, b.ticks);
  const c = await st();
  ok(c.ai === b.ai, `AI clock stopped while the box is open (${b.ai} -> ${c.ai} over ${c.ticks - b.ticks} frames)`);
  // no control: W + D held for 40 frames moves him nowhere
  await pg.keyboard.down('KeyW'); await pg.keyboard.down('KeyD');
  await until(t0 => window.__play.stats.ticks >= t0 + 40, c.ticks);
  await pg.keyboard.up('KeyW'); await pg.keyboard.up('KeyD');
  const d = await st();
  ok(Math.hypot(d.pos[0] - c.pos[0], d.pos[1] - c.pos[1]) < 0.01, `no movement under bit 11 (${(d.pos[0] - c.pos[0]).toFixed(3)}, ${(d.pos[1] - c.pos[1]).toFixed(3)})`);
  const prims = await pg.evaluate(() => (window.__play.stageInfo.draw() || []).length);
  ok(prims === 1007, `the box draws 1007 primitives (the GS dump's count): ${prims}`);
  // worker 0241: the box's effects on the menu managers (menu_fx.js): slot 0 the panel 0x834c0000, slot 1 the picture
  const fxs = await pg.evaluate(() => {
    const si = window.__play.stageInfo, L = si.fxLayer;
    if (!si.fx || !L) return null;
    const last = L.last || [], by = {};
    for (const s of last) { const k = s.type + (s.line ? 'L' : ''); by[k] = (by[k] || 0) + 1; }
    return { ids: si.fx.title.fx.emitters.map(e => e.id >>> 0), by, slots: [...si.fx.slots.keys()] };
  });
  ok(fxs && fxs.ids.includes(0x834c0000) && fxs.ids.includes(0x834c2000) && fxs.by['10'] === 1 && fxs.by['11'] === 7 && fxs.by['103L'] > 0,
    `the box effects run and draw: panel + picture emitters, 7 models, 1 sprite, strand lines (${JSON.stringify(fxs)})`);
  if (process.env.STAGE_INFO_SHOT) { await pg.screenshot({ path: process.env.STAGE_INFO_SHOT }); console.log('saved', process.env.STAGE_INFO_SHOT); }
  // ✕: the box closes 1000 ms (50 game frames) later; the frames counted in the page (frame() calls), not across the
  // browser round trip
  await pg.evaluate(() => {
    const si = window.__play.stageInfo, fr = si.frame.bind(si); window.__si = { n: 0, cross: -1, clear: -1 };
    si.frame = c => { const L = window.__si; L.n++; const r = fr(c); if (L.cross < 0 && si.box && si.box.step === 7) L.cross = L.n; if (L.cross >= 0 && L.clear < 0 && si.kind === -1) L.clear = L.n; return r; };
  });
  await pg.keyboard.press('Space');
  await until(() => window.__play.stageInfo.kind === -1);
  const L = await pg.evaluate(() => window.__si);
  ok(L.cross > 0 && L.clear - L.cross === 51, `✕ -> the kind clears ${L.clear - L.cross} frames later (game: ✕ frame 400, clear 451)`);
  // worker 0241: after the close the slots are empty and the soft-ended emitters fade out (FUN_002e7198 / FUN_002ea040)
  await until(() => window.__play.stageInfo.fx.title.fx.emitters.length === 0);
  ok(await pg.evaluate(() => window.__play.stageInfo.fx.slots.size === 0), 'box closed: its effects are gone (slots empty, emitters faded out)');
  await until(() => window.__play.gameState.test(6) === 0);
  const g = await st();
  await until(t0 => window.__play.stats.ticks >= t0 + 60, g.ticks);
  const h = await st();
  ok(h.ai > g.ai, `chaos: bit 6 clear, the AI clock runs again (${g.ai} -> ${h.ai})`);
  ok(h.b11 === 0, 'free_usercontrol(0): bit 11 clear');
  ok(errs.length === 0, 'no console / page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await pg.close();
  { // 2. the default load: the opening parks output.hud and puts it back at the hand-off; the box still draws after it
    const pg2 = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errs2 = [];
    pg2.on('pageerror', e => errs2.push(e.message));
    await pg2.goto(`http://127.0.0.1:${port}/play.html?enemydmg=0`, { waitUntil: 'load' });
    await pg2.waitForFunction(() => window.__play && window.__play.intro.ended > 0 && !window.__play.intro.active
      && window.__play.stageInfo && window.__play.stage, null, { timeout: 400000 });
    await pg2.evaluate(() => window.__play.stageInfo.ready);
    await pg2.evaluate(() => {
      const si = window.__play.stageInfo, d = si.draw.bind(si); window.__draws = 0;
      si.draw = () => { const p = d(); if (p && p.length) window.__draws++; return p; };
      const f = window.__play.enemyAI.eventFlags; f[46] = 0; f[2] = 7;
    });
    await pg2.waitForFunction(() => !!(window.__play.stageInfo.box && window.__play.stageInfo.box.screen), null, { timeout: 60000 });
    await pg2.waitForTimeout(1500);
    const n = await pg2.evaluate(() => window.__draws);
    ok(n > 0, `after the opening's hand-off the open box is drawn through output.hud (${n} renders)`);
    ok(errs2.length === 0, 'no page errors (opening run)' + (errs2.length ? ': ' + errs2.slice(0, 2).join(' | ') : ''));
    await pg2.close();
  }
} catch (e) { ok(false, 'exception: ' + e.message); }
finally { await browser.close(); srv.kill(); }
done();
