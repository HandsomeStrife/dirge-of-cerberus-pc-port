// test_stairs_enemies_page.mjs -- worker 0251: Dan's "enemies on the stairs are missing" (2026-11-03) on the real play.html.
// Soldiers 52-54 (e048 / e027 at (-859, -70, -575), the alley stairs) are activated by their parent area (record +0x3e =
// area index 0) switching on (FUN_0054ef68 -> FUN_0055a0d8 -> vt+0x144(1, 1); enemy_ai areaSwitch via areas.js onSwitch
// in play.js). Game RAM: active at route states r02_deckend / r02_climb (test_area_actors.mjs). Here: ?warp=stairs (the foot
// of the stairs, r02_climb's spot): area 0 on, 52-54 active actors with drawn bodies, 46-49 still on (area 2 is a
// neighbour). Also checks report.js's page-error log (meta.json `errors`, worker 0251's crash aid).
//   flock tools/trace/out/.browser.lock node native/web/test_stairs_enemies_page.mjs   (WEBDIR=<dir> serves another copy)
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
for (const f of ['data/z128_collision.bin', 'data/enemies/ai.json'])
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
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => { if (!/worker 0251 test throw/.test(e.message)) errs.push(e.message); });
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&sound=0&warp=stairs`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  const warped = await pg.waitForFunction(() => window.__play && window.__play.warp, null, { timeout: 240000 }).then(() => true).catch(() => false);
  ok(warped, 'the stairs warp ran');
  if (warped) {
    const t0 = await pg.evaluate(() => window.__play.warp.tick);
    await pg.waitForFunction(t0 => window.__play.stats.ticks > t0 + 60, t0, { timeout: 120000 }).catch(() => null);
    // bodies load asynchronously (enemies.js add): give them a moment
    await pg.waitForFunction(() => [52, 53, 54].every(k => window.__play.enemies.actors.some(a => a.rec === k)), null, { timeout: 60000 }).catch(() => null);
    const s = await pg.evaluate(() => {
      const P = window.__play, A = P.enemyAI;
      const act = k => { const o = A.objects.get(k + 22); return !!o && !!(o.flags28 & 1); };
      return { area0: P.areas.isOn(0), area2: P.areas.isOn(2), cur: P.areas.cur,
               on: [46, 47, 48, 49, 52, 53, 54].filter(act), ai: [52, 53, 54].filter(k => A.actors.some(a => a.rec === k && a.ai)),
               bodies: [52, 53, 54].filter(k => P.enemies.actors.some(a => a.rec === k)) };
    });
    ok(s.area0 && s.cur === 0, `area 0 is on at the stairs (current ${s.cur})`);
    ok([52, 53, 54].every(k => s.on.includes(k)), `52-54 active (active: ${s.on.join(' ')})`);
    ok(s.ai.length === 3, `52-54 are AI actors (${s.ai.join(' ')})`);
    ok(s.bodies.length === 3, `52-54 bodies drawn (${s.bodies.join(' ')})`);
    ok(s.area2 && [46, 47, 48, 49].every(k => s.on.includes(k)), '46-49 still on (area 2 is area 0\'s neighbour)');
    // worker 0256: area 2 off and on again (walked away and back): soldier 46 comes back where he stood, drawn there, not at his
    // placement (FUN_00559748's off path leaves +0x90, FUN_00588430 builds the body from it; T: route RAM r03_spot2 / r02_climb)
    const moved = [-880.5, -140.16, -905.5];
    const off = await pg.evaluate(moved => {
      const A = window.__play.enemyAI, a = A.actors.find(x => x.rec === 46);
      a.pos = moved.slice(); a.face = [0, 0, 1]; a.hp = 61;
      A.areaSwitch(2, false);
      return { still: A.actors.some(x => x.rec === 46), kind: A.objects.get(46 + 22).kind };
    }, moved);
    ok(!off.still && off.kind === 'record', `area 2 off: 46 gone (${off.kind})`);
    await pg.waitForFunction(() => !window.__play.enemies.actors.some(a => a.rec === 46), null, { timeout: 30000 }).catch(() => null);
    await pg.evaluate(() => window.__play.enemyAI.areaSwitch(2, true));
    await pg.waitForFunction(() => window.__play.enemies.actors.some(a => a.rec === 46), null, { timeout: 60000 }).catch(() => null);
    const t1 = await pg.evaluate(() => window.__play.stats.ticks);
    await pg.waitForFunction(t1 => window.__play.stats.ticks > t1 + 3, t1, { timeout: 60000 }).catch(() => null);
    const back = await pg.evaluate(() => {
      const P = window.__play, a = P.enemyAI.actors.find(x => x.rec === 46), d = P.enemies.actors.find(x => x.rec === 46);
      return { pos: a ? a.pos.slice() : null, hp: a ? a.hp : -1, body: d ? [d.body.position.x, d.body.position.y, d.body.position.z] : null };
    });
    const dd = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);
    ok(back.pos && dd(back.pos, moved) < 3 && back.hp === 61, `46 back at ${back.pos} (near ${moved}), HP ${back.hp} (61)`);
    ok(back.body && dd(back.body, back.pos) < 0.01, `46's body drawn at ${back.body}`);
    // report.js: an uncaught error goes into the report's error log (meta.json `errors`)
    await pg.evaluate(() => { setTimeout(() => { throw new Error('worker 0251 test throw'); }, 0); });
    await new Promise(r => setTimeout(r, 500));
    const er = await pg.evaluate(() => window.__play.report && window.__play.report.errors ? window.__play.report.errors() : null);
    ok(er && er.some(e => e.kind === 'error' && /worker 0251 test throw/.test(e.message) && /Error/.test(e.stack)), `report.js logs page errors with a stack (${er ? er.length : 'no log'})`);
  }
  ok(errs.length === 0, `no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally { await browser.close(); srv.kill(); }
done();
