// The level end and the Status results screen (worker 0232; notes/results-research.md, plan P12).
//
// ev0100 main's level end (bytecode 11098..11161): chaos, enable3Drender(0), sleep 100, Event.setflag(13, 99),
// **endSection**, unsetSkipMode, **displayStageInfo(2)**, sleep 500, **Zone.exit(181)**, sleep 5000.
// Translated here:
//   The section stats DAT_0046e228 (0x298 bytes; FUN_0031d3f8 / FUN_0031d470): +0 section start (play seconds), +4 end,
//     +8 start of the KO counter, +0x10 + 4k the 54 section stats, +0xe8 + 4k the totals, +0x290 the area record,
//     +0x294 totals-only flag, +0x294 + 4 (word 0xa5) "ended". FUN_0031d668 add, FUN_0031d698 set, FUN_0031d6d8 total
//     set, FUN_0031d7b8 get (computed: 9 KOs FUN_0031d768, 10 / 11 / 12 percentages FUN_0031df60 / 90 / c0 ->
//     FUN_0031dff0, 15 section time FUN_0031d718), FUN_0031d898 get total, FUN_0031dbf0 (the section's end), FUN_0031dac0.
//   PTR_0047db90: FUN_003fda68 (the stage load marks stat 14) / FUN_003fdb00 (endSection, and FUN_003fdb48(2)).
//   The clocks: DAT_0046b308 play seconds (FUN_00242a50: whole-second steps of the ms clock while DAT_0046b310),
//     DAT_0046b304 the KO counter (FUN_00242938, from FUN_003fdb48(3): the game over).
//   Intermission natives: getSectionStat FUN_003a5378, setSectionStat FUN_003a53e0, getTotalStat FUN_003a5450,
//     setTotalStat FUN_003a54b8, getTotalTime FUN_003a5588, getSectionTime FUN_003a5528, getGameDifficultyLevel
//     FUN_003a26f0, isGameOver FUN_003a5350, clearTotalStatAll FUN_003a2720, calc FUN_003a55e8 (-> FUN_003a9b88: the
//     script class KerberosIntermissionCalc's static calc(), run to its end in the caller's VM; here a second EventVM
//     with the stage VM's classes and natives), endSection FUN_003a26a8.
//   The counters during play (enemy_ai.js hooks; T: w232 call log): 0 kills (Vincent's vt+0x31c FUN_005726e0 from
//     FUN_0055db50 / FUN_0055e498), 1 shots (FUN_00577480), 2 hits / 3 criticals (FUN_00554ea8), 8 damage taken
//     (FUN_0055c7f8), 9 KOs (FUN_00242938), 52 kill chains (FUN_005694a0: not on the page, see below).
//   The Status box: displayStageInfo(2) -> FUN_003fdb48(2) (FUN_003fdb00) -> FUN_003fdf00 -> box kind DAT_004a8250[2]
//     = 0x1d: FUN_003c5358, FUN_003c54f8 (stats -> +0xff0; the row packing; FUN_003e2730 copies), FUN_003c6d70 (rank
//     effect ids), FUN_003c6050 (timeline, ✕, modes 1 / 2 / 5, widget fades and counts), FUN_003c6600 (the commands of
//     step table 0x479650), FUN_003c5db0 / FUN_003c7068 (value text, 200 ms count), FUN_003c7318, FUN_003d0d08.
//   Zone.exit(181): exit_l(181, 0, 0) FUN_0039df70 -> FUN_0037a368: event request 0x14 -> FUN_00377c68 ->
//     FUN_00324ab0(0), FUN_00241ed8(181, 0, 0, 0) (next stage DAT_004b8ba0); FUN_004012c0 returns 1 and the stage
//     program ends. The next stage is not on the page: the page stops there (console note).
// Not on the page (warned once):
//   - the screen's effects (FED a0093, ids 0x8174....: panels, rank letters, the evaluation): book-keeping only, as
//     stage_info.js; the time row's separators (Shift-JIS 0x8146: pause.js has no two-byte glyphs) - that row is not drawn.
//   - stat 52 (kill chains): FUN_005694a0's gate FUN_003b3538(HUD, 3) (the HUD's chain display) is not on the page;
//     stats 4 / 5 / 6 / 7 / 13 (magic, limit, mako): no source on the page.
//   - FUN_003c73f0's screen after the results (case 0xf: layout 0x4795c8, the EXP -> gil exchange prompt, FUN_003defd0(0xc,
//     ..); an input screen, not decoded): left out; the box goes on as if it had closed (GUESS row 'results: the EXP
//     exchange screen'). T: w232_status: the game waits there (mode 2 from f732 to the trace's end).
import { EventVM } from './event_vm.js';
import { measureText } from './pause.js';
import { StageInfoScreen } from './stage_info.js';
import { hexBytes } from './menu_layout.js';

export const STAT = { KILLS: 0, SHOTS: 1, HITS: 2, CRITS: 3, DAMAGE: 8, KO: 9, ACC: 10, SECTION: 14, TIME: 15, CHAIN: 52 };
export const BOX_KIND_STATUS = 0x1d;
const N = 0x36;                                   // 54 stats (FUN_0031dbf0: 0x35 .. 0)

const warned = new Set();
function warnOnce(k, m, warn = console.warn) { if (!warned.has(k)) { warned.add(k); warn(m); } }
const u32 = v => v >>> 0;
const i32 = v => v | 0;
const f32 = Math.fround;

// The save state's block (sea-of-flames.p2s RAM, DAT_0046e228 = 0xa09b00 at load; worker 0232): the page starts there.
export const SAVE_STATS = { start: 11, end: 0, koStart: 0, sect: { 0: 3, 1: 3, 2: 3, 7: 9, 14: 1, 52: 2 }, playSec: 53, ko: 0, mark: 1 };

// ---------------------------------------------------------------- DAT_0046e228 + the clocks
export class SectionStats {
  constructor(save = SAVE_STATS) {
    this.sect = new Int32Array(N);               // +0x10
    this.total = new Int32Array(N);              // +0xe8
    this.start = 0; this.end = 0; this.koStart = 0;   // +0, +4, +8
    this.totalsOnly = 0;                          // +0x294
    this.ended = 0;                               // word 0xa5
    this.playSec = 0;                             // DAT_0046b308
    this.lastSec = 0;                             // DAT_0046b30c
    this.running = 1;                             // DAT_0046b310 (FUN_00242980(1) at the stage load, FUN_00400778)
    this.ko = 0;                                  // DAT_0046b304
    this.mark = -1;                               // PTR_0047db90 (&_gp_11 = -1 here)
    this.log = [];
    if (save) {
      this.start = save.start; this.end = save.end; this.koStart = save.koStart;
      for (const [k, v] of Object.entries(save.sect)) this.sect[k] = v;
      this.playSec = save.playSec; this.ko = save.ko; this.mark = save.mark;
    }
  }
  // FUN_0031d668
  add(k, n) { this.sect[k] = i32(this.sect[k] + n); this.log.push(['add', k, n]); }
  // FUN_0031d698 (FUN_0031d6b8)
  set(k, v) { this.sect[k] = i32(v); }
  // FUN_0031d6d8
  setTotal(k, v) { this.total[k] = i32(v); }
  // FUN_0031d718: the section time (end - start, >= 0)
  sectionTime() { const t = i32(this.end - this.start); return t < 0 ? 0 : t; }
  // FUN_0031d768: the KOs since the section's start
  kos() { const t = i32(this.ko - this.koStart); return t < 0 ? 0 : t; }
  // FUN_0031d7b8: computed entries are written back first (cases 9 / 10 / 11 / 12 / 15)
  get(k) {
    const s = this.sect;
    switch (k) {
      case 9: s[9] = this.kos(); break;
      case 10: s[10] = pct(s[2], s[1]); break;   // FUN_0031df60(base, +0x10): +0x28 = pct(+8, +4)
      case 11: s[11] = pct(s[3], s[1]); break;   // FUN_0031df90: pct(+0xc, +4)
      case 12: s[12] = pct(s[6], s[7]); break;   // FUN_0031dfc0: pct(+0x18, +0x1c)
      case 15: s[15] = this.sectionTime(); break;
    }
    return k >>> 0 < N ? s[k] : 0;
  }
  // FUN_0031d898: section + total (or the totals alone with +0x294), computed entries as get()
  getTotal(k) {
    const v = this.totalsOnly ? Int32Array.from(this.total) : Int32Array.from(this.sect, (x, i) => i32(this.total[i] + x));
    switch (k) {
      case 9: v[9] = this.ko; break;               // FUN_0031d748 = FUN_00242950
      case 10: v[10] = pct(v[2], v[1]); break;
      case 11: v[11] = pct(v[3], v[1]); break;
      case 12: v[12] = pct(v[6], v[7]); break;
      case 15: v[15] = i32(this.playSec + this.sectionTime()); break;   // FUN_0031d6f8 + FUN_0031d718
    }
    return k >>> 0 < N ? v[k] : 0;
  }
  // FUN_0031dbf0: totals += section, end = now (play seconds), start = min(start, end), ended
  endSection() {
    for (let k = 0; k < N; k++) this.total[k] = i32(this.total[k] + this.sect[k]);
    this.end = this.playSec;
    if (u32(this.end) < u32(this.start)) this.start = this.end;
    this.ended = 1;
    this.log.push(['endSection', this.end]);
  }
  // FUN_003fdb00 (endSection FUN_003a26a8, FUN_003fdb48(2)): only for the section the stage load marked
  sectionEnd() {
    if (this.mark === this.get(STAT.SECTION)) { this.endSection(); this.mark = -1; }
  }
  // FUN_0031dac0
  clearTotals() { this.total.fill(0); }
  // FUN_00242a50 (every game frame, FUN_00247428): whole seconds of the ms clock while running
  tick(ms) {
    const s = Math.trunc(ms / 1000);
    if (u32(s) < u32(this.lastSec)) this.lastSec = s;
    if (this.running) this.playSec = i32(this.playSec + (s - this.lastSec));
    this.lastSec = s;
  }
  // FUN_00242938 (FUN_003fdb48(3), the game over)
  gameOver() { this.ko = i32(this.ko + 1); }
}
// FUN_0031dff0
export function pct(a, b) {
  if (a === 0 || b === 0) return 0;
  if (!(a < b)) return 100;
  const v = Math.trunc(f32(f32(f32(a) * 100.0) / f32(b)));
  return v < 1 ? 1 : v > 99 ? 99 : v;
}

// ---------------------------------------------------------------- Intermission.calc (FUN_003a55e8)
// KerberosIntermissionCalc.calc() on a VM of its own (the game: FUN_003a9c58 in the caller's VM, synchronously). Its
// natives: the stage VM's (Event / Zone flags), the Intermission ones on the stats.
export function intermissionNatives(stats, opts = {}) {
  return {
    'fake/KerberosIntermission.getSectionStat(I)I': (vm, [k]) => stats.get(k),
    'fake/KerberosIntermission.setSectionStat(II)V': (vm, [k, v]) => { stats.set(k, v); },
    'fake/KerberosIntermission.getTotalStat(I)I': (vm, [k]) => stats.getTotal(k),
    'fake/KerberosIntermission.setTotalStat(II)V': (vm, [k, v]) => { stats.setTotal(k, v); },
    'fake/KerberosIntermission.getTotalTime()I': () => stats.playSec,               // FUN_0031d6f8 = DAT_0046b308
    'fake/KerberosIntermission.getSectionTime()I': () => stats.sectionTime(),
    // FUN_003a26f0 -> FUN_00242c28: DAT_0046b328 (1 in the save), 1 when 0 and FUN_002424a0()
    'fake/KerberosIntermission.getGameDifficultyLevel()I': () => (opts.difficulty ?? 1),
    'fake/KerberosIntermission.isGameOver()Z': () => (opts.gameOver ? (opts.gameOver() ? 1 : 0) : 0),   // DAT_0047dbb4
    'fake/KerberosIntermission.clearTotalStatAll()V': () => { stats.clearTotals(); },
    'fake/KerberosEvent.isTutorial()Z': () => 0,   // FUN_003a48f0 -> FUN_002419d8(10): 0 in the save (DAT_004b8ac8 = 0)
  };
}
export function runCalc(calcClass, stats, baseVm = null, opts = {}) {
  const classes = { ...(baseVm ? baseVm.classes : {}), [calcClass.name]: calcClass };
  const natives = { ...(baseVm ? baseVm.natives : {}), ...intermissionNatives(stats, opts) };
  const vm = new EventVM({ classes }, natives, { warn: opts.warn || (m => console.warn(m)) });
  vm.start(calcClass.name, 'calc', '()V');
  const r = vm.run(1e7);
  if (r !== 'done') warnOnce('calcblock', 'results: KerberosIntermissionCalc.calc() blocked (a waiting native): left as is', opts.warn);
  return vm.steps;
}

// ---------------------------------------------------------------- data
// rj: results.json (export_web_results.py); pd: loadPauseData(pause.json) (font, textures, widths); sj: stage_info.json
// (the '$' code table, colours and inline images of the type-2 text, FUN_003d1d98: stage_info.js renderCodes)
export function loadResultsData(rj, pd, sj = null) {
  const layouts = { ...pd.layouts }, msg = { ...pd.msg };
  for (const [k, hex] of Object.entries(rj.layouts)) layouts['sires_' + k] = withOverride(hexBytes(hex), pd.opLen, rj.overrides[k]);
  for (const [k, v] of Object.entries(rj.messages)) msg[parseInt(k, 16)] = hexBytes(v);
  const si = sj ? { codes: sj.codes, colours: sj.colours, inline: sj.inline } : { codes: [], colours: [], inline: [] };
  if (!sj) warnOnce('nosj', 'results: no data/stage_info.json: the text\'s $ codes are not read');
  return { ...pd, layouts, msg, si, res: rj };
}
// FUN_003ca488 param_7 (as stage_info.js withOverride): each op 0x0e takes the next 4 shorts of the language's list
function withOverride(b, opLen, ov) {
  const out = Uint8Array.from(b);
  if (ov) {
    let p = 0, k = 0;
    while (out[p] !== 0xff) {
      if (out[p] === 0x0e) for (let i = 0; i < 4; i++) { const v = ov[k++] & 0xffff; out[p + 1 + 2 * i] = v & 0xff; out[p + 2 + 2 * i] = v >> 8; }
      p += opLen[out[p]];
    }
  }
  return Array.from(out, x => x.toString(16).padStart(2, '0')).join('');
}

// FUN_00248e98 (sprintf) for the formats the screen uses: %d, %Nd, %0Nd, %%
export function sprintf(fmt, ...args) {
  const out = []; let a = 0;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== 0x25) { if (c === 0) break; out.push(c); continue; }
    let j = i + 1, zero = false, w = 0;
    if (fmt[j] === 0x25) { out.push(0x25); i = j; continue; }
    if (fmt[j] === 0x30) { zero = true; j++; }
    while (fmt[j] >= 0x30 && fmt[j] <= 0x39) w = w * 10 + (fmt[j++] - 0x30);
    if (fmt[j] !== 0x64) { warnOnce('fmt' + fmt[j], 'results: sprintf %' + String.fromCharCode(fmt[j]) + ' not translated'); i = j; continue; }
    let s = String(args[a++] | 0);
    while (s.length < w) s = (zero ? '0' : ' ') + s;
    for (const ch of s) out.push(ch.charCodeAt(0));
    i = j;
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------- the screen (FUN_003c5d10 -> FUN_003d41e0)
// The widgets are type 2 (FUN_003d6f88: stage_info.js's StageInfoScreen draws them, FUN_003d7040); FUN_003cbe68 ->
// FUN_003cbf18 takes the layout's text id (op 0x10) as the string, FUN_003d72e8 measures it.
export class ResultsScreen extends StageInfoScreen {
  constructor(D, key, now) {
    super(D, 'res_' + key, now);                   // layout 'si' + 'res_' + key; no open animation (as stage_info.js)
    for (const w of this.all) if (w.type === 2 && w.textId) setTextId(D, w, w.textId & 0x7fffffff);
  }
}
// vt+0xcc of a type-9 text widget: the message id (FUN_003e6028 -> pause.js setText9); vt+0xd4: a string (FUN_003e60xx)
function setTextId(D, w, id) {
  w.textId = id >>> 0;
  w.str = D.msg[id & 0x7fffffff] || null;
  if (!w.str) { warnOnce('m' + id, 'results: message 0x' + (id >>> 0).toString(16) + ' not exported'); return; }
  measure(D, w);
}
function setString(D, w, bytes) { w.str = bytes; measure(D, w); }
function measure(D, w) {
  for (const c of w.str) {
    if (c === 0) break;
    if (c >= 0x80) { warnOnce('sjis', 'results: a two-byte (Shift-JIS) text code (the time row\'s 0x8146) is not translated in pause.js: that text is not drawn'); w.str = null; return; }
  }
  const m = measureText(D, w, w.str);
  w.tw = m.w; w.th = m.h; w.count = m.count;
}

// ---------------------------------------------------------------- FUN_003c5358: the Status box (kind 0x1d)
export class ResultsBox {
  constructor(D, stats, now, opts = {}) {
    this.D = D; this.kind = BOX_KIND_STATUS; this.opts = opts;
    const R = D.res;
    this.T = R.tables;
    this.table = R.steps;                          // +0x488
    this.start = now; this.step = 0; this.hold = 0; this.mode = 0; this.result = 2; this.f48f = 0;
    this.fx = Array.from({ length: 0x26 }, () => ({ id: -1, h: -1, life: 0, x: 0, y: 0 }));   // +0x54 + 0x1c i
    this.ws = Array.from({ length: 40 }, blankWs);                                         // +0x490 + 0x3c i
    this.screen = null; this.closed = false; this.events = [];
    // FUN_003c54f8: the stats (stat 14 == 0x10: the totals, FUN_0031d898; else the section's)
    const v = new Int32Array(N + 3);               // + +0x10c8 / +0x10cc / +0x10d0 (the gil rows' values: 54 / 55 / 56)
    const tot = stats.get(STAT.SECTION) === 0x10;
    for (let k = 0; k < N; k++) v[k] = tot ? stats.getTotal(k) : stats.get(k);
    this.f1028 = tot ? 0x10 : v[STAT.SECTION];   // +0x1028 = +0xff0 + 4 x 14
    if (opts.e2730 ?? true) { v[5] = v[13]; v[25] = v[24]; }   // FUN_003e2730 (true for this build): +0x1004 = +0x1024, +0x1054 = +0x1050
    // the packing of the four point rows (DAT_0047a315 / DAT_0047a338): non-zero rows move up
    const P = this.T.statPairs, Q = this.T.pack338;    // P[0x14 + 2 i] = 0x47a314 + 2 i
    for (let i = 0, k = 0; i < 4; i++) {
      const a = 0x15 + 2 * i, ka = 0x15 + 2 * k;
      if (v[P[a + 0xf]] !== 0) {
        if (i !== k) {
          v[P[ka + 0xf]] = v[P[a + 0xf]]; v[P[ka - 1]] = v[P[a - 1]]; v[P[ka]] = v[P[a]]; v[Q[k]] = v[Q[i]];
          v[P[a + 0xf]] = 0;
        }
        k++;
      }
    }
    // +0x10c8 = -1, +0x10cc = stat 18 - 1, +0x10d0 = -1; FUN_003e0b10 requests 0x13, 0x16 (and 0x15 with the reward
    // when +0x48c == 0x1d) with the callback 0x3c57d0 -> FUN_003c5800: 0x13's answer a -> +0x10c8 = a, +0x10cc = a +
    // stat 18 (capped 99999999); 0x16's -> +0x10d0. GUESS: the answers (FUN_00312b38's request system, not decoded):
    // 0x13 = the inventory's gil (opts.gil; T: w232_status shows 0 + 2000), at once; 0x16 / 0x15 left out.
    v[54] = -1; v[55] = v[18] - 1; v[56] = -1;
    const gil = opts.gil ? opts.gil() : null;
    if (gil != null) { v[54] = gil; v[55] = Math.min(i32(gil + v[18]), 99999999); }
    else warnOnce('gil', 'results: no gil source: the Gil row keeps FUN_003c54f8\'s start values');
    warnOnce('req15', 'results: the gil requests 0x15 (the reward paid in) / 0x16 (FUN_00312b38) are not translated');
    this.v = v;                                    // +0xff0
    // FUN_003c6d70 (the default case): rank effect ids by the rank stats (< 5), the evaluation slot 27
    const S = this.T.rankSlots;
    for (let i = 0; S[3 * i] >= 0; i++) {
      const r = v[S[3 * i]];
      if (r < 5) {
        if (S[3 * i + 1] !== -1) this.fx[S[3 * i + 1]].id = i32(this.T.rankFxA[r]);
        if (S[3 * i + 2] !== -1) this.fx[S[3 * i + 2]].id = i32(this.T.rankFxB[r]);
        // FUN_002413c0(0x1e) and FUN_003e2730: positions from 0x51d0e0 (not drawn: the effects are book-keeping)
      }
    }
    this.fx[27].id = this.f1028 === 0x10 ? i32(0x81744c00) : i32(0x81744800);
  }
  byId(id) { return this.screen ? this.screen.byId(id) : null; }
  // FUN_003c5d10: a new layout (FUN_003d4330 drops the old screen, FUN_003c5d78 clears the widget slots)
  layout(key, now) {
    this.screen = new ResultsScreen(this.D, key, now);
    for (let i = 0; i < this.ws.length; i++) this.ws[i] = blankWs();
  }
  // FUN_003c6050 (vt+0x1c), once a frame; cross = FUN_003de918(0, 1)
  frame(now, cross) {
    if (!this.table || this.closed) return;
    let el = u32(now - this.start);
    const focused = !!this.screen;                 // FUN_003d5480
    if (focused) {
      if (this.hold === 0) {
        if (this.mode === 1 && (cross || this.f48f)) { this.c7278(); el = 0; this.c72f8(now); this.hold = 0; this.events.push('next'); }
      } else if (cross) { el = this.hold; this.hold = 0; this.start = now - el; this.events.push('fast'); }
    }
    if (this.mode === 2 || this.mode === 5) {     // FUN_003c73f0's screen gone (DAT_00477fe0 == 0). GUESS: left out, so at once
      this.fx[0].life = 0; el = 0; this.c72f8(now);
    } else if (this.mode === 3 || this.mode === 4) warnOnce('mode' + this.mode, 'results: box mode ' + this.mode + ' (a menu box) not used by kind 0x1d');
    let i = this.step, skip = false;
    for (;;) {
      const s = this.table[i];
      if (!s || s[2] === -1) break;
      if (el < u32(s[0])) { this.step = i; return this.tail(el, now); }
      if (skip) { i++; continue; }
      if (s[2] >= 0) {                             // FUN_003c6600 returns 0: an effect slot (FUN_003c58b8)
        this.slot(s, now);
        this.fx[s[2]].life = s[1] === 0 ? -1 : s[1];
        i++; continue;
      }
      const r = this.command(s, now);
      if (r === 'stop') { this.step = i; return this.tail(el, now); }
      if (r === 'closed') return;
      if (r === 'skipmode') { skip = true; this.start = now - s[1]; el = u32(s[1] - 1); }
      if (r === 'skip1') i++;
      i++;
    }
    this.step = i;
    this.tail(el, now);
  }
  // FUN_003c6600 (op + 0x1d), kind 0x1d's commands
  command(s, now) {
    const c = (s[2] + 0x1d) & 0xff, D = this.D, T = this.T, P = T.statPairs;
    switch (c) {
      case 0: if (this.f1028 !== 0x10) return 'skip1'; this.fx[0].life = 0; return 'next';
      case 1: if (this.f1028 === 0x10) { this.fx[26].life = -2; this.fx[24].life = -2; this.fx[25].life = -2; } return 'next';
      case 2: if (!(this.opts.tutorial ?? 0)) return 'skip1'; this.fx[0].life = 0; return 'next';   // FUN_002419d8(10)
      case 3: this.events.push({ se: s[3] & 0xff }); return 'next';                                  // FUN_003e1d10
      case 5: {                                    // an effect slot's move (+0x5c = -2, start, length, x, y)
        const F = this.fx[s[3]]; F.life = -2; F.mvStart = now; F.mvLen = s[1]; F.x = s[4]; F.y = s[5]; return 'next';
      }
      case 6: return this.v[P[(s[3] + 0x12) * 2]] !== 0 ? 'next' : 'skipmode';
      case 7: this.hold = 0; this.f48f = 1; this.mode = 1; return 'stop';
      case 8: case 4: {                            // the title layout, widget 4 = 0xb842 (case 4: FUN_002420e0 first)
        if (c === 4) warnOnce('c4', 'results: box command 4 (FUN_002420e0: the world stop) not translated');
        this.layout('title', now); const w = this.byId(4);
        if (w) setTextId(D, w, 0xb842);
        this.c5db0(s, w, now, -1, -1); return 'next';
      }
      case 9: { this.layout('points', now); const w = this.byId(0x1f); this.c7318(w); this.c5db0(s, w, now, -1, -1); return 'next'; }
      case 10: this.f48f = 0; this.mode = 1; this.hold = 0; return 'next';
      case 0xb: if (this.f1028 !== 0x10) this.hold = s[1]; return 'next';
      case 0xc: case 0xf:                          // FUN_003c73f0 (layout 0x4795c8) -> mode 5 / 2
        // GUESS: the EXP -> gil exchange prompt (FUN_003c73f0, layout 0x4795c8) is left out (not decoded)
        warnOnce('c73f0', 'results: the EXP exchange screen after the Status (FUN_003c73f0, layout 0x4795c8) is not on the page: left out, the box goes on (GUESS)');
        this.mode = c === 0xc ? 5 : 2; return 'next';
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: {
        const w = this.byId(T.widgets[s[3]]);
        this.c5db0(s, w, now, P[2 * s[3]], P[2 * s[3] + 1]); return 'next';
      }
      case 0x16: { const w = this.byId(T.widgets[s[3]]); this.c5db0(s, w, now, -1, -1); return 'next'; }
      case 0x17: case 0x18: {
        const w = this.byId(T.widgets[s[3]]);
        const val = this.v[P[2 * s[3]]];
        if (u32(val - 1) < 0x27) {
          if (w) setTextId(D, w, (c === 0x17 ? T.text428 : T.text388)[val]);
          this.c5db0(s, w, now, -1, -1);
        }
        return 'next';
      }
      case 0x19: {                                 // the rows layout (override 0x51f960); FUN_003e2730: widget 0xe = 0xb82f
        this.layout('rows', now);
        if (this.opts.e2730 ?? true) { const e = this.byId(0xe); if (e) setTextId(D, e, 0xb82f); }
        const w = this.byId(7); this.c7318(w); this.c5db0(s, w, now, -1, -1); return 'next';
      }
      case 0x1a: {                                 // the default kind: the title layout, widget 4 = 0xb800 (0xb878: totals)
        this.layout('title', now); const w = this.byId(4);
        if (w) setTextId(D, w, this.f1028 === 0x10 ? 0xb878 : 0xb800);
        this.c5db0(s, w, now, -1, -1); return 'next';
      }
      case 0x1b: this.closed = true; this.table = null; this.events.push('closed'); return 'closed';   // FUN_003b7830(box, 0, +0x48e)
      default:
        warnOnce('cmd' + c, 'results: box command ' + c + ' (FUN_003c6600) not used by kind 0x1d');
        return 'next';
    }
  }
  // FUN_003c7318: the section's name in w (not in the tutorial), the row widgets hidden
  c7318(w) {
    const T = this.T, D = this.D;
    if (w && !(this.opts.tutorial ?? 0) && this.f1028 < 0x11 && i32(T.sectionNames[this.f1028]) !== -1) setTextId(D, w, T.sectionNames[this.f1028]);
    for (const id of T.widgets) {
      if (id === 0xff) break;
      const x = this.byId(id);
      if (x && x !== this.screen.root) x.flags |= 1;
    }
  }
  // FUN_003c58b8: an effect in slot s[2] (book-keeping; not drawn)
  slot(s, now) {
    const S = this.fx[s[2]];
    S.h = -1;                                      // FUN_003c5c50
    let id = s[3];
    if (id === -1) { id = S.id; if (id === -1) return; }
    warnOnce('fx', 'results: the Status screen\'s effects (FED a0093, ids 0x8174....) are not drawn');
    S.h = 1; S.id = id; S.since = now;
    this.events.push({ fx: u32(id) });
  }
  // FUN_003c5db0: widget slot s[3]: fade in over 100 ms (op != -0xd); ops -13..-8: the value text from stats pa / pb
  c5db0(s, w, now, pa, pb) {
    const W = this.ws[s[3]];
    W.op = s[2]; W.w = w;
    if (s[2] === -0xd) { W.mode = 0; W.end = 0; } else { W.mode = 1; W.end = now + 100; }
    W.life = s[1] === 0 ? -1 : s[1];
    if (u32(s[2] + 0xd) < 6) {
      W.a = pa < 0 ? 0 : this.v[pa];
      W.b = pb < 0 ? 0 : this.v[pb];
      W.t0 = s[2] === -9 ? (u32(now) < 0xc9 ? 0 : now - 200) : now;
      if (w) { w.str = null; this.c7068(W, now); }
    } else W.t0 = 0;
    if (w) { w.flags &= ~1; if (W.mode === 1 && w.c58) w.c58[3] = 0; }   // FUN_003cb360(w, 0)
  }
  // FUN_003c7068: the value counts up over 200 ms (FUN_003d0d08) and is printed by the op's format
  c7068(W, now) {
    const D = this.D;
    const from = W.op === -0xc ? 0 : W.b, to = W.a;
    const v = d0d08(from, to, now, W.t0, 200);
    if (v === W.a) W.t0 = 0;
    const fmt = id => D.msg[id] || Uint8Array.of();
    let str;
    switch ((W.op + 0xd) & 0xff) {
      case 0: case 4: case 5: str = sprintf(fmt(0xb837), v); break;
      case 1: str = sprintf(fmt(0xb83a), v, W.b); break;
      case 2: str = sprintf(fmt(0xb839), Math.trunc(v / 3600), Math.trunc((v % 3600) / 60), v % 60); break;
      case 3: str = sprintf(fmt(0xb838), v); break;
      default: return;
    }
    W.text = str;
    if (W.w) setString(D, W.w, str);
  }
  // the end of FUN_003c6050: effect lives / moves (FUN_003c5a98 / FUN_003c5b00) and the widget fades and counts
  tail(el, now) {
    for (const S of this.fx) {
      if (S.h === -1) continue;
      if (!(el < u32(S.life))) { S.h = -1; this.events.push({ fxEnd: u32(S.id) }); }
    }
    for (const W of this.ws) {
      if (!W.w) continue;
      let a = null;
      if (W.mode === 0) {
        if (u32(W.life) <= el) { W.mode = 2; W.end = now + 100; }
      } else if (W.mode === 1) {
        if (now < W.end) a = (0x80 - Math.trunc(((W.end - now) * 0x80) / 100)) & 0xff;
        else { W.mode = 0; a = 0x80; }
      } else if (now < W.end) a = Math.trunc(((W.end - now) * 0x80) / 100) & 0xff;
      else { W.mode = 0; W.w.flags |= 1; W.w = null; W.t0 = 0; continue; }
      if (a !== null && W.w.c58) W.w.c58[3] = a;
      if (W.t0) this.c7068(W, now);
    }
  }
  c7278() {                                        // FUN_003c7278: lives -2 -> 0
    for (const S of this.fx) if (S.id !== -1 && S.life === -2) S.life = 0;
    for (const W of this.ws) if (W.w && W.life === -2) W.life = 0;
  }
  c72f8(now) { this.start = now; this.mode = 0; this.step++; this.f48f = 0; }   // FUN_003c72f8
  draw(now) { return this.screen ? this.screen.draw(now) : null; }
  // the drawn rows: label / value text of the visible widgets (tests)
  texts() {
    if (!this.screen) return [];
    const out = [];
    for (const w of this.screen.all) if (w.str && !(w.flags & 1)) out.push({ id: w.id, text: Array.from(w.str, c => String.fromCharCode(c)).join(''), a: w.c58 ? w.c58[3] : null });
    return out;
  }
}
function blankWs() { return { op: 0, mode: 0, end: 0, life: 0, w: null, a: 0, b: 0, t0: 0, text: null }; }
// FUN_003d0d08
export function d0d08(from, to, now, t0, dur) {
  if (u32(now) < u32(t0 + dur)) return i32(to - Math.trunc(i32((t0 + dur - now) * (to - from)) / dur));
  return to;
}

// ---------------------------------------------------------------- the level end on the page (play.js)
// createResults({ stageInfo, warn }): the stats + clock (from the save), the box factory for stage_info.js (kind 2),
// the stage controller's hooks (endSection, calc, exit). Returns at once; the data loads behind it.
export function createResults({ stageInfo = null, gil = null, warn = m => console.warn(m), url = 'data/results.json', pauseUrl = 'data/pause.json', siUrl = 'data/stage_info.json' } = {}) {
  const stats = new SectionStats();
  const R = { stats, D: null, ended: false, exit: null, log: [], gil: gil || (() => 0) };
  R.ready = (async () => {
    try {
      const [rj, pj, sj] = await Promise.all([url, pauseUrl, siUrl].map(u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null)));
      if (!rj || !pj) { warn('results: no ' + url + ' or ' + pauseUrl + ' (export_web_results.py): the level end runs without the Status screen'); return; }
      const { loadPauseData } = await import('./pause.js');
      R.D = loadResultsData(rj, loadPauseData(pj), sj);
    } catch (e) { warn('results: bad data, no Status screen: ' + String(e)); }
  })();
  R.frame = ms => stats.tick(ms);                                       // FUN_00242a50
  R.gameOver = () => stats.gameOver();                                  // FUN_00242938
  R.endSection = () => { stats.sectionEnd(); R.log.push('endSection'); };   // FUN_003a26a8 -> FUN_003fdb00
  R.calc = vm => {                                                      // FUN_003a55e8
    if (!R.D) { warnOnce('calcdata', 'results: no data/results.json: Intermission.calc() left out', warn); return; }
    runCalc(R.D.res.calc, stats, vm, { warn }); R.log.push('calc');
  };
  // FUN_0039df70 -> request 0x14 -> FUN_00241ed8(181, 0, 0, 0): the next stage; not on the page
  R.onExit = (z, a, b) => {
    R.exit = [z, a, b]; R.log.push('exit ' + z);
    console.info('results: Zone.exit(' + z + ', ' + a + ', ' + b + '): the game asks for the next stage (FUN_00241ed8, DAT_004b8ba0 = ' + z + ') and ends this stage\'s program; the next stage is not on the page: stopped here');
  };
  if (stageInfo) {
    // FUN_003fdb48(2): FUN_003fdb00; FUN_003fdf00 state 4: box kind 0x1d is this module's
    stageInfo.onBegin = kind => { if (kind === 2) stats.sectionEnd(); };
    stageInfo.makeBox = (bk, now) => {
      if (bk !== BOX_KIND_STATUS) return null;
      if (!R.D) { warnOnce('nobox', 'results: no data/results.json: the Status box closes at once', warn); return { closed: true, events: [], frame() {}, draw() { return null; } }; }
      R.box = new ResultsBox(R.D, stats, now, { gil: R.gil }); R.ended = true; R.log.push('status');
      return R.box;
    };
  }
  return R;
}
