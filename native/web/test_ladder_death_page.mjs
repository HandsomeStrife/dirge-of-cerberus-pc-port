// Death and the knock-down where the last reviews found softlocks (worker 0255), real page, headless, ?intro=0, damage on, the real ladder mounted by a real ✕:
// killed on the rungs and during the mount, with a Phoenix Down and without: c_ld_jp, the fall, state 7 on the ground (T w255_ladder_climb / w255_ladder_mount), the y stops, the revive or the
// game over, W walks. A live blast: state 0xf, the get-up, the stick locked at first, then back. A corpse sliding off a ledge: states 0xf / 0x10.
//   flock tools/trace/out/.browser.lock node native/web/test_ladder_death_page.mjs
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
  const until = (f, arg, t = 400000) => pg.waitForFunction(f, arg, { timeout: t, polling: 50 });
  const S = () => pg.evaluate(() => { const P = window.__play, c = P.ctrl, go = P.gameOver.go; return { hp: P.php.hp, s64: P.php.s64, st: c.P.state, wm: go.wm, w4c: go.w4c, y: c.pos.y, x: c.pos.x, z: c.pos.z, active: c.active && c.active.name, ph: c.active && c.active.phase, g: c.onGround, key: P.anim.head.key, ov: !!P.anim.override, mo: c.jump.motion && c.jump.motion.id, head: c.jump.head, lock: !!(c.jump.motion && c.jump.motion.lock), tick: P.stats.ticks, drawn: P.aim.core.P.drawn }; });
  const ticks = async n => { const t0 = await pg.evaluate(() => window.__play.stats.ticks); await until(t => window.__play.stats.ticks >= t, t0 + n); };
  await pg.evaluate(() => { const P = window.__play; for (const a of P.enemyAI.actors) if (a.ai && a.ai.mode) a.ai.mode = 0; });
  // the foot of ladder 0 (T w255_ladder_climb record 480), the way the route arrives; a real ✕ mounts
  const toFoot = (s64) => pg.evaluate(s64 => {
    const P = window.__play, c = P.ctrl;
    P.php.hp = 780; P.php.s64 = s64; P.gameOver.reset(); P.follow.clearDeath(); c.reset();
    c.pos = { x: -1109.7, y: -90.63, z: -1108.8 }; c.prev = { ...c.pos }; c.locate(); c.pos = { x: -1109.7, y: -90.63, z: -1108.8 };
    const f = window.__foot; c.heading = Math.atan2(0.72, 0.69); c.C.face = { x: Math.sin(c.heading), y: 0, z: Math.cos(c.heading) };
  }, s64);
  const hit = () => pg.evaluate(() => { const P = window.__play; P.php.hp = 1; P.enemyAI.t.damagePlayer({ damage: 99, kind: 0, hit: 0, f148: 0x42, dir: [1, 0, 0], pos: P.php.pos.slice(), from: { id: 66 }, f120: 0, shooter: 66 }); return P.ctrl.active && P.ctrl.active.phase; });
  const mount = async () => { await pg.keyboard.press('Space'); await until(() => window.__play.ctrl.active && window.__play.ctrl.active.name === 'ladder', null, 30000); };
  for (const [name, s64, when] of [['rungs + Phoenix Down', 8, 'rungs'], ['rungs, no status', 0, 'rungs'], ['mount + Phoenix Down', 8, 'mount']]) {
    await toFoot(s64);
    await ticks(3);
    await mount();
    if (when === 'rungs') {
      await pg.keyboard.down('KeyW');
      await until(() => { const a = window.__play.ctrl.active; return a && (a.phase === 'up' || a.phase === 'down' || a.phase === 'idle'); }, null, 120000);
      await ticks(10);
      await pg.keyboard.up('KeyW');
    }
    const a0 = await S();
    const ph1 = await hit();
    const a1 = await S();
    ok(a1.hp === 0, `${name}: killed at y ${a0.y.toFixed(1)}, phase ${a0.ph}`);
    if (when === 'rungs') ok(ph1 === 'jump', `  FUN_00562d30 on the rungs: the jump-off at once (phase ${ph1})`);
    else ok(ph1 && ph1.startsWith('mount'), `  in the mount: the class finishes first (phase ${ph1})`);
    await until(() => window.__play.ctrl.P.state === 7);
    const a2 = await S();
    ok(a2.g && !a2.active && Math.abs(a2.y - -90.63) < 2, `  landed, state 7: on the ground at y ${a2.y.toFixed(2)} (T -90.63), x ${a2.x.toFixed(1)} (T -1116.1)`);
    if (s64) {
      await until(() => window.__play.ctrl.P.state === 0x16);
      const a3 = await S();
      ok(a3.hp === 780 && a3.g, `  revived on the ground: HP ${a3.hp}, y ${a3.y.toFixed(2)}`);
      await until(() => window.__play.ctrl.P.state === 2);
      const p0 = await S();
      await pg.keyboard.down('KeyS'); await ticks(40); await pg.keyboard.up('KeyS');
      const p1 = await S();
      ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1 && Math.abs(p1.y - p0.y) < 30, `  control back: S moved him ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} u, y ${p1.y.toFixed(1)}`);
    } else {
      await until(() => window.__play.gameOver.go.w4c === 1);
      await ticks(30);
      const a4 = await S();
      ok(a4.w4c === 1 && a4.g && Math.abs(a4.y - a2.y) < 0.01, `  GAME OVER, the corpse lies still at y ${a4.y.toFixed(2)}`);
    }
  }
  // a live blast (flags 8): knocked down, gets up by himself
  await toFoot(0);
  await pg.evaluate(() => window.__play.ctrl.reset());                // (his spawn: the page's collision is streamed, so no teleport into a far chunk)
  await ticks(3);
  await pg.evaluate(() => window.__play.aim.press('r1'));
  await until(() => window.__play.aim.core.P.drawn);
  await pg.evaluate(() => { const P = window.__play, p = P.php.pos; P.enemyAI.blast.player({ dmg: 50, kind: 0, flags: 8, owner: -1 }, [p[0] + 10, p[1], p[2]], [-1, 0, 0]); });
  await ticks(1);
  const k0 = await S();
  ok(k0.hp > 0 && k0.hp < 780 && (k0.st === 0xf || k0.st === 0x10) && !k0.drawn, `a live blast: HP ${k0.hp}, state 0x${k0.st.toString(16)}, the gun away (T w255_knock_gun)`);
  await until(() => window.__play.ctrl.P.state === 0x11);
  await until(() => window.__play.ctrl.P.state === 2);
  const k1 = await S();
  ok(k1.mo === 0x37 && k1.lock && /rev/.test(k1.key), `the get-up: class 0x${(k1.mo ?? 0).toString(16)}, ${k1.key}, the stick locked`);
  await pg.keyboard.down('KeyW');
  await ticks(5);
  const k2 = await S();
  ok(Math.hypot(k2.x - k1.x, k2.z - k1.z) < 0.01, `W in the lock moves nothing (${Math.hypot(k2.x - k1.x, k2.z - k1.z).toFixed(3)} u)`);
  await until(() => !window.__play.ctrl.jump.motion);
  await ticks(30);
  const k3 = await S();
  await pg.keyboard.up('KeyW');
  ok(Math.hypot(k3.x - k2.x, k3.z - k2.z) > 1, `control back: W moved him ${Math.hypot(k3.x - k2.x, k3.z - k2.z).toFixed(1)} u`);
  // ✕ on the first frame of state 0x11, through the real aim.js gate (FUN_005763b8); the wrapper only times the press
  await pg.evaluate(() => { const P = window.__play, p = P.php.pos, c = P.ctrl, s = c.step; let once = false;
    c.step = function (i, ...r) { if (!once && c.P.state === 0x11) { once = true; c.step = s; i = { ...i, pressed: new Set([...(i.pressed || []), 'Space']) }; } return s.call(c, i, ...r); };
    P.enemyAI.blast.player({ dmg: 50, kind: 0, flags: 8, owner: -1 }, [p[0] + 10, p[1], p[2]], [-1, 0, 0]); });
  await until(() => { const st = window.__play.ctrl.P.state; return st === 8 || st === 0x20 || st === 2; }, null, 60000);
  const t0 = await S();
  ok(t0.st === 8 || t0.st === 0x20, `✕ in class 0x3a's first ticks jumps: state 0x${t0.st.toString(16)}`);
  await until(() => window.__play.ctrl.P.state === 2 && !window.__play.ctrl.jump.motion, null, 60000);
  // a corpse over a ledge: the walk mesh's drop at the edge nearest the kill site of w255_phoenix_air
  const edge = await pg.evaluate(() => {
    const P = window.__play, col = P.col, c = P.ctrl, o = { x: c.pos.x, z: c.pos.z }; let best = null;
    for (let a = 0; a < 32 && !best; a++) {
      const dx = Math.sin(a * Math.PI / 16), dz = Math.cos(a * Math.PI / 16); let last = col.groundY(o.x, o.z, c.pos.y), lx = o.x, lz = o.z;
      for (let d = 1; d < 90 && last != null; d += 0.5) {
        const x = o.x + dx * d, z = o.z + dz * d, g = col.groundY(x, z, last);
        if (g == null) break;
        if (g - last > 15) { best = { x: lx, z: lz, y: last, below: g, dx, dz }; break; }
        last = g; lx = x; lz = z;
      }
    }
    return best;
  });
  console.log('edge', JSON.stringify(edge));
  if (edge) {
    await toFoot(8);
    await pg.evaluate(() => window.__play.ctrl.reset());
    await pg.evaluate(e => { const P = window.__play, c = P.ctrl, x = e.x - e.dx * 4, z = e.z - e.dz * 4, y = P.col.groundY(x, z, e.y); c.pos = { x, y, z }; c.prev = { ...c.pos }; c.locate(); c.pos = { x, y, z }; }, edge);
    await ticks(3);
    await pg.evaluate(e => { const P = window.__play; P.php.hp = 0; P.ctrl.hitReact({ flags: 2, dir: [e.dx, 0, e.dz], aliveBefore: true, deadNow: true }); }, edge);
    await ticks(30);
    const e0 = await S();
    console.log('after the slide', JSON.stringify(e0));
    await until(() => window.__play.ctrl.P.state === 2 && window.__play.php.hp === 780, null, 200000);
    const e1 = await S();
    ok(e1.g && e1.y > edge.y + 5, `the corpse over the ledge: revived on the lower ground (y ${e1.y.toFixed(1)}, edge ${edge.y.toFixed(1)})`);
  } else console.log('SKIP: no ledge within 90 u of his spawn on the loaded collision (test_knock has the unit case)');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
