// test_kidnap_page.mjs -- the beast alley's abduction (worker 0276): played into from route state r04_east, as the game walk
// w217_r05_west does (pad replay from r04_east: beast_ev01 at stage flag 0 = 11, then trigger 163 at (-655.5, 241.7)).
// Trigger 163's script 216 event 0xd activates e_BeastB (record 8) and n_Child (record 112) and sends each cmd 0x19b 'kidnap'
// (motion class 0x42, FUN_0059e730: the clip's bone 1 carries the body's world path). T w276_beastpos (game, walked): the beast
// creeps from (-819, 483) to (-857, 465), waits, then runs off with the child to (-1043, -3, 417); the child's C+0x30 stays 0
// (she is drawn on the clip's world-space bones). Before the fix the page had no 'kidnap' clip (m001 0765078b / 076e070b not
// exported): both stood still at their placements ("the characters just stand there").
//   node native/web/test_kidnap_page.mjs   (playwright + data; network for the three.js CDN; sandbox off)
// MUTATE=noclip (e030's kidnap frame count dropped from ai.json model_clips) / noroot (no root drive) / noplay (0x19b skipped): each must fail.
// worker 0292: the toy (g001, record 151) and the child after her clip. MUTATE=notoy (g001 not in AI_TYPES: no actor) / noplace
// (FUN_00340c00's body placement left out of playClip): each must fail.
// PAGE AID (test only): the start is a warp entry added through the test's own route of warp.js, at route state r04_east's spot with
// its RAM's stage / global flags (tools/trace/out/route/r04_east.json); the camera is turned toward the next waypoint (FollowCamera.reset,
// as test_door_page's place()) and W walks him there. Waypoints: the game walk's positions (w276_beast, every 40 frames).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m, info = '') => { console.log((c ? 'ok   ' : 'FAIL ') + m + (info ? '  (' + info + ')' : '')); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const ai = JSON.parse(fs.readFileSync(path.join(here, 'data/enemies/ai.json'), 'utf8'));
if (!ai.model_clips || !ai.model_clips.e030 || !ai.model_clips.e030.kidnap) { console.log('FAIL data/enemies/ai.json has no e030 kidnap (rebuild: tools/byo/build_web.sh)'); fail++; done(); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// route state r04_east (walked, worker 0217): Vincent at (-727.75, -0.06, -36.93), pair (4, 5), stage flags {0: 4, 1: 7, 2: 4, 15: 1,
// 43-47: 1, 63: 1}, global {0: 1, 1: 7, 55: 4, 56: 7, 58: 1}
const WARP = `kidnap: { pos: [-727.75, -0.06, -36.93], face: [0, 1], pair: [4, 5], whole: true, stage: { 0: 4, 1: 7, 2: 4, 15: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 63: 1 }, global: { 0: 1, 1: 7, 55: 4, 56: 7, 58: 1 }, note: 'route state r04_east (test)' },`;
// T w276_beast: the game walk from r04_east (f190 .. f1100, every 40 frames); the first point takes him round the corner it starts at
const PATH = [[-660, 30], [-594, 95], [-573, 129], [-585, 166], [-619, 200], [-652, 234], [-719, 303], [-787, 370], [-823, 369], [-852, 390], [-877, 415]];
// T w276_beastpos: record 8's C+0x30 (x, z) at frames after trigger 163's event 0xd (f765): creep, wait, run, hold
const GAME = [[40, -824.0, 480.4], [100, -837.9, 473.9], [200, -856.7, 465.1], [240, -856.7, 465.1], [300, -918.4, 453.6], [360, -1032.6, 425.7], [400, -1043.1, 416.7]];
// T w292_toypos (the same walk; record frames - 765): the toy's C+0x30 (x, z) through its kidnap clip, then held (no script)
const TOY = [[35, -828.3, 476.91], [75, -838.11, 472.56], [115, -848.06, 468.05], [155, -856.49, 464.17], [195, -860.7, 458.63], [235, -862.39, 459.57], [275, -867.72, 458.0], [315, -869.93, 456.41], [430, -869.93, 456.41]];
const MUT = process.env.MUTATE;

const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('crash', () => errs.push('the renderer crashed'));
await pg.route('**/warp.js', async r => { const t = fs.readFileSync(path.join(here, 'warp.js'), 'utf8'); await r.fulfill({ contentType: 'text/javascript', body: t.replace('export const WARPS = {', 'export const WARPS = { ' + WARP) }); });
if (MUT === 'noclip') await pg.route('**/data/enemies/ai.json', async r => { const j = JSON.parse(JSON.stringify(ai)); delete j.model_clips.e030.kidnap; await r.fulfill({ contentType: 'application/json', body: JSON.stringify(j) }); });
const SUB = { noroot: ["if (m.phase === 1 && (C.f564 & 4) && C.mp && C.mp.clip === C.n640) rootDrive(a);", ''], noplay: ["case 0x19b: {", 'case 0x19b: { return 0;'],
  notoy: ["AI_TYPES.add('g001');", ''], noplace: ["if (C.mp && rootDrive(a) && walkCol) placeBody(a, 0);", ''] }[MUT];
if (SUB) await pg.route('**/enemy_ai.js', async r => { const t = fs.readFileSync(path.join(here, 'enemy_ai.js'), 'utf8'); if (!t.includes(SUB[0])) throw new Error('mutant does not apply'); await r.fulfill({ contentType: 'text/javascript', body: t.replace(SUB[0], SUB[1]) }); });
try {
  for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&sound=0&enemydmg=0&warp=kidnap`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.waitForFunction(() => window.__play && window.__play.warp && window.__play.stats.ticks > window.__play.warp.tick + 60, null, { timeout: 240000 });
  // every tick: trigger 163's event 0xd, and records 8 / 112 (position, motion class, clip, clip frame)
  await pg.evaluate(() => { const P = window.__play, A = P.enemyAI, t0 = A.tick, L = window.__k = { t163: null, s: [] };
    A.tick = (...a) => { const r = t0(...a), n = P.stats.ticks;
      if (L.t163 == null && A.events.some(e => /^event \S+ script 216 ev 13 /.test(e))) L.t163 = n;
      if (L.t163 != null && n - L.t163 <= 480) { const row = { d: n - L.t163 };
        for (const x of A.actors) if (x.rec === 8 || x.rec === 112 || x.rec === 151) row[x.rec] = { p: x.pos.slice(), cls: x.C.motion ? x.C.motion.cls : -1, clip: x.C.mp ? x.C.mp.clip : '', f: x.C.mp ? x.C.mp.frame : null };
        L.s.push(row); }
      return r; }; });
  // KIDNAP_SHOT=<png>: a screenshot at trigger 163 + 296 frames (the game's GS dump of T w276_beastpos f1061), Vincent stopped and
  // the camera turned toward the beast (the game's follow camera looks down the alley there)
  let shot = !process.env.KIDNAP_SHOT;
  const shoot = async () => {
    await pg.keyboard.up('KeyW');
    // PAGE AID (the picture only; the path checks don't read Vincent): he is put at the game's spot of that frame, (-868.06, 406.50) (T f1061)
    await pg.evaluate(() => { const P = window.__play, c = P.ctrl, b = P.enemyAI.actors.find(x => x.rec === 8);
      c.pos = { x: -868.06, y: -0.06, z: 406.5 }; c.locate(); c.prev = { ...c.pos };
      // worker 0292: toward the toy (record 151): the game's eye at the dump sits ~30 u to his right (save state CAM+0x90 (-839.5, -21.3,
      // 388.5)), where it sees the toy 21 deg right of centre; the page's follow camera is behind him, so it looks at the toy itself
      const t = P.enemyAI.actors.find(x => x.rec === 151) || b;
      if (t) P.follow.reset(c.pos, { yaw: Math.atan2(t.pos[0] - c.pos.x, t.pos[2] - c.pos.z), pitch: P.follow.pitch }); });
    await pg.waitForFunction(() => window.__play.stats.ticks >= window.__k.t163 + 296, null, { timeout: 60000, polling: 'raf' });
    await pg.screenshot({ path: process.env.KIDNAP_SHOT }); shot = true;
    console.log('screenshot at +' + await pg.evaluate(() => window.__play.stats.ticks - window.__k.t163) + ': ' + process.env.KIDNAP_SHOT);
    await pg.keyboard.down('KeyW'); };
  const go = async (tx, tz, tol = 8, maxMs = 60000) => { const t0 = Date.now(); await pg.keyboard.down('KeyW');
    while (Date.now() - t0 < maxMs) {
      if (!shot && await pg.evaluate(() => window.__k.t163 != null && window.__play.stats.ticks >= window.__k.t163 + 280)) await shoot();
      const s = await pg.evaluate(([tx, tz]) => { const P = window.__play, c = P.ctrl.pos, dx = tx - c.x, dz = tz - c.z, R = P.stage.rt;
        if (R.battle) P.follow.reset(c, { yaw: Math.atan2(dx, dz), pitch: P.follow.pitch }); return { d: Math.hypot(dx, dz), battle: R.battle }; }, [tx, tz]);
      if (s.d < tol) break;
      if (!s.battle) { await pg.keyboard.up('KeyW'); await pg.waitForTimeout(500); await pg.keyboard.down('KeyW'); }   // an event (beast_ev01): wait it out, as a player watching it
      await pg.waitForTimeout(100); }
    await pg.keyboard.up('KeyW'); return pg.evaluate(() => { const c = window.__play.ctrl.pos; return [c.x, c.z]; }); };
  for (const [x, z] of PATH.slice(0, 6)) await go(x, z);
  const ev1 = await pg.evaluate(() => { const P = window.__play, A = P.enemyAI; const on = r => [...A.objects.values()].some(o => o.rec === r && o.kind === 'actor'); return { f0: A.eventFlags[0], b8: on(8), c112: on(112) }; });
  ok(ev1.f0 === 11 && ev1.b8 && ev1.c112, 'beast_ev01 played on the way (stage flag 0 = 11), the beast and the child are up after it', JSON.stringify(ev1));
  for (const [x, z] of PATH.slice(6)) await go(x, z);
  if (!shot) { await pg.waitForFunction(() => window.__k.t163 != null && window.__play.stats.ticks >= window.__k.t163 + 280, null, { timeout: 120000, polling: 50 }); await shoot(); await pg.keyboard.up('KeyW'); }
  await pg.waitForFunction(() => window.__k.t163 != null && window.__play.stats.ticks - window.__k.t163 > 440, null, { timeout: 120000, polling: 200 });
  const k = await pg.evaluate(() => window.__k);
  ok(k.t163 != null, 'walking in fired trigger 163 (script 216 event 0xd)', `tick ${k.t163}`);
  const at = d => k.s.find(r => r.d === d) || {};
  const b = at(40)[8], c = at(40)[112];
  ok(b && b.cls === 0x42 && b.clip === 'kidnap', 'e_BeastB (record 8) plays kidnap in motion class 0x42', JSON.stringify(b));
  ok(c && c.cls === 0x42 && c.clip === 'kidnap', 'n_Child (record 112) plays kidnap in motion class 0x42', JSON.stringify(c));
  // T w276_beastpos: the child's C+0x30 stays (1.66e-6, 0, -4.8e-7) through the clip (her clip's root bone 1; she is drawn on the
  // clip's world-space bones), so the page's body must stay there too, not at her placement or on the beast's path. Only while the
  // clip plays (+40 .. +380); the hand-off after it is checked below (worker 0292)
  const CLIP_PTS = GAME.filter(([d]) => d < 399);
  let cw = 0, cwd = 0;
  for (const [d] of CLIP_PTS) { const q = (at(d)[112] || {}).p, e = q ? Math.hypot(q[0], q[1], q[2]) : Infinity; if (!(e <= cw)) { cw = e; cwd = d; } }
  ok(cw < 0.01, `n_Child (record 112) body at her clip's root (game C+0x30 ~0) at ${CLIP_PTS.length} points in the clip`, `largest ${cw.toFixed(4)} u at +${cwd}`);
  const fr = (r, d) => (at(d)[r] || {}).f;
  ok(fr(8, 300) > fr(8, 40) + 100 && fr(112, 300) > fr(112, 40) + 100, 'both clips run (frame at +40 / +300)', `8: ${fr(8, 40)} -> ${fr(8, 300)}, 112: ${fr(112, 40)} -> ${fr(112, 300)}`);
  // the beast against the game's path: +-1 frame of the trigger's tick (the page's walk and the game's reach the box at different
  // sub-frame points); the run moves ~2 u a frame, so the tolerance is that frame's step plus 1 u
  let worst = 0, wd = 0;
  for (const [d, gx, gz] of GAME) {
    const p = [d - 1, d, d + 1].map(e => (at(e)[8] || {}).p).filter(Boolean);
    const err = Math.min(...p.map(q => Math.hypot(q[0] - gx, q[2] - gz)));
    const step = p.length > 1 ? Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][2] - p[0][2]) / 2 : 0;
    if (!(err <= step + 1)) { ok(false, `e_BeastB at +${d}: the game's (${gx}, ${gz})`, p.length ? `page (${p[1] ? p[1][0].toFixed(1) : '?'}, ${p[1] ? p[1][2].toFixed(1) : '?'}), off ${err.toFixed(2)} u` : 'no sample'); }
    if (err > worst) { worst = err; wd = d; }
  }
  const moved = (at(400)[8] || {}).p, start = (at(1)[8] || {}).p;
  ok(moved && start && Math.hypot(moved[0] - start[0], moved[2] - start[2]) > 200, 'e_BeastB runs off with the child (more than 200 u from where the clip started)', moved ? `(${moved[0].toFixed(1)}, ${moved[2].toFixed(1)})` : '');
  ok(worst <= 3, `e_BeastB on the game's path (T w276_beastpos, ${GAME.length} points)`, `largest ${worst.toFixed(2)} u at +${wd}`);
  // worker 0292: after the clip. T w292_toypos: event 0x16 (script 153: 0x142(2), 0x40(19), 0x10e) puts her C+0x30 at locator 19 (record
  // +399; FUN_00588430), and the 'st' request next frame runs FUN_00340c00(C, 0): the body back on her kidnap clip's root (record +400 on:
  // (1.66e-6, 0, -4.8e-7)) until the rescue. The page has no one-frame locator (0x10e and the request in one tick): from +401 only
  let hw = 0, hd = -1;
  for (let d = 401; d <= 440; d++) { const q = (at(d)[112] || {}).p, e = q ? Math.hypot(q[0], q[1], q[2]) : Infinity; if (!(e <= hw)) { hw = e; hd = d; } }
  ok(hw < 0.01 && (at(430)[112] || {}).clip === 'st', "n_Child after her clip: FUN_00340c00 puts her body on the clip's root (game C+0x30 ~0 from +400), playing 'st'", `largest ${hw.toFixed(4)} u at +${hd}, clip ${(at(430)[112] || {}).clip}`);
  // the toy: an actor (stance 0x3b, no rows) that plays trigger 163's 'kidnap' in class 0x42, then lies where the clip ends
  const t = at(40)[151];
  ok(t && t.cls === 0x42 && t.clip === 'kidnap', 'o_nui (record 151, g001) plays kidnap in motion class 0x42', JSON.stringify(t));
  let tw = 0, twd = 0;
  for (const [d, gx, gz] of TOY) {
    const p = [d - 1, d, d + 1].map(e => (at(e)[151] || {}).p).filter(Boolean);
    const err = p.length ? Math.min(...p.map(q => Math.hypot(q[0] - gx, q[2] - gz))) : Infinity;
    const step = p.length > 1 ? Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][2] - p[0][2]) / 2 : 0;
    if (!(err <= step + 1)) ok(false, `o_nui at +${d}: the game's (${gx}, ${gz})`, p.length ? `page (${p[0][0].toFixed(1)}, ${p[0][2].toFixed(1)}), off ${err.toFixed(2)} u` : 'no sample');
    if (!(err <= tw)) { tw = err; twd = d; }
  }
  const drawn = await pg.evaluate(() => { const P = window.__play, d = P.enemies && P.enemies.actors.find(e => e.rec === 151); return d ? { visible: d.body.visible, clip: d.head && d.head.clip } : null; });
  ok(drawn && drawn.visible && drawn.clip === 'kidnap', 'o_nui is drawn (enemies.js, data/enemies/g001.glb) in its kidnap pose', JSON.stringify(drawn));
  ok(tw <= 3, `o_nui on the game's path and where it lies after (T w292_toypos, ${TOY.length} points)`, `largest ${tw.toFixed(2)} u at +${twd}`);
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
} catch (e) {
  ok(false, 'exception', e.message.split('\n')[0] + (errs.length ? '; ' + errs.slice(0, 3).join(' | ') : ''));
}
await browser.close(); srv.kill();
done();
