// test_context_loss_page.mjs -- worker 0264: what the page does when the browser takes its WebGL context (tab pressure, GPU reset, a laptop's GPU switch).
// three.js 0.169 has the handler (WebGLRenderer onContextLost: preventDefault, stops drawing; onContextRestore: new GL state, re-uploads). This checks it on
// play.html through WEBGL_lose_context, in the game: report.js logs the loss; no page error; game frames keep running while lost; after the restore the frame
// is drawn again (share of non-black pixels near what it was before, so the textures and render targets came back).
//   flock tools/trace/out/.browser.lock node native/web/test_context_loss_page.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.WEBDIR || here, OUT = process.env.LOSS_OUT || null;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
if (!existsSync(path.join(WEB, 'data/scene.json'))) { console.log('SKIP: no data'); process.exit(0); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: no playwright'); process.exit(0); }
const png = buf => { let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < buf.length) { const n = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8); if (t === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); ct = buf[o + 17]; } if (t === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + n)); o += 12 + n; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * bpp), st = w * bpp;
  for (let y = 0; y < h; y++) { const ft = raw[y * (st + 1)]; for (let x = 0; x < st; x++) { const a = x >= bpp ? out[y * st + x - bpp] : 0, b = y ? out[(y - 1) * st + x] : 0, c = x >= bpp && y ? out[(y - 1) * st + x - bpp] : 0; let v = raw[y * (st + 1) + 1 + x]; const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][ft]) & 255; out[y * st + x] = v; } }
  return { w, h, bpp, px: out }; };
const lit = ({ w, h, bpp, px }) => { let n = 0; for (let i = 0; i < w * h; i++) { const o = i * bpp; if (px[o] > 4 || px[o + 1] > 4 || px[o + 2] > 4) n++; } return n / (w * h); };
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 480, height: 360 } });
  const errs = [], warns = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /context|WebGL/i.test(m.text())) warns.push(m.text()); });
  for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?sound=0&intro=0`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 120, null, { timeout: 300000 });
  const shot = async n => { const b = await pg.screenshot(); if (OUT) writeFileSync(path.join(OUT, `loss_${n}.png`), b); return lit(png(b)); };
  const before = await shot('before');
  const tex0 = await pg.evaluate(() => window.__play.renderer.info.memory.textures);
  ok(before > 0.5, `drawn before the loss (${(before * 100).toFixed(0)}% lit, ${tex0} textures)`);
  await pg.evaluate(() => { const P = window.__play, gl = P.renderer.getContext(); window.__ev = []; const c = P.renderer.domElement;
    c.addEventListener('webglcontextlost', e => window.__ev.push(['lost', e.defaultPrevented])); c.addEventListener('webglcontextrestored', () => window.__ev.push(['restored']));
    window.__lc = gl.getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
  await pg.waitForFunction(() => window.__ev.length > 0, null, { timeout: 20000 }).catch(() => null);
  const t0 = await pg.evaluate(() => window.__play.stats.ticks);
  await pg.waitForTimeout(3000);
  const lost = await pg.evaluate(t0 => ({ ev: window.__ev, isLost: window.__play.renderer.getContext().isContextLost(), ticks: window.__play.stats.ticks - t0 }), t0);
  ok(lost.isLost && lost.ev.length > 0, `the context is lost (${JSON.stringify(lost.ev)})`);
  ok(lost.ev[0] && lost.ev[0][1] === true, 'the renderer prevents the default (so the browser may restore it)');
  ok(lost.ticks > 0, `the game keeps running while lost (${lost.ticks} ticks in 3 s)`);
  ok(errs.length === 0, `no page error while lost${errs.length ? ': ' + errs.slice(0, 2).join(' | ').slice(0, 300) : ''}`);
  await pg.evaluate(() => window.__lc.restoreContext());
  await pg.waitForFunction(() => window.__ev.some(e => e[0] === 'restored'), null, { timeout: 30000 }).catch(() => null);
  await pg.waitForTimeout(6000);
  const r = await pg.evaluate(t0 => ({ ev: window.__ev, isLost: window.__play.renderer.getContext().isContextLost(), tex: window.__play.renderer.info.memory.textures, ticks: window.__play.stats.ticks - t0 }), t0);
  const after = await shot('after');
  ok(r.ev.some(e => e[0] === 'restored') && !r.isLost, `restored (${JSON.stringify(r.ev)})`);
  ok(after > before * 0.7, `the frame is drawn again (${(after * 100).toFixed(0)}% lit, was ${(before * 100).toFixed(0)}%; ${r.tex} textures)`);
  ok(errs.length === 0, `no page error after the restore${errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 400) : ''}`);
  console.log(`  warnings: ${[...new Set(warns)].slice(0, 5).join(' / ').slice(0, 400)}`);
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
