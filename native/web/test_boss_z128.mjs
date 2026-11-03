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

console.log(`test_boss_z128: ${n - fails} / ${n} ok`);
process.exit(fails ? 1 : 0);
