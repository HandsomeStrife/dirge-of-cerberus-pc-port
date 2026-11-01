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
const { HudState, hpText, pulse, scissorFb, mapA } = await import('./hud_core.js');
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
ok(!warnings.some(w => /tiled|selectable|multi-frame|not exported/.test(w)), `no untranslated path hit by the drawn panels (${warnings.filter(w => !/FUN_003cd7e8/.test(w)).join('; ') || 'only the off-screen FUN_003cd7e8 text'})`);
done();
