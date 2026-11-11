// Vincent's jump sounds on the real page (worker 0277; test_jump_sound.mjs has the rules). From the save's spot (where
// T w277_jump was recorded) Space (✕) jumps: on the take-off frame the floor's kind-2 step and cue 0x50 (bt_v010, 9 above his
// feet) go out, on the landing the kind-3 step (cue 0x51 is ''). T w277_jump: fsj_026 + bt_v010 at f11 (pan 65, vol 116 both),
// fsj_038 at f53 (pan 63, vol 116). A second ✕ in the air: bsj_520 + bt_v010.
//   flock tools/trace/out/.browser.lock node native/web/test_jump_sound_page.mjs   (needs data/audio + playwright; else SKIP)
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
for (const f of ['data/audio/ambient_z128.json', 'data/enemies/ai.json'])
  if (!existsSync(path.join(here, f))) { console.log(`SKIP: ${f} missing (tools/byo/build_web.sh)`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await wait(250); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.enemyAI, null, { timeout: 180000 });
  await pg.keyboard.press('KeyQ');                 // a gesture: the AudioContext (play.js au.resume)
  const sfxOn = await pg.waitForFunction(() => { const P = window.__play; return !!(P.amb && P.amb.sfx && P.amb.data && P.pauseSound.audio && P.pauseSound.audio.ctx); }, null, { timeout: 60000 }).then(() => true).catch(() => false);
  ok(sfxOn, 'sound loaded (data/audio)');
  await wait(1000);
  // record every request (FUN_0033cc48 on the page) with the controller's frame, and the sends (vol / pan)
  await pg.evaluate(() => {
    const P = window.__play, sfx = P.amb.sfx, play0 = sfx.play.bind(sfx);
    window.__req = [];
    sfx.play = (name, pos, range) => { window.__req.push({ name, f: P.ctrl.frames, pos: pos && pos.slice(), y: P.ctrl.pos.y, st: P.ctrl.P.state }); return play0(name, pos, range); };
    sfx.log = [];
  });
  const f0 = await pg.evaluate(() => window.__play.ctrl.frames);
  await pg.keyboard.down('Space'); await wait(120); await pg.keyboard.up('Space');
  await pg.waitForFunction(f => { const c = window.__play.ctrl; return c.frames > f + 90 && c.P.state === 2; }, f0, { timeout: 60000 }).catch(() => {});
  const r = await pg.evaluate(() => ({ req: window.__req.filter(e => !/^(fsj_0[0-1]\d|fsj_02[0-3])$/.test(e.name)), sent: window.__play.amb.sfx.log.slice(),
    ev: window.__play.ctrl.jump.events.filter(e => e.ev === 'jump' || e.ev === 'land').map(e => ({ ...e })) }));
  const jf = (r.ev.find(e => e.ev === 'jump') || {}).frame, lf = (r.ev.find(e => e.ev === 'land') || {}).frame;
  const at = f => r.req.filter(e => e.f === f).map(e => e.name);
  console.log(`  jump frame ${jf}, land frame ${lf}; requests ${JSON.stringify(r.req.map(e => [e.f, e.name]))}`);
  // the take-off: requests made in the motion update of the frame after the take-off (T: ✕ f10, phase 0 at f11)
  const take = r.req.filter(e => e.name === 'bt_v010');
  ok(take.length === 1, `one bt_v010 (cue 0x50) per jump (${take.length})`);
  const tf = take.length ? take[0].f : -1;
  ok(JSON.stringify(at(tf)) === '["fsj_026","bt_v010"]', `take-off frame ${tf}: ${at(tf)} (T w277_jump f11: fsj_026, bt_v010)`);
  ok(tf >= jf && tf <= jf + 1, `the take-off sounds on the jump's first motion update (jump event ${jf}, sounds ${tf})`);
  ok(take.length && Math.abs(take[0].pos[1] - (take[0].y - 9)) < 1e-3, `bt_v010 9 above his feet (y ${take.length && take[0].pos[1]}, feet ${take.length && take[0].y})`);
  const land = r.req.filter(e => e.f > tf && /^fsj_/.test(e.name));
  ok(land.length >= 1 && land[0].name === 'fsj_038', `landing: ${land.map(e => e.name)} (T w277_jump f53: fsj_038)`);
  ok(land.length >= 1 && lf != null && Math.abs(land[0].f - lf) <= 1, `on the landing class's first update (land event ${lf}, sound ${land.length && land[0].f})`);
  const vols = r.sent.filter(e => e.name === 'bt_v010' || e.name === 'fsj_026' || e.name === 'fsj_038');
  ok(JSON.stringify(vols.map(e => [e.id, e.vol, e.pan])) === '[[20026,116,65],[37008,116,65],[20038,116,63]]',
    `sent: ${JSON.stringify(vols)} (T w277_jump se_new: 20026 / 37008 vol 116 pan 65 at f12, 20038 vol 116 pan 63 at f54)`);
  ok(land.length && tf >= 0 && land[0].f - tf === 42, `take-off to landing sound: ${land.length && land[0].f - tf} frames (T: f11 -> f53 = 42)`);
  // a second jump: ✕ again in the air -> bsj_520 + bt_v010
  await pg.evaluate(() => { window.__req.length = 0; });
  const f1 = await pg.evaluate(() => window.__play.ctrl.frames);
  await pg.keyboard.down('Space'); await wait(120); await pg.keyboard.up('Space');
  await pg.waitForFunction(f => window.__play.ctrl.frames > f + 20, f1, { timeout: 30000 }).catch(() => {});
  await pg.keyboard.down('Space'); await wait(120); await pg.keyboard.up('Space');
  await pg.waitForFunction(f => { const c = window.__play.ctrl; return c.frames > f + 120 && c.P.state === 2; }, f1, { timeout: 60000 }).catch(() => {});
  const r2 = await pg.evaluate(() => window.__req.filter(e => /^(bsj_52|bt_v010)/.test(e.name)).map(e => e.name));
  ok(JSON.stringify(r2) === '["bt_v010","bsj_520","bt_v010"]', `jump + second jump: ${r2} (T w277_jump f121 / f141: bt_v010; bsj_520, bt_v010)`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.kill();
}
done();
