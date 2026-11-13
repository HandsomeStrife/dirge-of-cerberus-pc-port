// test_knock_soldier_page.mjs (worker 0259): the soldier's knock-down on the real play.html, real collision and drawn clips: FUN_00565480 flags 8 (as an explosion's) on #66 (notes/other-types.md 'Knock-downs').
//   node native/web/test_knock_soldier_page.mjs
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
for (const f of ['data/enemies/ai.json', 'data/enemies/e027.glb'])
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
  const pg = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /boss|enemy_ai|stage/.test(m.text())) warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  const OPTIONAL = new Set(['/game_state.js', '/stage_info.js']);
  pg.on('response', r => { if (r.status() !== 404) return; const u = r.url().replace(/^http:..[^/]+/, ''); if (!OPTIONAL.has(u)) errs.push('404 ' + u); });
  // the camera: at btbox5's centre, 60 u up, looking at btbox0 (BOSS_SHOT only)
  const cam = process.env.BOSS_SHOT ? '&cam=' + (process.env.BOSS_CAM || '600,-160,1300,45,-12') : '';
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&sound=0${cam}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.enemyAI && window.__play.enemies && window.__play.stage, null, { timeout: 180000 });

  await pg.waitForFunction(() => { const a = window.__play.enemyAI.objects.get(66); return a && a.kind === 'actor' && a.C; }, null, { timeout: 60000 });
  const R = await pg.evaluate(async () => {
    const P = window.__play, W = P.enemyAI, a = W.objects.get(66);
    if (!(a.flags28 & 1)) W.setActive(a, 1);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(500);
    a.f118 &= ~4; a.hp = 100;                                                 // (#66 has HP 1 on the page: he'd die)
    const y0 = a.pos[1], p0 = a.pos.slice(); let peak = 0;
    W.t.enemyHP(a, 1); W.t.react(a, 8, [a.face[0], 0, a.face[2]], a.pos.slice(), 1);   // from behind: state 0x10
    const log = [], t0 = performance.now();
    const drawn = () => { const b = P.enemies.actors.find(x => x.rec === 44); return b ? b.clip : null; };
    while (performance.now() - t0 < 60000) {
      const s = `${a.astate}/${a.C.clip}`;
      if (log.at(-1) !== s) log.push(s);
      peak = Math.max(peak, y0 - a.pos[1]);
      if (a.astate === 2 && a.C.clip && !/rev|fl_|bl_/.test(a.C.clip)) break;
      await wait(8);
    }
    return { log, peak, moved: Math.hypot(a.pos[0] - p0[0], a.pos[2] - p0[2]), y: a.pos[1], y0, drawn: drawn(), clip: a.C.clip };
  });
  console.log('  ' + R.log.join(' '));
  ok(R.log[0].startsWith('16/') && R.log.some(x => /^16\/._fl_0/.test(x)) && R.log.some(x => /^17\/._fl_1/.test(x)) && R.log.some(x => /^2\/._rev_0/.test(x)), `the chain: state 0x10, fl_0, state 0x11 fl_1, state 2 rev_0 (T w259_hit_poly): ${R.log.join(' ')}`);
  ok(R.peak > 8 && R.peak < 25, `he leaves the floor: ${R.peak.toFixed(1)} u (T 13.9+)`);
  ok(Math.abs(R.y - R.y0) < 2, `and lands on it (${R.y.toFixed(1)}, was ${R.y0.toFixed(1)})`);
  ok(R.moved > 5 && R.moved < 60, `pushed along the hit ${R.moved.toFixed(1)} u (T 16)`);
  // Real z128 collision: a run of big hits and knock-downs, each direction: he ends on a polygon (movers 9 / 0xb / 10 walk the mesh, FUN_0034f178; a review saw 186 of 240 off the floor past the railings with a flat step)
  const F = await pg.evaluate(async () => {
    const P = window.__play, W = P.enemyAI, a = W.objects.get(66), wait = ms => new Promise(r => setTimeout(r, ms));
    const col = P.col, out = [];
    for (let n = 0; n < 16; n++) {
      a.hp = 100; a.f164 = -1000;
      const ang = n * Math.PI / 8, dir = [Math.cos(ang), 0, Math.sin(ang)];
      W.t.react(a, n % 2 ? 8 : 4, dir, a.pos.slice(), 1);
      const t0 = performance.now();
      while (performance.now() - t0 < 15000 && !(a.astate === 2 || a.astate === 3)) await wait(30);
      await wait(600);
      const loc = col.locate ? col.locate(a.pos[0], a.pos[1], a.pos[2]) : null;
      out.push({ n, st: a.astate, on: !!loc, pos: a.pos.map(v => +v.toFixed(1)) });
    }
    return out;
  });
  const off = F.filter(x => !x.on);
  ok(off.length === 0 && F.length === 16, `16 big hits / knock-downs: all end on the floor (${off.length} off${off.length ? ': ' + JSON.stringify(off.slice(0, 3)) : ''})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} catch (e) { if (!e.stop) throw e; } finally {
  await browser.close();
  srv.kill();
}
done();
