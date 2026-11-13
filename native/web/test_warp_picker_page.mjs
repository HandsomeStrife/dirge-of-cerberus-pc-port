// test_warp_picker_page.mjs -- the warp picker on play.html (PAGE AID, worker 0279; warp.js warpOptions / warpUrl). A user picks a place
// in the #warp-pick control: the page reloads with ?warp=<name>, keeps its other options, and the warp runs. The control lists every
// WARPS entry with a label, and never keeps the keyboard: out of the Tab order, it blurs when its popup closes (even on the same row),
// and a real key reaching it can't type-ahead to a place; the key goes on to the game.
//   node native/web/test_warp_picker_page.mjs     (needs playwright)
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
for (const f of ['data/z128_collision.bin', 'data/vincent/light.json', 'data/event/ev0100_stage.json', 'data/enemies/ai.json'])
  if (!existsSync(path.join(here, f))) { console.log(`SKIP: ${f} missing (tools/byo/build_web.sh)`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }
const { WARPS, warpUrl } = await import('./warp.js');

// the URL builder: other options kept, warp replaced, '' drops it
ok(warpUrl('?sound=0&warp=deck&res=native', 'market') === '?sound=0&warp=market&res=native', 'warpUrl replaces warp, keeps the rest');
ok(warpUrl('', 'boss') === '?warp=boss', 'warpUrl on an empty query');
ok(warpUrl('?a=1&warp=deck', '') === '?a=1', 'warpUrl with no name drops the warp');

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
let browser = null;
try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await browser.newPage({ viewport: { width: 480, height: 360 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&sound=0&intro=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForSelector('#warp-pick');
  const opts = await pg.$$eval('#warp-pick option', os => os.map(o => ({ v: o.value, t: o.textContent })));
  const names = Object.keys(WARPS);
  ok(names.every(n => opts.some(o => o.v === n && o.t.includes(WARPS[n].note))), `every warp (${names.length}) is listed with its place`);
  ok(opts.length === names.length + 1 && opts[0].v === '', 'one placeholder row, then the warps');
  // Escape gives the keyboard back
  await pg.focus('#warp-pick');
  await pg.keyboard.press('Escape');
  ok(await pg.evaluate(() => document.activeElement !== document.getElementById('warp-pick')), 'Escape blurs the control');
  // pick a place: the page reloads with ?warp=market, other options kept
  const nav = pg.waitForURL(u => u.searchParams.get('warp') === 'market', { timeout: 30000 }).then(() => true).catch(() => false);
  await pg.selectOption('#warp-pick', 'market');
  ok(await nav, 'picking a place reloads with ?warp=market');
  const q = new URL(pg.url()).searchParams;
  ok(q.get('sound') === '0' && q.get('enemydmg') === '0', `other options kept (${q.toString()})`);
  const warped = await pg.waitForFunction(() => window.__play && window.__play.warp, null, { timeout: 240000 }).then(() => true).catch(() => false);
  ok(warped && await pg.evaluate(() => window.__play.warp.name) === 'market', 'the page arrived at the market warp');
  ok(await pg.evaluate(() => document.getElementById('warp-pick').value) === 'market', 'the control shows the current place');
  const pickFocused = () => pg.evaluate(() => document.activeElement === document.getElementById('warp-pick'));
  const url0 = pg.url();
  // the same row picked again (no change event): the popup closes and the control lets go of the keyboard
  await pg.click('#warp-pick');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(300);
  ok(!await pickFocused() && pg.url() === url0, 'the same row picked again: no reload, focus off the control');
  // Tab during play doesn't reach the control (tabindex -1): W then walks Vincent and type-ahead can't warp to 'wro'
  await pg.mouse.click(240, 250);
  await pg.keyboard.press('Tab');
  ok(!await pickFocused(), 'Tab does not focus the control');
  const walk = async () => {
    const a = await pg.evaluate(() => ({ ...window.__play.ctrl.pos }));
    await pg.keyboard.down('KeyW'); await pg.waitForTimeout(1200); await pg.keyboard.up('KeyW');
    await pg.waitForTimeout(300);
    const b = await pg.evaluate(() => ({ ...window.__play.ctrl.pos }));
    return Math.hypot(b.x - a.x, b.z - a.z);
  };
  const d1 = await walk();
  ok(pg.url() === url0 && d1 > 5, `Tab then W: no warp, Vincent walks (${d1.toFixed(1)})`);
  // focused anyway (a popup closed some other way): a real key can't type-ahead or arrow-pick a place, and the game still gets it
  await pg.focus('#warp-pick');
  const d2 = await walk();
  ok(pg.url() === url0 && !await pickFocused() && d2 > 5, `W on the focused control: no warp, focus off, Vincent walks (${d2.toFixed(1)})`);
  await pg.focus('#warp-pick');
  await pg.keyboard.press('ArrowDown');
  await pg.waitForTimeout(1500);
  ok(pg.url() === url0, 'ArrowDown on the focused control does not pick a place');
  // End / PageDown: play.js doesn't cancel these (it does arrows / Space), so only the control's own listener stops the pick
  for (const k of ['End', 'PageDown']) {
    await pg.focus('#warp-pick');
    await pg.keyboard.press(k);
    await pg.waitForTimeout(1500);
    ok(pg.url() === url0 && !await pickFocused(), `${k} on the focused control does not pick a place, focus off`);
  }
  // Escape inside the open popup closes it with no keydown to the page (focus stays): the next click must open it, not blur
  await pg.evaluate(() => document.exitPointerLock());   // the canvas click above locked the pointer (a player leaves it to use the mouse)
  await pg.waitForTimeout(200);
  await pg.click('#warp-pick');
  await pg.keyboard.press('Escape');
  await pg.click('#warp-pick');
  await pg.waitForTimeout(300);
  ok(await pickFocused(), 'Escape in the popup, then a click: the control keeps focus (the popup opens)');
  await pg.keyboard.press('Escape');                  // closes that popup; the control stays focused for the next step
  await pg.focus('#warp-pick');
  await pg.keyboard.press('Escape');
  ok(!await pickFocused() && !await pg.evaluate(() => window.__play.pause.active), 'Escape blurs the control again, and does not pause');
  const before = await pg.evaluate(() => ({ ...window.__play.ctrl.pos }));
  await pg.keyboard.press('KeyH');
  await pg.waitForTimeout(500);
  const after = await pg.evaluate(() => ({ ...window.__play.ctrl.pos }));
  ok(Math.hypot(after.x - before.x, after.z - before.z) > 50, 'the game still takes keys after the pick (H respawned Vincent)');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally { if (browser) await browser.close().catch(() => {}); srv.kill(); }
done();
