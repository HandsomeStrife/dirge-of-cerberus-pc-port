// test_boss_z128.mjs -- the z128 boss brain (boss_z128.js = kel_boss_z128.ovl FUN_00aa16f8 and helpers).
// Checks the decoded rules with a fake engine: thresholds (HP 10000, 30 %, 400 damage), the attack
// choice, the gun burst, the volley, death, the HUD gauge. Run: node native/web/test_boss_z128.mjs
// BOSS_MOD=<path> runs the same checks on a mutated copy (notes/boss-research.md "Tests").
const B = await import(process.env.BOSS_MOD || new URL('./boss_z128.js', import.meta.url).href);

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };

function world(o = {}) {
  const log = [];
  let clock = 1000, rnd = 0.5, nextId = 1;
  const shots = new Map();
  const P = { pos: [500, -100, 1200], C: { mid: 0 } };
  const boxes = { btbox0: { pos: [0, 0, 0] }, btbox1: { pos: [100, 0, 0] }, btbox2: { pos: [100, 0, 100] },
    btbox3: { pos: [0, 0, 100] }, btbox4: { pos: [50, 0, 50] }, btbox5: { pos: [50, 0, 50] } };
  if (o.noBox) delete boxes[o.noBox];
  const C = { pos: [0, -100, 0], f568: 0, f1c0: 0, f1c4: 4 | 8, f765: 0, f77c: 0, mid: 0 };
  const io = {
    log, P, shots,
    clockA: () => clock, clockB: () => clock, tick() { clock++; },
    rand: () => rnd, setRand(v) { rnd = v; },
    mshort: i => (i === 99 ? (o.max ?? 17000) : 0),
    difficulty: () => o.diff ?? 1,
    player: () => P, locator: n => boxes[n] || null,
    weapon: n => ({ name: n }), setStatusWeapon: (s, n) => log.push('statusW ' + n), stageValue: () => undefined,
    busy: () => false, motionId: c => c.mid, motionDone: () => !!o.done, motionPast: (c, f) => (o.past ?? 999) >= f,
    motionReq: (c, k) => log.push('req ' + k), setClip: (c, n) => log.push('clip ' + n),
    bodyMode: (c, k) => log.push('mode ' + k), bodyFlag() {}, moverRates: (c, a, b, d) => log.push(`rates ${a}`),
    flyTo: (a, p) => log.push('fly ' + p.map(Math.round).join(',')), turnTo: () => log.push('turn'),
    placeAt: () => log.push('place'), soundBody: (c, v, n) => log.push('sb ' + n), soundAt: (a, v, n) => log.push('sa ' + n),
    shoot(x) { const s = { id: nextId++, speed: 100, pos: [0, 0, 0] }; shots.set(s.id, s); log.push(`shoot ${x.w.name} ${x.kind}`); return s; },
    shotById: id => shots.get(id) || null, shotRetarget() {}, muzzle() {}, marker: () => [0, 0, 0],
    dist: (a, b) => { const p = a.pos, q = b.pos; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); },
    inBox: () => !!o.inBox4, targetDead: () => false, targetPlayer() {}, fxHost: () => ({}), dropBrain: () => log.push('drop'),
    attackVolume: () => log.push('volume'), clampToBox: p => p, effect: id => log.push('fx ' + id.toString(16)),
    effectEnd() {}, stagger() {}, motionStop() {}, die: () => log.push('die'), lockable() {},
    hudGauge: (k, v, m) => log.push(`gauge ${k} ${v} ${m}`),
  };
  const ai = { st: 0, f26: 0, f20: 0, flags: o.aiFlags ?? 0, W: { f44: 5, f46: 30, f48: 6 } };
  const status = { hp: o.hp ?? 17000 };
  const actor = { f118: 0, pos: [0, -100, 0] };
  const b = B.makeBrain(ai, actor, status, C);
  return { io, b, ai, status, C, actor };
}
const run = (w, k) => { for (let i = 0; i < k; i++) { B.update(w.b, w.io); w.io.tick(); } };
const toState2 = w => { B.enter(w.b, w.io); run(w, 1); run(w, 61); };

// enter / setup (FUN_00aa1690 / FUN_00aa13a8)
{ const w = world(); B.enter(w.b, w.io);
  ok(w.ai.st === 0 && w.b.wg.name === 'nwe024gn' && w.b.wm.name === 'nwe024mn' && w.b.f54 === 0xb4, 'setup normal weapons');
  ok(!w.io.log.includes('drop'), 'no drop with all locators'); }
{ const w = world({ diff: 3 }); B.enter(w.b, w.io); ok(w.b.wg.name === 'nwe024gh', 'difficulty 3 -> hard weapons (min 2)'); }
{ const w = world({ noBox: 'btbox2' }); B.enter(w.b, w.io); ok(w.io.log.includes('drop'), 'missing btbox2 -> mode 0'); }
{ const w = world({ noBox: 'btbox5' }); B.enter(w.b, w.io); ok(!w.io.log.includes('drop') && w.b.box5 === w.b.box4, 'btbox5 falls back to btbox4'); }

// state 0 -> 1 -> 2 after 61 frames
{ const w = world(); B.enter(w.b, w.io); run(w, 1);
  ok(w.ai.st === 1 && w.io.log.includes('sb bsj_291') && w.io.log.includes('place'), 'state 0 places the boss, rotor sound, -> 1');
  run(w, 60); ok(w.ai.st === 1, 'still 1 at 60 frames'); run(w, 1); ok(w.ai.st === 2, '-> 2 at 61 frames'); }

// defeated at HP 10000 (FUN_00aa2c30)
{ const w = world({ hp: 10000 }); toState2(w); run(w, 1); ok(w.ai.st === 9, 'HP 10000 -> state 9'); }
{ const w = world({ hp: 10001 }); toState2(w); run(w, 1); ok(w.ai.st !== 9, 'HP 10001 not beaten'); }

// stagger: 400 damage and a hit this frame
// (the damage is added after the switch: the check sees the earlier hits, the frame's hit only as HP != last)
{ const w = world(); toState2(w); w.b.acc = 400; w.status.hp -= 1; run(w, 1);
  ok(w.ai.st === 8, '400 damage + hit -> state 8'); }
{ const w = world(); toState2(w); w.b.acc = 399; w.status.hp -= 1; run(w, 1); ok(w.ai.st !== 8, '399 damage: no stagger'); }
{ const w = world(); toState2(w); w.b.acc = 400; run(w, 1); ok(w.ai.st !== 8, '400 damage, no hit this frame: no stagger'); }

// stagger ends: <= 30 % of the bar above 10000 -> atk_sp2 (7), else the volley (5)
for (const [hp, want] of [[12100, 7], [12101, 5], [9000, 9]]) {
  const w = world({ done: 1 }); toState2(w); w.ai.st = 8; w.b.sub = 4; w.status.hp = hp; w.b.lastHp = hp; run(w, 1);
  ok(w.ai.st === want, `stagger end at HP ${hp} -> ${want} (got ${w.ai.st})`);
}

// attack choice (state 2 when ready: 60 frames, no shot alive)
function choose(o, alt, count) {
  const w = world(o); toState2(w); w.b.alt = alt; w.b.count = count; run(w, 61); return w;
}
ok(choose({ inBox4: 1 }, 0, 0).ai.st === 3, 'player in btbox4, count 0 -> gun (3)');
ok(choose({ inBox4: 1 }, 0, 2).ai.st === 6, 'in btbox4, count 2, alt 0 -> atk_sp3 (6)');
ok(choose({ inBox4: 1 }, 1, 2).ai.st === 4, 'in btbox4, count 2, alt 1 -> atk_sp1 (4)');
ok(choose({ aiFlags: 0 }, 0, 0).ai.st === 5, 'outside, AI bit 1 clear -> volley (5)');
ok(choose({ aiFlags: 2 }, 0, 0).ai.st === 3, 'outside, AI bit 1, alt 0 -> gun (3)');
ok(choose({ aiFlags: 2 }, 1, 0).ai.st === 5, 'outside, AI bit 1, alt 1 -> volley (5)');
{ const w = choose({ inBox4: 1 }, 0, 2); ok(w.b.alt === 1, 'alternation bit toggles'); }
{ const w = world({ inBox4: 1 }); toState2(w); run(w, 60); ok(w.ai.st === 2, 'not ready at 60 frames on timer 0'); }

// gun burst: W +0x48 shots, one per W +0x44 frames; kind 0x12 with the player 60 u above
{ const w = world({ inBox4: 1 }); toState2(w); run(w, 61); ok(w.ai.st === 3, 'in state 3');
  w.io.P.pos[1] = w.C.pos[1] - 60;
  run(w, 40); const shots = w.io.log.filter(s => s.startsWith('shoot nwe024gn'));
  ok(shots.length === 6, `6 gun shots (got ${shots.length})`); ok(shots.every(s => s.endsWith(' 18')), 'kind 0x12 above');
  const w2 = world({ inBox4: 1 }); toState2(w2); run(w2, 61); run(w2, 5);
  ok(w2.io.log.filter(s => s.startsWith('shoot')).length === 0, 'interval 5: no shot in the first 5 frames');
  run(w2, 1); ok(w2.io.log.filter(s => s.startsWith('shoot')).length === 1, 'first shot on frame 6');
  ok(w2.io.log.filter(s => s.startsWith('shoot')).every(s => s.endsWith(' 17')), 'kind 0x11 level'); }
{ const w = world({ inBox4: 1 }); toState2(w); run(w, 61); run(w, 60); ok(w.ai.st === 3, 'rest W +0x46 not over');
  run(w, 1); ok(w.ai.st === 2 && w.b.count === 1, 'burst over -> 2, count 1'); }

// volley: 4 missiles, 8 after a stagger
{ const w = world(); toState2(w); B.setState(w.b, w.io, 5, 1); w.b.prev = 2; run(w, 1);
  ok(w.io.log.filter(s => s.startsWith('shoot nwe024mn')).length === 4, 'volley: 4 missiles'); }
{ const w = world(); toState2(w); w.ai.st = 5; w.b.sub = 0; w.b.prev = 8; run(w, 1);
  ok(w.io.log.filter(s => s.startsWith('shoot nwe024mn')).length === 8, 'volley after a stagger: 8'); }

// death: 180 frames in state 9
{ const w = world({ hp: 10000 }); toState2(w); run(w, 1); run(w, 180); ok(!w.io.log.includes('die'), 'not dead at 180');
  run(w, 1); ok(w.io.log.includes('die') && w.io.log.includes('sb bsj_294'), 'dies at 181, bsj_294'); }

// HUD gauge (FUN_00aa11b8)
{ const w = world(); toState2(w); w.status.hp = 15000; run(w, 1); ok(w.io.log.includes('gauge 13 5000 7000'), 'gauge 5000 / 7000');
  ok(w.b.acc === 2000, 'damage counted'); }

// ---------------------------------------------------------------- worker 0237: checks for the mutants that survived
// the gauge floor (FUN_00aa11b8: HP - 10000, at least 0)
{ const w = world(); toState2(w); w.status.hp = 9000; run(w, 1); ok(w.io.log.includes('gauge 13 0 7000'), 'gauge floor: HP 9000 -> 0 / 7000'); }
// the turn clip (overlay asm 0xaa1aac-0xaa1b88): me = nearest box of the boss, p = of the player, to = p + 2 (mod 4) unless
// |me - p| == 2. l_trn (0xaa3428) when: me 0: to != 3; me 1 / 2: to >= me; me 3: to != 0; else r_trn (0xaa3430).
{
  const BOX = [[0, 0, 0], [100, 0, 0], [100, 0, 100], [0, 0, 100]];
  const asmLeft = (me, to) => me === 0 ? to !== 3 : me === 3 ? to !== 0 : to >= me;
  let cases = 0, bad = [];
  for (let me = 0; me < 4; me++) for (let p = 0; p < 4; p++) {
    let to = Math.abs(me - p) !== 2 ? (p + 2) % 4 : me;
    const w = world(); toState2(w); w.io.log.length = 0;
    w.actor.pos = BOX[me].slice(); w.io.P.pos = BOX[p].slice();
    run(w, 1);
    const clip = w.io.log.find(x => x.startsWith('clip ')), fly = w.io.log.find(x => x.startsWith('fly '));
    if (to === me) { if (clip || fly) bad.push(`me ${me} p ${p}: moved`); continue; }
    cases++;
    const want = asmLeft(me, to) ? 'clip l_trn' : 'clip r_trn';
    if (clip !== want || fly !== 'fly ' + BOX[to].join(',')) bad.push(`me ${me} p ${p} to ${to}: ${clip} ${fly} (want ${want})`);
  }
  ok(cases === 12 && bad.length === 0, `turn clip / destination for every (me, player) pair (${cases} moves): ${bad.join('; ') || 'all as the asm'}`);
}
// the nearest-box tie (FUN_00aa2ac8: strictly closer replaces, so a tie keeps the earlier box). The boss halfway between
// btbox0 and btbox1 is at 0; with the player at btbox2 (p 2) |0 - 2| = 2: no move (a tie taken as 1 would fly to btbox0)
{ const w = world(); toState2(w); w.io.log.length = 0; w.actor.pos = [50, 0, 0]; w.io.P.pos = [100, 0, 100]; run(w, 1);
  ok(!w.io.log.some(x => x.startsWith('fly ')), `nearest-box tie keeps the earlier box (no move): ${w.io.log.filter(x => x.startsWith('fly') || x.startsWith('clip')).join(' ') || 'none'}`); }
// homing shots in flight (FUN_00aa16f8's tail): slot i steers to the player + (sin, 0, cos)(i x pi / 4) x r, r = 40 + 20 rand
// (slots 0 / 4: 10 + 10 rand); within 80 u of the player homing ends (+0x154 = 0) and the slot frees
const retarget = (rnd, dist = 1e4) => {
  const w = world(); toState2(w); w.io.setRand(rnd);
  const S = [];
  for (let i = 0; i < 8; i++) { const sh = { id: 100 + i, home: 1, speed: 100, pos: [w.io.P.pos[0] + dist, w.io.P.pos[1], w.io.P.pos[2]] }; w.io.shots.set(sh.id, sh); w.b.miss[i] = sh.id; S.push(sh); }
  run(w, 1);
  return { w, S, P: w.io.P.pos };
};
const radii = rnd => { const { S, P } = retarget(rnd); return S.map(s => Math.hypot(s.target[0] - P[0], s.target[2] - P[2])); };
{
  const { S, P } = retarget(0.5);
  ok(S.every((s, i) => Math.abs(Math.atan2(s.target[0] - P[0], s.target[2] - P[2]) - (((i + 4) % 8) - 4) * Math.PI / 4) < 1e-5 && s.target[1] === P[1]),
     'homing target angle i x pi / 4 (x = sin, z = cos), at the player\'s height');
  const r0 = radii(0), r1 = radii(0.999999);
  ok(r0.every((r, i) => Math.abs(r - (i % 4 === 0 ? 10 : 40)) < 1e-4) && r1.every((r, i) => Math.abs(r - (i % 4 === 0 ? 20 : 60)) < 1e-3),
     `homing radius: slots 0 / 4 in [10, 20), others [40, 60): ${r0.map(v => v.toFixed(0))} .. ${r1.map(v => v.toFixed(0))}`);
  // against the game: trace w235_missile (r0b_boss2): every homing missile's target point +0xd0 around Vincent (pinned there)
  const T = process.env.TRACE_OUT ?? new URL('../../tools/trace/out/', import.meta.url).pathname;
  const fs = await import('node:fs');
  if (!fs.existsSync(T + 'w235_missile.calls.jsonl') || !fs.existsSync(T + 'w235_missile.jsonl')) console.log('SKIP: trace w235_missile missing');
  else {
    const vp = JSON.parse(fs.readFileSync(T + 'w235_missile.jsonl', 'utf8').split('\n')[1]).matrix[3];
    const E = fs.readFileSync(T + 'w235_missile.calls.jsonl', 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')));
    const seen = {}; let n2 = 0, off = [];
    for (const e of E) {
      if (((parseInt(e['a3+0x150'].u[0], 16) >> 20) & 0xf) !== 1 || !e['a3+0x150'].f[1]) continue;   // homing (mode 1, +0x154 > 0)
      const t = e['a3+0xd0'].f, dx = t[0] - vp[0], dz = t[2] - vp[2], a = Math.atan2(dx, dz), i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8, r = Math.hypot(dx, dz);
      n2++;
      if (Math.abs(a - Math.round(a / (Math.PI / 4)) * Math.PI / 4) > 1e-3 || Math.abs(t[1] - vp[1]) > 1e-3 || r < r0[i] - 1e-3 || r > r1[i] + 1e-3) off.push(`slot ${i} r ${r.toFixed(2)}`);
      (seen[i] ??= []).push(r);
    }
    const span = Object.entries(seen).map(([i, v]) => `${i}: ${Math.min(...v).toFixed(1)}-${Math.max(...v).toFixed(1)}`);
    ok(n2 > 400 && off.length === 0 && Object.keys(seen).length >= 4,
       `w235_missile: ${n2} homing targets at the brain's angle / height, radius inside its slot's range (${span.join(', ')})${off.length ? ': off ' + off.slice(0, 4) : ''}`);
  }
}
{ const { w, S } = retarget(0.5, 80); ok(S.every(s => s.home === 0) && w.b.miss.every(id => id === -1), 'a shot 80 u from the player stops homing, slot freed (<= 80)'); }
{ const { w, S } = retarget(0.5, 80.01); ok(S.every(s => s.home === 1) && w.b.miss.every(id => id > 0), 'a shot 80.01 u away keeps homing'); }

console.log(`test_boss_z128: ${n - fails} / ${n} ok`);
process.exit(fails ? 1 : 0);
