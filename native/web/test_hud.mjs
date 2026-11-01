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
const { HudState, hpText, pulse, scissorFb, mapA, hitAngle } = await import('./hud_core.js');
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
  st.now = 100000;
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
  st.now = 100500;
  st.prims();
  ok(st.hp[3] === 640, `500 ms later the shown value drains to 780 - 280 x 500 / 1000 = 640 (FUN_003aec78): ${st.hp[3]}`);
  st.now = 101001;
  st.prims();
  ok(st.hp[3] === 500 && st.hp[4] === 0 && lagA(st) === 0 && lag(st).length === 1, `after 1000 ms: shown = cur, timer cleared, the lag strip has no width (still drawn, as FUN_003aed60 does while min < max) (${st.hp[3]}, ${st.hp[4]})`);
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
ok(!warnings.some(w => /tiled|selectable|multi-frame|not exported/.test(w)), `no untranslated path hit by the drawn panels (${warnings.filter(w => !/FUN_003cd7e8/.test(w)).join('; ') || 'only the off-screen FUN_003cd7e8 text'})`);
done();
