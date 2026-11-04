// test_warp_page.mjs -- the ?warp= PAGE AID on the real play.html (worker 0249; warp.js). Not game behaviour: the aid that
// takes a review to later places in z128. For every place: the warp ran (once main settled), Vincent stands on the walk
// polygon under the spot (on the ground, y = the polygon's height, near the spot), the chunk the spot lies in is loaded and
// drawn (area_stream slots; a screenshot that is not the black void), the place's flags are set, no console errors / 404s.
// boss: main takes its boss block (Zone.boss(true): enemy_ai bossPlugin) and loads (10, 11) itself. ?warp=list: the names
// on the console and in the help line, no warp.
//   node native/web/test_warp_page.mjs            (needs playwright; WARP_ONLY=market,boss runs a subset)
//   WARP_SHOT=<dir> saves one screenshot per place.
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import zlib from 'node:zlib';
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
const { WARPS } = await import('./warp.js');

// the chunk each place lies in (walk polygon file; hex 0b = 11)
const CHUNK = { deck: 2, stairs: 2, dogs: 3, market: 6, heli: 6, chunk07: 7, chunk09: 9, chunk0b: 11, boss: 11 };
const only = process.env.WARP_ONLY ? process.env.WARP_ONLY.split(',') : null;
const names = Object.keys(WARPS).filter(n => (!only || only.includes(n)) && !WARPS[n].cutscene);   // cutscene places: test_heri_kita_page
ok(Object.keys(CHUNK).every(n => WARPS[n]) && Object.keys(WARPS).every(n => n in CHUNK || WARPS[n].cutscene), `the warp names: ${Object.keys(WARPS).join(', ')}`);

const png = buf => {                                           // 8-bit RGB / RGBA, non-interlaced (playwright screenshots)
  let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < buf.length) { const n = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8);
    if (t === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); ct = buf[o + 17]; }
    if (t === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + n)); o += 12 + n; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * bpp), st = w * bpp;
  for (let y = 0; y < h; y++) { const ft = raw[y * (st + 1)];
    for (let x = 0; x < st; x++) { const a = x >= bpp ? out[y * st + x - bpp] : 0, b = y ? out[(y - 1) * st + x] : 0, c = x >= bpp && y ? out[(y - 1) * st + x - bpp] : 0;
      let v = raw[y * (st + 1) + 1 + x]; const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v = (v + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][ft]) & 255; out[y * st + x] = v; } }
  return { w, h, bpp, px: out };
};
// share of pixels that are not the void's black (any channel > 4; the boss arena is dark and main fades it in)
const lit = ({ w, h, bpp, px }) => { let n = 0; for (let i = 0; i < w * h; i++) { const o = i * bpp; if (px[o] > 4 || px[o + 1] > 4 || px[o + 2] > 4) n++; } return n / (w * h); };

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const OPTIONAL = new Set(['/game_state.js', '/stage_info.js']);
async function open(query) {
  const pg = await browser.newPage({ viewport: { width: 480, height: 360 } });
  const errs = [], info = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'info' || m.type() === 'warning') info.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('response', r => { if (r.status() !== 404) return; const u = r.url().replace(/^http:..[^/]+/, ''); if (!OPTIONAL.has(u)) errs.push('404 ' + u); });
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?sound=0&${query}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  return { pg, errs, info };
}
try {
  for (const name of names) {
    const w = WARPS[name];
    const { pg, errs } = await open(`warp=${name}`);
    const warped = await pg.waitForFunction(() => window.__play && window.__play.warp, null, { timeout: 240000 }).then(() => true).catch(() => false);
    ok(warped, `${name}: the warp ran`);
    if (!warped) { await pg.close(); continue; }
    // the chunk loads (area_stream progress), main's polls; boss: main's Zone.load(128, 10, 11) and Zone.boss(true)
    const t0 = await pg.evaluate(() => window.__play.warp.tick);
    await pg.waitForFunction(t0 => window.__play.stats.ticks > t0 + 90, t0, { timeout: 120000 }).catch(() => null);
    if (name === 'boss') await pg.waitForFunction(() => window.__play.enemyAI.bossPlugin, null, { timeout: 30000 }).catch(() => null);
    const s = await pg.evaluate(({ name }) => {
      const P = window.__play, c = P.ctrl, f = P.enemyAI.eventFlags;
      return { pos: { ...c.pos }, onGround: c.onGround, poly: c.body.poly, gy: P.col.groundY(c.pos.x, c.pos.z, c.pos.y),
               spawn: { ...c.spawn }, loaded: P.light.stream.loaded(), slots: P.light.stream.slots.map(x => x.loaded ? x.chunk : -1),
               sflags: { ...f }, gflags: Array.from(P.stage.globalFlags), boss: !!P.enemyAI.bossPlugin, intro: P.intro.active, name };
    }, { name });
    const spot = w.spawn ? s.spawn : { x: w.pos[0], y: w.pos[1], z: w.pos[2] };
    const d = Math.hypot(s.pos.x - spot.x, s.pos.z - spot.z);
    ok(!s.intro, `${name}: no opening (a warp starts from the save)`);
    ok(s.onGround && s.poly !== null && s.gy !== null && Math.abs(s.pos.y - s.gy) < 0.5,
       `${name}: Vincent on the floor (onGround ${s.onGround}, poly ${s.poly}, y ${s.pos.y.toFixed(2)} vs polygon ${s.gy === null ? null : s.gy.toFixed(2)})`);
    // boss: main's boss block hands Vincent back at its own place (battle()'s FUN_003157b0, stage_controller.js), so the
    // check is the arena's chunk (file 11: x 209..1265, z 1053..1868), not the aid's spot
    if (name === 'boss') ok(s.pos.x > 209 && s.pos.x < 1265 && s.pos.z > 1053 && s.pos.z < 1868, `boss: in the arena's chunk 0b (pos ${s.pos.x.toFixed(1)}, ${s.pos.y.toFixed(1)}, ${s.pos.z.toFixed(1)})`);
    else ok(d < 6, `${name}: at the spot (${d.toFixed(2)} u away; pos ${s.pos.x.toFixed(1)}, ${s.pos.y.toFixed(1)}, ${s.pos.z.toFixed(1)})`);
    ok(s.slots.includes(CHUNK[name]), `${name}: its chunk ${CHUNK[name]} is in a slot (slots ${s.slots.join(' / ')})`);
    if (w.pair) ok(w.pair.every(k => s.slots.includes(k)), `${name}: the pair (${w.pair}) loaded`);
    if (name === 'boss') {
      ok([10, 11].every(k => s.slots.includes(k)), `boss: main's Zone.load(128, 10, 11) loaded (slots ${s.slots.join(' / ')})`);
      ok(s.boss, `boss: main took its boss block (Zone.boss(true): bossPlugin ${s.boss})`);
    }
    // flags: main may move them on (its beats); the ones it does not write must hold
    for (const [k, v] of Object.entries(w.stage || {})) if (!(name === 'boss')) ok((s.sflags[k] | 0) === v, `${name}: stage flag ${k} = ${v} (${s.sflags[k] | 0})`);
    if (name === 'boss') ok((s.sflags[0] | 0) === 36, `boss: stage flag 0 = 36 (${s.sflags[0] | 0})`);
    for (const [k, v] of Object.entries(w.global || {})) if (+k !== 19) ok(s.gflags[k] === v, `${name}: global flag ${k} = ${v} (${s.gflags[k]})`);
    // the room drawn: not the black void
    const shot = await pg.screenshot();
    if (process.env.WARP_SHOT) writeFileSync(path.join(process.env.WARP_SHOT, `warp_${name}.png`), shot);
    const L = lit(png(shot));
    ok(L > 0.35, `${name}: the room is drawn (${(L * 100).toFixed(0)}% of the frame not black)`);
    ok(errs.length === 0, `${name}: no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    await pg.close();
  }
  if (!only || only.includes('list')) {
    const { pg, errs, info } = await open('warp=list&intro=0');
    await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 60, null, { timeout: 240000 }).catch(() => null);
    const r = await pg.evaluate(() => ({ help: document.getElementById('hud') ? document.getElementById('hud').textContent : document.body.innerText, warp: window.__play.warp || null }));
    ok(/\?warp=list\|deck\|stairs\|dogs\|market\|chunk07\|chunk09\|chunk0b\|boss/.test(r.help), `list: the help line names the warps`);
    ok(info.some(m => /^warp \(page aid\): deck = /.test(m)), 'list: the names on the console');
    ok(r.warp === null, 'list: no warp');
    ok(errs.length === 0, `list: no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    await pg.close();
  }
  // a name that is not a place, including what every object inherits (WARPS.constructor): warned and off, no throw in applyWarp
  if (!only || only.includes('unknown')) {
    for (const bad of ['constructor', 'toString', 'nowhere']) {
      const { pg, errs } = await open(`warp=${bad}&intro=0`);
      await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 60, null, { timeout: 240000 }).catch(() => null);
      const r = await pg.evaluate(() => ({ warp: window.__play ? window.__play.warp || null : 'no page', ticks: window.__play ? window.__play.stats.ticks : -1 }));
      ok(r.warp === null && r.ticks > 60, `?warp=${bad}: no warp, the game runs (ticks ${r.ticks})`);
      ok(errs.length === 0, `?warp=${bad}: no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
      await pg.close();
    }
  }
} finally { await browser.close(); srv.kill(); }
done();
