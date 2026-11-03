// test_room_vis_page.mjs -- the room's start visibility mask on the pages (worker 0225; review item 1):
// a triangle of a chain group the start mask hides (the probe FUN_00264ee0 from the start camera's eye, room_vis.js
// startMask) is neither drawn nor hit by the report tool's ray cast (report.js __rayCast, which follows each
// geometry's index), and a triangle of a never-hidden group is, on
//   play.html (area streaming + the per-frame probe), play.html with light.json's area boxes stripped (no streaming:
//   the probe still runs), index.html (main.js, the static viewer: every chunk, the start mask).
// Run: node native/web/test_room_vis_page.mjs   (needs playwright, the three.js CDN, data/scene.json, data/z128_vis.json)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRoomVis, startMask } from './room_vis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(here, 'data');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
if (!existsSync(path.join(D, 'scene.json')) || !existsSync(path.join(D, 'z128_vis.json'))) { console.log('SKIP: no data/scene.json or data/z128_vis.json'); process.exit(0); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch (e) { console.log('SKIP: no playwright'); process.exit(0); }

// the target triangles (node side: scene.json + the mesh buffers)
const scene = JSON.parse(readFileSync(path.join(D, 'scene.json'), 'utf8'));
const mask = startMask(createRoomVis(JSON.parse(readFileSync(path.join(D, 'z128_vis.json'), 'utf8'))), scene.camera.eye);
ok(mask.bits().join() === '0,19,25,56,57', `start mask from scene.json's camera eye: {${mask.bits()}} (the save's DAT_004e86f0)`);
const buf = {};
const tri = (d, t) => {
  const f = buf[d.mesh] || (buf[d.mesh] = (q => new Float32Array(q.buffer.slice(q.byteOffset, q.byteOffset + q.byteLength)))(readFileSync(path.join(D, scene.meshes[d.mesh].file))));
  const P = [0, 1, 2].map(k => [0, 1, 2].map(j => f[(t * 3 + k) * 12 + j]));
  const e1 = P[1].map((x, j) => x - P[0][j]), e2 = P[2].map((x, j) => x - P[0][j]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const a = Math.hypot(...n), c = [0, 1, 2].map(j => (P[0][j] + P[1][j] + P[2][j]) / 3);
  return { area: a / 2, n: n.map(x => x / (a || 1)), c };
};
function pick(test) {               // the largest opaque triangle of a range passing test, in chunks 0..2
  let best = null;
  scene.draws.forEach((d, di) => {
    if (d.kind !== 'room' || !d.chunks || d.aref >= 0 || d.blend) return;
    for (const r of d.chunks) {
      if (r[0] > 2 || !test(r[3] ?? -1)) continue;
      for (let t = r[1] / 3; t < (r[1] + r[2]) / 3; t += Math.max(1, Math.floor(r[2] / 3 / 50))) {
        const q = tri(d, t);
        if (!best || q.area > best.area) best = { ...q, draw: di, tri: t, group: r[3] };
      }
    }
  });
  return best;
}
const hid = pick(g => g >= 0 && mask.has(g)), vis = pick(g => g < 0);
ok(hid && vis && hid.area > 1 && vis.area > 1, `targets: hidden group ${hid && hid.group} draw ${hid && hid.draw} tri ${hid && hid.tri}, never-hidden draw ${vis && vis.draw} tri ${vis && vis.tri}`);
const rayOf = (q, off) => ({ o: q.c.map((x, j) => x + q.n[j] * off), d: q.n.map(x => -x) });

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const [name, url, strip] of [['play.html', 'play.html?intro=0&enemydmg=0', false],
                                    ['play.html, no area boxes', 'play.html?intro=0&enemydmg=0', true],
                                    ['index.html (main.js)', 'index.html', false]]) {
    const pg = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    if (strip) await pg.route('**/data/vincent/light.json', async r => {
      const res = await r.fetch(), j = await res.json(); delete j.areas; r.fulfill({ response: res, json: j });
    });
    for (let k = 0; ; k++) { try { await pg.goto(`http://127.0.0.1:${port}/${url}`, { waitUntil: 'load' }); break; } catch (e) { if (k > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
    await pg.waitForFunction(() => typeof window.__rayCast === 'function', null, { timeout: 240000 });
    await new Promise(r => setTimeout(r, 3000));          // a few game frames (the probe runs in the frame loop)
    const cast = (q, off) => pg.evaluate(([o, d]) => window.__rayCast(o, d, 16).hits.map(h => [h.draw, h.tri]), [rayOf(q, off).o, rayOf(q, off).d]);
    const has = (hits, q) => hits.some(([d, t]) => d === q.draw && t === q.tri);
    // the ray cast skips hits nearer than the camera's near plane: start the ray at the first offset that hits the control
    let off = null;
    for (const o of [4, 12, 30, 60]) if (has(await cast(vis, o), vis)) { off = o; break; }
    ok(off !== null, `${name}: the never-hidden triangle is drawn and hit (control; ray start ${off} u off it)`);
    const hh = await cast(hid, off ?? 4);
    ok(!has(hh, hid), `${name}: the hidden group ${hid.group}'s triangle is not drawn (ray from ${off} u: hits ${JSON.stringify(hh.slice(0, 3))})`);
    ok(errs.length === 0, `${name}: no page errors (${errs.slice(0, 2).join(' | ')})`);
    await pg.close();
  }
  // Restart clears the script half DAT_004e8700 itself (review item 2), here with no stage fire (ids.json without its
  // stage FEDs: no fxStage, whose reset also clears it)
  {
    const pg = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/data/effects/ids.json', async r => { const res = await r.fetch(), j = await res.json(); j.stage = []; r.fulfill({ response: res, json: j }); });
    await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&enemydmg=0`, { waitUntil: 'load' });
    await pg.waitForFunction(() => window.__play && window.__play.visMask && window.__play.packsReady, null, { timeout: 240000 }).catch(() => {});
    await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 5, null, { timeout: 240000 });
    const noFire = await pg.evaluate(() => !window.__fx || !window.__fx.stage);
    await pg.evaluate(() => { window.__play.visMask.setScript(5, true); window.__play.php.hp = 0; });
    const set = await pg.evaluate(() => window.__play.visMask.has(5));
    await pg.waitForFunction(() => { const m = window.__play.gameOver?.go.menu; return m && m.focus && m.focus.id === 3; }, null, { timeout: 120000 });
    await pg.waitForTimeout(300);
    await pg.keyboard.press('Space');
    await pg.waitForFunction(() => window.__play.restart.count === 1 && !window.__play.restart.pending, null, { timeout: 60000 });
    const after = await pg.evaluate(() => Array.from(window.__play.visMask.script));
    ok(noFire && set && after.every(x => x === 0), `Restart with no stage fire clears the script half (fire ${noFire ? 'off' : 'ON'}, bit 5 set ${set}, after ${after})`);
    ok(errs.length === 0, `restart page: no page errors (${errs.slice(0, 2).join(' | ')})`);
    await pg.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
