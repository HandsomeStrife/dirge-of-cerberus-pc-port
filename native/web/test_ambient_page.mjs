// Placed sounds and footsteps on the real page (worker 0215; notes/audio-research.md "Placed sounds", "Footsteps"), in a
// headless browser with the default options:
//   1. at the start Vincent stands inside section-22 records 2 / 3 (asj_031 / asj_030, as in the save: DAT_004f5920
//      holds both): both slots are open and streaming (ambient.js SlotStreams -> music.js SeStream) after the first frames;
//   2. walking (W) then running (W + Shift) on the start deck (floor material 3): footsteps fsj_002 / fsj_014 at the foot
//      markers' crossings (FUN_005ae828) with the game's spacing (T: w215_ambfoot walk 34-35 frames, w215_routeA run
//      16-18 frames between steps), each a request at range 400 with pan 0x40 (the MP's slot, flag 0x8000);
//   3. the placed sounds' volume / pan follow the listener: request 0x11 updates reach the streams (SeRenderer.update).
//   node native/web/test_ambient_page.mjs     (needs data/audio + playwright; else SKIP, exit 0). Sandbox off (CDN).
// Serves native/web with python3 http.server on a free port. three.js comes from the CDN (play.html importmap).
// PLAY_HTML=<file> (in native/web) loads another page copy (mutation runs).
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

for (const f of ['data/audio/ambient_z128.json', 'data/audio/se_z128.json', 'data/audio/wave0000.bin'])
  if (!existsSync(path.join(here, f))) { console.log(`SKIP: ${f} missing (tools/byo/build_web.sh)`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /ambient|audio/.test(m.text())) console.log('     warn:', m.text().slice(0, 200)); });
  pg.on('pageerror', e => errs.push(e.message));
  // play.js imports some modules optionally (`.then(.., () => null)`: other workers' stage_controller parts); a 404 on those
  // is not this test's business. Any other 404 stays an error.
  const OPTIONAL = new Set(['/game_state.js', '/stage_info.js']);
  let opt404 = 0;
  pg.on('response', r => { if (r.status() !== 404) return; const u = r.url().replace(/^http:..[^/]+/, ''); if (OPTIONAL.has(u)) opt404++; else errs.push('404 ' + u); console.log('     404:', u); });
  const page = process.env.PLAY_HTML || 'play.html';
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/${page}?intro=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.mouse.click(480, 270);                          // the gesture that starts the AudioContext (play.js)
  await pg.waitForFunction(() => { const P = window.__play, a = P.pauseSound.audio; return a && a.ctx && P.amb && P.amb.placed && P.amb.sfx; }, null, { timeout: 60000 });

  // the streams start on the first frame after the AudioContext exists (SlotStreams.update)
  await pg.waitForFunction(() => { const sl = [...window.__play.amb.slots.slots.values()]; return sl.length >= 2 && sl.every(s => s.stream); }, null, { timeout: 20000 }).catch(() => {});
  // hooks: footstep requests (SoundEmitters.play from Footsteps) with the frame, the sent vol / pan, the slot requests
  await pg.evaluate(() => {
    const P = window.__play, A = P.amb; P.sfx = A.sfx;
    window.__t = { steps: [], sent: [], ys: [], upd: [] };
    const play = P.sfx.play.bind(P.sfx);
    P.sfx.play = (n, pos, r) => { const s = play(n, pos, r); if (/^fsj_/.test(n)) window.__t.steps.push({ n, tick: P.stats.ticks, slot: s }); return s; };
    const fr = A.foot.frame.bind(A.foot);
    A.foot.frame = (ys, pos) => { window.__t.ys.push(ys.slice()); return fr(ys, pos); };
    A.slots.log = window.__t.upd;
    window.__t.rdUpd = 0;                                    // SeRenderer.update calls on the live streams
    for (const sl of A.slots.slots.values()) if (sl.stream) { const u = sl.stream.rd.update.bind(sl.stream.rd); sl.stream.rd.update = (...a) => { window.__t.rdUpd++; return u(...a); }; }
    P.sfx.log = window.__t.sent;
  });
  const startSlots = await pg.evaluate(() => [...window.__play.amb.slots.slots.values()].map(s => ({ name: s.name, sent: s.sent, stream: !!s.stream })));
  const names = startSlots.map(s => s.name).sort();
  ok(names.join() === 'asj_030,asj_031', `start: the placed sounds of records 2 / 3 are open (${names.join(', ')})`);
  ok(startSlots.every(s => s.sent && s.stream), 'start: both sent (request 2) and streaming (SeStream)');

  const hold = async (keys, ms) => { for (const k of keys) await pg.keyboard.down(k); await pg.waitForTimeout(ms); for (const k of keys) await pg.keyboard.up(k); };
  await hold(['KeyW'], 4000);
  const walk = await pg.evaluate(() => { const t = window.__t; const r = { steps: t.steps.map(s => ({ n: s.n, tick: s.tick })), ys: t.ys.slice() }; t.steps.length = 0; t.ys.length = 0; return r; });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => { window.__t.steps.length = 0; });
  await hold(['KeyS', 'ShiftLeft'], 3000);
  const run = await pg.evaluate(() => ({ steps: window.__t.steps.map(s => ({ n: s.n, tick: s.tick })), sent: window.__t.sent.filter(s => /^fsj_/.test(s.name)), upd: window.__t.upd.slice() }));

  const gaps = (st) => st.slice(1).map((s, i) => s.tick - st[i].tick);
  const wn = [...new Set(walk.steps.map(s => s.n))], rn = [...new Set(run.steps.map(s => s.n))];
  console.log('     walk steps', walk.steps.length, wn.join(), 'gaps', gaps(walk.steps).join(' '));
  console.log('     run steps', run.steps.length, rn.join(), 'gaps', gaps(run.steps).join(' '));
  const ys = walk.ys.flat();
  console.log('     foot marker y on the walk', Math.min(...ys).toFixed(2), '..', Math.max(...ys).toFixed(2), '(trace w215_ambfoot walk f40-105: -3.68 .. -1.64)');
  ok(walk.steps.length >= 3 && wn.includes('fsj_002'), 'walk: footsteps fsj_002 (material 3 -> row 2, kind 0)');
  ok(run.steps.length >= 4 && rn.includes('fsj_014'), 'run: footsteps fsj_014 (kind 1: row 16 + 2)');
  // steady-state spacing (drop the first gap: the start / the change of clip)
  const steady = (g, lo, hi) => g.slice(1).filter(x => x >= lo && x <= hi).length >= Math.max(1, g.length - 2);
  ok(steady(gaps(walk.steps), 33, 36), 'walk: a step every 34-35 frames (T: w215_ambfoot 35 / 34 / 34)');
  const rg = gaps(run.steps.filter(s => s.n === 'fsj_014')).slice(1, -1);
  ok(rg.length >= 4 && rg.filter(x => x >= 16 && x <= 18).length >= rg.length - 1, 'run: a step every 16 / 18 frames (T: w215_routeA 18 16 18 16 ...)');
  ok(Math.min(...ys) < -2.2 && Math.max(...ys) > -2.2, 'the foot markers cross the mk2 threshold -2.2 (model space, y down)');
  ok(run.sent.length > 0 && run.sent.every(s => s.pan === 0x40 && s.vol >= 100), `footstep requests: pan 0x40, near-full volume (${run.sent.slice(0, 3).map(s => s.vol + '/' + s.pan).join(' ')})`);
  const upd = run.upd.filter(u => u.code === 0x11);
  ok(upd.length > 5 && new Set(upd.map(u => u.vol)).size > 1, `placed sounds: request 0x11 updates while moving (${upd.length}, vol ${[...new Set(upd.map(u => u.vol))].slice(0, 8).join(' ')})`);
  const rdUpd = await pg.evaluate(() => window.__t.rdUpd);
  ok(rdUpd > 5, `the updates reach the streams (SeRenderer.update, IOP command 0x30): ${rdUpd}`);
  { const e = errs.filter(x => !(opt404 && /^Failed to load resource: .* 404/.test(x)));
    ok(e.length === 0, 'no page errors' + (e.length ? ': ' + e.slice(0, 3).join(' | ') : '')); }

  // 4. the ladder (l_ladder_cam's route ends there; the page's ?ladder=0 warp instead of walking it): record 28's asj_039
  //    (follows record 105 n017, active in the save: play.js AMB_SAVE_ACTIVE GUESS) starts, as in w215_routeA f170
  await pg.goto(`http://127.0.0.1:${port}/${page}?intro=0&ladder=0`, { waitUntil: 'load' });
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.mouse.click(480, 270);
  const lad = await pg.waitForFunction(() => { const A = window.__play.amb; if (!A || !A.slots) return false;
    const sl = [...A.slots.slots.values()].find(s => s.name === 'asj_039'); return sl && sl.stream ? { vol: sl.vol, pan: sl.pan } : false; }, null, { timeout: 30000 })
    .then(h => h.jsonValue()).catch(() => null);
  const pos = await pg.evaluate(() => { const c = window.__play.ctrl.pos; return [c.x, c.y, c.z].map(v => Math.round(v)); });
  ok(!!lad, `ladder 0 at ${pos.join(', ')}: asj_039 (section 22 record 28) plays` + (lad ? ` (vol ${lad.vol}, pan ${lad.pan})` : ''));
} catch (e) { ok(false, String(e)); } finally {
  await browser.close();
  srv.kill();
}
done();
