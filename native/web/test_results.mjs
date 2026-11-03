// The level end's stats, calc and Status box (results.js; worker 0232, notes/results-research.md) against the game:
//   - FUN_0031dff0 / FUN_003d0d08 / sprintf formats, the clock FUN_00242a50, FUN_0031dbf0 + FUN_003fdb00;
//   - w232_status (PCSX2, from the save; the level end's C calls made by the trace hook): the section's end (end 54,
//     time 43), calc's stats and the box's +0xff0 copy (all 54 entries, after FUN_003c54f8's copies / packing) =
//     the page's runCalc + ResultsBox from the save's stats;
//   - the box timeline (+0x47c step, +0x48d mode) frame by frame with the trace's ✕ frames;
//   - the text draws against the GS dumps of the rows and the points (data/results_ref_rows.json / _points.json).
//   node native/web/test_results.mjs        (SKIP parts without data/ or the traces; MUTATE=<name> runs a mutant)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const MUT = process.env.MUTATE || '';
const R = await import('./results.js');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const done = () => { console.log(fail ? `${fail} FAILED of ${n}${MUT ? ' (mutant ' + MUT + ')' : ''}` : `all ok (${n})${MUT ? ' (mutant ' + MUT + ' survived)' : ''}`); process.exit(fail ? 1 : 0); };
const bytes = s => Uint8Array.from(Buffer.from(s, 'latin1'));
const str = b => Buffer.from(b).toString('latin1');

// ---- pure parts
ok(R.pct(0, 5) === 0 && R.pct(5, 0) === 0 && R.pct(5, 5) === 100 && R.pct(7, 5) === 100 && R.pct(1, 300) === 1 && R.pct(299, 300) === 99 && R.pct(2, 3) === 66,
  'FUN_0031dff0: 0 / 0 / 100 / 100 / clamp 1 / clamp 99 / 66');
ok(R.d0d08(0, 100, 1000, 1000, 200) === 0 && R.d0d08(0, 100, 1100, 1000, 200) === 50 && R.d0d08(0, 100, 1200, 1000, 200) === 100, 'FUN_003d0d08: 0 / 50 / 100 over 200 ms');
ok(str(R.sprintf(bytes('%d'), 42)) === '42' && str(R.sprintf(bytes('%3d%%'), 7)) === '  7%' && str(R.sprintf(bytes('%d/%d'), 3, 4)) === '3/4' && str(R.sprintf(bytes('%02d'), 5)) === '05',
  'sprintf: %d, %3d%%, %d/%d, %02d');
{
  const s = new R.SectionStats(null);
  s.running = 1; s.tick(999); s.tick(1000); s.tick(2999); s.tick(3000);
  ok(s.playSec === 3, `FUN_00242a50: whole seconds while running (${s.playSec})`);
  s.running = 0; s.tick(5000); ok(s.playSec === 3, 'stopped: no seconds');
  const t = new R.SectionStats();
  ok(t.get(14) === 1 && t.mark === 1 && t.start === 11 && t.playSec === 53, 'the save\'s block (section 1, start 11, play 53)');
  t.playSec = 54; t.sectionEnd();
  ok(t.end === 54 && t.get(15) === 43 && t.total[0] === 3 && t.mark === -1 && t.ended === 1, `FUN_003fdb00 -> FUN_0031dbf0: end ${t.end}, time ${t.get(15)} (43), totals, mark cleared`);
  t.playSec = 60; t.sectionEnd(); ok(t.end === 54, 'a second FUN_003fdb00 (FUN_003fdb48(2)) does nothing');
  t.gameOver(); ok(t.get(9) === 1, 'FUN_00242938: one KO -> stat 9 = 1');
}

// ---- data
const DATA = path.join(here, 'data');
const need = ['results.json', 'pause.json', 'stage_info.json', 'event/ev0100_stage.json'].map(f => path.join(DATA, f));
if (!need.every(existsSync)) { console.log('SKIP data checks: data/results.json etc. missing (tools/byo/build_web.sh)'); done(); }
const J = f => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));
const rj = J('results.json'), sd = J('event/ev0100_stage.json');
const { loadPauseData } = await import('./pause.js');
const D = R.loadResultsData(rj, loadPauseData(J('pause.json')), J('stage_info.json'));
ok(rj.steps.length === 126 && rj.tables.kinds[2] === 0x1d, `step table 0x479650: ${rj.steps.length} records, kind 2 -> box 0x${rj.tables.kinds[2].toString(16)}`);
// the level end on the save's stats: flags as main has them (0 = 1, 1 = 3 from the save, 13 = 99)
function levelEnd(end = 54) {
  const st = new R.SectionStats();
  st.playSec = end; st.sectionEnd();
  const g = new Uint8Array(64); g[0] = 1; g[1] = 3; g[13] = 99;
  const base = { classes: sd.classes, natives: {
    'fake/KerberosEvent.getflag(I)B': (vm, [k]) => g[k], 'fake/KerberosEvent.setflag(IB)V': (vm, [k, v]) => { g[k] = v & 0xff; },
    'fake/KerberosZone.getflag(I)B': () => 0 } };
  if (MUT !== 'nocalc') R.runCalc(rj.calc, st, base);
  return st;
}

// ---- the trace: w232_status
const tp = path.join(OUT, 'w232/w232_status.jsonl');
if (!existsSync(tp)) { console.log('SKIP trace checks: no ' + tp); done(); }
const recs = readFileSync(tp, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(d => 'frame' in d);
const I32 = (h, k) => Buffer.from(h, 'hex').readInt32LE(4 * k);
const ints = (h, cnt) => Array.from({ length: cnt }, (_, k) => I32(h, k));
const f = k => recs[k];
ok(I32(f(31).st_head, 1) === 54 && I32(f(30).st_head, 1) === 0, `game: endSection at f30 -> +4 end ${I32(f(31).st_head, 1)} (54)`);
const st = levelEnd(I32(f(31).st_head, 1));
const g32 = ints(f(32).st_sect, 20);
ok(g32.every((v, k) => v === st.sect[k] || k === 9 || k === 11 || k === 12), `stats 0..19 after calc = the game's f32 (${g32.map((v, k) => v !== st.sect[k] ? k + ':' + v + '/' + st.sect[k] : '').filter(Boolean).join(' ') || 'equal'})`);
const boxAt = recs.findIndex(d => d.si_box && d.sb_tl && Buffer.from(d.sb_tl, 'hex').readUInt32LE(12));
ok(boxAt > 0, `game: the box (DAT_00479160) with its step table from frame ${boxAt}`);
if (boxAt > 0) {
  const gv = ints(recs[boxAt + 2].sb_stats, 54);
  const box = new R.ResultsBox(D, st, 0, { gil: () => 0 });
  const diff = gv.map((v, k) => (v !== box.v[k] ? `${k}:${v}/${box.v[k]}` : '')).filter(Boolean);
  ok(diff.length === 0, `the box's +0xff0 stats (54) = the page's (FUN_003c54f8 copies, packing; calc): ${diff.join(' ') || 'equal'}`);
  // ---- the timeline: step / mode per frame from the box's first frame, ✕ on the trace's frames (pad_in edges)
  const tl = d => { const b = Buffer.from(d.sb_tl, 'hex'); return { step: b.readUInt32LE(0), hold: b.readUInt32LE(8), mode: b[0x11] }; };
  const crossAt = new Set();
  for (let k = 1; k < recs.length; k++) {
    // pad_in.buttons: the held bits byte-swapped (trace.py BUTTONS cross = bit 14 -> 0x40 here)
    const down = d => (d.pad_in.buttons & 0x40) !== 0;
    if (down(recs[k]) && !down(recs[k - 1])) crossAt.add(k);
  }
  const pbox = new R.ResultsBox(D, levelEnd(54), 0, { gil: () => 0 });
  let now = 0, bad = 0, first = '';
  for (let k = boxAt; k < recs.length; k++) {
    if (!recs[k].si_box) break;
    const g = tl(recs[k]);
    if (k > boxAt) { now += 20; pbox.frame(now, crossAt.has(k - 1)); }
    if (pbox.closed) break;
    const okk = Math.abs(g.step - pbox.step) <= 1 && (g.mode === pbox.mode || Math.abs(g.step - pbox.step) === 1);
    if (!okk) { bad++; if (!first) first = `f${k}: game step ${g.step} mode ${g.mode} hold ${g.hold}, page ${pbox.step} / ${pbox.mode} / ${pbox.hold}`; }
  }
  ok(bad <= 6, `timeline vs the game frame by frame (step within 1 at the transitions): ${bad} off${first ? ' (first ' + first + ')' : ''}`);
  // worker 0241: the slot spawns (FUN_003c58b8 with FUN_003c6d70's positions, script flag 0x1e) vs the RAM emitters of the
  // state at 321 (fx_fixture.py: tools/trace/out/w232/fx321.json): every live emitter's id and position +0x120 is the
  // page's last spawn of some slot up to that frame (the rank letters at 0x51d0e0's, e.g. (184, -84), not the steps')
  const fp = path.join(root, 'tools/trace/out/w232/fx321.json'), rf = path.join(here, 'data/results.fed');
  if (existsSync(fp) && existsSync(rf)) {
    const { parseFed } = await import('./effects.js');
    const b = readFileSync(rf), F = parseFed(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    const idOf = rec => { for (let g = 0; g < F.u16(0x40); g++) { const G = F.groupOf(g); if (!G) continue; for (let k = 0; k < F.u16(G + 6); k++) if (G + F.u32(G + 0x20 + 4 * k) === rec) return (F.code | (g << 10) | k) >>> 0; } return null; };
    const box2 = new R.ResultsBox(D, levelEnd(54), 0, { gil: () => 0 });
    const last = new Map();
    let t = 0;
    for (let k = boxAt; k < 321 && k < recs.length; k++) {
      if (k > boxAt) { t += 20; box2.frame(t, crossAt.has(k - 1)); }
      for (const e of box2.events) if (e.fxOp && e.fxOp.spawn !== undefined) last.set(e.fxOp.spawn, e.fxOp);
      box2.events.length = 0;
    }
    const S = JSON.parse(readFileSync(fp, 'utf8')).emitters;
    const spawned = [...last.values()];
    const miss = S.filter(e => !spawned.some(o => o.id === idOf(e.rec) && o.x === e.p120[0] && o.y === e.p120[1]));
    ok(miss.length === 0 && S.length > 10, `the Status slots' spawns = the ${S.length} RAM emitters' ids and positions at 321 (${miss.map(e => 'E' + e.ei + ' (' + e.p120.slice(0, 2) + ')').join(' ') || 'all'})`);
  } else console.log('SKIP the Status slot positions (no w232/fx321.json or data/results.fed)');
}

// ---- the text against the GS dumps
for (const [name, until, crosses] of [['rows', 'rows', [0]], ['points', 'points', [0, 1, 2]]]) {
  const rp = path.join(DATA, `results_ref_${name}.json`);
  if (!existsSync(rp)) { console.log(`SKIP draw check ${name}: no data/results_ref_${name}.json (export_web_results.py --dump ${name}=GS)`); continue; }
  const ref = JSON.parse(readFileSync(rp, 'utf8')).draws;
  const box = new R.ResultsBox(D, levelEnd(54), 0, { gil: () => 0 });
  let now = 0, c = 0;
  // to the hold, ✕ (jump), past the count; for the points: ✕ next part, then the hold and ✕ again
  for (let k = 0; k < 2000 && !box.closed; k++) {
    now += 20;
    const want = c < crosses.length && ((box.hold !== 0) || box.mode === 1);
    box.frame(now, want);
    if (want) c++;
    if (c === crosses.length && box.mode === 1 && !box.hold) { for (let j = 0; j < 20; j++) { now += 20; box.frame(now, false); } break; }
  }
  const prims = box.draw(now).filter(p => p.tex === 'font');
  // the dump also holds the HUD's text (drawn above / below the screen: y < 60 px or >= 430 px) in its own order, so
  // the page's glyphs are matched as a set: position, UV and RGBA of both vertices, each dump draw used once
  const key = v => v.map(q => `${q.x},${q.y},${q.u},${q.v},${q.c}`).join(';');
  const pool = new Map();
  for (const r of ref) pool.set(key(r.v), (pool.get(key(r.v)) || 0) + 1);
  const miss = prims.filter(p => { const k = key(p.v); if (pool.get(k)) { pool.set(k, pool.get(k) - 1); return false; } return true; });
  const left = ref.filter(r => { const k = key(r.v); if (pool.get(k)) { pool.set(k, pool.get(k) - 1); return true; } return false; })
    .filter(r => { const y = r.v[0].y >> 4; return y >= 60 && y < 430; });
  if (miss.length) console.log(`  ${name}: first page glyph not in the dump ${JSON.stringify(miss[0].v)}`);
  // rows: the time row (format 0xb839, Shift-JIS 0x8146 separators) is not drawn on the page: its 7 glyphs x 5 draws are left
  const want = name === 'rows' ? 35 : 0;
  ok(miss.length === 0 && left.length === want, `${name}: ${prims.length} page glyphs, ${miss.length} not in the GS dump; dump text outside the HUD not on the page: ${left.length} (${want}${want ? ': the time row' : ''})`);
}
done();
