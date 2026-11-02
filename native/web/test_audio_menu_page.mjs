// Menu sounds and the pause's sound side on the real play.html, in a headless browser (worker 0194):
// Enter pauses (msj_008 at pan 0x40, SEs held, BGM volume 0x30), ↓ moves (msj_000 at pan 0x3d), ✕ on Tempsave opens the
// box (msj_003), ○ cancels it (msj_002), Enter resumes (msj_009; after the close: SEs released, BGM 0x7f).
// The menu sounds start real AudioBufferSources with the resident programs (flag byte 0x58 / 0x59).
//   node native/web/test_audio_menu_page.mjs   (needs playwright, data/pause.json, data/audio/se_res.json; else SKIP)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['data/pause.json', 'data/audio/se_res.json']) if (!fs.existsSync(path.join(here, f))) { console.log('SKIP: no ' + f); done(); }
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
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.pauseSound.audio && window.__play.pauseSound.audio.res, null, { timeout: 120000 });
  // spies on the sound side (they call through)
  await pg.evaluate(() => {
    const S = window.__play.pauseSound, au = S.audio; window.__log = [];
    const pm = au.playMenu.bind(au);
    au.playMenu = (n, x, y) => { const r = pm(n, x, y); window.__log.push(['menu', n, r.pan, au.playing.at(-1) && au.playing.at(-1).flags]); return r; };
    const sp = au.setPaused.bind(au);
    au.setPaused = on => { window.__log.push(['sePaused', !!on, window.__play.pause.flow.active]); return sp(on); };
    const wrapMu = mu => { const sv = mu.setVolume.bind(mu); mu.setVolume = v => { window.__log.push(['bgm', v]); return sv(v); }; };
    if (S.music) wrapMu(S.music); else window.__log.push(['no music']);
    // the scheduled BGM gain steps and every buffer start (offset) on the real AudioContext
    window.__sv = []; window.__starts = [];
    const sv = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (v, t) {
      const mu = S.music; if (mu && mu.gain && this === mu.gain.gain) window.__sv.push([v, t]); return sv.call(this, v, t);
    };
    const st = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (w, o) { window.__starts.push([this, o || 0]); return st.call(this, w, o); };
    au.setPaused = ((f) => on => { window.__log.push(['t', au.ctx.currentTime]); return f(on); })(au.setPaused);
    // a key the page doesn't use: the first gesture starts the music (play.js go)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F24' }));
  });
  const music = await pg.waitForFunction(() => { const m = window.__play.pauseSound.music; return m && m.src; }, null, { timeout: 120000 }).then(() => true, () => false);
  if (!music) console.log('  (no BGM stream started: gain checks skipped)');
  // a gunshot (bsj_051) playing when the pause comes
  await pg.evaluate(() => { const au = window.__play.pauseSound.audio; au.playName('bsj_051'); window.__shot = au.playing.at(-1); window.__shotT0 = au.ctx.currentTime; });
  await pg.waitForFunction(() => window.__play.pauseSound.audio.ctx.currentTime - window.__shotT0 > 0.25, null, { timeout: 20000 });
  const log = () => pg.evaluate(() => window.__log.slice());
  const until = fn => pg.waitForFunction(fn, null, { timeout: 20000 });
  const n = async () => (await log()).length;
  const press = async (k, cond) => { const k0 = await n(); await pg.keyboard.press(k); await until(new Function(`return window.__log.length > ${k0} && (${cond})`)); };
  await press('Enter', 'window.__log.some(e => e[0] === "menu")');
  await press('ArrowDown', 'window.__log.filter(e => e[0] === "menu").length >= 2');
  await press('Space', 'window.__play.pause.flow.box && window.__log.filter(e => e[0] === "menu").length >= 3');
  await until(() => { const f = window.__play.pause.flow; return f.box && f.box.cur === f.box.total; });
  await press('Backspace', 'window.__log.filter(e => e[0] === "menu").length >= 4');
  await until(() => !window.__play.pause.flow.box);
  await press('Enter', 'window.__log.filter(e => e[0] === "menu").length >= 5');
  await until(() => !window.__play.pause.active);
  await pg.waitForTimeout(200);
  const L = (await log()).filter(e => e[0] !== 'no music');
  const menus = L.filter(e => e[0] === 'menu');
  console.log('  log:', JSON.stringify(L));
  ok(JSON.stringify(menus.map(e => e[1])) === JSON.stringify(['msj_008', 'msj_000', 'msj_003', 'msj_002', 'msj_009']), 'menu sound names in order');
  ok(menus[0][2] === 0x40 && menus[1][2] === 61 && menus[2][2] === 0x40 && menus[4][2] === 0x40, 'pans 0x40 / 0x3d (pause button) / 0x40 / 0x40');
  ok([58, 68].includes(menus[3][2]), 'box ○ pans from a box button (0x3a / 0x44): ' + menus[3][2]);
  ok(menus.every(e => e[3] === 0x58 || e[3] === 0x59), 'each started a buffer of a resident menu program (flags 0x58 / 0x59)');
  const pz = L.filter(e => e[0] === 'sePaused').map(e => e[1]);
  ok(JSON.stringify(pz) === '[true,false]', 'SE hold on at the pause, off after the close: ' + JSON.stringify(pz));
  const iOn = L.findIndex(e => e[0] === 'sePaused' && e[1]), off = L.find(e => e[0] === 'sePaused' && !e[1]);
  // FUN_00241f40 runs at the screen's destruction (FUN_003dd9f8 -> FUN_003d5340 -> FUN_003d4630), after the close;
  // in the same frame it comes before FUN_003e1d90 (FUN_003dce38's order), so it may precede msj_009 on a slow frame
  ok(off && off[2] === false && L[iOn][2] === true, 'SE hold on with the screen, released once it is destroyed');
  const hasMusic = await pg.evaluate(() => !!window.__play.pauseSound.music);
  if (hasMusic) {
    const bg = L.filter(e => e[0] === 'bgm').map(e => e[1]);
    ok(JSON.stringify(bg) === '[48,127]', 'BGM volume 0x30 at the pause, 0x7f at the resume: ' + JSON.stringify(bg));
    ok(L.findIndex(e => e[0] === 'bgm') < iOn + 2, 'BGM drop sent with the pause');
  } else console.log('skip BGM volume (no music module)');
  ok(await pg.evaluate(() => window.__play.pauseSound.audio.sePaused === 0), 'audio not paused after the resume');
  // the gunshot: held at its offset at the pause, restarted (re-rendered with the hold) at that offset at the resume
  const shot = await pg.evaluate(() => {
    const p = window.__shot, ts = window.__log.filter(e => e[0] === 't').map(e => e[1]);
    const st = window.__starts.filter(([n]) => n.buffer === p.buf);
    return { dur: p.buf.duration, at: p.at, t0: window.__shotT0, ts, starts: st.map(([, o]) => o), rerenders: window.__play.pauseSound.audio.rerenders || 0 };
  });
  const heldOff = shot.ts[0] - shot.t0;
  ok(heldOff > 0 && heldOff < shot.dur, `gunshot still playing at the pause (${heldOff.toFixed(3)} s of ${shot.dur.toFixed(3)} s)`);
  // the restart is the last start of the SE's (possibly re-rendered: only when the hold lands in a decay) buffer
  ok(shot.starts.length >= 1 && Math.abs(shot.starts.at(-1) - heldOff) < 1e-6, `gunshot restarted at its offset (${shot.rerenders} re-render(s)): ` + JSON.stringify(shot.starts));
  ok(Math.abs(shot.at - (shot.ts[1] - heldOff)) < 1e-6, 'its clock continues from the resume');
  if (music) {
    const sv = await pg.evaluate(() => window.__sv.slice());
    const ts = shot.ts;
    const ramp = (t0) => sv.filter(([, t]) => t >= t0 - 1e-9 && t <= t0 + 20 / 240 + 1e-6);
    const down = ramp(ts[0]), up = ramp(ts[1]);
    // the IOP ramp (music.js BgmVolume): 0x7fff -> 0x30ff, then 0x30ff -> 0x7fff, 20 steps 1/240 s apart
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    ok(down.length === 21 && near(down[0][0], 0x7fff / 32768) && near(down[20][0], 0x30ff / 32768) && near(down[20][1] - down[0][1], 20 / 240),
      'BGM gain steps on the real context at the pause: ' + down.length + ' values, last ' + (down.at(-1) || [0])[0].toFixed(4));
    ok(up.length === 21 && near(up[0][0], 0x30ff / 32768) && near(up[20][0], 0x7fff / 32768), 'and back at the resume: last ' + (up.at(-1) || [0])[0].toFixed(4));
    ok(down.every(([v], i) => i === 0 || v < down[i - 1][0]), 'the drop steps down monotonically');
  }
  ok(errs.length === 0, 'no console / page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
