// test_market_cam_page.mjs -- Dan's "texture deloading" report (2026-11-03, worker 0247): in chunk 03's square
// (feet (-1507.3, -0.06, -573.5), facing -z, stream pair (2, 3)) the page drew only the floor, banners and actors.
// Cause: the follow camera's collision rays tested chunks 0 / 1 / 2 only, so the eye passed through chunk 03's wall
// at z -542.75 and ended behind chunk 03's occluder quad 2 (the plane z -540); FUN_0026ccc8 then dropped nearly
// every node of the square. The game's rays test the LOADED slots (FUN_0054c848 -> FUN_0054fc38 -> FUN_0026a320,
// worker 0244), so the eye stays in front of the wall. Checks, with Vincent placed there and the camera settled:
//   1. the camera rays test the loaded slots (0, 2, 3);
//   2. the eye is in front of the occluder plane (z < -540) and stopped by the wall (z <= -542.75);
//   3. the view's centre ray (report.js __rayCast, which follows the drawn index) hits chunk 03's square beyond the
//      wall: the first hit is more than 20 u away.
// Run: flock tools/trace/out/.browser.lock node native/web/test_market_cam_page.mjs
//   (needs playwright, the three.js CDN, data/scene.json; WEBDIR=<dir> serves another copy, for mutation runs)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.WEBDIR || here;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
if (!existsSync(path.join(WEB, 'data/scene.json'))) { console.log('SKIP: no data/scene.json'); process.exit(0); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch (e) { console.log('SKIP: no playwright'); process.exit(0); }

const FEET = { x: -1507.3049, y: -0.0636, z: -573.5304 }, HEADING = -176.84;   // the report's player block
const WANT = Math.atan2(4.9, -34.7);                // the report camera's (at - eye) direction in x / z
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  for (let k = 0; ; k++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&enemydmg=0&sound=0`, { waitUntil: 'load' }); break; } catch (e) { if (k > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.waitForFunction(() => typeof window.__rayCast === 'function' && window.__play && window.__play.stats.ticks > 5, null, { timeout: 400000 });
  const r = await pg.evaluate(async ([feet, heading, want]) => {
    const P = window.__play, c = P.ctrl, wait = ms => new Promise(res => setTimeout(res, ms));
    // place Vincent (test aid): position, last frame's position, heading, walk polygon; the stream at the box's pair
    const fr = P.col.findPoly(feet.x, feet.z, feet.y - 7.5, feet.y + 200);
    c.pos = { ...feet }; c.prev = { ...feet }; c.heading = c.prevHeading = heading * Math.PI / 180;
    c.C.face = { x: Math.sin(c.heading), y: 0, z: Math.cos(c.heading) };
    if (c.body) c.body.poly = fr ? fr[0] : null;
    P.light.stream.reset([2, 3]);
    // turn the camera to the report's direction (reset with a corrected yaw until it matches), then let it settle
    let yaw = P.follow.yaw;
    for (let it = 0; it < 5; it++) {
      P.follow.reset(c.pos, { yaw, pitch: P.follow.pitch });
      await wait(1500);
      const f = P.follow, got = Math.atan2(f.at[0] - f.eye[0], f.at[2] - f.eye[2]);
      let d = want - got; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) < 0.02) break;
      yaw = P.follow.yaw + d;
    }
    await wait(3000);
    const f = P.follow, dir = [0, 1, 2].map(j => f.at[j] - f.eye[j]);
    const hits = window.__rayCast(f.eye, dir, 4).hits.map(h => ({ name: h.name, dist: h.dist }));
    return { eye: f.eye, at: f.at, camChunks: P.follow.rays.chunks(), slots: P.light.stream.loaded(), hits,
             dir: Math.atan2(dir[0], dir[2]) };
  }, [FEET, HEADING, WANT]);
  console.log('eye', r.eye.map(v => +v.toFixed(2)).join(', '), ' slots', r.slots.join(','), ' first hits', JSON.stringify(r.hits.slice(0, 2)));
  ok(Math.abs(r.dir - WANT) < 0.05, `camera turned to the report's direction (${r.dir.toFixed(3)} vs ${WANT.toFixed(3)})`);
  ok(r.camChunks.slice().sort().join() === '0,2,3', `camera rays test the loaded slots: [${r.camChunks}] (FUN_0054fc38 -> FUN_0026a320)`);
  ok(r.eye[2] <= -542.75 + 1e-3, `eye stopped by chunk 03's wall: z ${r.eye[2].toFixed(2)} <= -542.75 (in front of occluder plane z -540)`);
  ok(r.hits.length > 0 && r.hits[0].dist > 20, `centre ray reaches the square: first hit ${r.hits[0] ? r.hits[0].name + ' at ' + r.hits[0].dist.toFixed(1) : 'none'} (> 20 u)`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await pg.close();
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
