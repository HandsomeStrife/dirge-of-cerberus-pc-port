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
  const S = () => pg.evaluate(() => { const P = window.__play, c = P.ctrl, go = P.gameOver.go; return { hp: P.php.hp, s64: P.php.s64, st: c.P.state, wm: go.wm, w4c: go.w4c, y: c.pos.y, x: c.pos.x, z: c.pos.z, active: c.active && c.active.name, ph: c.active && c.active.phase, g: c.onGround, key: P.anim.head.key, ov: !!P.anim.override, mo: c.jump.motion && c.jump.motion.id, head: c.jump.head, lock: !!(c.jump.motion && c.jump.motion.lock), tick: P.stats.ticks, drawn: P.aim.core.P.drawn, stance: c.P.stance ?? 0, low: !!P.follow.low, m29c: P.aim.core.P.m29c, aiming: P.aim.core.isAiming() }; });
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
  ok(k0.m29c === 2 && !k0.aiming && k0.stance === 0 && !k0.low, `FUN_005747f8(P, 2): m29c ${k0.m29c}, aiming ${k0.aiming}; stance ${k0.stance}, camera low ${k0.low}`);
  await until(() => window.__play.ctrl.P.state === 0x11);
  const kl = await S();
  ok(kl.stance === 2 && kl.low, `lying: FUN_00539458: stance ${kl.stance}, the camera lowered ${kl.low} (T w255_knock_run 160)`);
  await until(() => window.__play.ctrl.P.state === 2);
  const k1 = await S();
  ok(k1.stance === 0 && !k1.low && k1.m29c === 2 && !k1.aiming, `up: stance ${k1.stance}, low ${k1.low}, m29c ${k1.m29c}, not aiming`);
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
  // killed lying down (T w255_lying_kill2 / 4 / 0, w255_lying_nostatus): a real bullet in state 0x11
  const blastHere = () => pg.evaluate(() => { const P = window.__play, p = P.php.pos; P.enemyAI.blast.player({ dmg: 50, kind: 0, flags: 8, owner: -1 }, [p[0] + 10, p[1], p[2]], [-1, 0, 0]); });
  for (const s64 of [8, 0]) {
    await toFoot(s64);
    await pg.evaluate(() => window.__play.ctrl.reset());
    await ticks(3);
    await blastHere();
    await until(() => window.__play.ctrl.P.state === 0x11);
    await ticks(5);
    await hit();
    const d0 = await S();
    ok(d0.hp === 0 && d0.st === 7 && d0.mo === 0xd, `shot lying, status ${s64}: HP ${d0.hp}, state ${d0.st}, class 0x${(d0.mo ?? 0).toString(16)} (FUN_00537aa0's stance 2)`);
    if (s64) {
      await until(() => window.__play.ctrl.P.state === 0x16, null, 30000);
      await until(() => window.__play.ctrl.P.state === 2, null, 30000);
      const d1 = await S();
      await pg.keyboard.down('KeyW'); await ticks(40); await pg.keyboard.up('KeyW');
      const d2 = await S();
      ok(d1.hp === 780 && d1.stance === 0 && !d1.low && Math.hypot(d2.x - d1.x, d2.z - d1.z) > 1, `revived: HP ${d1.hp}, stance ${d1.stance}, W moved him ${Math.hypot(d2.x - d1.x, d2.z - d1.z).toFixed(1)} u`);
    } else {
      await until(() => window.__play.gameOver.go.w4c === 1, null, 60000);
      await ticks(30);
      const d1 = await S();
      ok(d1.st === 7 && Math.hypot(d1.x - d0.x, d1.z - d0.z) < 0.5, `GAME OVER; the corpse lies still (${Math.hypot(d1.x - d0.x, d1.z - d0.z).toFixed(2)} u; T 0)`);
    }
  }
  // a live big hit lying: state 0x18, class 0x3f (T w255_lying_big)
  await toFoot(0);
  await pg.evaluate(() => window.__play.ctrl.reset());
  await ticks(3);
  await blastHere();
  await until(() => window.__play.ctrl.P.state === 0x11);
  await ticks(5);
  await pg.evaluate(() => { const c = window.__play.ctrl; c.hitReact({ flags: 4, dir: [-1, 0, 0], aliveBefore: true, deadNow: false }); });
  const b0 = await S();
  ok(b0.st === 0x18 && b0.mo === 0x3f && b0.stance === 0, `a big hit lying: state 0x${b0.st.toString(16)}, class 0x${(b0.mo ?? 0).toString(16)}, stance ${b0.stance}`);
  await until(() => window.__play.ctrl.P.state === 2, null, 30000);
  // the ladder's own fall is state 8: a hit in the air knocks him down (FUN_0055a410 false for it)
  await toFoot(0);
  await ticks(3);
  await mount();
  await pg.keyboard.down('KeyW');
  await until(() => { const a = window.__play.ctrl.active; return a && a.phase === 'up'; }, null, 120000);
  await ticks(60);
  await pg.keyboard.up('KeyW');
  await until(() => window.__play.ctrl.active.phase === 'idle', null, 30000);   // (a rung step reads ✕ only at its end)
  await pg.evaluate(() => { const P = window.__play, c = P.ctrl, s = c.step;
    c.step = function (...r) { if (c.active && c.active.phase === 'fall') { c.step = s; const p = P.php.pos; P.enemyAI.blast.player({ dmg: 50, kind: 0, flags: 8, owner: -1 }, [p[0] + 10, p[1], p[2]], [-1, 0, 0]); } return s.apply(c, r); }; });
  await pg.keyboard.down('Space'); await ticks(2); await pg.keyboard.up('Space');
  await until(() => { const st = window.__play.ctrl.P.state; return st === 0xf || st === 0x10; }, null, 60000);
  const f0 = await S();
  ok(!f0.active, `hit in the ladder's fall: state 0x${f0.st.toString(16)}, the ladder action ended (${f0.active})`);
  await until(() => window.__play.ctrl.P.state === 2, null, 60000);
  await until(() => !window.__play.ctrl.jump.motion, null, 60000);
  // FUN_005771c8: C+0x564 bit 0x4000: ✕ at the foot in the get-up doesn't mount
  await toFoot(0);
  await ticks(3);
  await pg.evaluate(() => { const P = window.__play, c = P.ctrl, s = c.step; let n = 0; window.__gate = false;
    c.step = function (i, ...r) { const m = c.jump.motion;
      if (m && m.id === 0x37) {
        if (++n === 1) { c.pos = { x: -1109.7, y: -90.63, z: -1108.8 }; c.prev = { ...c.pos }; c.locate(); c.pos = { x: -1109.7, y: -90.63, z: -1108.8 }; c.heading = Math.atan2(0.72, 0.69); c.C.face = { x: Math.sin(c.heading), y: 0, z: Math.cos(c.heading) }; }
        if (n === 4) { i = { ...i, pressed: new Set([...(i.pressed || []), 'Space']) }; c.step = s; window.__gate = true; }
      }
      return s.call(c, i, ...r); };
    const p = P.php.pos; P.enemyAI.blast.player({ dmg: 50, kind: 0, flags: 8, owner: -1 }, [p[0] + 10, p[1], p[2]], [-1, 0, 0]); });
  await until(() => window.__gate === true, null, 60000);
  await ticks(3);
  const g0 = await S();
  ok(!g0.active, `✕ at the ladder in the get-up: no mount (active ${g0.active})`);
  await until(() => !window.__play.ctrl.jump.motion, null, 60000);
  await ticks(3);
  await mount();
  ok(true, 'after the get-up ✕ mounts');
  // a corpse over a real ledge: the top of ladder 0, reached by climbing it. The walk mesh's drop at the edge nearest him
  await toFoot(8);
  await ticks(3);
  await mount();
  await pg.keyboard.down('KeyW');
  await until(() => !window.__play.ctrl.active, null, 300000);
  await pg.keyboard.up('KeyW');
  await ticks(3);
  const edge = await pg.evaluate(() => {
    const P = window.__play, col = P.col, c = P.ctrl, o = { x: c.pos.x, z: c.pos.z }; let best = null;
    for (let a = 0; a < 32 && !best; a++) {
      const dx = Math.sin(a * Math.PI / 16), dz = Math.cos(a * Math.PI / 16); let lx = o.x, lz = o.z;
      for (let d = 0.5; d < 30; d += 0.5) {
        const x = o.x + dx * d, z = o.z + dz * d, g = col.groundY(x, z, c.pos.y);
        if (g == null) break;
        if (g - c.pos.y > 15) { best = { x: lx, z: lz, y: c.pos.y, below: g, dx, dz }; break; }
        if (Math.abs(g - c.pos.y) < 1) { lx = x; lz = z; }
      }
    }
    return best;
  });
  console.log('edge', JSON.stringify(edge));
  if (edge) {
    const place = () => pg.evaluate(e => { const P = window.__play, c = P.ctrl, x = e.x - e.dx * 1, z = e.z - e.dz * 1, y = P.col.groundY(x, z, e.y); c.pos = { x, y, z }; c.prev = { ...c.pos }; c.locate(); c.pos = { x, y, z }; }, edge);
    const kill = () => pg.evaluate(e => { const P = window.__play; P.php.hp = 0; P.ctrl.hitReact({ flags: 2, dir: [e.dx, 0, e.dz], aliveBefore: true, deadNow: true }); }, edge);
    // the death's slide takes him over; the fall is shorter than class 0xb's 216 frames, so FUN_00538780's event finds him on the lower floor: he lies there in state 7
    await place();
    await ticks(3);
    await kill();
    await until(() => window.__play.ctrl.P.state === 2 && window.__play.php.hp === 780, null, 200000);
    const n0 = await S();
    ok(n0.g && n0.y > edge.y + 5, `killed at the ledge: the corpse falls, revived on the lower floor (y ${n0.y.toFixed(1)}, ledge ${edge.y.toFixed(1)})`);
    // FUN_00538780's air branch: the class's end while he is over the drop. Test aid: the clip is moved to its end on his first frame off the ground; everything after is the page's
    await pg.evaluate(() => { const P = window.__play; P.php.s64 = 8; P.gameOver.reset(); });   // (the revive above used the status)
    await place();
    await ticks(3);
    await pg.evaluate(() => { const c = window.__play.ctrl, s = c.step;
      c.step = function (...r) { if (c.P.state === 7 && !c.onGround) { c.step = s; const K = c.jump.clock; K.frame = K.frames[K.clip] - 1; } return s.apply(c, r); }; });
    await kill();
    await until(() => { const st = window.__play.ctrl.P.state; return st === 0xf || st === 0x10; }, null, 60000);
    const e0 = await S();
    ok(!e0.g && e0.stance === 0 && !e0.low, `FUN_00538780: the corpse off the ledge: state 0x${e0.st.toString(16)}, off the ground, stance ${e0.stance} (FUN_005392b8 / FUN_00539390)`);
    await until(() => window.__play.ctrl.P.state === 0x11, null, 60000);
    const e2 = await S();
    ok(e2.stance === 2 && e2.low, `lands: state 0x11, stance ${e2.stance}, the camera lowered`);
    await until(() => window.__play.ctrl.P.state === 2 && window.__play.php.hp === 780, null, 200000);
    const e1 = await S();
    await pg.keyboard.down('KeyW'); await ticks(40); await pg.keyboard.up('KeyW');
    const e3 = await S();
    ok(e1.g && e1.y > edge.y + 5 && Math.hypot(e3.x - e1.x, e3.z - e1.z) > 1, `revived on the lower floor (y ${e1.y.toFixed(1)}, ledge ${edge.y.toFixed(1)}), W moved him ${Math.hypot(e3.x - e1.x, e3.z - e1.z).toFixed(1)} u`);
  } else ok(false, 'no ledge found from the top of ladder 0');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
