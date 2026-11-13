// Light 2 by chunk on the real play.html (worker 0216; area_stream.js, play.js setupCharLighting): the game loop feeds
// Vincent's MP+0x10 position (ctrl.prev) to the chunk stream; light 2 (Vincent and the soldiers, every frame) is picked
// from the loaded chunks' grids; the room draws the loaded chunks (room.js showChunks, worker 0213); the page aids H
// (start pair) and ?ladder= (every chunk until a box's pair loads); Restart resets the stream.
//   node native/web/test_char_light_page.mjs (needs playwright + data; else SKIP; network for the three.js CDN)
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
for (const f of ['vincent/light.json', 'enemies/ai.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open(q = '') {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&sound=0&enemydmg=0${q}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  await pg.evaluate(() => { window.__instance = Math.random(); });
  return { pg, errs, warns };
}

// Vincent held on chunk 06's floor (-1498,-27,1242; in the (6, 8) box) from the start deck: the game loop must feed his
// position to the stream (FUN_0026a0c0 before the logic), chunks 6 / 8 load, and light 2 comes from chunk 06's grid.
const until = (pg, fn, arg, timeout = 30000) => pg.waitForFunction(fn, arg, { timeout });
const L = JSON.parse(fs.readFileSync(path.join(here, 'data/vincent/light.json'), 'utf8'));
if (!L.chunks) { ok(false, 'light.json v2 (re-run export_web_light.py)'); done(); }
const want6 = L.chunks[6].lights[7].pos;
const ALL = Array.from({ length: 13 }, (_, i) => i).join();
// hold Vincent at p (pos and prev) for n game frames
const hold = (pg, p, n) => pg.evaluate(async ([p, n]) => {
  const P = window.__play, c = P.ctrl, t0 = P.stats.ticks; let on = true;
  const h = () => { if (!on) return; c.pos = { ...p }; c.prev = { ...p }; requestAnimationFrame(h); };
  h();
  while (P.stats.ticks < t0 + n) await new Promise(r => setTimeout(r, 50));
  on = false;
}, [p, n]);
const state = pg => pg.evaluate(() => { const P = window.__play; return { loaded: P.light.stream.loaded().join(), shown: P.root.userData.chunksShown }; });
const soldier = (pg, rec) => pg.evaluate(r => { const a = window.__play.enemies?.actors.find(x => x.rec === r); return a && a.light ? a.light.C2 : null; }, rec);
try {
  const { pg, errs } = await open();
  const r0 = await pg.evaluate(() => ({ loaded: window.__play.light.stream.loaded().join(), c2: window.__play.light.U.uC2.value.toArray() }));
  ok(r0.loaded === '0,1,2', 'start: chunks 0, 1, 2 loaded', r0.loaded);
  ok((await state(pg)).shown === '0,1,2', 'start: the room draws chunks 0, 1, 2', (await state(pg)).shown);
  const s46a = await soldier(pg, 46);

  // the box test reads MP+0x10 = ctrl.prev at the frame start, not ctrl.pos (walk: they differ every moving frame)
  await pg.evaluate(() => {
    const P = window.__play, st = P.light.stream, f = st.frame.bind(st);
    window.__log = []; window.__f = f;
    st.frame = p => { window.__log.push([p.x - P.ctrl.prev.x, p.z - P.ctrl.prev.z, p.x - P.ctrl.pos.x, p.z - P.ctrl.pos.z]); return f(p); };
  });
  await pg.keyboard.down('w');
  await pg.evaluate(async () => { const P = window.__play, t0 = P.stats.ticks; while (P.stats.ticks < t0 + 40) await new Promise(r => setTimeout(r, 50)); });
  await pg.keyboard.up('w');
  const w = await pg.evaluate(() => {
    const log = window.__log; window.__play.light.stream.frame = window.__f;
    return { n: log.length, prev: log.filter(l => Math.hypot(l[0], l[1]) > 1e-9).length, pos: log.filter(l => Math.hypot(l[2], l[3]) > 1e-6).length };
  });
  ok(w.n > 20 && w.prev === 0 && w.pos > 10, 'walking: every box test at ctrl.prev (MP+0x10), not ctrl.pos', `${w.n} calls, ${w.prev} off prev, ${w.pos} off pos`);

  // Vincent held on chunk 06's floor (-1498,-27,1242; the (6, 8) box) from the start deck
  await hold(pg, { x: -1498, y: -27, z: 1242 }, 120);
  const r = await pg.evaluate(() => { const P = window.__play, p = { x: -1498, y: -27, z: 1242 };
    const hit = P.light.pick({ x: p.x + P.light.centre.x, y: p.y + P.light.centre.y, z: p.z + P.light.centre.z });
    return { c2: P.light.U.uC2.value.toArray(), l2: P.light.U.uL2.value.toArray(), hit: hit && hit.pos }; });
  const st6 = await state(pg);
  ok(st6.loaded === '0,6,8', 'held in the (6, 8) box from the deck: both slots freed, 6 then 8 (slot order)', st6.loaded);
  ok(st6.shown === '0,6,8', 'the room draws chunks 0, 6, 8', st6.shown);
  ok(r.hit && r.hit.every((v, i) => Math.abs(v - want6[i]) < 1e-3), 'light 2 picked from chunk 06 (light 7)', r.hit && r.hit.map(v => v.toFixed(1)).join());
  const d = want6.map((v, i) => v - [-1498, -27, 1242][i]), dl = Math.hypot(...d), cos = d.reduce((a, v, i) => a + v / dl * r.l2[i], 0);
  ok(cos > 0.97, 'shader light-2 direction points at chunk 06 light 7 (from the actor point, ~10 u off the held point)', `cos ${cos.toFixed(4)}`);
  ok(Math.hypot(...r.c2) > 0 && r.c2.some((v, i) => Math.abs(v - r0.c2[i]) > 1e-3), 'light 2 colour on the shader uniform changed from the deck light', `deck ${r0.c2.map(v => v.toFixed(3))} -> ${r.c2.map(v => v.toFixed(3))}`);
  // soldier 46 (start deck) re-picks every frame (FUN_005ab0b0): its deck light (chunk 01) is gone with chunks 1 / 2
  const s46b = await soldier(pg, 46);
  ok(s46a && s46b && Math.hypot(...s46a) > 0 && s46a.some((v, i) => Math.abs(v - s46b[i]) > 1e-3), 'soldier 46: light 2 follows the slots (deck light, then not)', `${s46a && s46a.map(v => v.toFixed(3))} -> ${s46b && s46b.map(v => v.toFixed(3))}`);

  // (-1267,-16,733), box (4, 5): no light 2 there with 4 / 5 loaded (a scan of every chunk would find chunk 08's)
  await hold(pg, { x: -1267, y: -16, z: 733 }, 30);
  const r2 = await pg.evaluate(() => ({ loaded: window.__play.light.stream.loaded().join(), hit: window.__play.light.pick({ x: -1267, y: -16, z: 733 }) }));
  ok(r2.loaded === '0,4,5' && r2.hit === null, '(4, 5) box: chunks 0, 4, 5 loaded and no light 2 at the held point', `${r2.loaded} hit ${r2.hit && r2.hit.pos}`);

  // H (page aid): back to the start pair, drawn
  await hold(pg, { x: -1498, y: -27, z: 1242 }, 20);
  await pg.keyboard.press('h');
  await pg.evaluate(async () => { const P = window.__play, t0 = P.stats.ticks; while (P.stats.ticks < t0 + 5) await new Promise(r => setTimeout(r, 50)); });
  const sh = await state(pg);
  ok(sh.loaded === '0,1,2' && sh.shown === '0,1,2', 'H from the (6, 8) box: stream and room back to chunks 0, 1, 2', `${sh.loaded} / ${sh.shown}`);

  // Restart (game over -> ✕): the stage reload resets the stream
  await hold(pg, { x: -1498, y: -27, z: 1242 }, 20);
  ok((await state(pg)).loaded === '0,6,8', 'before the game over: chunks 0, 6, 8');
  await pg.evaluate(() => { window.__play.php.hp = 0; });
  await until(pg, () => { const m = window.__play.gameOver?.go.menu; return m && m.focus && m.focus.id === 3; }, null, 90000);
  await pg.waitForTimeout(300);
  await pg.keyboard.press('Space');
  await until(pg, () => window.__play.restart.count === 1 && !window.__play.restart.pending, null, 30000);
  await pg.evaluate(async () => { const P = window.__play, t0 = P.stats.ticks; while (P.stats.ticks < t0 + 5) await new Promise(r => setTimeout(r, 50)); });
  const sr = await state(pg);
  ok(sr.loaded === '0,1,2' && sr.shown === '0,1,2', 'Restart: stream and room back to chunks 0, 1, 2', `${sr.loaded} / ${sr.shown}`);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
  await pg.close();

  // ?ladder=1 (page aid): the warp lands in no box; every chunk is drawn and scanned until a box's pair has loaded
  const q = await open('&ladder=1&enemies=0');
  const sl = await state(q.pg);
  const at = await q.pg.evaluate(() => [window.__play.ctrl.pos.x, window.__play.ctrl.pos.z].map(Math.round).join());
  ok(sl.loaded === ALL && sl.shown === ALL, `?ladder=1 (at ${at}): every chunk drawn and scanned`, `${sl.loaded} / ${sl.shown}`);
  await hold(q.pg, { x: -1498, y: -27, z: 1242 }, 10);
  // (on the ladder its code pulls him back when the hold ends, into box 24 (6, 12) or (6, 8): either is a box pair). Moving
  // boxes unloads the old chunk that frame and loads the new one at the next FUN_00267970 (area_stream.js progress), so sample
  // once no load is in flight and the room has drawn a frame since (the first frame after the hold is mid-switch: 0,6)
  await until(q.pg, () => { const s = window.__play.light.stream; return s.busy === 0 && !s.all; }, null, 30000).catch(() => {});
  await q.pg.evaluate(async () => { const P = window.__play, t0 = P.stats.ticks; while (P.stats.ticks < t0 + 2) await new Promise(r => setTimeout(r, 50)); });
  const sl2 = await state(q.pg);
  ok(['0,6,8', '0,6,12'].includes(sl2.loaded) && sl2.shown === sl2.loaded, 'then a box: its pair loaded, the aid ends, the room draws the pair', `${sl2.loaded} / ${sl2.shown}`);
  ok(q.errs.length === 0, 'no page errors (ladder)' + (q.errs.length ? ': ' + q.errs.slice(0, 2).join(' | ') : ''));
  await q.pg.close();
} finally {
  await browser.close(); srv.kill();
}
done();
