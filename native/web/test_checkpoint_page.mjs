// Restart -> the checkpoint on the real play.html, in a headless browser (worker 0201; checkpoint.js):
//   1. a soldier changed, Vincent dead, the game over's ✕ on Restart: the same page instance goes on (no reload), HP 780,
//      Vincent at the checkpoint in state 2, a new enemy world with the save's soldiers (44 alive again, 41-43 not
//      active), the game over reset, and play resumes (W walks him, game frames run).
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
for (const f of ['pause.json', 'gameover.json', 'enemies/ai.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open() {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html`, { waitUntil: 'load' }); break; }
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
    if (W && W !== old && !window.__first) window.__first = { frame: W.S.frame, bodies: E.actors.map(a => a.rec).sort((p, q) => p - q).join() };
    return tick(W);
  };
});
const bodies = pg => pg.evaluate(() => window.__play.enemies.actors.map(x => x.rec).sort((p, q) => p - q).join());
const after = pg => pg.evaluate(() => {
  const P = window.__play, W = P.enemyAI, a = W && W.actors.find(x => x.rec === 44);
  return { instance: window.__instance, count: P.restart.count, hp: P.php.hp, pos: [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z],
           state: P.ctrl.P.state, newWorld: W !== window.__oldWorld, recs: W ? W.actors.map(x => x.rec).sort((p, q) => p - q) : null,
           a44: a ? { hp: a.hp, x: a.pos[0] } : null, flags: W ? JSON.stringify(W.eventFlags) : null, frame: W ? W.S.frame : null,
           goActive: P.gameOver.go.active, goWm: P.gameOver.go.wm, hudHp: P.gameHud ? P.gameHud.state.hp[0] : null };
});
// the HUD's HP gauge right at the restore ([cur, max, from, shown, timer]: a rebuilt HUD shows 780 with no drain running)
const hudNow = pg => pg.evaluate(() => { const H = window.__play.gameHud; return H ? H.state.hp.slice() : null; });
function hudCheck(h, how) {
  ok(h === null || (h[0] === 780 && h[3] === 780 && h[4] === 0), `${how}: the HUD rebuilt: HP gauge ${JSON.stringify(h)} (780 shown, no 0 -> 780 drain)`);
}
const CHK = [-1395.151611328125, -98.64443969726562, -1111.014892578125];
const SAVE44 = -1038.98;
function check(s, how, n) {
  ok(s.count === n && s.instance !== undefined, `${how}: restored in the same page instance (restart count ${s.count}, no reload)`);
  ok(s.hp === 780 && s.state === 2, `${how}: HP ${s.hp} (780), state ${s.state} (2)`);
  ok(Math.abs(s.pos[0] - CHK[0]) < 0.5 && Math.abs(s.pos[2] - CHK[2]) < 0.5 && Math.abs(s.pos[1] - CHK[1]) < 0.05,
     `${how}: Vincent near the checkpoint ${s.pos.map(v => v.toFixed(2))} (the restore frame plus the frames since)`);
  ok(s.newWorld && JSON.stringify(s.recs) === JSON.stringify([44, 45, 46, 47, 48, 49, 66]), `${how}: __play.enemyAI is a new world with the save's soldiers (${s.recs})`);
  ok(s.flags === '{}', `${how}: the new world's event flags ${s.flags} ({}: FUN_004039d0)`);
  ok(s.frame >= 24 && s.frame < 24 + 200, `${how}: its frame counter started at the placement's 24 (now ${s.frame})`);
  ok(s.a44 && s.a44.hp > 0 && Math.abs(s.a44.x - SAVE44) < 0.05, `${how}: soldier 44 back alive at its place (${JSON.stringify(s.a44)})`);
  ok(!s.goActive && s.goWm === 2, `${how}: game over reset`);
  ok(s.hudHp === null || s.hudHp === 780, `${how}: the HUD rebuilt with HP 780 (${s.hudHp})`);
}
try {
  const { pg, errs, warns } = await open();
  const start = await bodies(pg);
  ok(await pg.evaluate(() => JSON.stringify(window.__play.enemyAI.eventFlags)) === '{"2":7,"46":1}', 'the page start: event flags {2: 7, 46: 1}');
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
    hudCheck(await hudNow(pg), 'game over');
    await until(pg, s => window.__play.enemies.actors.map(x => x.rec).sort((p, q) => p - q).join() === s, start).catch(() => {});
    check(await after(pg), 'game over', 1);
    { const f = await pg.evaluate(() => window.__first);
      ok(f && f.bodies === start && f.frame === 25, `game over: the new world's first tick (S.frame ${f && f.frame}) has every start body attached (${f && f.bodies})`); }
    ok(await bodies(pg) === start, `game over: the drawn bodies are the start's again (${await bodies(pg)})`);
    ok(warns.some(w => /restart: the stage-result Status screen/.test(w)) && warns.some(w => /41-43/.test(w)), 'game over: the left-out screens and 41-43 warn');
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
    hudCheck(await hudNow(pg), 'pause');
    await until(pg, s => window.__play.enemies.actors.map(x => x.rec).sort((p, q) => p - q).join() === s, start).catch(() => {});
    check(await after(pg), 'pause (second Restart)', 2);
    { const f = await pg.evaluate(() => window.__first);
      ok(f && f.bodies === start && f.frame === 25, `pause: the new world's first tick (S.frame ${f && f.frame}) has every start body attached (${f && f.bodies})`); }
    ok(await bodies(pg) === start, `pause: the drawn bodies are the start's again (${await bodies(pg)})`);
  }
  { // 3. H after a Restart: the page's own spawn, HP 780, play goes on
    await pg.keyboard.press('KeyH'); await pg.waitForTimeout(400);
    const h = await pg.evaluate(() => { const P = window.__play; return { hp: P.php.hp, pos: [P.ctrl.pos.x, P.ctrl.pos.z], spawn: [P.ctrl.spawn.x, P.ctrl.spawn.z], state: P.ctrl.P.state }; });
    ok(h.hp === 780 && h.state === 2 && Math.hypot(h.pos[0] - h.spawn[0], h.pos[1] - h.spawn[1]) < 0.5 && Math.abs(h.spawn[0] - (-1395.63)) < 1e-6,
       `H after a Restart: the page spawn ${h.spawn.map(v => v.toFixed(2))} (not the checkpoint), HP ${h.hp}`);
  }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
  await pg.close();
} finally {
  await browser.close(); srv.kill();
}
done();
