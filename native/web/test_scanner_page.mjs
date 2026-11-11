// The scanner in the opening (worker 0275; Dan 2026-11-09: "the scanner overlay is still not there in the first cutscene; just
// Vincent pink"), on play.html with no URL options (a fresh load: the opening plays), as Dan plays it.
//   first_event pc: playseqstr_l(10, [0], [0], ["FEDEF_A0001_SCOPE01_IN_SCOPE01_IN"]) on p014 (Vincent's scanned body; its textures are
//   magenta in the game too) -> FUN_003a1ea8 -> FUN_0037fb88 (strid2numid FUN_002f5238: 0x80042000) -> FUN_0037f728: command 0x1d ->
//   FUN_00382cd8 -> FUN_00382b70 type 0 -> FUN_00375db8: FUN_002ed660 on DAT_004ee4a0 (FUN_002f0878); the FED a0001 from
//   Effect.load(1) (FUN_0037f2f0). Later setVisible_l(0, id, -1) (FUN_00379760 -> FUN_002ed828 mode 2) hides it under the black.
//   T: GS dumps tools/trace/out/w275b (start1704 + 920 + 120 / 200 / 280 / 360): the scope's camera-1 sprites (slot 0x11f), and at
//   f360 the event fade's full-screen strips drawn after them (the fade over the scanner).
//   flock tools/trace/out/.browser.lock node native/web/test_scanner_page.mjs   (needs playwright, data/event/fx/a0001.fed)
//   SCANNER_SHOT=<png> saves the scanner frame.
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
for (const f of ['data/event/ev0100_scr001.json', 'data/event/actors/actors.json', 'data/event/fx/a0001.fed'])
  if (!fs.existsSync(path.join(here, f))) { console.log('SKIP: no ' + f + ' (tools/byo/build_web.sh)'); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// the share of strongly blue pixels in the 4:3 picture (the scanner's lines and panels; p014 is magenta, the scene grey-brown)
const blueShare = (png) => Number(execSync(`python3 -I -c "from PIL import Image; im=Image.open('${png}').convert('RGB'); w,h=im.size; x0=(w-h*4//3)//2; px=[im.getpixel((x,y)) for x in range(max(0,x0),min(w,x0+h*4//3),3) for y in range(0,h,3)]; print(sum(1 for r,g,b in px if b>90 and b>r+50 and b>g+20)/len(px))"`, { encoding: 'utf8' }).trim());
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  const until = (fn, arg, t = 300000) => pg.waitForFunction(fn, arg, { timeout: t, polling: 20 });
  await until(() => window.__play && window.__play.intro && window.__play.intro.rt);
  // the sequence starts: first_event's playseqstr_l on actor 10 (command 0x1d)
  await until(() => window.__play.intro.rt.log.some(([, m]) => /^fxseq 10 FEDEF_A0001_SCOPE01_IN/.test(m)));
  const f0 = await pg.evaluate(() => window.__play.intro.rt.log.find(([, m]) => /^fxseq 10 /.test(m))[0]);
  await until(n => window.__play.intro.rt.frameNo >= n, f0 + 2);
  const a = await pg.evaluate(() => {
    const X = window.__play.intro.fx, ems = X && X.mgr ? X.mgr.emitters : [];
    const s = ems.find(e => (e.id >>> 0) === 0x80042000);
    return { has: !!X, ids: ems.map(e => (e.id >>> 0).toString(16)), cat: s ? s.cat : null, f0a: s ? s.f0a : null };
  });
  ok(a.has, 'the opening has its event effects (event_fx.js)');
  ok(a.ids.includes('80042000') && a.cat === 1, `SCOPE01_IN (strid2numid -> 0x80042000) spawned on DAT_004ee4a0, a camera-1 emitter: [${a.ids.join(' ')}] cat ${a.cat}`);
  // fully up (the game's w275b frames show it steady): drawn by the layer, and blue over the picture
  await until(n => window.__play.intro.rt.frameNo >= n, f0 + 150);
  const b = await pg.evaluate(() => {
    const X = window.__play.intro.fx, L = window.__play.intro.fxLayer;
    return { sprites: X.title.sprites().length, meshes: L.group.children.filter(m => m.visible && m.isMesh).length, ro: L.group.renderOrder, fade: window.__play.intro.rt.fade ? window.__play.intro.rt.fade.level : 0 };
  });
  ok(b.sprites > 50 && b.meshes > 0, `the scanner draws: ${b.sprites} sprites, ${b.meshes} meshes in the event-effects layer`);
  const shot = process.env.SCANNER_SHOT || path.join(process.env.TMPDIR || '/tmp', 'w275_scanner_' + process.pid + '.png');
  await pg.screenshot({ path: shot });
  const blue = blueShare(shot);
  if (!process.env.SCANNER_SHOT) fs.unlinkSync(shot);
  // without the scanner (p014 over the stairs) the share is 0.000; the game's w275b f200 frame: 0.52 (its full-screen blue tint and
  // bars are particles the page doesn't draw yet: channel types 26 / 111 / 121, render category 255, type 21 shape 8; MISSING row)
  ok(blue > 0.03, `the scanner's panels, ring and lines over the picture (blue share ${blue.toFixed(3)})`);
  console.log(`KNOWN DIFF: blue share ${blue.toFixed(3)} against the game's 0.52 at w275b f200 (the tint and bars not drawn)`);
  // the event fade (fadeout 2000 at the shot's end) is drawn over the scanner (w275b f360: the fade strips after the sprites):
  // half way into it, the blue is dimmed
  await until(() => { const r = window.__play.intro.rt; return r.fade && r.fade.level >= 150 && r.log.some(([, m]) => m === 'fadeout 2000'); });
  const shot2 = path.join(process.env.TMPDIR || '/tmp', 'w275_scanner_fade_' + process.pid + '.png');
  await pg.screenshot({ path: shot2 });
  const blue2 = blueShare(shot2); fs.unlinkSync(shot2);
  ok(blue2 < blue * 0.5, `the event fade is drawn over the scanner: blue share ${blue2.toFixed(3)} at fade level >= 150 (was ${blue.toFixed(3)})`);
  // setVisible_l(0, 0x80042000, -1) after the black (FUN_00379760 -> FUN_002ed828 mode 2 -> FUN_002ebee8: +0x0a bit 2): not drawn
  await until(() => window.__play.intro.rt.log.some(([, m]) => m === 'fxvis 0 80042000'));
  const fv = await pg.evaluate(() => window.__play.intro.rt.frameNo);
  await until(n => window.__play.intro.rt.frameNo >= n, fv + 2);
  const c = await pg.evaluate(() => {
    const X = window.__play.intro.fx, s = X.mgr.emitters.find(e => (e.id >>> 0) === 0x80042000);
    return { f0a: s ? s.f0a : null, drawn: X.title.sprites().filter(p => p.em ? (p.em.id >>> 0) === 0x80042000 : false).length, total: X.title.sprites().length };
  });
  ok(c.f0a !== null && (c.f0a & 4) && c.total === 0, `hidden by setVisible_l(0): +0x0a 0x${(c.f0a ?? 0).toString(16)}, ${c.total} sprites drawn`);
  const bad = errs.filter(e => !/favicon|404/.test(e));
  ok(bad.length === 0, 'no page errors' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
