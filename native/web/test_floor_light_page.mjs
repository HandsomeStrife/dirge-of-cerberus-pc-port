// test_floor_light_page.mjs -- Vincent's light 0 / ambient scale follows the walk polygon he stands on (worker 0260; FUN_00340e08 -> FUN_005ae1f0, floor_shade.js).
// Places him (test aid, as test_market_cam_page) where the route states read MP+0x450 = 90 / 98 / 122 in RAM, lets the page run, and reads the uniforms the draw uses.
// Run: flock tools/trace/out/.browser.lock node native/web/test_floor_light_page.mjs      (WEBDIR: another copy, for mutants)
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
if (!existsSync(path.join(WEB, 'data/z128_walk_shade.bin'))) { console.log('SKIP: no data/z128_walk_shade.bin'); process.exit(0); }
const { chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright');
const CASES = [['r03_alcove', -1872.1835, -0.0636, -376.2135, 90, [2, 3]], ['r05_back', -1068.9878, -0.0637, 437.7289, 98, [4, 5]], ['r03_start', -1033.2726, -0.0636, -589.5958, 122, [2, 3]]];
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  for (let k = 0; ; k++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&enemydmg=0&sound=0`, { waitUntil: 'load' }); break; } catch (e) { if (k > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.waitForFunction(() => typeof window.__rayCast === 'function' && window.__play && window.__play.stats.ticks > 5, null, { timeout: 400000 });
  for (const [name, x, y, z, want, pair] of CASES) {
    const got = await pg.evaluate(async ({ x, y, z, pair }) => {
      const P = window.__play, c = P.ctrl, feet = { x, y, z }, fr = P.col.findPoly(x, z, y - 7.5, y + 200);
      c.pos = { ...feet }; c.prev = { ...feet };
      if (c.body) c.body.poly = fr ? fr[0] : null;
      P.light.stream.reset(pair);
      const t0 = P.stats.ticks;
      while (P.stats.ticks < t0 + 6) await new Promise(r => setTimeout(r, 50));
      const U = P.light.U, env = P.light.env;
      return { byte: P.light.scaleByte(), c0: U.uC0.value.x / env.col0[0], amb: U.uAmb.value.x / env.ambient[0], poly: !!fr };
    }, { x, y, z, pair });
    ok(got.poly, `${name}: a walk polygon under him`);
    ok(got.byte === want, `${name}: MP+0x450 ${got.byte} = RAM ${want}`);
    ok(Math.abs(got.c0 - want / 128) < 1e-4 && Math.abs(got.amb - want / 128) < 1e-4, `${name}: light 0 and ambient x ${want} / 128 (${got.c0.toFixed(4)}, ${got.amb.toFixed(4)})`);
  }
  // a bad sidecar (test aid: a 200 HTML page's worth of bytes): warned, the byte kept, Vincent still lit
  {
    const pg2 = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const warn = [];
    pg2.on('console', m => { if (/floor shade off/.test(m.text())) warn.push(m.text()); });
    await pg2.route('**/data/z128_walk_shade.bin', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html>not found</html>' }));
    await pg2.goto(`http://127.0.0.1:${port}/play.html?intro=0&enemydmg=0&sound=0`, { waitUntil: 'load' });
    await pg2.waitForFunction(() => typeof window.__rayCast === 'function' && window.__play && window.__play.stats.ticks > 10, null, { timeout: 400000 });
    const g = await pg2.evaluate(async () => { const P = window.__play, U = P.light.U; await new Promise(r => setTimeout(r, 300)); return { byte: P.light.scaleByte(), c0: U.uC0.value.x, env: P.light.env.col0[0] }; });
    ok(warn.length >= 1, `bad sidecar warned (${warn[0] || 'nothing'})`);
    ok(g.byte === 122 && Math.abs(g.c0 / g.env - 122 / 128) < 1e-4, `bad sidecar: MP+0x450 stays 122, light 0 x ${(g.c0 / g.env).toFixed(4)}`);
    await pg2.close();
  }
  ok(errs.length === 0, `no page errors ${errs.slice(0, 2).join(' | ')}`);
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
