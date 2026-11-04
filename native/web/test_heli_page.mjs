// test_heli_page.mjs (worker 0259; notes/other-types.md 'The helicopter'): Dragonfly (record 31) on the real play.html: the body flies the clip's world
// path and is drawn there (motion class 0x42), routine 6's rockets leave from its pods (shootMarker needs the drawn pose), a hit past HP 20000 ends the fight
// (flag 0 = 16). ?warp=market, flag 0 poked to 13 and event 0x23 run by hand (the stage's own way there is the door, trigger 14 and heri_toujou; route-states.md).
//   node native/web/test_heli_page.mjs     (needs playwright; HELI_SHOT=<file> saves a screenshot)
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.WEBDIR || here;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['data/z128_collision.bin', 'data/enemies/ai.json', 'data/enemies/e023.glb'])
  if (!existsSync(path.join(WEB, f))) { console.log(`SKIP: ${f} missing (tools/byo/build_web.sh)`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 480, height: 360 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); else if (/enemy_ai|enemies:/.test(m.text())) warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?sound=0&warp=market`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  const warped = await pg.waitForFunction(() => window.__play && window.__play.warp && window.__play.enemyAI, null, { timeout: 240000 }).then(() => true).catch(() => false);
  ok(warped, 'the market warp ran');
  if (warped) {
    await pg.evaluate(() => {
      const A = window.__play.enemyAI, h = A.objects.get(53);
      A.t.send(h, -2, 0xb, [0, 13, 0, 0]);
      A.t.send(h, -2, 0x108, [0, 0, 0, 0]);
      A.runEvent(A.objects.get(53), 0x23);
      window.__heliLog = [];
    });
    const up = await pg.waitForFunction(() => window.__play.enemies.actors.some(a => a.rec === 31 && a.clip === 'eva_0'), null, { timeout: 120000 }).then(() => true).catch(() => false);
    ok(up, 'the body is drawn, playing eva_0');
    // fly a while: the body on the root track, the bones where the game puts them
    const fly = await pg.waitForFunction(() => {
      const P = window.__play, a = P.enemies.actors.find(x => x.rec === 31), s = P.enemyAI.objects.get(53);
      if (!a || !s.C.mp || s.C.mp.frame < 30) return null;
      const bw = P.enemies.partPose(31);
      if (!bw) return null;
      const b1 = bw(1), tr = P.enemies.rootTrack('e023', s.C.mp.clip), fr = Math.max(0, s.C.mp.frame - 0.6), i = Math.trunc(fr), u = fr - i;
      const q = [0, 1, 2].map(k => tr.t[i][k] * (1 - u) + tr.t[i + 1][k] * u);
      return { pos: [...a.body.position.toArray()], s: s.pos.slice(), b1: b1[3], q, clip: s.C.mp.clip, fr, head: a.head.frame, yaw: a.body.rotation.y };
    }, null, { timeout: 120000, polling: 200 }).then(h => h.jsonValue()).catch(() => null);
    ok(fly, 'it flies');
    if (fly) {
      const d = Math.hypot(...fly.b1.map((v, k) => v - fly.q[k]));
      ok(Math.hypot(...fly.pos) > 500, `drawn at ${fly.pos.map(v => v.toFixed(0))} (the clip's world path, not the origin)`);
      ok(d < 12, `bone 1 of the drawn pose is on the track: ${d.toFixed(2)} u off at frame ${fly.fr.toFixed(1)} of ${fly.clip} (drawn frame ${fly.head.toFixed(1)})`);
      ok(Math.abs(fly.head - fly.fr) < 3, 'the drawn clip frame is the AI\'s (a body loaded late takes the running frame)');
      ok(fly.yaw === 0, 'the body adds no heading of its own under C+0x564 bit 4');
    }
    // routine 6 (script 29): two rockets (weapon 25) from markers 0xf / 0x10 at step 1
    const shot = await pg.evaluate(() => {
      const A = window.__play.enemyAI, h = A.objects.get(53);
      A.t.send(h, -2, 0x114, [6, 0, 0, 0]);
      window.__shots = [];
      const P = () => { for (const b of A.bullets) if (b.shooter === 53 && !window.__shots.includes(b)) window.__shots.push(b); };
      window.__shotTimer = setInterval(P, 30);
      return true;
    });
    const rockets = await pg.waitForFunction(() => window.__shots.length >= 1, null, { timeout: 120000, polling: 100 }).then(() => true).catch(() => false);
    const rr = await pg.evaluate(() => { clearInterval(window.__shotTimer); const b = window.__shots[0], h = window.__play.enemyAI.objects.get(53); return b ? { dmg: b.damage, start: b.start ? [...b.start] : null, pos: h.pos.slice() } : null; });
    ok(rockets && rr && rr.dmg === 80, `routine 6 fired weapon 25 (damage ${rr && rr.dmg})`);
    if (rr && rr.start) ok(Math.hypot(rr.start[0] - rr.pos[0], rr.start[1] - rr.pos[1], rr.start[2] - rr.pos[2]) < 200, `from the helicopter, not the origin (start ${rr.start.map(v => v.toFixed(0))}, body ${rr.pos.map(v => v.toFixed(0))})`);
    if (process.env.HELI_SHOT) {
      await pg.evaluate(() => { const P = window.__play, h = P.enemyAI.objects.get(53); P.follow.debugLook = h.pos; });
      await pg.screenshot({ path: process.env.HELI_SHOT });
    }
    // a player's hit past HP 20000 -> timer 0 -> event 1 -> flag 0 = 16 (r06_heli's run: 13 -> 16 at HP 172, poked)
    const before = await pg.evaluate(() => {
      const A = window.__play.enemyAI, h = A.objects.get(53);
      h.hp = 20001;
      A.t.hitEnemy(h, { damage: 500, kind: 0, dir: [1, 0, 0], shooter: 0x16, f148: 0, hit: 0, f120: 0x800 }, h.pos.slice());
      return { hp: h.hp, flag: A.t.send(h, -2, 0xc, [0, 0, 0, 0]) };
    });
    ok(before.flag === 13 && before.hp <= 20000, `HP ${before.hp}, flag 0 still ${before.flag}`);
    const f16 = await pg.waitForFunction(() => { const A = window.__play.enemyAI; const h = A.objects.get(53); return h && A.t.send(h, -2, 0xc, [0, 0, 0, 0]) === 16; }, null, { timeout: 120000, polling: 100 }).then(() => true).catch(() => false);
    ok(f16, 'flag 0 = 16');
    console.log(`  warnings: ${[...new Set(warns)].slice(0, 10).join(' / ')}`.slice(0, 800));
  }
  ok(errs.length === 0, `no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally { await browser.close(); srv.kill(); }
done();
