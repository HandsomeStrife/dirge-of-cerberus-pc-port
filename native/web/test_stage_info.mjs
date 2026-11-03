// test_stage_info.mjs (worker 0220): the stage-info box (stage_info.js) against the game.
//   node native/web/test_stage_info.mjs
// Needs data/pause.json and data/stage_info.json (+ data/stage_info_ref.json for the draw check:
//   python3 -I native/assets/models/export_web_stageinfo.py --dump tools/trace/out/w220/gs/open330.gs).
// Facts from the game (PCSX2, script tools/trace/scripts/w220_box.json, TRACE_FIELDSET=stageinfo; notes/message-research.md):
//   displayStageInfo(6, 'MES_ITEM_07') in frame 216; FUN_003fdf00 opens the box in frame 226; its 500 ms steps run in frame 251
//   (the focus moves to the screen); ✕ in frame 400 -> step 7; the box closes (FUN_003b7830) in frame 450; the kind is
//   clear (isDisplay false) in frame 451. GS dump open330 (frame 330): 1008 box draws (text, outline, icons).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
const SI = await import(process.env.MUTATE_STAGE_INFO ? pathToFileURL(path.resolve(process.env.MUTATE_STAGE_INFO)).href : './stage_info.js');
const { StageInfo, loadStageInfoData, READ_FRAMES } = SI;
import { loadPauseData } from './pause.js';
import * as GS from './game_state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(a === b, `${m}: ${a} vs ${b}`);
const MUT = process.env.MUTATE_STAGE_INFO || '';

const sjPath = path.join(DATA, 'stage_info.json'), pjPath = path.join(DATA, 'pause.json');
if (!fs.existsSync(sjPath) || !fs.existsSync(pjPath)) { console.log('SKIP: no data/stage_info.json or data/pause.json'); process.exit(0); }
const D = loadStageInfoData(JSON.parse(fs.readFileSync(sjPath)), loadPauseData(JSON.parse(fs.readFileSync(pjPath))));

// ---- data
eq(D.si.kinds[6], 0x2b, 'DAT_004a8250[6] = box kind 0x2b');
eq(D.si.kinds[1], 0x1f, 'DAT_004a8250[1] = box kind 0x1f');
ok(D.si.messages.MES_ITEM_07 && Buffer.from(D.si.messages.MES_ITEM_07).toString('latin1').startsWith('$c3Potion$c7 Obtained!'),
  'MES_ITEM_07 = the string the box held in RAM (box +0xdf0, open330.p2s)');
eq(D.si.itemFx[7] >>> 0, 0x834c2000, 'item picture id for flag 55 = 7 (box slot 1 +0x70 in RAM)');
eq(D.si.scripts['43'].length, 9, 'kind 0x2b table: two sections (one mode-1 command)');

// ---- the flow, frame by frame (frame f = the f-th call of frame(); display in frame 216 as in the trace)
function run({ crossAt = 400, until = 460, onFrame = null } = {}) {
  const si = new StageInfo(D, { flags: { event: n => (n === 55 ? 7 : 0) }, warn: () => {} });
  const log = { open: -1, focus: -1, step7: -1, closed: -1, clear: -1, se: [] };
  for (let f = 0; f <= until; f++) {
    si.frame(f === crossAt);
    if (f === 216) si.display(6, 'MES_ITEM_07');                   // the event VM runs after FUN_003fdf00 in the frame
    const b = si.box;
    if (b && log.open < 0) log.open = f;
    if (b && b.screen && log.focus < 0) log.focus = f;
    if (b && b.step === 7 && log.step7 < 0) log.step7 = f;
    if (b && b.closed && log.closed < 0) log.closed = f;
    if (f > 216 && !si.isDisplay(6) && log.clear < 0) log.clear = f;
    for (const e of si.events) if (e.se !== undefined) log.se.push([f, e.se]);
    si.events.length = 0;
    if (onFrame) onFrame(f, si);
  }
  return log;
}
const L = run();
eq(L.open, 226, 'box opens (FUN_003fdf00 state 4) in frame 226 (READ_FRAMES ' + READ_FRAMES + ')');
eq(L.focus, 251, 'the 500 ms steps (layout 0x479610, the focus) in frame 251');
eq(L.step7, 400, '✕ in frame 400 -> step 7 (FUN_003c72f8 past the end mark, then sound 0x1e)');
eq(L.closed, 450, 'op -2 (FUN_003b7830) 1000 ms after the ✕: frame 450');
eq(L.clear, 451, 'isDisplay(6) false from frame 451 (FUN_003fdf00 case 5 sees result 2)');
eq(JSON.stringify(L.se), JSON.stringify([[226, 0x1d], [400, 0x1e]]), 'menu sounds 0x1d at the open, 0x1e at the ✕ (FUN_003e1d10)');
const L2 = run({ crossAt: 240, until: 700 });
eq(L2.step7, -1, 'a ✕ before the screen has the focus (frame 240) does nothing (FUN_003d5480)');
eq(L2.closed, -1, '... and the box stays open (no time-out)');

// ---- the text widget's fade (FUN_003c5db0: 100 ms in from frame 251; after the ✕ 100 ms out)
const alpha = {};
run({ onFrame: (f, si) => { const w = si.box && si.box.screen && si.box.screen.byId && si.box.screen.byId(0x35); if (w) alpha[f] = w.c58[3]; } });
eq(alpha[251], 0, 'text alpha 0 in its first frame');
eq(alpha[253], 0x34, 'text alpha at +40 ms = 0x80 - trunc(60 x 0x80 / 100)');
eq(alpha[256], 0x80, 'text alpha 0x80 after 100 ms');
eq(alpha[400], 0x80, 'the ✕ frame: life -2 -> 0, the fade out starts (alpha kept)');
eq(alpha[401], 0x66, 'text alpha 20 ms into the fade out = trunc(80 x 0x80 / 100)');
const hidden = {};
run({ onFrame: (f, si) => { const w = si.box && si.box.screen && si.box.screen.byId && si.box.screen.byId(0x35); if (w) hidden[f] = w.flags & 1; } });
eq(hidden[404], 0, 'shown at frame 404');
eq(hidden[405], 1, 'hidden at the end of the 100 ms fade out (FUN_003cb360(w, 1)), frame 405');

// ---- a $c colour keeps the text's alpha (FUN_003cd7e8 case 1: uStack_10c's alpha byte kept): mid fade-in, frame 253
{
  let prims = null;
  run({ until: 253, onFrame: (f, si) => { if (f === 253) prims = si.draw(); } });
  const yellow = prims.filter(p => p.tex === 'font' && p.v[0].c[0] === 255 && p.v[0].c[1] === 255 && p.v[0].c[2] === 0);
  ok(yellow.length === 6 && yellow.every(p => p.v[0].c[3] === 0x34), `'Potion' after $c3: 6 yellow glyphs at alpha 0x34 (${yellow.length}, ${yellow.map(p => p.v[0].c[3])})`);
}
// ---- an unknown '$' code: FUN_003d1d98 returns 1 with *param_4 = 1: the '$' is skipped, the next byte is text
{
  const { StageInfoScreen } = SI;
  const scr = new StageInfoScreen(D, 0x2b, 0);
  const w = scr.byId(0x35);
  w.str = Uint8Array.from(Buffer.from('A$zB\0', 'latin1'));
  const main = scr.draw(0).filter(p => p.tex === 'font' && p.v[0].c[0] === 0x80 && p.v[0].c[3] === 0x80);
  ok(main.length === 3, `'A$zB': 3 glyphs drawn ('A', 'z', 'B'; the '$' skipped): ${main.length}`);
}

// ---- the draws against the GS dump (frame 330)
const refPath = path.join(DATA, 'stage_info_ref.json');
if (!fs.existsSync(refPath)) console.log('SKIP draw check: no data/stage_info_ref.json');
else {
  let prims = null;
  run({ until: 330, onFrame: (f, si) => { if (f === 330) prims = si.draw(); } });
  const R = JSON.parse(fs.readFileSync(refPath)).draws;
  eq(prims.length, R.length, 'box draws');
  let bad = 0;
  for (let i = 0; i < Math.min(prims.length, R.length); i++) {
    const p = prims[i], r = R[i], e = [];
    if (r.prim !== 6) e.push('prim ' + r.prim);
    p.v.forEach((a, k) => {
      const b = r.v[k]; if (!b) return;
      if (a.x !== b.x || a.y !== b.y) e.push(`v${k} xy ${a.x},${a.y} vs ${b.x},${b.y}`);
      if (a.u !== b.u || a.v !== b.v) e.push(`v${k} uv ${a.u},${a.v} vs ${b.u},${b.v}`);
      if (a.c.join() !== b.c.join()) e.push(`v${k} rgba ${a.c} vs ${b.c}`);
    });
    if (p.tex === 'font') { if (r.tbp !== 0 || r.cbp !== 0x3fff - 4 - p.clut) e.push(`font TEX0 cbp ${r.cbp} clut ${p.clut}`); }
    else if (p.tex === 2) { if (r.tbp !== 0x2a4c) e.push('page 2 TBP ' + r.tbp); }
    else e.push('tex ' + p.tex);
    if ((p.linear ? 0x60 : 0) !== (r.tex1 & 0x60)) e.push(`TEX1 ${r.tex1}`);
    if (e.length) { bad++; if (bad <= 8) console.log('  draw', i, e.slice(0, 3).join(' | ')); }
  }
  ok(bad === 0, `${bad} of ${R.length} box draws differ from the GS dump`);
}

// ---- game_state.js
GS.reset(); GS.set(6); eq(GS.aiPaused(), true, 'bit 6 set -> FUN_00325b40 true'); GS.clear(6); eq(GS.aiPaused(), false, 'bit 6 clear');
GS.set(43); eq(GS.test(43), 1, 'bit 43 (second word)'); GS.reset(); eq(GS.test(43), 0, 'reset clears');

console.log(`${passes} passed, ${fails} failed${MUT ? ' (mutant ' + MUT + ')' : ''}`);
process.exit(fails ? 1 : 0);
