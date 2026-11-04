// test_door_page.mjs -- the door at chunk 06's (trigger 12, script 149; worker 0257) on the real page: shut, it stops the camera but not Vincent (door walls are MISSING: notes/fidelity-audit.md); ✕ facing it opens it (with manager short 78 set,
// as the key's script does), the door's vertices swing, the camera box with them, and he walks through.
//   flock tools/trace/out/.browser.lock node native/web/test_door_page.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fail = 0; const ok = (c, m, x = '') => { console.log((c ? 'ok   ' : 'FAIL ') + m + (x ? '  (' + x + ')' : '')); if (!c) fail++; };
const SHOT = process.env.DOOR_SHOT;
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&stage=0`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  const place = (x, z, h, yaw, pitch) => pg.evaluate(async ([x, z, h, yaw, pitch]) => { const P = window.__play, c = P.ctrl, feet = { x, y: 0, z }, wait = ms => new Promise(r => setTimeout(r, ms));
    P.light.stream.reset([5, 6]);
    const fr = P.col.findPoly(x, z, -7.5, 200);
    c.pos = { ...feet }; c.prev = { ...feet }; c.heading = c.prevHeading = h; c.C.face = { x: Math.sin(h), y: 0, z: Math.cos(h) }; if (c.body) c.body.poly = fr ? fr[0] : null;
    P.enemyAI.areaSwitch(13, true); if (P.enemyAI.mshort) P.enemyAI.mshort[78] = 1;
    P.follow.reset(c.pos, { yaw, pitch }); await wait(600); return { t: P.enemyAI.triggers[12].e0, s: P.light.stream.loaded(), poly: !!fr }; }, [x, z, h, yaw, pitch]);
  const st = () => pg.evaluate(() => { const P = window.__play, T = P.enemyAI.triggers[12], B = P.enemyAI && P.enemyAI.props ? null : null, c = P.ctrl.pos; return { e0: T.e0, z: c.z, x: c.x, dist: P.follow.dist, eye: P.follow.eye.slice() }; });
  const s0 = await place(-1328.3, 1134.1, 0, 0, -0.1);
  ok(s0.t === 0 && s0.poly, 'at the door, shut', JSON.stringify(s0));
  // MISSING: door walls (FUN_005451d0 -> FUN_0054c628; notes/fidelity-audit.md): W into the shut door doesn't stop at T's 1134.10. A short walk, as past the door ✕ on it didn't open here; back to the door for ✕
  await pg.keyboard.down('KeyW'); await pg.waitForTimeout(500); await pg.keyboard.up('KeyW');
  let s = await st();
  ok(s.e0 === 0 && s.z > 1134.2, `MISSING door wall: he walks past the game's stop at the shut door: z ${s.z.toFixed(2)} (T 1134.10)`);
  await place(-1328.3, 1134.1, 0, 0, -0.1);
  // the door's vertices before
  const vert = () => pg.evaluate(() => { const R = window.__play.root; for (const m of R.children) { const u = m.userData; if (!u.chunks) continue; const r = u.chunks.find(q => q[0] === 6 && q[5] === 1); if (r) { const a = m.geometry.attributes.position; const n = 0; return [a.getX(r[1]), a.getY(r[1]), a.getZ(r[1])]; } } return null; });
  const v0 = await vert();
  ok(!!v0 && Math.abs(v0[0] + 1320) < 30 && Math.abs(v0[2] - 1140) < 30, 'the door (chunk 6, node 1) is drawn at the door, not at its node\'s origin', JSON.stringify(v0));
  if (SHOT) await pg.screenshot({ path: SHOT + '_shut.png' });
  // ✕ facing it
  await pg.evaluate(() => { window.__t = []; const P = window.__play, T = P.enemyAI.triggers[12]; const f = () => { window.__t.push([P.stats.ticks, T.e0]); requestAnimationFrame(f); }; f(); });
  await pg.keyboard.press('Space');
  const opened = await pg.waitForFunction(() => window.__play.enemyAI.triggers[12].e0 === 1, null, { timeout: 15000, polling: 16 }).then(() => true, () => false);
  ok(opened, '✕ facing the door: it opens (state 2, then 1)');
  const seq = await pg.evaluate(() => { const o = []; for (const [t, e] of window.__t) if (!o.length || o[o.length - 1][1] !== e) o.push([t, e]); return o; });
  const a = seq.find(x => x[1] === 2), b = seq.find(x => x[1] === 1);
  ok(a && b && Math.abs(b[0] - a[0] - 13) <= 1, `state 2 -> 1 in ${a && b ? b[0] - a[0] : '?'} game frames (T 13)`, JSON.stringify(seq));
  const v1 = await vert();
  const moved = v0 && v1 && Math.hypot(v1[0] - v0[0], v1[2] - v0[2]);
  ok(moved > 3, `the door's vertices swung (${moved && moved.toFixed(2)} u)`, JSON.stringify(v1));
  // the camera's probe: the doorway is free, and the box follows
  const pr = await pg.evaluate(() => { const R = window.__play.follow.rays, h = R.probe6([-1328.5, -16, 1125], [-1328.5, -16, 1155]); return h ? h.point : null; });
  ok(!pr, 'the camera ray through the open doorway passes', JSON.stringify(pr));
  await pg.keyboard.down('KeyW'); await pg.waitForTimeout(2500); await pg.keyboard.up('KeyW');
  s = await st();
  ok(s.z > 1142, `he walks through: z ${s.z.toFixed(2)}`);
  ok(s.dist > 5, `behind him the camera isn't pulled to the door: distance ${s.dist.toFixed(2)} (the review: 0.3 with the box shut)`);
  if (SHOT) { await place(-1328.975, 1134.025, 0, 0.6053507924079895, -0.10331715643405914); await pg.waitForTimeout(800); await pg.screenshot({ path: SHOT + '_open.png' }); }   // w257_door2 f436's feet and view
  // manager cmd 0xab's map ray is probe 3's word (FUN_0054fc38: 0x187), not every triangle: a sweep around gate 150, where the two differ
  const sw = await pg.evaluate(() => { const P = window.__play, col = P.col, acc = col.probeFlags(0x187), V = (x, y, z) => ({ x, y, z }); let n = 0, wrong = 0, differ = 0;
    for (let i = 0; i < 36; i++) for (let k = 0; k < 31; k++) { const th = i * Math.PI / 18, c = [-1680 + 12 * k * Math.cos(th), -16, -407 + 12 * k * Math.sin(th)], e = [-1680 - 300 * Math.sin(th), -12, -407 + 300 * Math.cos(th)];
      const a = V(...c), b = V(...e), p3 = !!col.segment(a, b, acc), all = !!col.segment(a, b); n++; if (all !== p3) differ++; if (P.viewRay(c, e) !== p3) wrong++; }
    return { n, wrong, differ }; });
  ok(sw.differ > 0, `0xab's ray: the sweep has rays where probe 3 and every triangle differ (${sw.differ} of ${sw.n})`);
  ok(sw.wrong === 0, `0xab's ray answers as probe word 0x187 on every ray (${sw.wrong} of ${sw.n} wrong)`);
  ok(!errs.length, 'no page errors', errs.slice(0, 2).join(' | '));
} catch (e) { ok(false, 'page run', String(e).slice(0, 300)); } finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
