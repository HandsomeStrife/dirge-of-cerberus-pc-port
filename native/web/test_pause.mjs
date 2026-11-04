// Pause menu (pause.js) against the game.
//   node native/web/test_pause.mjs
// Needs data/pause.json (python3 -I native/assets/models/export_web_pause.py); the draw-for-draw
// check also needs data/pause_ref.json (the same script with --dump <GS dump of the open pause
// menu>, worker 0176's pause.gs). Both are game-derived and gitignored.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { loadPauseData, PauseScreen, PauseFlow, gsX, gsY, scissor, measureText } from './pause.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, 'data/pause.json'), refPath = path.join(here, 'data/pause_ref.json');
if (!fs.existsSync(dataPath)) { console.log('SKIP: no data/pause.json (run export_web_pause.py)'); process.exit(0); }
const D = loadPauseData(JSON.parse(fs.readFileSync(dataPath)));

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log('FAIL', msg); } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const text = b => String.fromCharCode(...[...b.subarray(2)].map(c => c + 0x1d));   // '$&' glyph codes
// a long message by its shape (length, control bytes [index, byte], sha256 prefix): the repo is public, so no game text
const shape = b => ({ len: b.length, ctrl: [...b].flatMap((c, i) => c < 0x20 || c >= 0x80 ? [[i, c]] : []),
    sha: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16) });

// ---- strings (kelstr.bin, FUN_003fd370 / FUN_003fd578)
eq(text(D.msg[0x5c01]), 'Restart', 'message 0x5c01');
eq(text(D.msg[0x5c00]), 'Tempsave', 'message 0x5c00');
eq(text(D.msg[0x5c02]), 'Quit', 'message 0x5c02');
eq(shape(D.msg[0x5c06]), { len: 37, ctrl: [], sha: 'de4fefef6b81f97d' }, 'message 0x5c06 (the restart question)');

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
// prims vs a dump's draws (xy, UV, RGBA, TEX0 / CLUT, CLAMP, TEX1), draw for draw
function compareDraws(prims, R, label) {
  eq(prims.length, R.length, label + ': draw count');
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
  ok(bad === 0, `${label}: ${bad} of ${R.length} draws differ from the dump`);
  return bad;
}
if (!fs.existsSync(refPath)) console.log('SKIP draw-for-draw: no data/pause_ref.json');
else {
  compareDraws(prims, JSON.parse(fs.readFileSync(refPath)).draws, 'pause');
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
// left / right read param_3[2] / [3] (FUN_003cbc38), nav4[2] / [3]; a = 4 used to read past the array and jump to order 0
{ const n = new PauseScreen(D, { now: 0 }); n.update(200); n.action(3, 0); n.action(3, 0); eq(n.focus.id, 5, 'at Quit');
  eq(n.action(4, 0), null, 'left at Quit stays (no jump to Restart)'); eq(n.focus.id, 5, 'still Quit'); eq(n.action(5, 0), null, 'right at Quit stays'); eq(n.focus.id, 5, 'still Quit'); }
{ const b = new PauseFlow(D); b.start(0); b.frame(200); b.input(0, 300); b.frame(450); const box = b.box;
  eq(box.focus.id, 7, 'the box opens on CANCEL');
  b.input(4, 460); eq(box.focus.id, 6, 'left at CANCEL moves to OK'); b.input(4, 470); eq(box.focus.id, 6, 'left at OK stays');
  b.input(5, 480); eq(box.focus.id, 7, 'right at OK moves to CANCEL (FUN_003cbc38)'); b.input(5, 490); eq(box.focus.id, 7, 'right at CANCEL stays'); }

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
eq(g.input(0, 220), { box: 4, id: 0x27 }, 'flow: ✕ on Tempsave opens its box');

// ---- the confirm box (worker 0189): FUN_003c0220 -> 0x477a10 -> FUN_003b65c0 / FUN_003b7f38
eq(shape(D.msg[0x5c08]), { len: 52, ctrl: [[24, 10]], sha: '3c41eda9292ba8c2' }, 'message 0x5c08 (the quit question, two lines)');
eq(text(D.msg[0x3800]), 'OK', 'message 0x3800');
eq(text(D.msg[0x3801]), 'CANCEL', 'message 0x3801');
const bf = new PauseFlow(D); bf.start(0); bf.frame(200);
eq(bf.input(0, 300), { box: 3, id: 0x25 }, '✕ on Restart opens box 0x25');
const bx = bf.box;
// RAM at the open box (w189 cancel save state): root 64,177 384x94; text widget 76,189 360x44,
// +0x44 = 338, +0x68 = 37; buttons moved up by 56 (FUN_003b6c98)
eq([bx.root.x, bx.root.y, bx.root.w, bx.root.h], [64, 177, 384, 94], 'box root (FUN_003b6c10 / FUN_003b6c98)');
const t9 = bx.byId(5);
eq([t9.x, t9.y, t9.w, t9.h, t9.tw, t9.count, t9.flags5e & 0xfdff], [76, 189, 360, 44, 338, 37, 0x10 | 2], 'text widget + FUN_003cf338');
eq([bx.byId(6).x, bx.byId(6).y, bx.byId(7).x, bx.byId(7).y], [127, 235, 269, 235], 'OK / CANCEL moved');
eq(bx.byId(7).textOff[0], 22, 'CANCEL text x from DAT_00472f58 (language 2)');
eq(bx.focus.id, 7, 'kind 2: CANCEL focused (FUN_003b7eb8)');
eq(bf.screen.lit(bf.screen.focus), false, 'the pause buttons draw unlit while the box has the focus');
const boxRef = path.join(here, 'data/pause_box_ref.json'), boxOkRef = path.join(here, 'data/pause_box_ok_ref.json');
// pulse alpha 64 (CANCEL dump): t % 1500 = 250
if (fs.existsSync(boxRef)) compareDraws(bf.frame(1750), JSON.parse(fs.readFileSync(boxRef)).draws, 'box, CANCEL lit');
else console.log('SKIP box draw-for-draw: no data/pause_box_ref.json (export_web_pause.py --box-dump)');
eq(bf.input(4, 1800), { moved: 6 }, 'left -> OK');
if (fs.existsSync(boxOkRef)) compareDraws(bf.frame(3350), JSON.parse(fs.readFileSync(boxOkRef)).draws, 'box, OK lit');   // alpha 76: t % 1500 = 350
eq(bf.input(4, 3400), null, 'left at OK: stays');
// answers: CANCEL / ○ close the box and keep the pause; focus returns to Restart when it is gone
const c1 = new PauseFlow(D); c1.start(0); c1.frame(200); c1.input(0, 300); c1.frame(450);
eq(c1.input(0, 500), { answer: 'cancel', id: 0x25 }, '✕ on CANCEL -> answer 4');
eq(c1.lastSE, 8, 'cancel sound 8 (FUN_003cb4a8)');
eq(c1.input(2, 510), null, 'box input locked while it closes');
c1.frame(550); ok(c1.box && !c1.screen.hasFocus, 'box still closing at +50');
c1.frame(600); ok(!c1.box && c1.screen.hasFocus && c1.screen.lit(c1.screen.focus) && c1.screen.focus.id === 3, 'box gone at +100: Restart lit again');
eq(c1.input(3, 610), { moved: 4 }, 'pause takes input again');
const c2 = new PauseFlow(D); c2.start(0); c2.frame(200); c2.input(0, 300); c2.frame(450);
eq(c2.input(1, 500), { answer: 'cancel', id: 0x25 }, '○ in the box -> answer 4 (FUN_003b81b8)');
eq(c2.lastSE, 8, '○ in the box: cancel sound 8');
ok(c2.active, 'the pause stays open after a cancel');
const c3 = new PauseFlow(D); c3.start(0); c3.frame(200); c3.input(0, 300); c3.frame(450);
c3.input(4, 460);
eq(c3.input(0, 500), { answer: 'ok', id: 0x25, request: 'restart' }, 'OK on Restart -> restart (FUN_003c0a20, FUN_003dee40(0xf))');
eq(c3.lastSE, 7, 'confirm sound 7');
ok(c3.screen.flags & 0x20, 'the pause closes with it');
const c4 = new PauseFlow(D); c4.start(0); c4.frame(200); c4.input(3, 210); c4.frame(250);
eq(c4.input(0, 300), { box: 4, id: 0x27 }, '✕ on Tempsave opens box 0x27');
eq(c4.box.focus.id, 6, 'kind 1: OK focused');
eq(c4.box.byId(5).count, 52, 'two-line text: glyphs + the line break');
eq(c4.input(0, 500), { answer: 'ok', id: 0x27, request: 'tempsave' }, 'OK on Tempsave -> request (no save system)');
const c5 = new PauseFlow(D); c5.start(0); c5.frame(200); c5.input(3, 210); c5.input(3, 220); c5.frame(250);
eq(c5.input(0, 300), { box: 5, id: 0x26 }, '✕ on Quit opens box 0x26');
c5.input(4, 310);
eq(c5.input(0, 500), { answer: 'ok', id: 0x26, request: 'quit' }, 'OK on Quit -> request (no title)');
const c6 = new PauseFlow(D); c6.start(0); c6.frame(200); c6.input(0, 300); c6.frame(450);
eq(c6.start(460), 'close', 'Start with the box open closes the pause (FUN_003bfd70)');
c6.frame(560); ok(!c6.active && !c6.box, 'pause and box gone');

// text alpha while the box opens (FUN_003cd7e8: +0x4c alpha, shadow alpha - 0x20, glow 0x40, x cur / total)
const m = new PauseFlow(D); m.start(0); m.frame(200); m.input(0, 300);
m.box.byId(5).flags5e |= 0x800;                   // glow on, to check its alpha too
const half = m.frame(350).filter(p => p.tex === 'font' && (p.clut === 1 || p.clut === 2));
eq(m.box.cur, 50, 'box half open at +50');
const R0 = half.filter(p => p.v[0].c[0] === 0x80);     // glow and main both carry the text RGB
eq([...new Set(R0.map(p => p.v[0].c[3]))].sort((a, b) => a - b), [0x40 * 50 / 100, 0x80 * 50 / 100], 'mid-open: glow 0x40 x 50%, glyph 0x80 x 50%');
eq([...new Set(half.filter(p => p.v[0].c[0] === 0x10).map(p => p.v[0].c[3]))], [(0x80 - 0x20) * 50 / 100], 'mid-open: shadow (0x80 - 0x20) x 50%');
// flag 0x40 (fixed pitch, FUN_003cf338 iVar15 += uVar18): every glyph takes a 14 px cell
{
  const w = m.box.byId(5), keep = w.flags5e;
  w.flags5e = (keep | 0x40) & ~0x80;
  eq(measureText(D, w, Uint8Array.from([0x41, 0x42, 0x69, 0])).w, 3 * 14, 'fixed pitch: 3 glyphs = 3 x 14 px');
  w.flags5e = keep;
}
// a pause.json from before the box (no box scripts / widths20 / full font page): no throw, the
// pre-0189 behaviour (the request at once)
{
  const J = JSON.parse(fs.readFileSync(dataPath));
  for (const k of ['box_restart', 'box_quit', 'box_tempsave']) delete J.layouts[k];
  delete J.widths20; delete J.boxTextOff;
  J.font.v0 = 224; J.font.h = 64; J.font.idx = J.font.idx.substr(224 * 512, 64 * 512);
  const old = new PauseFlow(loadPauseData(J)); old.start(0); old.frame(200);
  const warn = console.warn; let w = ''; console.warn = x => { w += x; };
  let r = null; try { r = old.input(0, 300); } catch (e) { r = 'threw ' + e; }
  console.warn = warn;
  eq(r, { request: 'restart', id: 3 }, 'old pause.json: ✕ on Restart = the request (no box)');
  ok(w.includes('predates the confirm box'), 'old pause.json: warned');
  ok(old.frame(320) !== null && !old.box, 'old pause.json: no box, the pause draws');
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
