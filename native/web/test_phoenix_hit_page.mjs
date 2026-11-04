// The Phoenix Down against real hits on the real page (worker 0255), headless, ?intro=0 with damage on: a soldier's real bullet (enemy_ai spawnShot, flown by the
// world's own tick into Vincent at HP 1) kills him standing and in a jump; a barrel's blast path (world.blast.player) kills him with flags 8; R1 and Space on the corpse do
// nothing; each time he revives with no game over; under status 0 after the revive a real bullet takes nothing.
//   flock tools/trace/out/.browser.lock node native/web/test_phoenix_hit_page.mjs
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
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.stats.ticks > 30 && window.__items && window.__play.enemyAI && window.__play.gameOver, null, { timeout: 180000 });
  const until = (f, arg, t = 400000) => pg.waitForFunction(f, arg, { timeout: t, polling: 100 });
  const S = () => pg.evaluate(() => { const P = window.__play, c = P.ctrl, go = P.gameOver.go; return { hp: P.php.hp, s64: P.php.s64, st: c.P.state, wm: go.wm, w4c: go.w4c, tick: P.stats.ticks, head: c.jump.head, key: P.anim.head.key, n: window.__items.inventory.countAt(0), drawn: P.aim.core.P.drawn, ev: P.enemyAI.events.slice(-3) }; });
  const ticks = async n => { const t0 = await pg.evaluate(() => window.__play.stats.ticks); await until(t => window.__play.stats.ticks >= t, t0 + n); };
  // nobody else may shoot: AI off for the soldiers, only our shots fly
  await pg.evaluate(() => { const P = window.__play; for (const a of P.enemyAI.actors) if (a.ai && a.ai.mode) a.ai.mode = 0; });
  const phoenix = async () => {
    await pg.evaluate(() => { const inv = window.__items.inventory; inv.slots[0] = [0x69300004, 1]; inv.setSel(0); });
    await pg.keyboard.press('KeyE');
    await until(() => window.__play.php.s64 === 8);
  };
  // a real bullet: spawnShot from a soldier's weapon 40 u away, at his chest; the world's tick flies it (FUN_00552dd8 .. FUN_0055db50). No spread (W copy).
  const shoot = () => pg.evaluate(() => {
    const P = window.__play, W = P.enemyAI, T = W.t, a = W.actors.find(x => x.ai && x.ai.W) || W.actors[0], p = P.php.pos;
    const Wx = { ...a.ai.W, spread: null, s1c: 0, s20: 0, s24: 0, damage: 99 };
    const muzzle = [p[0] + 40, p[1] - 12, p[2]];
    T.spawnShot(a, [p[0], p[1] - 12, p[2]], muzzle, Wx);
  });
  const revived = () => until(() => { const P = window.__play; return P.gameOver.go.wm === 2 && P.php.hp === 780 && P.ctrl.P.state === 2 && P.php.s64 === 1; });
  // 1. standing
  await phoenix();
  await pg.evaluate(() => { window.__play.php.hp = 1; });
  await shoot();
  await until(() => window.__play.php.hp === 0, null, 60000);
  await ticks(3);
  const a = await S();
  ok(a.hp === 0 && a.st === 7 && a.wm === 5, `a soldier's bullet at HP 1: HP ${a.hp}, state ${a.st}, world mode ${a.wm}`);
  // R1 and Space on the corpse
  await pg.evaluate(() => window.__play.aim.press('r1'));
  await pg.keyboard.press('Space');
  await ticks(5);
  const a1 = await S();
  ok(a1.st === 7 && !a1.drawn, `R1 and Space on the corpse: state ${a1.st}, gun away ${!a1.drawn}`);
  // state 0x16's 50 frames: class 0x3e: C+0x564 bit 0x4000 refuses R1 and ✕; FUN_003419c0 = 0x3e for the AI's filters
  await until(() => window.__play.ctrl.P.state === 0x16);
  await pg.evaluate(() => window.__play.aim.press('r1'));
  await pg.keyboard.press('Space');
  await ticks(3);
  const a2 = await S();
  const mc = await pg.evaluate(() => window.__play.php.motionClass);
  ok(a2.st === 0x16 && !a2.drawn, `R1 and Space in state 0x16: state 0x${a2.st.toString(16)}, gun away ${!a2.drawn} (T w255_phoenix: C+0x564 0xc001)`);
  ok(mc === 0x3e, `php.motionClass ${mc} (0x3e)`);
  await revived();
  ok(true, 'revived (the 1st)');
  // 2. status 0: a real bullet takes nothing
  await shoot();
  await ticks(40);
  const b = await S();
  ok(b.hp === 780 && b.s64 === 1, `under status 0 a bullet takes nothing: HP ${b.hp} (${b.ev.join(' / ').slice(0, 90)})`);
  await until(() => window.__play.php.s64 === 0);
  // 3. in a jump
  await phoenix();
  await pg.evaluate(() => { window.__play.php.hp = 1; });
  await pg.keyboard.press('Space');
  await until(() => { const st = window.__play.ctrl.P.state; return st === 8 || st === 9 || st === 0x20 || st === 0x1f || st === 0x21; }, null, 30000);
  await pg.evaluate(() => { const T = window.__play.enemyAI.t; T.damagePlayer({ damage: 99, kind: 0, hit: 0, f148: 0x42, dir: [1, 0, 0], pos: window.__play.php.pos.slice(), from: { id: 66 }, f120: 0, shooter: 66 }); });
  await ticks(2);
  const c = await S();
  ok(c.hp === 0 && (c.st === 0xf || c.st === 0x10), `shot in the air at HP 1: state 0x${c.st.toString(16)} (FUN_00561270), HP ${c.hp}`);
  await revived();
  ok(true, 'revived (in the air)');
  await until(() => window.__play.php.s64 === 0);
  // 4. a barrel's blast (flags 8)
  await phoenix();
  await pg.evaluate(() => { const P = window.__play, p = P.php.pos; P.php.hp = 1; P.enemyAI.blast.player({ dmg: 99, kind: 0, flags: 8, owner: -1 }, [p[0] + 10, p[1], p[2]], [-1, 0, 0]); });
  await ticks(2);
  const d = await S();
  ok(d.hp === 0 && (d.st === 0xf || d.st === 0x10), `a blast at HP 1: state 0x${d.st.toString(16)}, HP ${d.hp}`);
  await revived();
  ok(true, 'revived (the blast)');
  const e = await S();
  ok(e.w4c === 0, 'no game over request in all of it');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
