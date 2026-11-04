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
    // routine 6 (script 29): two rockets (weapon 25), marker 15 then 16 (FUN_00569870 -> FUN_003461a0). The spawn is caught at the push, in the same
    // tick, so the body's flight can't move the comparison; markerWorld is the page's drawn pose.
    await pg.evaluate(() => {
      const A = window.__play.enemyAI, h = A.objects.get(53);
      window.__shots = [];
      const bl = A.bullets, push0 = bl.push;
      bl.push = function (...x) {
        for (const b of x) if (b.shooter === 53) {
          const d = i => { const m = A.t.markerWorld(h, i); return m ? Math.hypot(b.start[0] - m[0], b.start[1] - m[1], b.start[2] - m[2]) : null; };
          window.__shots.push({ dmg: b.damage, d15: d(15), d16: d(16), d17: d(17), off: Math.hypot(b.start[0] - h.pos[0], b.start[1] - h.pos[1], b.start[2] - h.pos[2]) });
        }
        return push0.apply(this, x);
      };
      A.t.send(h, -2, 0x114, [6, 0, 0, 0]);
      window.__unpush = () => { delete bl.push; };
    });
    const rockets = await pg.waitForFunction(() => window.__shots.length >= 2, null, { timeout: 120000, polling: 100 }).then(() => true).catch(() => false);
    const rr = await pg.evaluate(() => { window.__unpush(); return window.__shots; });
    ok(rockets && rr.length >= 2 && rr.every(s => s.dmg === 80), `routine 6 fired 2 of weapon 25 (damage ${rr.map(s => s.dmg)})`);
    if (rr.length >= 2) {
      ok(rr[0].d15 < 0.01, `rocket 1 leaves marker 15 (${rr[0].d15?.toFixed(3)} u off; marker 16 ${rr[0].d16?.toFixed(0)}, marker 17 ${rr[0].d17?.toFixed(0)})`);
      ok(rr[1].d16 < 0.01, `rocket 2 leaves marker 16 (${rr[1].d16?.toFixed(3)} u off; marker 15 ${rr[1].d15?.toFixed(0)}, marker 17 ${rr[1].d17?.toFixed(0)})`);
    }
    if (process.env.HELI_SHOT) {
      await pg.evaluate(() => { const P = window.__play, h = P.enemyAI.objects.get(53); P.follow.debugLook = h.pos; });
      await pg.screenshot({ path: process.env.HELI_SHOT });
    }
    // Real shots (playerShot through FUN_005ad118 / FUN_0055db50 / FUN_0055c7f8, no poked HP): through its part boxes until the fight ends. HP 21600, the
    // line 20000 (script 29 event 8, cmd 0x138) -> timer 0 = 240 -> event 1 -> flag 0 = 16.
    const real = await pg.evaluate(async () => {
      const P = window.__play, A = P.enemyAI, h = A.objects.get(53);
      const hb = (await fetch('data/enemies/ai.json').then(r => r.json())).hitboxes.e023;
      const Wv = { ...(await fetch('data/aim/weapon.json').then(r => r.json())), spread: null, pellets: 1 };
      const flag = () => A.t.send(h, -2, 0xc, [0, 0, 0, 0]);
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const hp0 = h.hp, drops = [], t0 = performance.now(); let shots = 0, hits = 0, crossed = null;
      const flag0 = flag();
      while (h.hp > 20000 && performance.now() - t0 < 120000) {
        const bw = P.enemies.partPose(31);
        if (!bw) { await wait(50); continue; }
        const b = hb[0], B = bw(b.bone), c = [0, 1, 2].map(k => b.offset[0] * B[0][k] + b.offset[1] * B[1][k] + b.offset[2] * B[2][k] + B[3][k]);
        const was = h.hp;
        A.playerShot([c[0] - 60, c[1], c[2]], [c[0] + 60, c[1], c[2]], Wv); shots++;
        await wait(60);
        if (h.hp < was) { hits++; drops.push(was - h.hp); }
      }
      crossed = { hp: h.hp, flag: flag(), tick: P.stats.ticks, var1: A.t.send(h, -2, 0x138, [0, 0, 0, 0]) };
      return { hp0, flag0, shots, hits, drops: drops.slice(0, 6), crossed };
    });
    ok(real.hp0 === 21600 && real.flag0 === 13, `the fight starts at HP ${real.hp0}, flag 0 = ${real.flag0}`);
    ok(real.hits > 0 && real.crossed.hp < real.hp0, `real shots land: ${real.hits} of ${real.shots} took HP (${real.drops.join(', ')} ...), HP ${real.hp0} -> ${real.crossed.hp}`);
    ok(real.crossed.hp <= 20000 && real.crossed.flag === 13, `HP ${real.crossed.hp} is past the line, flag 0 still ${real.crossed.flag} (timer 0 running)`);
    const f16 = await pg.waitForFunction(() => { const A = window.__play.enemyAI, h = A.objects.get(53); return h && A.t.send(h, -2, 0xc, [0, 0, 0, 0]) === 16 ? window.__play.stats.ticks : false; }, null, { timeout: 120000, polling: 50 }).then(h => h.jsonValue()).catch(() => null);
    ok(f16 && Math.abs(f16 - real.crossed.tick - 240) <= 25, `flag 0 = 16 ${f16 ? f16 - real.crossed.tick : '-'} ticks after the crossing (timer 0 = 240; T w259_heli_end 239)`);
    console.log(`  warnings: ${[...new Set(warns)].slice(0, 10).join(' / ')}`.slice(0, 800));
  }
  ok(errs.length === 0, `no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally { await browser.close(); srv.kill(); }
done();
