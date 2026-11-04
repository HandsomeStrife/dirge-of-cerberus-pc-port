// The menu boxes' effects (menu_fx.js, worker 0258): the slot operations on the real FEDs (data/stage_info.fed = a0211,
// data/results.fed = a0093), the objective box's text (stage_info.js kind 1) and both against the w258 GS dump.
//   node native/web/test_menu_fx.mjs
// w258: PCSX2, tools/trace/scripts/w258_box31.json, TRACE_POKE=47db6c=1,4fadbc=0 (FUN_003fdb48's writes: the box opens by
// the game's own FUN_003fdf00), grab_gs frames 40 / 120; dumpfx.py b120.gs fx120.json --lines --fed results.fed;
// export_web_stageinfo.py --dump-objective b120.gs (data/stage_info_k1_ref.json). Without those files the checks are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMenuFx, menuManager, MGR_A, MGR_B } from './menu_fx.js';
import { StageInfo, loadStageInfoData, STAT_OBJECTIVE } from './stage_info.js';
import { loadPauseData } from './pause.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = f => path.join(here, 'data', f);
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL', m); } };
for (const f of ['stage_info.fed', 'results.fed', 'stage_info.json', 'pause.json'])
  if (!fs.existsSync(data(f))) { console.log('SKIP: no data/' + f); process.exit(0); }
const buf = f => { const b = fs.readFileSync(data(f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const quiet = { warn: () => {} };
const make = () => createMenuFx([buf('stage_info.fed'), buf('results.fed')], quiet);
const tick = (m, n = 1) => { for (let i = 0; i < n; i++) { m.begin(1.2); m.end(); } };
const PANEL = 0x81740000, ITEM = 0x834c0000;
const gsOf = sp => sp.filter(s => s.verts && !s.line && s.tex).flatMap(s => s.verts.map(v => v.gs));

// ---- FUN_002f0878: the manager of an id
ok(menuManager(PANEL) === MGR_B, '0x8174.... ((id >> 18) & 0x3ff = 0x5d) is DAT_004ee580');
ok(menuManager(ITEM) === MGR_A, '0x834c.... is DAT_004ee4a0');
for (const k of [0x5d, 0xe0, 0xfd, 0x109, 0x115]) ok(menuManager((0x80000000 | (k << 18)) >>> 0) === MGR_B, `key ${k.toString(16)} -> DAT_004ee580`);
{
  const m = make();
  m.op({ spawn: 0, id: PANEL, x: 0, y: 0 }); m.op({ spawn: 1, id: ITEM, x: 0, y: 0 });
  tick(m);
  ok(m.slots.get(0)?.mgr === MGR_B && m.mgrs.get(MGR_B).emitters.includes(m.slots.get(0)), 'the objective panel spawns on DAT_004ee580, from a0093');
  ok(m.slots.get(1)?.mgr === MGR_A && m.mgrs.get(MGR_A).emitters.includes(m.slots.get(1)), 'the help panel spawns on DAT_004ee4a0, from a0211');
  ok(gsOf(m.title.sprites()).length > 0, '... and the spawned emitters draw through the layer\'s sprites()');
}

// ---- the box's operations run in the menu update, after FUN_002efe98: state 9 (FUN_003dce38 after FUN_002efe98)
{
  const m = make();
  m.begin(1.2);
  m.op({ spawn: 0, id: PANEL, x: 0, y: 0 });
  ok(m.slots.size === 0 && m.title.fx.emitters.length === 0, 'a spawn waits for end()');
  m.end();
  const em = m.slots.get(0);
  ok(em && em.age === 0, `a spawn after end(): not aged by this frame's FUN_002ea040 (age ${em?.age})`);
  m.begin(1.2); m.end();
  ok(Math.abs(em.age - 1.2) < 1e-5, `... and aged from the next frame (age ${em.age})`);
}

// ---- FUN_003c5a98 -> FUN_002e7198: the soft end fades, it does not remove
{
  const m = make();
  m.op({ spawn: 0, id: PANEL, x: 0, y: 0 });
  tick(m, 40);
  const em = m.slots.get(0), age = em.age;
  m.op({ end: 0 });
  tick(m);
  ok(!m.slots.has(0), 'soft end: the slot lets go of the emitter (FUN_003c5a98: +0x58 = -1)');
  ok(m.title.fx.emitters.includes(em), 'soft end: the emitter lives on');
  ok(em.fade >= age, `soft end: the fade starts at the age (+0x28 = ${em.fade}, age ${age})`);
  let n = 0;
  while (m.title.fx.emitters.includes(em) && n < 2000) { tick(m); n++; }
  ok(n > 1 && n < 2000, `soft end: it fades out by itself after ${n} frames`);
}

// ---- FUN_003c5b00 -> FUN_002e7660: the move carries the emitter's draws (FUN_002e3300: +0x40 / +0x44 x the PAL factors)
{
  const m = make();
  m.op({ spawn: 0, id: PANEL, x: 0, y: 0 });
  tick(m, 30);
  const a = gsOf(m.title.sprites()), em = m.slots.get(0);
  m.op({ move: 0, x: 4, y: -2 });
  const m2 = make();                              // the same frames without the move
  m2.op({ spawn: 0, id: PANEL, x: 0, y: 0 });
  tick(m2, 30); m2.title.sprites();
  tick(m); tick(m2);                              // the move applies after this end() (FUN_003c5b00, state 9)
  ok(gsOf(m.title.sprites()).length > 0 && gsOf(m2.title.sprites()).length > 0, 'move: still drawing');
  tick(m); tick(m2);                              // FUN_002e7cd0 takes +0x120 into +0x40 in the next frame
  const b = gsOf(m.title.sprites()), c = gsOf(m2.title.sprites());
  ok(em.p120[0] === 4 && em.p120[1] === -2, `move: the emitter's position (${em.p120})`);
  ok(a.length > 0 && b.length === c.length, `move: the same sprites (${b.length} / ${c.length})`);
  let worst = 0;
  b.forEach((v, i) => { worst = Math.max(worst, Math.abs(v[0] - c[i][0] - 4 * 0.83203125), Math.abs(v[1] - c[i][1] + 2 * 1.1428572)); });
  ok(worst < 0.1, `move: every corner shifts by (x 0.83203125, y 1.1428572) x the move: worst error ${worst.toFixed(3)} px`);
}

// ---- FUN_003fdd58 -> FUN_003b7930 only flags the box; FUN_003c5428 -> FUN_003c5cc0 runs in the menu update (FUN_003de938),
// after FUN_002efe98, before the draw
{
  const m = make();
  const si = new StageInfo(null, { warn: () => {} });
  si.fx = m;
  m.op({ spawn: 0, id: PANEL, x: 0, y: 0 }); m.op({ spawn: 1, id: 0x81740400, x: 0, y: 0 }); tick(m, 10);
  const soft = m.slots.get(1), panel = m.slots.get(0), age = panel.age;
  m.op({ end: 1 }); tick(m);
  si.box = { closed: false, events: [] }; si.kind = 1;
  m.begin(1.2);
  si.stop();
  ok(si.kind === -1 && m.slots.has(0) && m.title.fx.emitters.includes(panel), 'stop(): the emitter is still there until the menu update');
  ok(si.events.some(e => e.fxOp && e.fxOp.clear), 'stop(): the event stays in the box\'s log');
  m.end();
  ok(panel.age > age, `stop(): FUN_002efe98 still ran it (age ${age} -> ${panel.age})`);
  ok(m.slots.size === 0 && !m.title.fx.emitters.includes(panel), 'stop(): gone after end(), before the draw');
  ok(m.title.fx.emitters.includes(soft), 'stop(): a soft-ended emitter (no longer in its slot) fades on (FUN_003c5c50 skips it)');
  // a spawn queued earlier this frame: applied in order, then cleared
  m.begin(1.2);
  m.op({ spawn: 3, id: PANEL, x: 0, y: 0 });
  si.box = { closed: false, events: [] }; si.kind = 1;
  si.stop();
  m.end();
  ok(m.slots.size === 0 && !m.title.fx.emitters.some(e => e.id === PANEL), 'stop(): a spawn queued this frame does not survive it');
}

// ---- kind 1, the objective box: the steps of 0x47a0a0 on the managers, the text of DAT_0047a388[stat 0x32]
const D = loadStageInfoData(JSON.parse(fs.readFileSync(data('stage_info.json'))), loadPauseData(JSON.parse(fs.readFileSync(data('pause.json')))));
const txt = b => Buffer.from(b).toString('latin1');
ok(D.si.objectives?.length === 40, 'DAT_0047a388: 40 objective texts');
ok(txt(D.si.objectives[0]) === 'Protect the civilians!', `row 0: ${D.si.objectives && txt(D.si.objectives[0])}`);
ok(txt(D.si.objectives[3]) === 'Protect the boy!', 'row 3 is its own text');
const box31 = (stat, onFrame, frames = 300) => {
  const m = make();
  const si = new StageInfo(D, { flags: { event: () => 0, stat: k => (k === STAT_OBJECTIVE ? stat : 0) }, warn: () => {} });
  si.fx = m;
  si.display(1);
  for (let f = 0; f < frames; f++) {
    si.frame(false);
    for (const e of si.events) if (e.fxOp && !e.fxOp.clear) m.op(e.fxOp);   // createStageInfo's wrapper
    si.events.length = 0;
    tick(m);
    onFrame?.(f, si, m);
  }
  return { si, m };
};
{
  const seen = new Set();
  let t0 = -1, tEnd = -1, tClose = -1;
  const { si, m } = box31(0, (f, s, mm) => {
    for (const k of mm.slots.keys()) seen.add(mm.slots.get(k).id >>> 0);
    if (t0 < 0 && mm.slots.size) t0 = f;
    if (t0 >= 0 && tEnd < 0 && !mm.slots.size) tEnd = f;
    if (tClose < 0 && t0 >= 0 && s.kind === -1) tClose = f;
  });
  ok(seen.has(0x81740000) && seen.has(0x81740400) && seen.has(0x81740c00), 'the box spawns 0x81740000 / 0400 / 0c00');
  ok(tEnd - t0 === 150, `their life is over 3000 ms after the open (${tEnd - t0} frames)`);
  ok(tClose - t0 === 186, `the box goes 3700 ms after the open + FUN_003fdf00's next frame (${tClose - t0} frames)`);
  ok(si.kind === -1 && m.slots.size === 0, 'closed: no slots');
}
{
  const glyphs = stat => { let n = null; box31(stat, (f, s) => { if (f === 120) n = (s.draw() || []).length; }, 121); return n; };
  ok(glyphs(0) === 100, `stat 0x32 = 0: 100 sprites (${glyphs(0)})`);
  ok(glyphs(3) !== glyphs(0) && glyphs(3) > 0, `stat 0x32 picks the row (${glyphs(3)})`);
  ok(glyphs(0x28) === 0, `stat 0x32 past the table: no text (FUN_003c6600: 0x27 < stat; ${glyphs(0x28)} sprites)`);
}
// the text against the GS dump, every sprite: position, UV, colours (centred: FUN_003d7218's measure; layout without override)
if (!fs.existsSync(data('stage_info_k1_ref.json'))) console.log('SKIP text check: no data/stage_info_k1_ref.json');
else {
  let prims = null;
  // the dump's frame: script frame 124 is the box's frame 115 (the box opens at 10 here; alpha 0x80 from 600 ms on)
  box31(0, (f, s) => { if (f === 115) prims = s.draw(); }, 116);
  const R = JSON.parse(fs.readFileSync(data('stage_info_k1_ref.json'))).draws;
  ok(prims && prims.length === R.length, `the text: ${prims?.length} sprites, the dump's ${R.length}`);
  let bad = 0, worst = 0;
  (prims || []).forEach((p, i) => p.v.forEach((a, k) => {
    const b = R[i]?.v[k]; if (!b) { bad++; return; }
    worst = Math.max(worst, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    if (a.x !== b.x || a.y !== b.y || a.u !== b.u || a.v !== b.v || a.c.join() !== b.c.join()) bad++;
  }));
  ok(bad === 0, `the text: ${bad} corners differ from the dump (worst ${worst / 16} px)`);
}
// the panel's particles against the dump (emitters at the page's age 139.2 = the dump's frame)
const fxPath = path.join(here, '../../tools/trace/out/w258/fx120.json');
if (!fs.existsSync(fxPath)) console.log('SKIP effect check: no tools/trace/out/w258/fx120.json');
else {
  const T = JSON.parse(fs.readFileSync(fxPath)).tris;
  const key = s => '0x' + s.tex.tex0[1].toString(16) + s.tex.tex0[0].toString(16).padStart(8, '0');
  let sp = null, age = null;
  box31(0, (f, s, m) => { const e = m.slots.get(0); if (e && Math.abs(e.age - 139.2) < 0.01) { sp = m.title.sprites(); age = e.age; } }, 130);
  const q = (sp || []).filter(s => s.verts && !s.line && s.tex);
  let hit = 0, worst = 0, bad = 0;
  for (const t of T) {
    const h = q.filter(s => key(s) === t.tex0).find(s => t.v.every(v => s.verts.some(p => Math.hypot(p.gs[0] - v[0], p.gs[1] - v[1]) < 0.3)));
    if (!h) continue;
    hit++;
    for (const v of t.v) {
      const p = h.verts.reduce((a, c) => (Math.hypot(c.gs[0] - v[0], c.gs[1] - v[1]) < Math.hypot(a.gs[0] - v[0], a.gs[1] - v[1]) ? c : a));
      worst = Math.max(worst, Math.hypot(p.gs[0] - v[0], p.gs[1] - v[1]));
      if (p.rgba.join() !== v[6].join()) bad++;
    }
  }
  console.log(`  dump f120 (age ${age?.toFixed(1)}): ${hit} of ${T.length} triangles matched, worst ${worst.toFixed(3)} px, ${bad} RGBA differ`);
  ok(hit >= 354, `the page's panel sprites are in the dump: ${hit} triangles`);
  // every page sprite is a dump draw: a record's sprites past 16 (their corners overwritten, w = 0: effects.js vuSprite) are not
  const out = q.filter(s => !T.some(t => key(s) === t.tex0 && t.v.every(v => s.verts.some(p => Math.hypot(p.gs[0] - v[0], p.gs[1] - v[1]) < 0.3))));
  ok(out.length === 0, `no page sprite outside the dump (${out.length} of ${q.length}${out[0] ? ', first tag ' + out[0].tag + ' rgba ' + out[0].verts[0].rgba : ''})`);
  ok(worst < 0.1, `... corners within 0.1 px (${worst.toFixed(3)})`);
  ok(bad === 0, `... RGBA exact (${bad} differ)`);
}
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
