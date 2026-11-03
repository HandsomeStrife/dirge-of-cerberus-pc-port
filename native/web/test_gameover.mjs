// Game over (gameover.js, worker 0192). node native/web/test_gameover.mjs
// Needs data/pause.json + data/gameover.json (export_web_pause.py, export_web_gameover.py). With the traces
// tools/trace/out/w192_gameover.jsonl / w192_quit.jsonl (TRACE_FIELDSET=gameover) it runs the closed loop, with
// data/gameover_ref.json (export_web_gameover.py --menu-dump, the f1240 GS dump) the menu draw for draw.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameOver, menuResult, endVolume, DEATH_WAIT, mergeData } from './gameover.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`));
const origWarn = console.warn; console.warn = () => {};

// ---- rules
eq([menuResult(3), menuResult(4), menuResult(7), menuResult(8)], [6, 7, 6, 8], 'FUN_005349c0: id 3 / 7 -> 6, 8 -> 8, else 7');
eq([endVolume(1000, 1000), endVolume(1000 + 32 * 10, 1000), endVolume(1000 + 32 * 500, 1000)], [0x7f, 0x75, 7], 'FUN_003fdf00 volume ramp');
{ // timer: 0xb4, then -(int)step - 1 a frame: the request 91 frames after the death is seen
  const g = new GameOver(null);
  let req = -1;
  for (let f = 0; f < 200; f++) { g.frame(f >= 10, 1.2, f * 20); if (g.events.includes('request') && req < 0) req = f; }
  eq(req - 10, 91, 'request 91 frames after the death frame (0xb4: -2 a frame at step 1.2)');
  eq(g.endType, 3, 'FUN_003fdb48(3) in the request frame');
  const g2 = new GameOver(null);
  for (let f = 0; f < 200; f++) { g2.frame(f >= 10, 2.4, f * 20); if (g2.events.includes('request')) { eq(f - 10, 61, 'step 2.4: (int)step = 2 -> -3 a frame'); break; } }
  const g3 = new GameOver(null);
  for (let f = 0; f < 300; f++) { g3.frame(f >= 10, 0.6, f * 20); if (g3.events.includes('request')) { eq(f - 10, 91, 'step 0.6: (int)step = 0 -> at least 1: -2 a frame'); break; } }
  eq(DEATH_WAIT, 0xb4, 'death wait 0xb4');
}

// ---- data
const dp = path.join(here, 'data/pause.json'), dg = path.join(here, 'data/gameover.json');
let D = null;
if (!fs.existsSync(dp) || !fs.existsSync(dg)) console.log('SKIP data checks: run export_web_pause.py and export_web_gameover.py');
else {
  const gj = JSON.parse(fs.readFileSync(dg));
  D = mergeData(JSON.parse(fs.readFileSync(dp)), gj);
  eq(gj.seq6.map(r => [r[0], r[2]]), [[0, 0xfd], [4000, 0xf0], [4000, 0xff]], 'table 0x47a130: 0xfd at 0, 0xf0 (case 0xd: the menu) at 4000 ms');
  eq(gj.endKinds[3], 6, 'DAT_004a8250[3] = box kind 6');
  const dec = id => Buffer.from(D.msg[id].slice(2)).toString('latin1').split('').map(c => String.fromCharCode(c.charCodeAt(0) + 29)).join('');
  eq([dec(0x4c02), dec(0x4c01)], ['Restart', 'Quit'], 'messages 0x4c02 / 0x4c01 ($& glyph codes)');
}

if (D) { // the box: ○ does nothing (FUN_00534a28), ✕ locks the input (FUN_003d4780) until the result
  const g = new GameOver(D);
  g.openMenu(0); g.menu.update(200);
  eq([g.input(1, 200), g.menu.focus.id, g.menu.flags & 2], [null, 3, 0], '○: no answer, no close, Restart still focused');
  g.input(3, 210); eq(g.menu.focus.id, 4, 'down: Quit');
  eq(g.input(0, 220), { answer: 7 }, '✕ on Quit -> 7');
  g.input(2, 230); eq([g.menu.focus.id, g.input(0, 240)], [4, null], 'input locked after the answer (no move, no second answer)');
  g.menuFrame(1219); eq(g.menu.result, 0, 'no result before +1000 ms');
  g.menuFrame(1220); eq(g.menu.result, 7, 'result at +1000 ms');
}
if (D) { // FUN_003c6050: a record runs once the elapsed time reaches its start (uVar14 < *puVar8 waits)
  const g = new GameOver(D);
  g.seq = { start: 0, idx: 0, mode: 0, result: 0, table: D.seq6 };
  g.seqFrame(3999); const before = !!g.menu; g.seqFrame(4000);
  eq([before, !!g.menu, g.seq.mode], [false, true, 4], 'menu command at elapsed 4000 ms exactly, not 3999');
}
{ const g = new GameOver(null); g.frame(false, 1.2, 0); const before = g.pauseBlocked; g.frame(true, 1.2, 20);
  eq([before, g.pauseBlocked], [false, true], 'pause blocked from the death (FUN_00241760(1, 3, 0); trace DAT_004f3044 bit 0x100 at f788)'); }

{ // the pause gate (FUN_003de130 in this save: FUN_003dfd18 = 0): 0x100 or the pad given to the menus, not 0x2000
  const g = new GameOver(null);
  g.bit2000 = true; const a1 = g.pauseBlocked;
  g.bit2000 = false; g.padMenu = true; const a2 = g.pauseBlocked;
  g.padMenu = false; g.count = 1; const a3 = g.pauseBlocked;
  eq([a1, a2, a3], [false, true, true], 'pause gate: 0x2000 alone does not block; DAT_004e0ff8 == 2 or the count does');
}

// ---- closed loop against the traces
function load(name) {
  const p = path.join(root, 'tools/trace/out', name + '.jsonl');
  if (!fs.existsSync(p)) return null;
  const rec = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (r.frame !== undefined) rec[r.frame] = r; }
  return rec;
}
const ACT = { 0x40: 0, 0x4000: 3 };               // pad bits in the trace: ✕ 0x40, down 0x4000
const u32le = (hex, o) => parseInt(hex.slice(2 * o, 2 * o + 8).match(/../g).reverse().join(''), 16);
const T0 = rec => u32le(rec[891].seq, 4);        // kind-6 screen +0x480 (its ctor's clock, f890)
function run(rec, last, D) {
  const g = new GameOver(D);
  const seen = {};
  const mark = (k, v) => { if (seen[k] === undefined) seen[k] = v; };
  let held = 0;
  for (let k = 781; k < last; k++) {
    const now = rec[k + 1].clock_ms;              // the clock as this frame's logic left it
    const dead = rec[k].p_hp === 0;                // FUN_00316cf8: HP 0 as this frame starts (the f788 bullet kills)
    const b = rec[k].pad_in.buttons;              // the pad this frame's logic sees
    const press = b & ~held; held = b;
    for (const bit of Object.keys(ACT)) if (press & bit) g.input(ACT[bit], now, 0);
    g.frame(dead, rec[k].step, now);
    if (g.seq && seen.seqOpen === undefined) {
      // the page opens the sequence at once (GUESS: no disc read; checked below, f881). From here on the test
      // OVERWRITES the page's start with the trace's own (f890's clock) so the rest is compared against the game
      seen.seqOpen = k; seen.pageStart = g.seq.start; seen.pageStartClock = now; g.seq.start = T0(rec);
    }
    // the pause hold (DAT_004f3044 0x100 / 0x2000) every frame; at f788 (the kill's own frame) the trace already has
    // 0x100 while gameover.js sees the death at f789 (play.js blocks the pause on HP 0 for that frame)
    // f881-889: the game still reads the title file (count held until state 4, f890); the page's GUESS skips the read
    if (k !== 788 && !(k >= 881 && k <= 889) && k < 1250 && (rec[k + 1].ui_flags & 0x2100) !== g.ui) mark('uiBad', [k, g.ui.toString(16), (rec[k + 1].ui_flags & 0x2100).toString(16)]);
    const wm = rec[k + 1].wmode & 0xffff, t = (rec[k + 1].wmode >> 16) << 16 >> 16;
    // state 9 -> 10 (FUN_00324a78(e290, 0)) is not translated (nothing reads it): states compared in 2 / 3 only
    // from the answer on the game stops ticking the world (FUN_00534af8's FUN_002420e0(0, 1, 0): not on the page)
    if (k < 1250 && g.wm >= 3 && (t !== g.t || (g.wm === 3 && wm !== 3) || (g.wm === 9 && wm !== 9 && wm !== 10))) mark('wmBad', [k, g.wm, g.t, wm, t]);
    if (k === 1303) mark('ui1303', [g.ui, rec[k + 1].ui_flags & 0x2100]);
    // the pad owner DAT_004e0ff8 (2 = the menus) every frame, except the GUESS read window (the page's screen opens at f881)
    // f1303: the game frees the screens (and the focus) a frame after FUN_003fdd58 (the manager's deferred delete, not decoded)
    if (rec[k + 1].pad_gate !== undefined) seen.padN = (seen.padN || 0) + 1;
    if (rec[k + 1].pad_gate !== undefined && !(k >= 881 && k <= 889) && k !== 1303 && g.padMenu !== (rec[k + 1].pad_gate === 2)) mark('padBad', [k, g.padMenu, rec[k + 1].pad_gate]);
    if (g.events.includes('deathCamera')) mark('death', k);
    if (g.events.includes('begin')) mark('begin', k);
    if (g.events.includes('menu')) mark('menu', k);
    if (g.events.includes('menuResult')) mark('result', k);
    if (g.menu && g.menu.pending) mark('answer', [k, g.menu.pending]);
    if (g.answer) mark('ans', [k, g.answer]);
    if (g.request) mark('request', [k, g.request]);
    if (g.menu && g.menu.focus) mark('focus' + g.menu.focus.id, k);
  }
  return seen;
}
const rg = load('w192_gameover'), rq = load('w192_quit');
if (!rg || !rq) console.log('SKIP closed loop: no tools/trace/out/w192_gameover.jsonl / w192_quit.jsonl');
else {
  const a = run(rg, 1329, D);
  eq(a.wmBad, undefined, 'world mode state / timer = the trace every frame (f789-1249)');
  eq(a.death, 789, 'death seen at f789 (the trace: +0x2c 2 -> 3)');
  eq(a.begin, 880, 'game over begins at f880 (trace: DAT_0046e290+0x4c = 1, PTR_0047db6c = 3)');
  eq(a.seqOpen, 881, 'page: the sequence opens at f881 (game f890 after its disc read: GUESS row)');
  eq([a.pageStart === a.pageStartClock, a.pageStartClock], [true, rg[882].clock_ms], 'the page\'s own sequence start = f881\'s clock (before the test overrides it)');
  eq(a.uiBad, undefined, 'pause hold: FUN_00241760 count (0x100) and FUN_003e0cc8 (0x2000) = DAT_004f3044 every frame (f781-1249, not f788 nor the GUESS read window f881-889)');
  if (D) {
    eq(a.menu, 1090, 'menu (box 0x21) at f1090, start + 4000 ms (trace: slot 1 kind 0x21 at f1090)');
    eq(a.answer, [1250, 6], 'Restart (✕ f1250) -> 6 (trace: box +0x58 = 6 at f1250)');
    eq(a.result, 1301, 'result out 1000 ms later, f1301 (trace: slot 1 result 6)');
    eq(a.request, [1302, 'restart'], 'the sequence sees 6 at f1302 (trace: it goes on, f1302) -> page restart');
    const q = run(rq, 1329, D);
    eq(q.focus4, 1230, 'down at f1230 moves to Quit (trace: focus change f1230)');
    eq(q.answer, [1250, 7], 'Quit (✕ f1250) -> 7');
    eq(q.result, 1301, 'Quit result at f1301 (trace)');
    eq(q.ans, [1303, 7], 'DAT_0047db88 = 7 at f1303, end type cleared (trace: f1303)');
    eq(q.request, [1303, 'quit'], 'page: quit request (warned, no title)');
    eq(q.ui1303, [0, 0], 'Quit: FUN_003fdd58 releases 0x2000 (DAT_0047db80 0) at f1303, as the trace');
    ok(q.padN >= 500, `the Quit trace carries pad_gate (${q.padN} frames compared, f781-1328, >= 500)`);
    eq(q.padBad, undefined, 'pad owner DAT_004e0ff8 (FUN_00253fd8 2 / 1 with the menu focus) = the Quit trace every frame');
  }
}

// ---- the menu draw for draw against the GS dump (f1240: menu open, Restart lit)
const refPath = path.join(here, 'data/gameover_ref.json');
if (!D || !fs.existsSync(refPath)) console.log('SKIP draw-for-draw: no data/gameover_ref.json');
else {
  const R = JSON.parse(fs.readFileSync(refPath)).draws;
  const page = { 2: [10828, 10824], 3: [10960, 10956] };
  // the frame also holds the HUD sliding out and a help strip (same textures): find the menu's run of draws
  const diffAt = (prims, s0) => {
    let bad = 0;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i], r = R[s0 + i];
      if (!r) return 1e9;
      let e = (p.kind === 'sprite' ? 6 : 4) !== r.prim || p.v.length !== r.v.length;
      p.v.forEach((v, k) => { const w = r.v[k]; if (!w || v.x !== w.x || v.y !== w.y || v.u !== w.u || v.v !== w.v || v.c.join() !== w.c.join()) e = true; });
      if (p.tex === 'font') { if (r.tbp !== 0 || r.cbp !== 0x3fff - 4 - p.clut) e = true; }
      else if (p.tex && (r.tbp !== page[p.tex][0] || r.cbp !== page[p.tex][1])) e = true;
      if ((p.linear ? 0x60 : 0) !== r.tex1) e = true;
      if (e) bad++;
    }
    return bad;
  };
  const g = new GameOver(D);
  g.openMenu(0);
  g.menu.update(1000);
  // the button pulse (FUN_003d75a0) depends on DAT_004f55e8, not decoded for this screen: search its phase too
  let best = 1e9, at = null;
  for (let t = 0; t < 1500 && best; t++) {
    const prims = g.menu.draw(3000 + t);
    for (let s0 = 0; s0 + prims.length <= R.length; s0++) { const d = diffAt(prims, s0); if (d < best) { best = d; at = [t, s0, prims.length]; } }
  }
  console.log('  best: pulse t % 1500 =', at[0], 'at dump draw', at[1]);
  eq(best, 0, `menu: our ${at[2]} draws (box 0x477c38, Restart lit) = a run of the f1240 dump's draws, draw for draw`);
  const ys = R.slice(at[1], at[1] + at[2]).flatMap(d => d.v.map(v => v.y >> 4));
  ok(Math.min(...ys) >= 300 && Math.max(...ys) <= 460, 'that run is the box region (y ' + Math.min(...ys) + '..' + Math.max(...ys) + ')');
}
// ---- the GAME OVER title (gameover_title.js, worker 0198): FED 0x81840000 on the 2D manager DAT_004ee4a0.
// Needs data/gameover_title.fed (export_web_gameover.py); with tools/trace/out/w198/ (grab_gs.py with the HP poke on
// w192_gameover: states 906 / 965 / 1046 / 1147 -> ramN.json via tools/trace/title_fixture.py; GS dumps 969 / 1050 /
// 1151 -> dumpN.json via tools/trace/dumpfx.py --fed) it checks the spawn time, every particle and every sprite.
{
  const { createTitle, TITLE_DELAY } = await import('./gameover_title.js');
  const { EffectRng } = await import('./effects.js');
  const tf = path.join(here, 'data/gameover_title.fed'), W = path.join(root, 'tools/trace/out/w198');
  const gj = fs.existsSync(dg) ? JSON.parse(fs.readFileSync(dg)) : null;
  if (!fs.existsSync(tf) || !gj || !gj.title) console.log('SKIP title: no data/gameover_title.fed (run export_web_gameover.py)');
  else {
    eq([gj.title.fed, gj.title.id], ['gameover_title.fed', 0x81840000], 'gameover.json declares the title FED 0x81840000');
    const b = fs.readFileSync(tf), fed = () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    eq(TITLE_DELAY, 14, 'title spawn 14 frames after the request frame (MEASURED: page frame 880 -> 894)');
    // the RNG (worker 0202): the title DOES draw from the shared effect LCG / VU0 R (types 20 / 24 / 103; worker 0198's
    // '0 draws' held while those particles were skipped); checked frame by frame against the call logs in the closed
    // loop below. Here: never the twister (no type 137 in the title)
    {
      const rng = new EffectRng(); let calls = 0;
      for (const k of ['mtNext', 'mtSigned']) { const o = rng[k].bind(rng); rng[k] = (...a) => { calls++; return o(...a); }; }
      const t = createTitle(fed(), { rng, warn: () => {} });
      t.begin(1.2); t.logic(true); for (let i = 0; i < 400; i++) { t.begin(1.2); t.logic(true); t.end(); t.sprites(); }
      ok(t.emitter && calls === 0, `the title never draws the effect twister (${calls} calls over 400 frames)`);
    }
    // the glow's repeats (worker 0202 review): this FED has scale 100 % and one repeat, so FUN_00278b50's growth never runs
    // here; a hand case on a patched copy (tag 0's type 35 blocks: +8 = 200 %, +0x13 = 2 repeats): after each draw the box
    // grows by (200 x 0.01 - 1) / 2 = 0.5 of its size on each side (x1 += trunc(w k), x0 -= trunc(w k); y alike)
    {
      const { parseFed } = await import('./effects.js');
      const buf = fed(), F = parseFed(buf), dv = new DataView(buf), P = F.part(F.emitter(0), 0);
      const blocks = [];
      const blk = F.list(P, 0);
      for (let j = 0; j < F.u8(blk + 4); j++) if (F.u16(F.desc(P, F.u8(blk + 8 + 8 * j))) === 35) blocks.push(blk + F.u16(blk + 8 + 8 * j + 2));
      for (let k = 0; k < F.u8(P + 0x21); k++) { const ev = F.event(P, k); for (let j = 0; j < F.u8(ev + 4); j++) { const e = ev + 8 + 8 * j; if (F.u16(F.desc(P, F.u8(e))) === 35) blocks.push(ev + F.u16(e + 2)); } }
      for (const a of blocks) { dv.setFloat32(a + 8, 200, true); dv.setUint8(a + 0x13, 2); }
      const t = createTitle(buf, { warn: () => {} });
      t.begin(1.2); t.logic(true);
      let g = null;
      for (let i = 0; i < 200 && !g; i++) { t.begin(1.2); t.logic(true); t.end(); g = t.sprites().find(s => s.glow && s.tag === 0); }
      const [b0, b1] = g ? g.boxes : [];
      const w = b0 && b0[2] - b0[0], h = b0 && b0[3] - b0[1], dx = Math.trunc(w * 0.5), dy = Math.trunc(h * 0.5);
      ok(blocks.length >= 2 && g && g.boxes.length === 2 && b1.join() === [b0[0] - dx, b0[1] - dy, b0[2] + dx, b0[3] + dy].join(),
        `glow repeats (hand case, scale 200 %, 2 repeats): the second box = the first grown by trunc(size x 0.5) each side (${b0} -> ${b1})`);
    }
    // type 20's loop wrap (FUN_0027b680 -> FUN_002d9208(x + 4096, 4096) outside [0, 4096)): this FED's UV offset reaches only
    // ~1924 in 60 s (the first wrap would come ~2 min into the menu; no capture has it): a hand case on the loop method
    {
      const { _internals } = await import('./effects.js');
      const v = new Float32Array(16); v[2] = 4100.5; v[3] = -10.25;
      _internals.T[20].loop({ F: { f32: () => 0 }, p: { v } }, 0, 0, 0, 0, 0);
      ok(v[2] === 4.5 && v[3] === 4085.75, `type 20 loop: the UV offset wraps by FUN_002d9208 (4100.5 -> ${v[2]}, -10.25 -> ${v[3]}; hand case, not in the captures)`);
    }
    // the FED's own textures (FUN_002eba88 -> FUN_00309f28): every CLUT = the game's GS memory at its CBP (dump f1050;
    // tools/trace/dumpfx.py --fed .. --clut-out), which fixes where the image and CLUT start in each TIM2
    {
      const cp = path.join(W, 'clut4.json');
      if (!fs.existsSync(cp)) console.log('SKIP title textures: no tools/trace/out/w198/clut4.json');
      else {
        const { parseFed, parseFedTextures } = await import('./effects.js');
        const GS = JSON.parse(fs.readFileSync(cp)), tx = [...parseFedTextures(parseFed(fed())).values()];
        const same = tx.map(t => { const g = GS['0x' + ((BigInt(t.tex0[1]) << 32n) | BigInt(t.tex0[0])).toString(16)]; return g ? t.clut.every((c, k) => c === g[k]) : false; });
        ok(tx.length === 3 && same.every(Boolean), `the title's 3 TIM2 CLUTs = GS memory at their CBP, 256 / 256 entries each (${same})`);
      }
    }
    // closed loop on the traced HP (as run() above): the page frame k, the title alongside
    const states = { 905: 'ram1', 964: 'ram3', 1045: 'ram4', 1146: 'ram5' };   // state counter S = after frame S - 1
    // GS dump = its state + 4 frames (dump5: + 3, worker 0202: MEASURED by the glow's alpha ramp, tag 0's type 17 alpha
    // 4.56 at page frame 1149 and 5.47 at 1150 vs RGBA alpha 4 in the dump; the static letters could not tell)
    const dumps = { 968: 'dump3', 1049: 'dump4', 1149: 'dump5' };
    const have = rg && Object.values(states).concat(Object.values(dumps)).every(f => fs.existsSync(path.join(W, f + '.json')));
    if (!have) console.log('SKIP title vs the game: no w192_gameover trace or tools/trace/out/w198/ fixtures');
    else {
      const t = createTitle(fed(), { warn: () => {} });
      const g = new GameOver(null);
      let spawnAt = -1;
      const res = {}, rcalls = {};
      // worker 0202: (1) the effect step. The game ages the title's emitter by the effect frame's own step (+0x20:
      // 1.1999969 / 1.1999988 / 1.2000008), not the logic step the page passes (1.1999999; its source is not decoded,
      // fidelity-audit 'Game over'): tools/trace/out/w202_fxtitle.jsonl (TRACE_FXTITLE=d15820 on w192_gameover) logs it,
      // the page frame k's step = record k + 2. (2) the RNG: the call logs (TRACE_CALLLOG=w202lcg, log frame = page frame
      // + 2) give each frame's reseed (FUN_002d97f8's rand()) and every LCG / VU0 R draw in order; the draws of other
      // callers (the level's 0x2a1b68 effect) are replayed before the title's next own draw, so the title draws the
      // game's values. Without these files: the logic step and an unseeded generator (the value checks of the random
      // lanes are then skipped).
      const fxtP = path.join(root, 'tools/trace/out/w202_fxtitle.jsonl'), fxt = {};
      if (fs.existsSync(fxtP)) for (const l of fs.readFileSync(fxtP, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (r.frame !== undefined) fxt[r.frame] = r; }
      const stepOf = k => (k > 894 && fxt[k + 2]) ? fxt[k + 2].fxt_dt : rg[k].step;
      const logs = [['w202', 'w202_lcg'], ['w202b', 'w202_lcg'], ['w202c', 'w202_lcg2'], ['w202d', 'w202_lcg3']].map(([d, f]) => path.join(root, 'tools/trace/out', d, f + '.calls.jsonl'));
      const haveLogs = logs.every(f => fs.existsSync(f)) && Object.keys(fxt).length > 0;
      const titleCaller = r => r >= 0x27b120 && r < 0x27b300 || r >= 0x2755a0 && r < 0x275850 || r >= 0x2a9d60 && r < 0x2aa120;
      const LOG = {}, win = [];
      if (haveLogs) for (const f of logs) {
        const ls = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
        win.push(ls[0].meta.frames);
        for (const e of ls.slice(1)) {
          const L = LOG[e.frame - 2] ??= { seed: null, seq: [] };
          if (e.hook === 'fx_reseed') L.seed = e.v0 >>> 0; else L.seq.push({ hook: e.hook, title: titleCaller(e.ra - 8) });
        }
      }
      const rng = t.fx.rng, raw = {};
      for (const m of ['next', 'signed', 'unit', 'vrSpan', 'vrInt']) raw[m] = rng[m].bind(rng);
      let cur = null, lf = null, lp = 0, lbad = 0;
      for (const [m, tag] of [['signed', 'lcg_signed'], ['unit', 'lcg_unit'], ['vrSpan', 'vr_span'], ['vrInt', 'vr_flip']]) {
        rng[m] = (...a) => {
          if (cur) cur.push(tag);
          if (lf) {
            while (lp < lf.seq.length && !lf.seq[lp].title) { if (lf.seq[lp].hook.startsWith('lcg')) raw.next(); else raw.vrSpan(0); lp++; }
            if (lp < lf.seq.length && lf.seq[lp].hook === tag) lp++; else lbad++;
          }
          return raw[m](...a);
        };
      }
      const F0 = t.fx.fed, drawType = P => F0.u16(F0.desc(P, F0.u16(F0.list(P, 3))));
      for (let k = 781; k <= 1150; k++) {
        cur = rcalls[k] = [];
        lf = haveLogs && LOG[k] && LOG[k].seed !== null ? LOG[k] : null; lp = 0;
        if (lf) { rng.s = lf.seed; rng.R = ((lf.seed & 0x7fffff) | 0x3f800000) >>> 0; }   // FUN_002d97f8: LCG = rand(), VRINIT R
        // the emitter age as the game had it before this frame (record k + 1): the game's age is not always f(age + dt)
        // of its own +0x20 (84 of 350 frames differ by an ulp; the clock's update is not decoded), which drifts 1e-3 by f1147
        if (t.emitter && k > 895 && fxt[k + 1]) t.emitter.age = fxt[k + 1].fxt_age;
        t.begin(stepOf(k));
        g.frame(rg[k].p_hp === 0, rg[k].step, rg[k + 1].clock_ms);
        t.logic(g.started);
        if (t.emitter && spawnAt < 0) spawnAt = k;
        t.end();
        const sp = t.sprites();
        if (states[k]) res[states[k]] = t.emitter ? { age: t.emitter.age, parts: t.emitter.lists[1].map(p => ({ tag: p.tag, age: p.age, ev: p.ev, skip: p.skip, noDraw: p.noDraw, v: p.v.slice(), i32: p.i32.slice(), m50: p.m50.slice(), dt: drawType(p.P), ext: p.ext ? JSON.parse(JSON.stringify(p.ext)) : null, data: p.data.slice() })) } : null;
        if (dumps[k]) res[dumps[k]] = sp;
      }
      // worker 0206: the back-face cull of FUN_002f5c50 (flag 0x10 when model +0 bit 1 is clear: model 4). No culled model
      // has a back face in the dumps, so a hand case after the replay: tag 40's matrix mirrored in y (same screen box,
      // opposite winding) draws none of its 2 quads; unmirrored, both
      {
        const p40 = t.emitter?.lists[1].find(p => p.tag === 40);
        if (!p40) ok(false, 'model cull: no tag 40 particle at f1150');
        else {
          const m0 = p40.m50.slice(), n0 = t.fx.sprites({}).filter(s => s.model === 4).length;
          for (let j = 4; j < 8; j++) p40.m50[j] = -p40.m50[j];
          const n1 = t.fx.sprites({}).filter(s => s.model === 4).length;
          p40.m50.set(m0);
          ok(n0 === 2 && n1 === 0, `model cull (FUN_002f5c50 flag 0x10, model 4): tag 40 draws ${n0} quads, mirrored in y ${n1} (back faces culled)`);
        }
      }
      eq(spawnAt, 894, 'title spawned in page frame 894 (request 880 + 14; RAM: age 13.2 at state counter 906 .. 302.4 at 1147)');
      // particles against RAM: tag, age, event index, the value region (w lanes of the type 4 / 7 outputs at
      // indices 11 / 19 are never written by the game: pool leftovers), matrix +0x50
      for (const [k, name] of Object.entries(states)) {
        const R = JSON.parse(fs.readFileSync(path.join(W, name + '.json'))).emitters[0], P = res[name];
        ok(P && Math.abs(P.age - R.age) < 1e-3, `${name} (f${+k + 1}): emitter age ${P && P.age.toFixed(2)} = RAM ${R.age.toFixed(2)}`);
        const tags = ps => ps.map(p => `${p.tag}:${p.age.toFixed(1)}`).sort().join(' ');
        eq(tags(P.parts), tags(R.parts), `${name}: the ${R.parts.length} live particles (tag : age; the loop wraps) = RAM`);
        let worst = 0, evBad = 0, mBad = 0, nv = 0;
        for (const rp of R.parts) {
          const p = P.parts.find(q => q.tag === rp.tag);
          if (!p) continue;
          if (p.ev !== rp.ev) evBad++;
          if (p.skip || p.noDraw || p.dt !== 10) continue;        // the type 10 particles (the other draw types: below)
          rp.v.forEach((x, i) => { if (x === null || i === 11 || i === 19) return; nv++; worst = Math.max(worst, Math.abs(p.v[i] - x) / Math.max(1, Math.abs(x))); });
          if (rp.m50 && rp.m50.some((x, i) => Math.abs(p.m50[i] - x) > 1e-4 * Math.max(1, Math.abs(x)))) mBad++;
        }
        // 2e-6: a type 17 colour mid-fade (ram3 tag 16: 85.18585 vs 85.18575, both 85 as RGBA): the PS2 FPU / VU0 truncate
        const any = R.parts.some(rp => { const p = P.parts.find(q => q.tag === rp.tag); return p && !p.skip && !p.noDraw && p.dt === 10; });
        ok(evBad === 0 && mBad === 0 && worst < 2e-6 && (nv > 0 || !any), `${name}: event indices, matrices and ${nv} values = RAM (worst rel ${worst.toExponential(2)} < 2e-6)`);
        // worker 0202: the channels of draw types 20 / 35 / 103 (the fixture's 'vall' / 'pool', title_fixture.py).
        // Their particles' other channels (type 17 colour ramps) follow the particle age, which drifts from RAM by
        // up to 1.8e-4 (the emitter age: 181.19974 vs 181.19992 at f1046, within the 1e-3 above): checked here only
        // for the new channels' own values. Type 20: the base / rate / acceleration lanes whose random range is 0
        // (the others take this frame's LCG values: the RNG order is checked against the call logs below).
        if (!R.parts[0].vall || !haveLogs) { console.log(`SKIP ${name} types 20 / 35 / 103: no 'vall' (re-run tools/trace/title_fixture.py) or no w202 logs`); continue; }
        let w2 = 0, n20 = 0, n35 = 0, n103 = 0, pBad = 0;
        const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
        for (const rp of R.parts) {
          const p = P.parts.find(q => q.tag === rp.tag);
          if (!p || ![20, 35, 103].includes(p.dt)) continue;
          const Pd = F0.part(F0.emitter(0), p.tag), ld = F0.list(Pd, 3), di = F0.u16(ld), d = F0.desc(Pd, di), o = F0.u16(d + 4) / 4;
          if (p.dt === 20) for (let j = 2; j < 8; j++) { if (!haveLogs && F0.f32(p.data[di] + 0x28 + 4 * (j - 2)) !== 0) continue; n20++; w2 = Math.max(w2, rel(p.v[o + j], rp.vall[o + j])); }
          if (p.dt === 35) { n35++; w2 = Math.max(w2, rel(p.v[o], rp.vall[o])); }
          if (p.dt === 103) {
            n103++; w2 = Math.max(w2, rel(p.v[o + 1], rp.vall[o + 1]));
            const mine = p.ext[o], game = rp.pool[o];
            if (!game || mine.length !== game.length) { pBad++; continue; }
            game.forEach((G, j) => {
              const M = mine[j];
              if (M.live !== G.live) { pBad++; return; }
              if (!G.live) return;
              if (M.life !== G.life || M.half !== G.half) pBad++;
              for (const key of ['pos', 'tail', 'vel', 'acc']) for (let c = 0; c < 3; c++) w2 = Math.max(w2, rel(M[key][c], G[key][c]));
              for (const key of ['fade', 'rate', 'len']) w2 = Math.max(w2, rel(M[key], G[key]));
            });
          }
        }
        ok(pBad === 0 && w2 < 1e-5, `${name}: types 20 / 35 / 103 = RAM, with the game's step and RNG (${n20} type 20 lanes, ${n35} type 35 clocks, ${n103} type 103 accumulators + point pools; worst rel ${w2.toExponential(2)} < 1e-5)`);
      }
      // the RNG order (worker 0202): every LCG / VU0 R draw of the title's channels in the call logs
      // (TRACE_CALLLOG=w202lcg on w192_gameover: tools/trace/out/w202 / w202b / w202c; callers 0x27b120..0x27b300 type 20's
      // transition, 0x2755a0..0x275850 type 24, 0x2a9d60..0x2aa120 type 103's eval; log frame = page frame + 2)
      {
        if (!haveLogs) console.log('SKIP title RNG order: no w202 call logs / w202_fxtitle trace (tools/trace/out/w202*)');
        else {
          let frames = 0, bad = [], draws = 0;
          for (const [lo, hi] of win) for (let k = lo - 2; k < hi - 2 && k <= 1150; k++) {
            frames++; const own = (LOG[k]?.seq ?? []).filter(e => e.title).map(e => e.hook);
            const a = (rcalls[k] ?? []).join(), b = own.join(); draws += own.length;
            if (a !== b) bad.push(`f${k}: page [${a}] vs game [${b}]`);
          }
          ok(bad.length === 0 && lbad === 0 && draws > 300, `title RNG draws = the game's, frame by frame and in order (${frames} frames, ${draws} draws: types 20 / 24 / 103; other callers replayed between)${bad.length ? ': ' + bad.slice(0, 3).join('; ') : ''}`);
        }
      }
      // sprites against the dumps: TEX0, ALPHA, vertex RGBA exact, corners < 0.15 px; every FED-textured draw of the
      // dump that is not one of type 35's frame-buffer passes (or type 11's texture 0 mesh) is one of ours
      const blendOf = a => [a & 3, (a >> 2) & 3, (a >> 4) & 3, (a >> 6) & 3];
      for (const [k, name] of Object.entries(dumps)) {
        const all = res[name], sp = all.filter(s => !s.glow && s.model === undefined && !s.line), T = JSON.parse(fs.readFileSync(path.join(W, name + '.json')));
        // ours: the tex2 sprites and the letters (tex1, ALPHA 0x44); type 35's tex1 passes go through its 64 x 64 page
        const own = T.filter(r => r.tex0 === '0x4006388621313000' || (r.tex0 === '0x4006380621312e00' && r.blend.slice(0, 4).join() === '0,1,0,1' && !r.v.some(v => v[0] === 2016 || v[0] === 2080)));
        let worst = 0, bad = 0;
        const used = new Set();
        for (const s of sp) {
          const key = '0x' + s.tex.tex0[1].toString(16) + s.tex.tex0[0].toString(16).padStart(8, '0');
          const dist = r => Math.max(...r.v.map(v => Math.min(...s.verts.map(q => Math.hypot(q.gs[0] - v[0], q.gs[1] - v[1])))));
          const mine = own.map((r, i) => [r, i]).filter(([r, i]) => !used.has(i) && r.tex0 === key && dist(r) < 0.5);
          if (mine.length !== 2) { bad++; continue; }
          for (const [r, i] of mine) {
            used.add(i); worst = Math.max(worst, dist(r));
            for (const v of r.v) {
              const q = s.verts.reduce((a, c) => Math.hypot(c.gs[0] - v[0], c.gs[1] - v[1]) < Math.hypot(a.gs[0] - v[0], a.gs[1] - v[1]) ? c : a);
              if (q.rgba.join() !== v[6].join()) bad++;
            }
            if (blendOf(s.alpha).join() !== r.blend.slice(0, 4).join()) bad++;
          }
        }
        // worker 0206: the draw order (effects.js drawSlot: the draw buckets). The type-10 sprites' TEX0 runs in our order =
        // the dump's (by triangle index; two triangles a sprite)
        const runs = keys => keys.reduce((r, k) => (r.length && r[r.length - 1][0] === k ? r[r.length - 1][1]++ : r.push([k, 1]), r), []).map(r => r.join(':')).join(' ');
        const ourRuns = runs(sp.map(s => '0x' + s.tex.tex0[1].toString(16) + s.tex.tex0[0].toString(16).padStart(8, '0')).flatMap(k => [k, k]));
        const dumpRuns = runs(own.slice().sort((x, y) => x.i - y.i).map(r => r.tex0));
        if (ourRuns !== dumpRuns) { bad++; console.log(`  sprite order: page ${ourRuns} / dump ${dumpRuns}`); }
        ok(sp.length > 0 && bad === 0 && worst < 0.15 && used.size === own.length,
          `${name} (f${k}): our ${sp.length} sprites = the dump's ${own.length / 2} type-10 sprites (${used.size} / ${own.length} triangles; corners ${worst.toFixed(3)} px; RGBA / ALPHA / TEX0 exact; TEX0 runs in the dump's order; ${T.length - own.length} triangles of other types)`);
        // worker 0241: type 103's strands (effects.js drawStrands = FUN_002aa120) against the dump's blended LINE segments
        // (dumpfx.py --lines -> linesN.json; the HUD's unblended ones left out): head / tail XY, RGBA, ALPHA, count
        {
          const lp = path.join(W, 'lines' + name.slice(4) + '.json');
          if (!fs.existsSync(lp)) console.log(`SKIP ${name} strands: no ${lp} (dumpfx.py --lines)`);
          else {
            const G = JSON.parse(fs.readFileSync(lp)).lines.filter(l => l.alpha[1] === 2);
            const mine = all.filter(s => s.line && s.type === 103), left = new Set(G.keys());
            let worst = 0, bad = 0;
            for (const s of mine) {
              const d = (l, j) => Math.hypot(l.v[j][0] - s.verts[j].gs[0], l.v[j][1] - s.verts[j].gs[1]);
              const i = [...left].find(i => Math.max(d(G[i], 0), d(G[i], 1)) < 0.2);
              if (i === undefined) { bad++; continue; }
              left.delete(i); worst = Math.max(worst, d(G[i], 0), d(G[i], 1));
              if (G[i].v[0][3].join() !== s.verts[0].rgba.join() || G[i].v[1][3].join() !== s.verts[1].rgba.join()) bad++;
              if (blendOf(s.alpha).join() !== G[i].alpha.slice(0, 4).join()) bad++;
            }
            ok(mine.length === G.length && bad === 0 && left.size === 0, `${name} (f${k}): our ${mine.length} type 103 strand lines = the dump's ${G.length} blended LINE segments (ends ${worst.toFixed(3)} px; RGBA / ALPHA exact${bad ? '; ' + bad + ' bad' : ''})`);
          }
        }
        // worker 0206: types 11 / 20's FED models (effects.js drawModel = FUN_002f5c50) against the dump, triangle for
        // triangle in draw order (a quad = a strip of two): the textured ones (TEX0 0x40063a0621312f00, the FED's texture
        // 0; dumpN.json) and the untextured ones (untexN.json: dumpfx.py --untex): XY, Z, RGBA, ST (= S / Q), ALPHA
        {
          const up = path.join(W, 'untex' + name.slice(4) + '.json');
          if (!fs.existsSync(up)) console.log(`SKIP ${name} models: no ${up} (dumpfx.py --untex)`);
          else {
            const U = JSON.parse(fs.readFileSync(up));
            const G = T.filter(r => r.tex0 === '0x40063a0621312f00').map(r => ({ ...r, tex: true })).concat(U).sort((a, b) => a.i - b.i);
            const mine = [], kinds = {};
            for (const s of all.filter(s => s.model !== undefined)) {
              kinds[`${s.type}/${s.tag}/m${s.model}`] = (kinds[`${s.type}/${s.tag}/m${s.model}`] ?? 0) + 1;
              for (const ix of s.verts.length === 3 ? [[0, 1, 2]] : [[0, 1, 2], [1, 2, 3]]) mine.push({ s, v: ix.map(j => s.verts[j]) });
            }
            let xy = 0, st = 0, zb = 0, bad = 0;
            mine.forEach((m, i) => {
              const g = G[i];
              if (!g) { bad++; return; }
              if (!!g.tex !== !m.s.untextured || blendOf(m.s.alpha).join() !== g.blend.slice(0, 4).join()) bad++;
              m.v.forEach((q, j) => {
                const v = g.v[j];
                xy = Math.max(xy, Math.abs(q.gs[0] - v[0]), Math.abs(q.gs[1] - v[1]));
                zb = Math.max(zb, Math.abs(q.gs[2] - v[2]));
                if (q.rgba.join() !== (g.tex ? v[6] : v[3]).join()) bad++;
                if (g.tex) st = Math.max(st, Math.abs(q.uv[0] - v[3] / v[5]), Math.abs(q.uv[1] - v[4] / v[5]));
              });
            });
            // the order against the title's sprites: in the dump every model triangle draws before the first FED-textured
            // type-10 sprite (particle list order: tags 40 / 41 / 58 / 59 / 61 come before the letters' particles)
            const firstSprite = Math.min(...T.filter(r => r.tex0 !== '0x40063a0621312f00' && r.tex0 !== '0x4007bd06613137c0').map(r => r.i));
            const lastModel = Math.max(...G.map(r => r.i)), ours = all.map(s => s.model !== undefined);
            const order = lastModel < firstSprite && ours.lastIndexOf(true) < ours.indexOf(false);
            ok(mine.length > 0 && mine.length === G.length && bad === 0 && order && xy <= 0.0625 && zb <= 1 && st < 2e-4,
              `${name} (f${k}): our type 11 / 20 model triangles = the dump's, in draw order (${mine.length} / ${G.length}: ${JSON.stringify(kinds)} items; XY ${xy.toFixed(4)} px, Z ${zb}, ST ${st.toExponential(1)}; RGBA / ALPHA exact; drawn before the sprites, as the dump${bad ? `; ${bad} mismatches` : ''}${order ? '' : '; ORDER differs'})`);
          }
        }
        // worker 0202: type 35's glows against the page passes of the dump (dumpfx.py --glow: glowN.json): per glow the
        // record drawn into the 64 x 64 page (FRAME FBW 1, TEX 0x2e00: corners, RGBA, ALPHA), the copy of the frame (TEX0
        // 0x66401ce00 = TBP 0xe00 / TBW 7 / CT32 / 512 x 512: ST), the page drawn back (TEX0 0x598006a00: XY 12.4, RGBA,
        // ALPHA) — the four draws of FUN_00278b50, exact
        const gp = path.join(W, 'glow' + name.slice(4) + '.json');
        if (!fs.existsSync(gp)) { console.log(`SKIP ${name} glows: no ${gp} (dumpfx.py --glow)`); continue; }
        const GL = JSON.parse(fs.readFileSync(gp)), glows = all.filter(s => s.glow);
        const back = GL.filter(r => r.frame === '0x700e0' && r.tme), copy = GL.filter(r => r.tex0 === '0x66401ce00'), into = GL.filter(r => r.frame === '0x10150' && r.tme && r.tex0 !== '0x66401ce00');
        const xyMatch = (r, X0, Y0, X1, Y1, e = 0) => r.v.every(v => (Math.abs(v[0] - X0) <= e || Math.abs(v[0] - X1) <= e) && (Math.abs(v[1] - Y0) <= e || Math.abs(v[1] - Y1) <= e));
        let gBad = 0, gWorst = 0, gExact = 0, pExact = 0;
        for (const s of glows) {
          const [X0, Y0, X1, Y1] = s.boxes[0].map(x => x / 16);
          // the box: exact with the EE / VU0 rounding toward zero (effects.js rz); matched within 1/16 px, the exact ones counted
          const b2 = back.filter(r => xyMatch(r, X0, Y0, X1, Y1, 0.0625));
          if (b2.length === 2 && b2.every(r => xyMatch(r, X0, Y0, X1, Y1))) gExact++;
          if (b2.length !== 2 || b2.some(r => r.v.some(v => v[6].join() !== s.rgba.join()) || blendOf(s.alpha).join() !== r.blend.slice(0, 4).join())) { gBad++; continue; }
          const at = Math.min(...b2.map(r => r.i));
          const c2 = copy.filter(r => r.i < at && r.i >= at - 2);
          if (c2.length !== 2) { gBad++; continue; }
          for (const r of c2) for (const v of r.v) gWorst = Math.max(gWorst, Math.min(Math.abs(v[3] - s.copy.st[0]), Math.abs(v[3] - s.copy.st[2])), Math.min(Math.abs(v[4] - s.copy.st[1]), Math.abs(v[4] - s.copy.st[3])));
          const l2 = into.filter(r => r.i < at - 2 && r.i >= at - 4), q = s.page[0];
          if (l2.length !== 2 || !l2.every(r => xyMatch(r, q.x[0] + 2016, q.y[0] + 2016, q.x[1] + 2016, q.y[1] + 2016, 0.0625) && r.v.every(v => v[6].join() === q.rgba.join()) && blendOf(q.alpha).join() === r.blend.slice(0, 4).join())) gBad++;
          else if (l2.every(r => xyMatch(r, q.x[0] + 2016, q.y[0] + 2016, q.x[1] + 2016, q.y[1] + 2016))) pExact++;
        }
        ok(glows.length > 0 && glows.length === back.length / 2 && gBad === 0 && gWorst < 1e-7 && gExact === glows.length && pExact >= glows.length * 3 / 4,
          `${name} (f${k}): our ${glows.length} type 35 glows = the dump's ${back.length / 2} page passes (record into the page: RGBA / ALPHA exact, corners exact for ${pExact} / ${glows.length}, the rest within 1/16 px (VU1 rounding); copy ST worst ${gWorst.toExponential(1)}; draw-back XY ${gExact} / ${glows.length}, RGBA, ALPHA exact)`);
      }
    }
  }
}
console.warn = origWarn;
console.log(`${n - fails} / ${n} passed`);
process.exit(fails ? 1 : 0);
