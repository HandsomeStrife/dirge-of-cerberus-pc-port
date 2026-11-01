// Pause menu (pause.js) against the game.
//   node native/web/test_pause.mjs
// Needs data/pause.json (python3 -I native/assets/models/export_web_pause.py); the draw-for-draw
// check also needs data/pause_ref.json (the same script with --dump <GS dump of the open pause
// menu>, worker 0176's pause.gs). Both are game-derived and gitignored.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPauseData, PauseScreen, PauseFlow, gsX, gsY, scissor } from './pause.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, 'data/pause.json'), refPath = path.join(here, 'data/pause_ref.json');
if (!fs.existsSync(dataPath)) { console.log('SKIP: no data/pause.json (run export_web_pause.py)'); process.exit(0); }
const D = loadPauseData(JSON.parse(fs.readFileSync(dataPath)));

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log('FAIL', msg); } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const text = b => String.fromCharCode(...[...b.subarray(2)].map(c => c + 0x1d));   // '$&' glyph codes

// ---- strings (kelstr.bin, FUN_003fd370 / FUN_003fd578)
eq(text(D.msg[0x5c01]), 'Restart', 'message 0x5c01');
eq(text(D.msg[0x5c00]), 'Tempsave', 'message 0x5c00');
eq(text(D.msg[0x5c02]), 'Quit', 'message 0x5c02');
eq(String.fromCharCode(...D.msg[0x5c06]), 'Return to the most recent checkpoint?', 'message 0x5c06');

// ---- the widget tree (RAM at the pause: root +0x24 list order, rects)
const s = new PauseScreen(D, { now: 0 });
eq([s.root.x, s.root.y, s.root.w, s.root.h, s.root.image], [167, 167, 178, 114, 0xa], 'root');
eq(s.root.children.map(w => [w.id, w.x, w.y, w.w, w.h, w.image]),
   [[2, 167, 175, 178, 96, 0x34], [3, 176, 194, 160, 24, 6], [4, 176, 220, 160, 24, 6], [5, 176, 246, 160, 24, 6],
    [6, 202, 177, 107, 15, 0x106], [7, 167, 189, 35, 3, 0x107], [8, 309, 180, 36, 3, 0x107]], 'children');
eq(s.focus && s.focus.id, 3, 'first focus = Restart');
eq(s.all.filter(w => w.flags & 8).map(w => w.id), [6], 'flag 8 (bilinear) on the header only (RAM +2 = 0x08)');
// FUN_003ca160 inner rects: root (kind 4, margins 8 / 8), button (kind 1, pieces 86 / 25)
eq([s.root.iy, s.root.ih], [175, 98], 'root inner y / h');
eq([s.root.children[1].ix, s.root.children[1].iw], [262, 49], 'button inner x / w');
// unfocused buttons: FUN_003d1950 halves the frame colour (RAM 49,28,28), text 0x70
const tb = s.root.children[2];
eq([tb.rgb80, tb.col7c], [[0x49, 0x28, 0x28], [0x70, 0x70, 0x70, 0x80]], 'unfocused colours');
eq(tb.col74, [0xff, 0x86, 0x8a, 0x80], 'focused text colour 0x808a86ff');

// ---- transforms (FUN_003d2e80 / FUN_003d3880, flag 0x1e)
eq([gsX(167 * 16), gsY(167 * 16), gsX(-16)], [2254, 3053, -13], 'drawable transform');
eq(scissor(0, 0, 0x200, 0x1c0), [0, 0, 431, 511], 'full scissor');

// ---- draw for draw against the GS dump of the open menu (Restart lit, pulse alpha 92)
s.update(1000);
// FUN_003d75a0 pulse: a = (0x2ee - |0x2ee - t % 0x5dc|) * 0x60 / 0x2ee + 0x20; t % 1500 = 470 -> 92
const prims = s.draw(1500 + 470);
if (!fs.existsSync(refPath)) console.log('SKIP draw-for-draw: no data/pause_ref.json');
else {
  const R = JSON.parse(fs.readFileSync(refPath)).draws;
  eq(prims.length, R.length, 'draw count');
  const page = { 2: [10828, 10824], 3: [10960, 10956] };
  let bad = 0;
  for (let i = 0; i < Math.min(prims.length, R.length); i++) {
    const p = prims[i], r = R[i], e = [];
    if ((p.kind === 'sprite' ? 6 : 4) !== r.prim) e.push(`prim ${p.kind} vs ${r.prim}`);
    if (p.v.length !== r.v.length) e.push('vertex count');
    p.v.forEach((a, k) => {
      const b = r.v[k]; if (!b) return;
      if (a.x !== b.x || a.y !== b.y) e.push(`v${k} xy ${a.x},${a.y} vs ${b.x},${b.y}`);
      if (r.tme && (a.u !== b.u || a.v !== b.v)) e.push(`v${k} uv ${a.u},${a.v} vs ${b.u},${b.v}`);
      if (a.c.join() !== b.c.join()) e.push(`v${k} rgba ${a.c} vs ${b.c}`);
    });
    if (!!p.tex !== !!r.tme) e.push('textured');
    if (p.tex === 'font') {
      if (r.tbp !== 0 || r.psm !== 0x2c) e.push('font TEX0');
      if (r.cbp !== 0x3fff - 4 - p.clut) e.push(`font CLUT ${p.clut} -> CBP ${r.cbp}`);   // FUN_003dd5b0, DAT_0047ad14 = 4
    } else if (p.tex) {
      if (r.tbp !== page[p.tex][0] || r.cbp !== page[p.tex][1] || r.psm !== 0x13) e.push(`page ${p.tex} TEX0 ${r.tbp}/${r.cbp}`);
    }
    if (r.tme) {
      const c = p.clamp || { wms: 0, wmt: 0, umsk: 0x3ff, ufix: 0, vmsk: 0x3ff, vfix: 0 };      // FUN_003d3fb8(0, ...) after a piece
      const reg = (BigInt(c.wms) | (BigInt(c.wmt) << 2n) | (BigInt(c.umsk) << 4n) | (BigInt(c.ufix) << 14n)
                 | (BigInt(c.vmsk) << 24n) | (BigInt(c.vfix) << 34n)).toString(16);
      if (p.clamp ? reg !== r.clamp : !['0', '3ff003ff0'].includes(r.clamp)) e.push(`CLAMP ${reg} vs ${r.clamp}`);
      if ((p.linear ? 0x60 : 0) !== r.tex1) e.push(`TEX1 ${p.linear ? 0x60 : 0} vs ${r.tex1}`);
    }
    if (e.length) { bad++; if (bad <= 10) console.log('  draw', i, e.slice(0, 3).join(' | ')); }
  }
  ok(bad === 0, `${bad} of ${R.length} draws differ from the dump`);
  const F = JSON.parse(fs.readFileSync(refPath)).font4hh;
  ok(F && F === D.font.idx, 'font texels (kelfnt0 TIM) = the GS memory the glyph draws sample (PSMT4HH, TBP 0)');
}

// ---- pulse (FUN_003d75a0) and the focused-only extras
const orb = t => s.draw(t).find(p => p.tex === 7 || (p.kind === 'sprite' && p.v[0].u === 106 * 16 + 1));
eq(orb(0).v[0].c[3], 0x20, 'pulse at phase 0');
eq(orb(750).v[0].c[3], 0x80, 'pulse at phase 750 ms');
eq(s.draw(0).filter(p => p.kind === 'sprite' && p.v[0].u === 106 * 16 + 1).length, 1, 'one orb (focused button only)');

// ---- navigation (FUN_003cbc38 / FUN_003cb018): the pad doesn't wrap, the keyboard does
const f = new PauseScreen(D, { now: 0 }); f.update(200);
eq(f.action(3, 0), { moved: 4 }, 'down -> Tempsave');
eq(f.action(3, 0), { moved: 5 }, 'down -> Quit');
eq(f.action(3, 0), null, 'down at Quit (pad): stays');
eq(f.action(3, 2), { moved: 3 }, 'down at Quit (keyboard): wraps to Restart');
eq(f.action(2, 0), null, 'up at Restart (pad): stays');
eq(f.action(4, 0), null, 'left: no neighbour');
eq(f.action(0, 0), { event: 3 }, '✕ on Restart -> event id 3');

// ---- open / close timing (FUN_003d5110 / FUN_003d5340 / FUN_003d51c0)
const o = new PauseScreen(D, { now: 1000 });
o.update(1030);
eq(o.clipH, 175 + Math.trunc(98 * 30 / 100), 'clip = root inner y + inner h x 30% (FUN_003d5340 +0x26)');
o.update(1050);
eq([o.cur, o.total, o.clipH], [50, 100, 175 + 49], 'half open: cur 50, children clipped at root.iy + ih / 2');
const p50 = o.draw(1050);
eq(p50[0].v[0].c[3], 0x20, 'dimming alpha 0x40 x 50%');
eq(p50[1].v[0].c[3], Math.trunc(0x74 * 50 / 100), 'root gradient alpha x 50%');
eq(gsY(p50[1].v[2].y) && p50[1].v[2].y, gsY((167 + Math.trunc(114 * 50 / 100)) * 16), 'root height x 50%');
eq(p50.find(p => p.sc).sc, scissor(0, 0, 0x200, 224), 'children scissor');
o.update(1100);
eq([o.cur, o.flags & 0x10], [100, 0], 'open done after 100 ms');

const fl = new PauseFlow(D);
eq(fl.start(0), 'open', 'Start opens');
fl.frame(10);
ok(fl.input(1, 50).close, '○ closes');
eq(fl.input(3, 60), null, 'no input while closing (flag 2)');
// closed at t 50 while opening (cur 50): FUN_003d51c0 mirrors the elapsed time, end = 2 x 50 - 0 = 100
ok(fl.active && fl.frame(80) !== null && fl.screen.cur === 20, 'still drawn (and the world frozen) during the close');
eq(fl.frame(100), null, 'gone when the close timer reaches 0');
ok(!fl.active, 'world resumes after the close');
eq(fl.start(200), 'open', 'Start opens again');
fl.frame(400);
eq(fl.start(410), 'close', 'Start closes');
// a normal close from fully open (FUN_003d51c0, flags & 0x90 == 0): cur = 100, end = now + 100
fl.frame(460);
eq(fl.screen && fl.screen.cur, 50, 'close from open: half way at +50');
ok(fl.frame(509) !== null && fl.screen.cur === 1, 'close from open: still drawn at +99');
eq(fl.frame(510), null, 'close from open: gone at +100');
// FUN_003d5110 reopening a closing screen (flags & 0x60 != 0): the open takes over the remaining
// time, end = now + 100 - (end - now), cur kept. The pause flow never does this (Start is ignored
// while the close runs, FUN_003d47b8), so it is tested on the screen itself.
const ro = new PauseScreen(D, { now: 0 }); ro.update(200);
ro.close(300); ro.update(350);
eq([ro.cur, ro.end], [50, 400], 'closing: half way');
ro.open(350);
eq([ro.cur, ro.end, ro.flags & 0x30], [50, 400, 0x10], 'reopen while closing: end kept at 400, cur 50, opening');
ro.update(375);
eq(ro.cur, 75, 'reopen: cur = now - (end - 100)');
ro.update(400);
eq([ro.cur, ro.flags & 0x10], [100, 0], 'reopen: fully open at the old close end');
const g = new PauseFlow(D); g.start(0); g.frame(200);
eq(g.input(3, 210), { moved: 4 }, 'flow: down');
eq(g.input(0, 220), { request: 'tempsave', id: 4 }, 'flow: ✕ on Tempsave');

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
