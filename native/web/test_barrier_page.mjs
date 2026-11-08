// test_barrier_page.mjs -- worker 0269: an EM barrier on the real page (gate 1's records 56 / 57, chunk 03; props.js class 8,
// obj_contact.js). Vincent walks into barrier 56 and stops in front of its face (FUN_0035a440's object pass; T r03_mid2 rests
// at z -355.67, within one step of it); its base model (g048) is drawn; once the gate's command 0x18e has switched it off
// (state 2, then code -5 after 36 ticks: state 0) he walks through.
//   flock tools/trace/out/.browser.lock node native/web/test_barrier_page.mjs      (BARRIER_SHOT=/path/prefix for pictures)
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
const SHOT = process.env.BARRIER_SHOT;
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&stage=0`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  // as test_door_page: the feet, the walk polygon, the chunks (route state r03_mid2: pair 3 / 4), the barriers' area 1
  const place = (x, z, h, yaw, pitch) => pg.evaluate(async ([x, z, h, yaw, pitch]) => { const P = window.__play, c = P.ctrl, feet = { x, y: -0.064, z }, wait = ms => new Promise(r => setTimeout(r, ms));
    P.light.stream.reset([3, 4]);
    const fr = P.col.findPoly(x, z, -7.5, 200);
    c.pos = { ...feet }; c.prev = { ...feet }; c.heading = c.prevHeading = h; c.C.face = { x: Math.sin(h), y: 0, z: Math.cos(h) }; if (c.body) c.body.poly = fr ? fr[0] : null;
    window.__props.areaSwitch(1, true);
    P.follow.reset(c.pos, { yaw, pitch }); await wait(800); return { poly: !!fr }; }, [x, z, h, yaw, pitch]);
  const st = () => pg.evaluate(() => { const P = window.__play, o = window.__props.barrels.find(b => b.rec === 56), m = window.__propsView && window.__propsView.meshes.get(o); return { z: P.ctrl.pos.z, x: P.ctrl.pos.x, st: o.st, on: !!(o.flags28 & 1), drawn: !!(m && m.visible), walls: window.__props.blockers().map(b => b.id) }; });
  const s0 = await place(-1752, -364, 0, 0, -0.1);
  let s = await st();
  ok(s0.poly && s.on && s.st === 1 && s.walls.includes('p56'), 'barrier 56 is on and a wall', JSON.stringify(s));
  await pg.waitForFunction(() => { const o = window.__props.barrels.find(b => b.rec === 56), m = window.__propsView.meshes.get(o); return m && m.visible; }, null, { timeout: 20000 }).catch(() => {});
  s = await st();
  ok(s.drawn, 'its base (g048) is drawn');
  // its beams: FUN_0054f660's four emitters per record from g048's FED (effects.js attachMatrix; test_barrier_fx = the dumps), drawn as type 11 models
  const bm = await pg.evaluate(() => { const fx = window.__fx && window.__fx.fx; if (!fx) return null; const ems = fx.emitters.filter(e => e.F.code === 0x90c00000);
    return { ems: ems.length, held: ems.filter(e => e.flags & 4).length }; });
  ok(bm && bm.ems === 8 && bm.held === 8, `the 8 beam emitters of 56 / 57 run, attached and held (${JSON.stringify(bm)})`);
  await pg.keyboard.down('KeyW'); await pg.waitForTimeout(3000);
  s = await st();
  if (SHOT) await pg.screenshot({ path: SHOT + '_on.png' });
  await pg.keyboard.up('KeyW');
  ok(s.z <= -355.66 && s.z > -355.67 - 1.19, `W into it: he stops in front of its face, z ${s.z.toFixed(3)} (face - r = -355.67)`);
  // the gate's 0x18e (script 202 event 0x11 with the card; test_barrier / test_gate_key run the script itself)
  await pg.evaluate(() => { const p = window.__props; for (const k of [56, 57]) p.cmd(p.barrels.find(b => b.rec === k), 0x18e, []); });
  s = await st();
  ok(s.st === 2 && s.walls.includes('p56'), '0x18e: state 2, still a wall', JSON.stringify(s));
  await pg.waitForFunction(() => window.__props.barrels.find(b => b.rec === 56).st === 0, null, { timeout: 10000 }).catch(() => {});
  s = await st();
  ok(s.st === 0 && !s.walls.includes('p56'), 'code -5: state 0, no wall', JSON.stringify(s));
  const gone = await pg.evaluate(() => window.__fx.fx.emitters.filter(e => e.F.code === 0x90c00000).length);
  ok(gone === 0, `the beams soft-ended and went (FUN_0054f7b8(o, 0) -> FUN_002e7198): ${gone} left`);
  await pg.keyboard.down('KeyW'); await pg.waitForTimeout(2500); await pg.keyboard.up('KeyW');
  s = await st();
  ok(s.z > -350, `W: he walks through, z ${s.z.toFixed(2)}`);
  if (SHOT) await pg.screenshot({ path: SHOT + '_off.png' });
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
