// test_play_c_page.mjs -- the C build in a headless browser (native migration plan step 0; docs/NATIVE.md):
//   1. play_c.html?smoke=300: WebGL2 context, the shared GLSL subset compiles, data/pause.json arrives through
//      fs_load (fetch), 300 ticks run and print "SMOKE OK hash ..."; the hash equals the Linux build's (same ticks,
//      same floats: native/build/linux/game/dirge, if built);
//   2. play_c.html: ticks follow the clock at the default 50 Hz (frame_clock.c), and ?tick_hz=60 runs 60 a second;
//   3. holding Space on the canvas reaches the engine as the pad's Cross (platform_sdl.c -> engine/core/input.c).
//   flock tools/trace/out/.browser.lock node native/web/test_play_c_page.mjs   (sandbox off; needs the wasm build,
//   data/pause.json and playwright, else SKIP, exit 0). DIRGE_WASM_DIR=<dir with dirge.mjs/.wasm> tests another build.
import { existsSync, mkdtempSync, symlinkSync, copyFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync, execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };

const wasmDir = process.env.DIRGE_WASM_DIR ? path.resolve(process.env.DIRGE_WASM_DIR) : path.join(here, 'wasm');
if (!existsSync(path.join(wasmDir, 'dirge.mjs'))) { console.log('SKIP: no wasm build (docs/NATIVE.md)'); done(); }
if (!existsSync(path.join(here, 'data/pause.json'))) { console.log('SKIP: data/pause.json missing (tools/byo/build_web.sh)'); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

// serve a small root: play_c.html, the wasm build, and data/ linked (python's http.server follows links)
const root = mkdtempSync(path.join(os.tmpdir(), 'play_c_'));
copyFileSync(path.join(here, 'play_c.html'), path.join(root, 'play_c.html'));
symlinkSync(wasmDir, path.join(root, 'wasm'));
symlinkSync(path.join(here, 'data'), path.join(root, 'data'));

// the Linux build's hash for the same run, when built
let linuxHash = null;
const linux = path.join(here, '../build/linux/game/dirge');
if (existsSync(linux)) {
  const o = execFileSync(linux, ['--data', path.join(here, 'data'), '--smoke', '300', '--hidden', '--no-audio'],
    { encoding: 'utf8', env: { ...process.env, SDL_VIDEODRIVER: 'offscreen' } });
  linuxHash = /SMOKE OK hash ([0-9a-f]+)/.exec(o)?.[1] ?? null;
}

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const url = q => `http://127.0.0.1:${port}/play_c.html${q}`;
try {
  await new Promise(r => setTimeout(r, 400));   // http.server up
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // 1. smoke
  await pg.goto(url('?smoke=300'));
  await pg.waitForFunction(() => window.__dirge?.lines.some(l => /SMOKE (OK|FAIL)/.test(l)), null, { timeout: 30000 });
  const lines = await pg.evaluate(() => window.__dirge.lines);
  for (const l of lines) console.log('     ' + l);
  ok(lines.some(l => /^dirge: GL OpenGL ES 3\.0 \(WebGL 2\.0/.test(l)), 'WebGL2 context');
  ok(lines.some(l => /shared GLSL subset compiles/.test(l)), 'shared GLSL subset compiles as #version 300 es');
  ok(lines.some(l => /data pause\.json \d+ bytes/.test(l)), 'data/pause.json loaded through fs_load (fetch)');
  const h = /SMOKE OK hash ([0-9a-f]+)/.exec(lines.join('\n'))?.[1];
  ok(!!h, `smoke: 300 ticks, hash ${h}`);
  if (linuxHash) ok(h === linuxHash, `hash equals the Linux build's (${linuxHash})`);
  else console.log('     (Linux build not found: hash not compared)');

  // 2. ticks follow the clock: 50 Hz default, 60 Hz as a parameter
  for (const [q, hz] of [['', 50], ['?tick_hz=60', 60]]) {
    await pg.goto(url(q));
    await pg.waitForFunction(() => window.__dirge?.ready && window.__dirge.M._dirge_ticks() > 5, null, { timeout: 20000 });
    const a = await pg.evaluate(() => [window.__dirge.M._dirge_ticks(), performance.now()]);
    await pg.waitForTimeout(2000);
    const b = await pg.evaluate(() => [window.__dirge.M._dirge_ticks(), performance.now(), window.__dirge.M._dirge_tick_hz()]);
    const rate = (b[0] - a[0]) / ((b[1] - a[1]) / 1000);
    ok(b[2] === hz && Math.abs(rate - hz) < hz * 0.1, `tick_hz ${b[2]}: ${rate.toFixed(1)} ticks/s (want ${hz})`);
  }

  // 3. a key reaches the engine's pad: Space = Cross (1 << 14), released again
  await pg.click('#canvas');
  await pg.keyboard.down('Space');
  await pg.waitForTimeout(200);
  const held = await pg.evaluate(() => window.__dirge.M._dirge_pad_held(0));
  await pg.keyboard.up('Space');
  await pg.waitForTimeout(200);
  const after = await pg.evaluate(() => window.__dirge.M._dirge_pad_held(0));
  ok(held === 1 << 14 && after === 0, `Space -> pad Cross held ${held.toString(16)}, released ${after.toString(16)}`);

  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.kill();
  rmSync(root, { recursive: true, force: true });
}
done();
