// test_hud.mjs -- hud_core.js (the game's HUD draw list) against the hero GS dump, plus the HP gauge's
// decoded behaviour. Run: node native/web/test_hud.mjs
// Data (gitignored): data/hud/hud.json and data/hud/dump_z128_hero_163235.json, both from
//   python3 -I native/assets/models/export_web_hud.py --dump tools/gsdump/dumps/z128_hero_163235.bin
// The dump and the save state are different moments; what differs between them is the CHAIN pulse
// (FUN_003b4fa0 on the HUD clock), so the clock is set to the dump's phase (see check 1).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const HUD = path.join(here, 'data/hud/hud.json'), DUMP = path.join(here, 'data/hud/dump_z128_hero_163235.json');
if (!existsSync(HUD) || !existsSync(DUMP)) { console.log('SKIP: data/hud missing (export_web_hud.py --dump ...)'); done(); }
// MUTATE_HUD = the path of a mutated hud_core.js copy (mutation runs; worker 0237)
const HUD_MOD = process.env.MUTATE_HUD ? (await import('node:url')).pathToFileURL(path.resolve(process.env.MUTATE_HUD)).href : './hud_core.js';
const { HudState, hpText, pulse, scissorFb, mapA, hitAngle } = await import(HUD_MOD);
const data = JSON.parse(readFileSync(HUD, 'utf8')), dump = JSON.parse(readFileSync(DUMP, 'utf8'));
const warnings = [];
console.warn = m => warnings.push(String(m));

const TBP = { menu1: 10756, menu2: 10792, menu3: 10828, menu4: 10960, font: 0 };
const CBP_FONT = n => 16379 - n;                    // FUN_003dd5b0(n): CBP base - n (dump: 16375..16378)
const FULL = [0, 431, 0, 511];
const verts = p => p.kind === 'sprite'
  ? [[p.v[0][0], p.v[0][1], p.v[0][2], p.v[0][3], p.c], [p.v[1][0], p.v[0][1], p.v[1][2], p.v[0][3], p.c],
     [p.v[1][0], p.v[1][1], p.v[1][2], p.v[1][3], p.c], [p.v[0][0], p.v[1][1], p.v[0][2], p.v[1][3], p.c]]
  : p.v.map((v, i) => [v[0], v[1], v[2], v[3], p.c[i]]);
const key = vs => vs.map(v => v.slice(0, 4).map(x => x.toFixed(4)).join(',') + '|' + v[4].join(',')).sort().join(' ');
const box = vs => [Math.min(...vs.map(v => v[0])), Math.min(...vs.map(v => v[1])), Math.max(...vs.map(v => v[0])), Math.max(...vs.map(v => v[1]))];
const onScreen = r => { const b = box(r.v); return b[2] > 0 && b[0] < 432 && b[3] > 0 && b[1] < 512 && r.sc[0] <= r.sc[1] && r.sc[2] <= r.sc[3]; };
const visible = (p) => { const b = box(verts(p)), s = p.scissor || FULL; return b[2] > 0 && b[0] < 432 && b[3] > 0 && b[1] < 512 && s[0] <= s[1] && s[2] <= s[3]; };

// 1. the hero frame: every primitive in the dump's HUD draw list, in order, vertex for vertex. Clock
// phase: the CHAIN glow is 88 on CHAIN (drawn before callback 0x32 runs) and 103 on the pieces after
// it = FUN_003d0ad0 at t and t - 20 ms (half period 200 - 150 x 200 / 1000 = 170): t = 53 (mod 340).
{
  const st = new HudState(data);
  st.now = 33; st.prims(); st.now = 53;              // the frame before (CHAIN keeps last frame's alpha)
  const ours = st.prims().filter(p => p.kind !== 'line');
  let n = 0, bad = [];
  const want = dump.slice(0, ours.length);
  for (let i = 0; i < ours.length && i < dump.length; i++) {
    const o = ours[i], d = dump[i];
    if (!onScreen(d) && !visible(o)) continue;       // off-screen tail (the message bar below the frame)
    const tex = o.tex == null ? null : TBP[o.tex];
    const sameTex = (o.tex == null) ? !d.tme : (d.tme && d.tbp === tex && (o.tex !== 'font' || d.cbp === CBP_FONT(o.clut)));
    const sc = o.scissor || FULL;
    const same = sameTex && key(verts(o)) === key(d.v.map(v => [v[0], v[1], o.tex == null ? v[2] * 0 : v[2], o.tex == null ? v[3] * 0 : v[3], v[4]]))
      && sc.join() === d.sc.join();
    if (same) n++; else bad.push(i);
  }
  const shown = dump.filter(onScreen).length;
  ok(bad.length === 0 && n === shown, `hero frame: ${n} / ${shown} on-screen dump primitives equal (texture + CLUT, 4 vertices x y u v rgba, scissor)` +
    (bad.length ? `; differ at ${bad.slice(0, 8).join(', ')}` : ''));
  ok(!dump.slice(ours.length).some(onScreen), `nothing on screen in the dump after our ${ours.length} primitives`);
  // pieces we know by name (redundant with the above, for readable failures)
  const hp = ours.find(p => p.kind === 'strip' && p.tex == null && p.c[0].join() === '224,141,151,78');
  ok(hp && box(verts(hp)).map(x => x.toFixed(4)).join() === '54.0000,34.2500,161.1250,40.0000', `HP bar (FUN_003aed60 row 0): ${hp && box(verts(hp)).map(x => x.toFixed(4))}`);
  const mk = ours.find(p => p.kind === 'strip' && p.tex == null && p.c[0].join() === '240,240,200,128');
  ok(mk && mk.c.map(c => c[2]).join() === '200,240,200,240', `MP marker (row 3): colours c0 left, c1 right: ${mk && mk.c.map(c => c[2])}`);
  const glyphs = ours.filter(p => p.tex === 'font' && p.kind === 'strip' && p.v[0][1] < 60).map(p => p.v[0][2]);
  ok(glyphs.join() === [264, 276, 180, 168, 264, 276, 180].map(u => u + 1 / 16).join(), `"780/780": number glyph cells (FUN_003cedf0, 12 px pitch) ${glyphs.map(u => Math.floor(u))}`);
  const box8 = ours.filter(p => p.tex === 'menu4' && p.c[3] === 30);
  ok(box8.length === 9 && box8.every(p => p.scissor && p.scissor[2] > p.scissor[3]), `item-list background: 9 pieces, all clipped away by its 0-height group (FUN_003d5ac0 +0x3c bit 0): scissor ${box8[0]?.scissor}`);
  const mid = box8.find(p => p.wrap && p.wrap.v);
  ok(mid && mid.wrap.v.join() === '3,104', `region repeat on the stretch row (FUN_003d3fb8 CLAMP_1 MINV 3 MAXV 104): ${mid && mid.wrap.v}`);
}

// 2. HP: FUN_00339988 -> FUN_003adda8 (lag on) -> FUN_003aec10 / FUN_003aed00; the drain FUN_003aec78
{
  const st = new HudState(data);
  st.now = st.mnow = 100000;                         // the gauge reads FUN_0023c1f0 (mnow)
  st.setHP(500, 780);
  ok(JSON.stringify(st.hpElem.text) === JSON.stringify(hpText(500, 780)) && hpText(500, 780).join() === [0x18, 0x13, 0x13, 0x12, 0x1a, 0x1b, 0x13].join(),
    `HP text = FUN_003cbb58 codes ${hpText(500, 780).map(c => c.toString(16))}`);
  const barX = st2 => {
    const p = st2.prims().filter(q => q.kind === 'strip' && q.tex == null && q.c[0][0] === 224 && q.c[0][3] === 78)[0];
    return p ? p.v[1][0] : null;
  };
  const lag = st2 => st2.prims().filter(q => q.kind === 'strip' && q.tex == null && q.c[0][0] === 224 && q.c[0][3] === 78 - 0x20);
  const lagA = st2 => lag(st2).filter(q => q.v[1][0] > q.v[0][0]).length;     // a strip with width
  const want0 = mapA((69 + Math.trunc(122 * 500 / 780)) * 16, 30 * 16)[0] / 16;
  ok(barX(st) === want0 && lagA(st) === 1, `hit to 500: the bar ends at cur (${barX(st)} px, want ${want0}), lag segment (alpha 0x4e - 0x20) drawn`);
  st.now = st.mnow = 100500;
  st.prims();
  ok(st.hp[3] === 640, `500 ms later the shown value drains to 780 - 280 x 500 / 1000 = 640 (FUN_003aec78): ${st.hp[3]}`);
  st.now = st.mnow = 101001;
  st.prims();
  ok(st.hp[3] === 500 && st.hp[4] === 0 && lagA(st) === 0 && lag(st).length === 1, `after 1000 ms: shown = cur, timer cleared, the lag strip has no width (still drawn, as FUN_003aed60 does while min < max) (${st.hp[3]}, ${st.hp[4]})`);
  { // the lag runs on FUN_0023c1f0 (FUN_003aec10 / FUN_003aec78): a hit, then a 2 s pause (only the real-time clock moves)
    const sp = new HudState(data); sp.now = sp.mnow = 100000; sp.setHP(500, 780); sp.mnow += 2000; sp.prims();
    ok(sp.hp[3] === 500 && sp.hp[4] === 0, `hit, 2 s pause (mnow only): the lag has drained, as in the game (${sp.hp[3]}, ${sp.hp[4]})`);
    const sq = new HudState(data); sq.now = 50000; sq.mnow = 100000; sq.setHP(500, 780); sq.mnow += 500; sq.prims();
    ok(sq.hp[3] === 640, `the lag's start and drain both on mnow (now 50000 apart): 500 ms later 640 (${sq.hp[3]})`);
  }
  const st3 = new HudState(data);
  st3.setHP(0, 780);
  ok(st3.prims().filter(q => q.kind === 'strip' && q.tex == null && q.c[0][0] === 224 && q.c[0][3] === 78).length === 1 && !st3.prims().some(q => q.kind === 'line' && q.v.some(v => v[1] > 33.5)),
    'HP 0: the zero-width bar still drawn, no edge lines (FUN_003aed60: lines only for cur > 0)');
}

// 3. small decoded pieces
ok(pulse(1, 170, 0x40, 0xc0, 53) === 103 && pulse(1, 170, 0x40, 0xc0, 33) === 88 && pulse(1, 170, 0x40, 0xc0, 1 + 170) === 0xc0 && pulse(1, 170, 0x40, 0xc0, 1 + 340) === 0x40,
  'FUN_003d0ad0 triangle wave (0x40 -> 0xc0 -> 0x40, 170 ms each way)');
ok(scissorFb(16, 402, 37, 11).join() === '13,43,459,470' && scissorFb(16, 370, 0x200, 0).join() === '13,444,422,421',
  `FUN_003d3880 scissor mapping: ${scissorFb(16, 402, 37, 11)} (dump 13,43,459,470)`);
// 4. the hit-direction ring (FUN_00567c08 -> FUN_003af6b8 / FUN_003af740 / FUN_003b1048 kind 5), through
// HudState as the page drives it: st.hit (enemy_ai's hook), st.ringFrame once per game frame, st.prims.
// GS references (gitignored): data/hud/ring_w190_ring_0N.json from export_web_hud.py --ring-dump DUMP STATE
// (worker 0190's grab of w174_pain_a: dumps at f792 / f955 / f1013 with their save states).
{
  const ringOf = st => st.prims().filter(p => p.ring);
  const at = (fx, yaw) => {                          // the state, then 4 game frames (the dump's frame)
    const st = new HudState({ ...data, values: { ...data.values, ring: fx.ring } });
    st.now = fx.clock;
    for (let k = 0; k < 4; k++) { st.now += 20; st.ringFrame(yaw); }
    return st;
  };
  const same = (ours, ref) => ours.length === ref.length && ours.every((p, i) => p.v.every((v, k) =>
    v.slice(0, 4).every((x, j) => x === ref[i].v[k][j]) && p.c[k].every((c, j) => c === ref[i].v[k][4][j])));
  const FX = n => path.join(here, `data/hud/ring_w190_ring_0${n}.json`);
  if (!existsSync(FX(3))) console.log('SKIP ring vs GS dumps: data/hud/ring_w190_ring_0N.json missing (export_web_hud.py --ring-dump)');
  else {
    const f3 = JSON.parse(readFileSync(FX(3), 'utf8')), f1 = JSON.parse(readFileSync(FX(1), 'utf8')), f2 = JSON.parse(readFileSync(FX(2), 'utf8'));
    const r3 = ringOf(at(f3, f3.yaw));
    ok(same(r3, f3.prims), `f1013 dump: all ${f3.prims.length} ring strips equal (x y u v rgba per vertex, in order) with the save state's camera yaw ${f3.yaw.toFixed(6)} (ours ${r3.length})`);
    // f792: the camera was still turning between the state and the dump; any yaw in [1.63205, 1.63213] gives
    // these vertices (truncation to whole HUD px), the state has 1.63398
    const r1 = ringOf(at(f1, 1.63209));
    ok(same(r1, f1.prims), `f792 dump (yaw fitted: camera turning): all ${f1.prims.length} ring strips equal, segment 2 skipped, its arrow orange (ours ${r1.length})`);
    ok(f2.prims.length === 0 && ringOf(at(f2, f2.yaw)).length === 0, 'f955 dump: no timer set, no ring in the dump, none drawn');
    ok(f3.prims.every(p => p.blend.join() === '0,1,0,1,0'), 'the ring blends (Cs - Cd) As + Cd like the rest of the HUD');
  }
  // the sequence from a hit (no fixture needed)
  const st = new HudState({ ...data, values: { ...data.values, ring: { on: 1, f234: 0, timers: [0, 0, 0, 0, 0, 0, 0, 0], phase: 0, end: 0, len: 0 } } });
  st.now = 100000;
  const V = [-1070.1163, -146.0673, -1105.5870], B = [-1046.2216, -155.2970, -1098.2831];   // w190 f792: Vincent, the bullet's +0xc0
  ok(st.ringFrame(0) === undefined && ringOf(st).length === 0, 'no hit: no ring');
  st.now += 20; const sec = st.hit(V, B); st.ringFrame(0);
  ok(sec === 2 && st.ring.timers[2] === 100020 + 2000 && st.ring.phase === 1, `a hit from the f792 shooter: sector ${sec} (the game: 2), timer clock + 2000, fade in (phase ${st.ring.phase})`);
  const r0 = ringOf(st);
  const ext = ps => Math.max(...ps.flatMap(p => p.v.map(v => v[0]))) - Math.min(...ps.flatMap(p => p.v.map(v => v[0])));
  ok(r0.length === 15 && r0.every(p => p.c[0][3] === 0), `t = 0: 7 grey segments (2 strips each) + 1 arrow, alpha 0 (${r0.length}, ${r0.map(p => p.c[0][3])[0]})`);
  for (let k = 0; k < 2; k++) { st.now += 20; st.ringFrame(0); }
  const r40 = ringOf(st);
  ok(r40[0].c[0][3] === Math.trunc(40 * 32 / 100) && r40[14].c[0][3] === Math.trunc(40 * 60 / 100), `t = 40: alpha t a / len (${r40[0].c[0][3]}, ${r40[14].c[0][3]})`);
  for (let k = 0; k < 3; k++) { st.now += 20; st.ringFrame(0); }
  const rFull = ringOf(st);
  ok(st.ring.phase === 2 && rFull[0].c[0][3] === 32 && rFull[14].c[0][3] === 60, `t = len: shown (phase ${st.ring.phase}), alpha 32 / 60`);
  ok(Math.abs(ext(r0) / ext(rFull) - 1.533) < 0.01, `bit 0x400: the pieces start at 1.5 x (1.533 x on screen through the perspective) (${(ext(r0) / ext(rFull)).toFixed(3)})`);
  const arrow = () => ringOf(st).find(p => p.c[0][0] !== 128);
  const blink = [];
  for (let k = 0; k < 4; k++) { blink.push(arrow().c[0][0]); st.now += 20; st.ringFrame(0); }
  // the counter starts at 0 here; these four draws used counters 6, 7, 8, 9 (one per ringFrame): bit 1 set ->
  // the piece's own 99,68,32, clear -> 0x4188c7. The dumps: counters 2100 (f792) and 2321 (f1013), both orange
  ok(blink.join() === '99,99,199,199', `the arrow blinks every 2 frames on HUD +0x234 bit 1: counters 6-9 -> 99,99,199,199 (${blink})`);
  // the arrow's corners turn with the camera: yaw + 2 pi / 8 moves copy i to copy i + 1's place
  const st2 = new HudState({ ...data, values: { ...data.values, ring: { on: 1, f234: 0, timers: [0, 0xffffffff, 0, 0, 0, 0, 0, 0], phase: 2, end: 0, len: 100 } } });
  st2.ringFrame(0); const p1 = ringOf(st2).find(p => p.c[0][0] !== 128);
  const st3b = new HudState({ ...data, values: { ...data.values, ring: { on: 1, f234: 0, timers: [0, 0, 0xffffffff, 0, 0, 0, 0, 0], phase: 2, end: 0, len: 100 } } });
  st3b.ringFrame(Math.fround(6.2831855 / 8));
  const p2 = ringOf(st3b).find(p => p.c[0][0] !== 128);
  ok(p1 && p2 && p1.v.every((v, k) => Math.abs(v[0] - p2.v[k][0]) <= 1 / 16 * 3 && Math.abs(v[1] - p2.v[k][1]) <= 1 / 16 * 3), 'CAM+0x178: segment i is drawn at angle i 2 pi / 8 - yaw (segment 2 at yaw pi / 4 = segment 1 at yaw 0)');
  // timing: the 2 s timer, then FUN_003af740 hides kind 5 (100 ms fade out)
  while (st.now < 100020 + 2000 - 20) { st.now += 20; st.ringFrame(0); }
  ok(st.ring.timers[2] !== 0 && st.ring.phase === 2, `still lit 20 ms before the 2 s (${st.now - 100020} ms)`);
  st.now += 20; st.ringFrame(0);
  ok(st.ring.timers[2] === 0 && st.ring.phase === 3 && !ringOf(st).some(p => p.c[0][0] !== 128), 'at 2000 ms: timer cleared, the arrow gone, the ring fades out (phase 3)');
  for (let k = 0; k < 5; k++) { st.now += 20; st.ringFrame(0); }
  ok(st.ring.phase === 0 && ringOf(st).length === 0, '100 ms later: hidden');
  // a second hit before the first lapses keeps the ring; a hit while fading out reverses the fade
  // direction (FUN_00567c08 -> FUN_00260e74 sign: the angle is negative when (d x X).y = d.z < 0)
  ok(hitAngle([0, 0, 0], [10, 0, 0]) === 0 && hitAngle([0, 0, 0], [0, 5, -10]) === -1024 && hitAngle([0, 0, 0], [0, 0, 10]) === 1024 &&
     hitAngle([0, 0, 0], [-10, 0, 0]) === 2048, `FUN_00567c08 angle units: +X 0, -Z -1024, +Z 1024, -X 2048 (${hitAngle([0, 0, 0], [0, 5, -10])})`);
  // camera-relative direction (review): a shooter along the camera's forward (sin Y, 0, cos Y) puts the arrow
  // above the ring's centre, its right (cos Y, 0, -sin Y) to the right, behind below, left to the left
  for (const Y of [0, 1, 1.632, -2.5]) {
    const fw = [Math.sin(Y), 0, Math.cos(Y)], rt = [Math.cos(Y), 0, -Math.sin(Y)];
    const res = {};
    for (const [name, d] of Object.entries({ front: fw, right: rt, back: fw.map(x => -x), left: rt.map(x => -x) })) {
      const sy = new HudState({ ...data, values: { ...data.values, ring: { on: 1, f234: 0, timers: [0, 0, 0, 0, 0, 0, 0, 0], phase: 0, end: 0, len: 0 } } });
      const V = [-1070, -146, -1105];
      sy.hit(V, V.map((x, k) => x + 100 * d[k]));
      for (let k = 0; k < 6; k++) { sy.now += 20; sy.ringFrame(Y); }
      const all = ringOf(sy), lit = all.filter(p => p.c[0][0] !== 128);
      const xs = all.flatMap(p => p.v.map(v => v[0])), ys = all.flatMap(p => p.v.map(v => v[1]));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const mean = (ps, k) => ps.flatMap(p => p.v.map(v => v[k])).reduce((a, b) => a + b, 0) / (ps.length * 4);
      res[name] = lit.length === 1 ? [mean(lit, 0) - cx, mean(lit, 1) - cy] : null;
    }
    const r = res;
    ok(r.front && r.right && r.back && r.left && r.front[1] < -30 && Math.abs(r.front[0]) < 25 && r.back[1] > 30 && Math.abs(r.back[0]) < 25 &&
       r.right[0] > 60 && Math.abs(r.right[1]) < 25 && r.left[0] < -60 && Math.abs(r.left[1]) < 25,
       `yaw ${Y}: shooter ahead -> arrow above the ring centre, right -> right, behind -> below, left -> left (${Object.entries(r).map(([k, v]) => k + ' ' + (v ? v.map(x => x.toFixed(0)).join('/') : '-')).join(', ')})`);
  }
  ok(hitAngle([0, 0, 0], [0, 0, 0]) === 0 && hitAngle([0, 0, 0], [0, -50, 0]) === 0, 'GUESS (VU0 0/0 = +max): no XZ component -> angle 0');
  const sts = new HudState(data);
  const secOf = a => { sts.ring.timers.fill(0); sts.ring.phase = 0; return sts.ring.hit(a, 0, 100); };
  ok(secOf(155) === 2 && secOf(0) === 2 && secOf(-1024) === 4 && secOf(1024) === 0 && secOf(2048) === 6 && secOf(0x500) === 8 && sts.ring.timers.every(t => t === 0),
    'FUN_003af6b8 sector ((0x1000 - ((a + 0xb00) & 0xfff)) >> 9): a 155 (w174 call log) -> 2, +Z -> 0, -Z -> 4, -X -> 6, a 0x500 -> 8 (no timer)');
  // FUN_003af740 hides kind 5 only when a timer lapses this frame and none is left: a hit on the sector-8
  // boundary (a & 0xfff == 0x500: no timer) shows the ring, which then stays up (the game's own behaviour)
  const s8 = new HudState({ ...data, values: { ...data.values, ring: { on: 1, f234: 0, timers: [0, 0, 0, 0, 0, 0, 0, 0], phase: 0, end: 0, len: 0 } } });
  s8.ring.hit(0x500, s8.now, 100);
  for (let k = 0; k < 200; k++) { s8.now += 20; s8.ringFrame(0); }
  ok(s8.ring.phase === 2 && ringOf(s8).length === 16, `a sector-8 hit: shown with no arrow, still up 4 s later (phase ${s8.ring.phase}, ${ringOf(s8).length} strips)`);
  ok(ringOf(s8).every(p => p.bilinear && p.tex === 'menu1'), 'kinds >= 5 draw bilinear (FUN_003d3830(1)) from menu1 (DAT_004727f0[10]); TEX1 is not in the GS parser, so code only');
  sts.ring.on = 0; sts.ring.phase = 0; ok(sts.ring.hit(0, 0, 100) === -1 && sts.ring.phase === 0, 'HUD +0x230 off: nothing');
}
// 7. the panels' slides (worker 0203): FUN_003ad5b0 -> FUN_003aff20 at the game over request, FUN_003ad560 after a
// reload; FUN_003d0fd0 / FUN_003d0f08 / FUN_003d0d50 / FUN_003cb380. Traces (gitignored, TRACE_FIELDSET=hud):
// tools/trace/out/w203_hudslide.jsonl (w192 death route, request f880) and w203_reload_hud.jsonl (worker 0201's reload
// state); GS dumps (export_web_hud.py --dump tools/trace/out/w203/w203_slide.gs / w192_menu.gs -> data/hud/dump_*.json).
{
  const { slideStart, slideAt, restartedHud, RELOAD_SHOW_LEAD } = await import(HUD_MOD);
  ok(data.slides && data.slides.length === 11 && data.chain.every(e => e.rel) && data.chain.filter(e => e.depth === 0).every(e => e.slide),
     'hud.json: the slide table (DAT_00471db0 / DAT_00471dc0), each element\'s +0x1c / +0x1e and each group\'s +0x48');
  const T = data.slides;
  ok(T[0].slot === 5 && T[0].len === 5 && T[0].dy === -100 && T[1].slot === 6 && T[1].len === 5 && T[1].dy === 100 &&
     T[8].slot === 8 && T[8].dx === -512 && T[9].dx === 512 && T[10].dx === -512 && T[8].len === 2 && T[5].slot === 1,
     'panels: 0 = slot 5 (HP) up 100 / 500 ms, 1 = slot 6 (weapon) down 100 / 500 ms, 8 / 9 / 10 = slots 8-10 -512 / +512 / -512 / 200 ms');
  // unit: the ease's ends and a reversal (FUN_003d0f08 from a running state 3 mirrors the start)
  const an = [2, 5, 0, 0, 0, -100, 0];
  ok(slideStart(an, T[0], 1000, true) && an[0] === 3 && an[6] === 1000 && slideAt(an, 1000)[1] === 0, 'start: state 3, start = now, t 0 = the base');
  ok(!slideStart(an, T[0], 1100, true), 'out again while going out: nothing (FUN_003d0fd0 states 3 / 4)');
  const mid = slideAt(an, 1250)[1];
  ok(mid === -50 && slideAt(an, 1499)[1] === -99 && an[0] === 3, `the sine ease: t 250 -> -50, t 499 -> -99 (${mid})`);
  const rv = an.slice(); slideStart(rv, T[0], 1100, false);
  ok(rv[0] === 1 && rv[6] === 700 && slideAt(rv, 1100)[1] === slideAt(an.slice(), 1100)[1], 'in while going out: start mirrored (2 now - (start + 500)), same position');
  const odd = [2, 5, 0, 0, 0, -101, 0]; slideStart(odd, { len: 5, dx: 0, dy: -101 }, 1000, true);
  ok(slideAt(odd.slice(), 1499)[1] === -99 && slideAt(odd.slice(), 1250)[1] === -50, 'an odd negative d halves toward zero ((d + sign bit) >> 1 = -50, not -51)');
  const late = [3, 5, 0, 0, 0, -100, 1000]; slideStart(late, T[0], 1600, false);
  ok(late[0] === 1 && late[6] === 1600, 'in after an out whose time ran out (start + 500 < now, not yet stepped): start = now (FUN_003d0f08 t < now), not mirrored');
  const two = new HudState(data); two.now = 7000; two.mnow = 9000; two.ring.phase = 2; two.hideAll();
  ok(two.chain[two.groupOf[5]].slide[6] === 9000 && two.ring.end === 7000 + data.ring.len_show,
     'two clocks: the slides read FUN_0023c1f0 (mnow, 0046b094), the ring FUN_003e2450 (now, DAT_004f58ec)');
  const e1 = slideAt(an, 1500);
  ok(e1[1] === -100 && an[0] === 4 && an[6] === 0, 'end: state 4 at base + d, start cleared');

  const TR = path.join(here, '../../tools/trace/out/w203_hudslide.jsonl'), TR2 = path.join(here, '../../tools/trace/out/w203_reload_hud.jsonl');
  const G = [5, 6, 8, 9, 10];
  const hexS = (h, o) => { const b = Buffer.from(h, 'hex'); return b.readInt16LE(o); };
  const recOf = r => Object.fromEntries(G.map(g => [g, { x: hexS(r['g' + g], 6), y: hexS(r['g' + g], 8), st: Buffer.from(r['g' + g + '_slide'], 'hex')[0],
                                                         t0: Buffer.from(r['g' + g + '_slide'], 'hex').readUInt32LE(12) }]));
  const groupsOf = st => Object.fromEntries(G.map(g => { const e = st.chain[st.groupOf[g]]; return [g, { x: e.rect[0], y: e.rect[1], st: e.slide[0] }]; }));
  const load = f => { const R = {}; for (const l of readFileSync(f, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (r.frame != null) R[r.frame] = r; } return R; };
  // the game's own clock per logic frame is not logged: logic k reads it between records k and k + 1 (f880: 250370
  // between 250355 / 250376), so record k + 1's positions must come from one integer t in that window
  const exact = (R, k0, k1, t0, build) => {
    const bad = [];
    for (let k = k0; k <= k1; k++) {
      const want = recOf(R[k + 1]);
      let hit = false;
      for (let c = R[k].clock_ms; c <= R[k + 1].clock_ms && !hit; c++) {
        const st = build(t0); st.mnow = c; st.slideFrame();
        const got = groupsOf(st);
        hit = G.every(g => got[g].x === want[g].x && got[g].y === want[g].y && got[g].st === want[g].st);
      }
      if (!hit) bad.push(k + 1);
    }
    return bad;
  };
  if (!existsSync(TR)) console.log('SKIP slides vs the game: tools/trace/out/w203_hudslide.jsonl missing (TRACE_FIELDSET=hud trace.py w203_hudslide.json)');
  else {
    const R = load(TR);
    const t0 = recOf(R[881])[5].t0;
    const startOut = c => { const st = new HudState(data); st.mnow = c; st.hideAll(); return st; };
    ok(G.every(g => recOf(R[880])[g].st === 2 && recOf(R[881])[g].st === 3 && recOf(R[881])[g].t0 === t0) && t0 > R[880].clock_ms && t0 < R[881].clock_ms,
       `the slide-out starts in the request's frame (f880, clock ${t0}): states 2 -> 3 in record 881`);
    const bad = exact(R, 880, 910, t0, startOut);
    ok(bad.length === 0, `FUN_003d0d50 with the game's clock: records 881-911, all five panels exact (x, y, state)${bad.length ? ': not ' + bad.join(' ') : ''}`);
    // the page: hud.js tick (clock + 20, the queued hide, the step) from the request's frame on
    const st = new HudState(data); st.mnow = R[880].clock_ms - 5;
    let worst = 0, wAt = '', stBad = [];
    for (let f = 880; f <= 920; f++) {
      st.mnow += 20; if (f === 880) st.hideAll(); st.slideFrame();
      const got = groupsOf(st), want = recOf(R[f + 1]);
      for (const g of G) {
        const d = Math.max(Math.abs(got[g].x - want[g].x), Math.abs(got[g].y - want[g].y));
        if (d > worst) { worst = d; wAt = `slot ${g} f${f}`; }
        if (got[g].st !== want[g].st) stBad.push(`slot ${g} f${f}`);
      }
    }
    ok(stBad.length === 0, `page (20 ms frames) vs the game: the same state each frame (start f880, 8-10 done f890, 5 / 6 done f905)${stBad.length ? ': ' + stBad.slice(0, 4).join(', ') : ''}`);
    ok(worst <= 12, `page vs the game, positions: worst ${worst} HUD px (${wAt}; the game's clock is not 20 ms a frame: PCSX2 frames 18-32 ms)`);
    // the GS dump of f887 (state f883 + 4): every HUD primitive at one slide time only, 143 ms (the dump's logic clock)
    const DS = path.join(here, 'data/hud/dump_w203_slide.json'), DM = path.join(here, 'data/hud/dump_w192_menu.json');
    const pos = vs => vs.map(v => v[0].toFixed(4) + ',' + v[1].toFixed(4)).sort().join(' ');
    const vpos = p => pos(verts(p));
    if (!existsSync(DS) || !existsSync(DM)) console.log('SKIP slides vs GS dumps: data/hud/dump_w203_slide.json / dump_w192_menu.json missing');
    else {
      const ds = new Set(JSON.parse(readFileSync(DS, 'utf8')).map(r => pos(r.v))), dm = new Set(JSON.parse(readFileSync(DM, 'utf8')).map(r => pos(r.v)));
      const at = t => { const s = new HudState(data); s.now = s.mnow = 100000; s.setHP(0, 780); s.now += 2000; s.mnow += 2000; s.hideAll(); s.mnow += t; s.slideFrame(); return s.prims().filter(p => p.kind !== 'line'); };
      const full = [];
      for (let t = 0; t <= 520; t++) { const ps = at(t); if (ps.every(p => ds.has(vpos(p)))) full.push(t); }
      ok(full.length === 1 && full[0] === 143 && at(143).length === 97, `f887 dump: all 97 HUD primitives where the game drew them, at slide time ${full.join(' / ')} ms only`);
      const end = at(600);
      ok(end.every(p => dm.has(vpos(p))) && end.every(p => { const ys = verts(p).map(v => v[1]), xs = verts(p).map(v => v[0]); return Math.min(...ys) >= 512 || Math.max(...ys) <= 0 || Math.max(...xs) <= 0 || Math.min(...xs) >= 432; }),
         'f1240 dump (the menu up): all 97 where the game drew them, every one off the 432 x 512 frame');
    }
  }
  // back after a reload: the rebuilt HUD slides in (FUN_003ad560); the page restores at record 10 (Vincent's placement)
  if (!existsSync(TR2)) console.log('SKIP slide-in vs the game: tools/trace/out/w203_reload_hud.jsonl missing');
  else {
    const R = load(TR2);
    const t0 = recOf(R[0])[5].t0;
    const startIn = c => { const st = new HudState(data); st.fresh(); st.mnow = c; st.show(); return st; };
    const bad = exact(R, 0, 30, t0, startIn);
    ok(G.every(g => recOf(R[0])[g].st === 1 && recOf(R[0])[g].t0 === t0) && bad.length === 0,
       `slide-in after the reload (start ${t0}, before record 0): records 1-31 exact with the game's clock${bad.length ? ': not ' + bad.join(' ') : ''}`);
    let st = restartedHud(data, R[10].clock_ms - 5);
    let worst = 0, stBad = [];
    for (let n = 1; n <= 25; n++) {
      st.mnow += 20; st.slideFrame();
      const got = groupsOf(st), want = recOf(R[10 + n]);
      for (const g of G) {
        worst = Math.max(worst, Math.abs(got[g].x - want[g].x), Math.abs(got[g].y - want[g].y));
        if (got[g].st !== want[g].st) stBad.push(`slot ${g} n${n}`);
      }
    }
    ok(RELOAD_SHOW_LEAD === 13 && stBad.length === 0 && worst <= 2, `page Restart vs the game, records 11-35: same states (5 / 6 in until record 23), positions within ${worst} HUD px`);
    const same = (a, b) => a.chain.every((e, i) => e.rect.join() === b.chain[i].rect.join() && e.box.join() === b.chain[i].box.join() && e.flags === b.chain[i].flags &&
                                                  (!e.slide || e.slide[0] === b.chain[i].slide[0]));
    ok(same(st, new HudState(data)), 'after the slide-in: every element\'s rect / box / flags and the slide states = the start layout');
  }
  // the whole tree after the slide vs the game's RAM (w198 state f906, slid out: tree_w198_s1.json from
  // export_web_hud.py --tree): every element's rect and box (FUN_003cb380 moves the boxes too). Slot 7 slid in that run
  // only (its message panel had been up: HUD +0xac), so its elements are left out.
  const TW = path.join(here, 'data/hud/tree_w198_s1.json');
  if (!existsSync(TW)) console.log('SKIP slid tree vs the game: data/hud/tree_w198_s1.json missing (export_web_hud.py --tree)');
  else {
    const tw = JSON.parse(readFileSync(TW, 'utf8')).slice(0, data.chain.length);
    const st = new HudState(data); st.mnow = 9000; st.hideAll(); st.mnow += 600; st.slideFrame();
    const bad = st.chain.filter((e, i) => e.inSlot !== 7 && (e.rect.join() !== tw[i].rect.join() || e.box.join() !== tw[i].box.join()));
    ok(tw.length === st.chain.length && bad.length === 0 && st.chain.filter(e => e.inSlot !== 7).length === 106,
       `after the slide-out: all 106 elements outside slot 7 at the game's rect and box (w198 f906 RAM)${bad.length ? ': ' + bad.slice(0, 3).map(e => e.inSlot + '/' + e.id).join(' ') : ''}`);
  }
  // a Restart during or after the slide-out ends at the start layout too (hud.js reset = restartedHud)
  for (const k of [3, 40]) {
    const s0 = new HudState(data); s0.mnow = 5000; s0.hideAll();
    for (let i = 0; i < k; i++) { s0.mnow += 20; s0.slideFrame(); }
    const st = restartedHud(data, s0.now, s0.mnow);
    const first = (st.mnow += 20, st.slideFrame(), st.chain[st.groupOf[5]].rect[1]);
    for (let i = 0; i < 40; i++) { st.mnow += 20; st.slideFrame(); }
    const ref = new HudState(data);
    ok(first < 0 && first > -100 && st.chain.every((e, i) => e.rect.join() === ref.chain[i].rect.join() && e.box.join() === ref.chain[i].box.join()),
       `Restart ${k} frames into the slide-out: the HP panel comes back in (first frame y ${first}), then the start layout`);
  }
  // the ring's hide is part of FUN_003aff20 (FUN_003b03e8 -> FUN_003b0738(5))
  const sr = new HudState(data); sr.ring.phase = 2; sr.now = 3000; sr.chainBB4 = 1; sr.hideAll();
  ok(sr.ring.phase === 3 && sr.ring.end === 3000 + data.ring.len_show && sr.chainBB4 === 0, 'FUN_003aff20 also hides the hit ring (kind 5, 100 ms) and zeroes +0xbb4 (FUN_003b4db0)');
}
ok(!warnings.some(w => /tiled|selectable|multi-frame|not exported/.test(w)), `no untranslated path hit by the drawn panels (${warnings.filter(w => !/FUN_003cd7e8/.test(w)).join('; ') || 'only the off-screen FUN_003cd7e8 text'})`);
// 8. the top-right gauge (worker 0237): the boss gauge 13 (manager 0x6e / 0x6f -> FUN_003b58e0 / FUN_003b5378, callback 0x46 =
// FUN_003b5d58, label text FUN_003cd7e8) against the r0b_boss2 GS dump (tools/trace/out/route/r0b_boss2.gs.zst, the fight on:
// export_web_hud.py --dump <it, unpacked as r0b_boss2.gs> -> data/hud/dump_r0b_boss2.json). The dump's list starts with slot 4.
{
  const DB = path.join(here, 'data/hud/dump_r0b_boss2.json');
  const gaugeOn = (o = {}) => {
    const st = new HudState(data);
    st.now = st.mnow = 500000;
    st.gaugeRequest(13, o.v ?? 7000, o.max ?? 7000, o.f ?? 1);
    if (o.show !== false) st.gaugeShow();
    st.mnow += 1000; st.slideFrame();                    // the slide-in (panel 4: 500 ms) is over
    return st;
  };
  const slot4 = st => { const g = st.groupOf[4]; return st.prims().filter(p => p.panel === g && p.kind !== 'line'); };
  if (!data.gauge || data.bars.length < 17) ok(false, 'hud.json has the gauge data and 17 bar rows (re-run export_web_hud.py)');
  else {
    const st = gaugeOn();
    ok(String.fromCharCode(...st.find(4, 0x45).text) === data.gauge.labels.map(l => String.fromCharCode(...l))[1] && st.find(4, 0x45).text.length > 0,
       `label = kelstr DAT_004729f8[1] (from the disc): ${st.find(4, 0x45).text.length} bytes`);
    ok([0x44, 0x45, 0x46].map(id => st.find(4, id).rect[2]).join() === [0x9c + 0x3c, 0x9c + 0x3c, 0xa0 + 0x3c].join(), `gauge 13 widens 0x44 / 0x45 / 0x46 by 0x3c (FUN_003b56f0): ${[0x44, 0x45, 0x46].map(id => st.find(4, id).rect[2])}`);
    ok(st.g.v[0] === 7000 && st.g.v[1] === 7000 && st.g.v[4] === 0, `gauge +0x7c = 7000 / 7000, no lag on the first request: ${st.g.v}`);
    const ours = slot4(st);
    if (!existsSync(DB)) console.log('SKIP r0b_boss2 dump part: no ' + DB);
    else {
      const dB = JSON.parse(readFileSync(DB, 'utf8'));
      let n = 0, bad = [];
      for (let i = 0; i < ours.length; i++) {
        const o = ours[i], d = dB[i];
        const tex = o.tex == null ? null : TBP[o.tex];
        const sameTex = (o.tex == null) ? !d.tme : (d.tme && d.tbp === tex && (o.tex !== 'font' || d.cbp === CBP_FONT(o.clut)));
        const same = sameTex && key(verts(o)) === key(d.v.map(v => [v[0], v[1], o.tex == null ? 0 : v[2], o.tex == null ? 0 : v[3], v[4]])) && (o.scissor || FULL).join() === d.sc.join();
        if (same) n++; else bad.push(i);
      }
      const glyphs = ours.filter(p => p.tex === 'font').length;
      ok(bad.length === 0 && n === ours.length && ours.length === 61 && glyphs === 55,
         `r0b_boss2: the gauge's ${n} / ${ours.length} primitives equal the dump's first ${ours.length} (3 icons, the line, ${glyphs} label glyph sprites, backing + bar; vertices, uv, rgba, CLUT, scissor)` + (bad.length ? `; differ at ${bad.slice(0, 8)}` : ''));
      const nxt = dB[ours.length];
      ok(nxt && !(box(nxt.v)[0] >= 230 && box(nxt.v)[1] < 52), 'the dump has no further gauge primitive after ours');
    }
    // hand cases
    const half = slot4(gaugeOn({ v: 3500 })).filter(p => p.kind === 'strip' && p.tex == null && p.c[0].join() === '151,141,224,78');
    // FUN_003aed60: right end x + (w - 1) cur / max = 280 + 219 x 3500 / 7000 (109) = 389 HUD px -> 389 x 0x1b0 >> 9 frame px
    ok(half.length === 1 && Math.abs(box(verts(half[0]))[2] - (389 * 0x1b0) / 512) < 0.07,
       `3500 / 7000: the row-9 bar is half the backing (${half.length && box(verts(half[0])).map(x => x.toFixed(2))})`);
    { const w = []; const ow = console.warn; console.warn = m => w.push(String(m)); slot4(gaugeOn({ v: 1000 })); console.warn = ow;
      ok(w.some(m => /FUN_003af1e0 \(row 10\)/.test(m)), 'below a quarter: the pulse (row 10) is warned, not drawn'); }
    ok(slot4(gaugeOn({ show: false })).length === 0, 'requested but not shown (no 0x6f): nothing in slot 4 (all hidden)');
    { const s2 = gaugeOn(); s2.gaugeRequest(13, 6000, 7000, 1);
      ok(s2.g.v[0] === 6000 && s2.g.v[3] === 7000 && s2.g.v[4] === s2.mnow + 1000, `a second request lags (FUN_003aec10 with +0x7e set): ${s2.g.v}`); }
    { const s3 = gaugeOn({ f: 0x100 }); ok(slot4(s3).some(p => p.kind === 'strip' && p.c[0].join() === '64,64,64,78'), '+0xc64 >= 0x100: bar row 0xf'); }
    { const s4 = gaugeOn({ f: 0x80 }); ok(s4.find(4, 0x45).text.length === 0, 'f byte 0x80: no label'); }
    { const s5 = gaugeOn(); s5.gaugeHide();
      ok(s5.g.c58 === 0 && s5.g.c59 === 2 && s5.chain[s5.groupOf[4]].slide[0] === 3, `0x70: slides out (state ${s5.chain[s5.groupOf[4]].slide[0]}), +0xc58 0, +0xc59 2`);
      s5.mnow += 1000; s5.slideFrame(); s5.prims();
      ok(s5.g.c59 === 0 && !s5.g.txtObj, `after the slide the text object goes, +0xc59 = 0 (FUN_003b56b8): ${s5.g.c59}`);
      s5.gaugeHide(); ok(s5.g.c59 === 0, '0x70 again: nothing (+0xc59 != 1)'); }
    { const s8 = new HudState(data); s8.mnow = 500000; s8.gaugeRequest(13, 7000, 7000, 1); s8.gaugeShow();
      const g = s8.chain[s8.groupOf[4]];
      ok(g.slide[0] === 1 && g.rect[1] === -100, `0x6f: panel 4 starts its slide-in from 100 px up (FUN_003afcf8 -> DAT_00471dc0[4]): state ${g.slide[0]}, y ${g.rect[1]}`); }
    { const s9 = gaugeOn({ v: -3500 }); ok(s9.g.v[0] === 3500, `a negative value is drawn as |v| (FUN_003b58e0 case 0xc): ${s9.g.v[0]}`); }
    { const s7 = new HudState(data); s7.gaugeRequest(5, 10, 0, 0); s7.gaugeShow();
      ok(s7.g.c59 === 0 && s7.find(4, 0x46).flags & 1, 'an untranslated gauge id (5): not shown (warned)'); }
    { const s6 = gaugeOn(); s6.hideAll(); ok(s6.chain[s6.groupOf[4]].slide[0] === 3, 'game over hideAll: panel 4 slides out while shown (FUN_003afec0)'); }
  }
}

done();
