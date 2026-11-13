// The Phoenix Down on the real page (worker 0255; notes/items-research.md 'The revive'), headless, ?intro=0: the item in slot 0, E: count
// 1 -> 0, status bit 3, msj_024. Vincent killed (HP 0 + player.js death, as test_gameover_page): no game over; the
// world mode goes 5 -> 6 -> 2 (FUN_00334590), he lies until the death clip ends, state 0x16, HP 780 at once, state 2, status 0 for 180
// ticks without damage, W walks him again. Counts against T w255_phoenix_air (no push in state 0x16; w255_phoenix had one: 2 frames): state 0x16 50
// frames, state 2, status 0 the next frame for 150 frames. A plain death with no status still reaches the game over's request.
//   flock tools/trace/out/.browser.lock node native/web/test_phoenix_page.mjs
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
for (const f of ['data/items/items.json', 'data/enemies/ai.json', 'data/gameover.json'])
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
  const errs = [], logs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); else logs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.stats.ticks > 30 && window.__items && window.__play.enemyAI && window.__play.gameOver, null, { timeout: 180000 });
  const until = (f, arg, t = 300000) => pg.waitForFunction(f, arg, { timeout: t, polling: 100 });
  const S = () => pg.evaluate(() => {
    const P = window.__play, c = P.ctrl, go = P.gameOver.go, inv = window.__items.inventory;
    return { tick: P.stats.ticks, hp: P.php.hp, s64: P.php.s64, st: c.P.state, wm: go.wm, w4c: go.w4c, key: P.anim.head.key, n: inv.countAt(0), death: P.follow.death,
             stance: c.P.stance, count: go.count };
  });
  // a timeline of the state changes, written from inside the game loop
  await pg.evaluate(() => {
    const P = window.__play, c = P.ctrl, step = c.step, L = window.__tl = [];
    let last = '';
    c.step = function (i) {
      const r = step.call(this, i), go = P.gameOver.go;
      const k = [c.P.state, go.wm, P.php.hp, P.php.s64, !!c.P.settled].join();
      if (k !== last) { last = k; L.push({ tick: P.stats.ticks, st: c.P.state, wm: go.wm, hp: P.php.hp, s64: P.php.s64, settled: !!c.P.settled, key: P.anim.head.key }); }
      return r;
    };
  });
  await pg.evaluate(() => { const inv = window.__items.inventory; inv.slots[0] = [0x69300004, 3]; inv.setSel(0); });
  await pg.keyboard.press('KeyE');
  await until(() => window.__play.php.s64 === 8);
  const a = await S();
  ok(a.n === 2 && a.s64 === 8 && a.hp === 780, `E: the Phoenix Down at full HP: count ${a.n}, status ${a.s64}, HP ${a.hp}`);
  await pg.keyboard.press('KeyE');
  await new Promise(r => setTimeout(r, 400));
  const a2 = await S();
  ok(a2.n === 2, `E again: refused, count ${a2.n}`);
  // the kill between two frames, as FUN_0055c7f8 -> FUN_00560fc8 would (the damage path itself: test_death)
  await pg.evaluate(() => { const P = window.__play; P.php.hp = 0; P.ctrl.death([1, 0, 0], 0x20209, 0x20901f); });
  await until(() => window.__play.php.hp === 0);
  await until(() => window.__play.gameOver.go.wm === 5);
  const b = await S();
  ok(b.st === 7 && b.death && b.wm === 5 && b.w4c === 0, `dead with status 3: state ${b.st}, death camera, world mode ${b.wm}`);
  await until(() => window.__play.gameOver.go.wm === 2 && window.__play.php.hp === 780);
  const c = await S();
  const L = await pg.evaluate(() => window.__tl);
  console.log('timeline ' + JSON.stringify(L).slice(0, 900));
  ok(c.hp === 780 && c.s64 === 1 && c.st === 2 && !c.death && c.w4c === 0 && c.count === 0, `revived: HP ${c.hp}, status ${c.s64}, state ${c.st}, no death camera, no game over request, pause count ${c.count}`);
  ok(c.stance === 0, `standing again (stance ${c.stance})`);
  const t = k => L.find(k);
  const dead = t(e => e.st === 7), set = t(e => e.settled), rv = t(e => e.st === 0x16), up = t(e => e.st === 2 && e.tick > (rv ? rv.tick : 0)), st0 = t(e => e.s64 === 1);
  ok(set && dead && Math.abs((set.tick - dead.tick) - 215) <= 1, `the corpse settles ${set && dead ? set.tick - dead.tick : '?'} frames after the kill (T 215)`);
  ok(rv && set && rv.tick - set.tick === 1, `state 0x16 ${rv && set ? rv.tick - set.tick : '?'} frame after that (T 1), HP 780 with it: ${rv && rv.hp}`);
  ok(up && rv && up.tick - rv.tick === 50, `state 2 ${up && rv ? up.tick - rv.tick : '?'} frames later (class 0x3e's 60 ticks with nothing moving him: T w255_phoenix_air 50)`);
  ok(st0 && up && st0.tick - up.tick === 1, `status 0 ${st0 && up ? st0.tick - up.tick : '?'} frame after that (T 1)`);
  // damage is off for 180 ticks, then status 0 ends
  await until(() => window.__play.php.s64 === 0);
  await pg.evaluate(() => new Promise(r => { const c = window.__play.ctrl, st = c.step; c.step = function (i) { c.step = st; const v = st.call(this, i); setTimeout(r, 0); return v; }; }));
  const L2 = await pg.evaluate(() => window.__tl); const e0 = L2[L2.length - 1];
  ok(st0 && Math.abs((e0.tick - st0.tick) - 150) <= 1, `status 0 lasts ${st0 ? e0.tick - st0.tick : '?'} frames (T 150)`);
  await pg.keyboard.down('KeyW');
  const p0 = await pg.evaluate(() => [window.__play.ctrl.pos.x, window.__play.ctrl.pos.z]);
  await new Promise(r => setTimeout(r, 3000));
  const p1 = await pg.evaluate(() => [window.__play.ctrl.pos.x, window.__play.ctrl.pos.z]);
  await pg.keyboard.up('KeyW');
  ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1, `W walks him again (${Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1)} u)`);
  // the gun out at the kill: away after the revive (FUN_00576548(P, 0): T weapon state 14 at the kill and at record 1007)
  await pg.evaluate(() => window.__play.aim.press('r1'));
  await until(() => window.__play.aim.core.P.drawn && window.__play.aim.core.P.st === 0);
  await pg.evaluate(() => { const inv = window.__items.inventory; inv.setSel(0); });
  await pg.keyboard.press('KeyE');
  await until(() => window.__play.php.s64 === 8);
  await pg.evaluate(() => { const P = window.__play; P.php.hp = 0; P.ctrl.death([1, 0, 0], 0x20209, 0x20901f); });
  await until(() => window.__play.gameOver.go.wm === 2 && window.__play.php.hp === 780);
  await until(() => window.__play.php.s64 === 0);
  const g = await pg.evaluate(() => { const P = window.__play; return { drawn: P.aim.core.P.drawn, st: P.ctrl.P.state, wst: P.aim.core.P.st, hp: P.php.hp }; });
  ok(!g.drawn && g.st === 2 && g.wst === 0, `revived with the gun out before: away (drawn ${g.drawn}), state ${g.st}, weapon state ${g.wst}`);
  // no status: the normal game over
  await pg.evaluate(() => { const P = window.__play; P.php.hp = 0; P.ctrl.death([1, 0, 0], 0x20209, 0x20901f); });
  await until(() => window.__play.gameOver.go.w4c === 1);
  const d = await S();
  ok(d.w4c === 1 && d.hp === 0, `no status: the game over request (world mode ${d.wm}, HP ${d.hp})`);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
