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
    // the RNG: the translated title draws nothing from the effect LCG / VU0 R / twister (so sharing the 3D one is safe)
    {
      const rng = new EffectRng(); let calls = 0;
      for (const k of ['next', 'signed', 'unit', 'vrInt', 'vrSpan', 'mtNext', 'mtSigned']) { const o = rng[k].bind(rng); rng[k] = (...a) => { calls++; return o(...a); }; }
      const t = createTitle(fed(), { rng, warn: () => {} });
      t.begin(1.2); t.logic(true); for (let i = 0; i < 400; i++) { t.begin(1.2); t.logic(true); t.end(); t.sprites(); }
      ok(t.emitter && calls === 0, `the title's translated part draws no RNG (${calls} calls over 400 frames)`);
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
    const dumps = { 968: 'dump3', 1049: 'dump4', 1150: 'dump5' };              // GS dump = its state + 4 frames
    const have = rg && Object.values(states).concat(Object.values(dumps)).every(f => fs.existsSync(path.join(W, f + '.json')));
    if (!have) console.log('SKIP title vs the game: no w192_gameover trace or tools/trace/out/w198/ fixtures');
    else {
      const t = createTitle(fed(), { warn: () => {} });
      const g = new GameOver(null);
      let spawnAt = -1;
      const res = {};
      for (let k = 781; k <= 1150; k++) {
        t.begin(rg[k].step);
        g.frame(rg[k].p_hp === 0, rg[k].step, rg[k + 1].clock_ms);
        t.logic(g.started);
        if (t.emitter && spawnAt < 0) spawnAt = k;
        t.end();
        const sp = t.sprites();
        if (states[k]) res[states[k]] = t.emitter ? { age: t.emitter.age, parts: t.emitter.lists[1].map(p => ({ tag: p.tag, age: p.age, ev: p.ev, skip: p.skip, noDraw: p.noDraw, v: p.v.slice(), m50: p.m50.slice() })) } : null;
        if (dumps[k]) res[dumps[k]] = sp;
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
          if (p.skip || p.noDraw) continue;                       // channels of the untranslated draw types
          rp.v.forEach((x, i) => { if (x === null || i === 11 || i === 19) return; nv++; worst = Math.max(worst, Math.abs(p.v[i] - x) / Math.max(1, Math.abs(x))); });
          if (rp.m50 && rp.m50.some((x, i) => Math.abs(p.m50[i] - x) > 1e-4 * Math.max(1, Math.abs(x)))) mBad++;
        }
        // 2e-6: a type 17 colour mid-fade (ram3 tag 16: 85.18585 vs 85.18575, both 85 as RGBA): the PS2 FPU / VU0 truncate
        const any = R.parts.some(rp => { const p = P.parts.find(q => q.tag === rp.tag); return p && !p.skip && !p.noDraw; });
        ok(evBad === 0 && mBad === 0 && worst < 2e-6 && (nv > 0 || !any), `${name}: event indices, matrices and ${nv} values = RAM (worst rel ${worst.toExponential(2)} < 2e-6)`);
      }
      // sprites against the dumps: TEX0, ALPHA, vertex RGBA exact, corners < 0.15 px; every FED-textured draw of the
      // dump that is not one of type 35's frame-buffer passes (or type 11's texture 0 mesh) is one of ours
      const blendOf = a => [a & 3, (a >> 2) & 3, (a >> 4) & 3, (a >> 6) & 3];
      for (const [k, name] of Object.entries(dumps)) {
        const sp = res[name], T = JSON.parse(fs.readFileSync(path.join(W, name + '.json')));
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
        ok(sp.length > 0 && bad === 0 && worst < 0.15 && used.size === own.length,
          `${name} (f${k}): our ${sp.length} sprites = the dump's ${own.length / 2} type-10 sprites (${used.size} / ${own.length} triangles; corners ${worst.toFixed(3)} px; RGBA / ALPHA / TEX0 exact; ${T.length - own.length} triangles of untranslated types not drawn)`);
      }
    }
  }
}
console.warn = origWarn;
console.log(`${n - fails} / ${n} passed`);
process.exit(fails ? 1 : 0);
