// test_combat_sound.mjs -- which sounds the page's combat asks for, through the real enemy_ai.js tick and aim_core.js
// (worker 0172; notes/audio-research.md "Combat sounds on the page"). The names, places and order are the game's:
//   - a soldier's shot: W+0x94 'bsj_063' at the sound camera (FUN_00554850 -> FUN_0033d788), then W+0x8c 'bsj_004' at
//     the muzzle with range 400 (FUN_005694f8 -> FUN_0033d6d8)  (T: w172_sound3 f786 / f875 / f1008: 063 then 004);
//   - its bullet ending on a wall: FUN_0054ff50 -> FUN_0033d528(material, rand x 2 != 0) -> 'bsj_021' / 'bsj_022' for
//     material 2 (surface word 0x20000), 'bsj_024' / 'bsj_025' for material 1, at the wall point (no range: the slot's
//     400, FUN_003e8bc8); no wall sound when it
//     hits Vincent (T: w172_sound3 f789);
//   - Vincent's shot: 'bsj_051' at the pulled-back muzzle after the pellets (FUN_00577480 -> FUN_0033d118), class 1;
//   - the draw / holster: 'bsj_018' / 'bsj_048' (FUN_005766c0 -> FUN_0033d348 / FUN_0033d3c8), class 1.
//   - audio.js SoundEmitters: a request is sent on the next update(), null position = the listener (pan 0x81).
//   - the ELF name tables come from the data (ai.json `se`, weapon.json se_draw / se_holster; worker 0173): without
//     them no gun / wall / draw sound, and nothing else changes;
//   - a wall impact draws the shared RNG 3 times (FUN_0054ff50 variant, FUN_002e0160 decal x 2; worker 0173): replayed
//     from the game's own twister state against trace w173_rng (tools/trace/out, gitignored; skipped without it).
// Needs data/enemies/ai.json (with se_* fields and `se`) and data/aim/weapon.json (gitignored): SKIP without them.
//   node native/web/test_combat_sound.mjs [enemy_ai.js]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(path.resolve(process.argv[2] || path.join(here, 'enemy_ai.js'))).href);
const AC = await import(pathToFileURL(process.env.AIM_CORE_JS || path.join(here, 'aim_core.js')).href);
const AU = await import(pathToFileURL(process.env.AUDIO_JS || path.join(here, 'audio.js')).href);
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const done = () => { console.log(fail ? `${fail} FAILED of ${n}` : `all ok (${n})`); process.exit(fail ? 1 : 0); };
const dataPath = path.join(here, 'data/enemies/ai.json'), wPath = path.join(here, 'data/aim/weapon.json');
if (!existsSync(dataPath) || !existsSync(wPath)) { console.log('SKIP: data/enemies/ai.json or data/aim/weapon.json missing'); done(); }
const data = JSON.parse(readFileSync(dataPath, 'utf8')), WV = JSON.parse(readFileSync(wPath, 'utf8'));
const near = (a, b, e = 1e-3) => a && b && a.every((x, k) => Math.abs(x - b[k]) < e);

if (!data.se || !WV.se_draw) { console.log('SKIP: ai.json has no se tables or weapon.json no se_draw: rebuild data/enemies and data/aim'); done(); }
const wallName = (mat, v) => data.se.wall[data.se.mat_kind[mat] * 3 + v];
// the tables against what the game played (w172_sound3: material 2 -> bsj_021 / bsj_022, Vincent's class-1 shot bsj_051)
ok(wallName(2, 0) === 'bsj_021' && wallName(2, 1) === 'bsj_022' && data.se.gun[12] === 'bsj_051',
  `ai.json se: material 2 -> ${wallName(2, 0)} / ${wallName(2, 1)}, gun[12] ${data.se.gun[12]}`);
ok(data.weapons[2].se_fire === 'bsj_004' && data.weapons[2].se_bullet === 'bsj_063' && data.weapons[2].se_range === 0,
  `e027 weapon 2 sounds: W+0x8c ${data.weapons[2].se_fire}, W+0x94 ${data.weapons[2].se_bullet}, W+0x74 ${data.weapons[2].se_range}`);

// ---- a soldier shoots Vincent 30 u away (record 44 = #66, as test_bullet_hit's end to end)
for (const surface of [null, 0x20000, 0x10000]) {
  const rec = data.records[44], pl = { pos: [rec.pos[0] - 30, rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const calls = [];
  const Wx = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, damage: true,
    sound: (name, pos, range) => calls.push({ name, pos: pos && pos.slice(), range }),
    roomRay: (a, b) => {
      if (surface == null) return null;
      const d = b.map((x, k) => x - a[k]), l = Math.hypot(...d), r = a.map((x, k) => x + d[k] / l * 10);
      r.surface = surface; return r;
    } });
  // no skeleton: the open shot is a near miss / hit by the capsule only; only the sounds matter here
  Wx.playerBoneWorld = () => null;
  Wx.addActor({ rec: 44, mode: 2, hp: 1, astate: 1 });
  let ev = [], firstShot = -1;
  for (let i = 0; i < 40; i++) {
    const before = calls.length;
    const e = Wx.tick(1.2, pl.pos, pl.pos);
    if (firstShot < 0 && e.some(x => x.startsWith('shot '))) { firstShot = i; ok(calls.length - before === 2, `shot frame: ${calls.length - before} sounds (063 + 004)`); }
    ev = ev.concat(e);
  }
  const shots = ev.filter(e => e.startsWith('shot ')).length;
  const names = calls.map(c => c.name);
  const per = names.slice(0, 2);
  ok(shots >= 1 && per[0] === 'bsj_063' && calls[0].pos === null && per[1] === 'bsj_004' && calls[1].range === 400,
    `soldier shot (wall ${surface == null ? 'none' : '0x' + surface.toString(16)}): ${names.join(' ')} (first: bsj_063 at the sound camera, then bsj_004 range 400)`);
  const walls = calls.filter(c => /^bsj_02/.test(c.name));
  const wallEv = ev.filter(e => e === 'bullet wall').length;
  if (surface == null) ok(walls.length === 0, `no wall: no wall sound (${walls.length})`);
  else {
    const want = wallName((surface >> 16) & 0xf, 1);                 // rand 0.5 -> (int)(1.0) != 0 -> variant 1
    ok(wallEv >= 1 && walls.length === shots && walls.every(c => c.name === want && c.range === undefined),
      `wall material ${(surface >> 16) & 0xf}: ${walls.length} x ${walls[0] && walls[0].name} for ${shots} shots (want ${want}, variant 1)`);
  }
}

// ---- the variant comes from the shared RNG: rand < 0.5 -> variant 0
{
  const rec = data.records[44], pl = { pos: [rec.pos[0] - 30, rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const calls = [];
  const Wx = AI.createEnemyAI({ data, player: pl, rand: () => 0.25, quiet: true, damage: true,
    sound: (name) => calls.push(name),
    roomRay: (a, b) => { const d = b.map((x, k) => x - a[k]), l = Math.hypot(...d), r = a.map((x, k) => x + d[k] / l * 10); r.surface = 0x20000; return r; } });
  Wx.playerBoneWorld = () => null;
  Wx.addActor({ rec: 44, mode: 2, hp: 1, astate: 1 });
  for (let i = 0; i < 40; i++) Wx.tick(1.2, pl.pos, pl.pos);
  ok(calls.includes(wallName(2, 0)) && !calls.includes(wallName(2, 1)), `rand 0.25 -> variant 0: ${calls.filter(c => /^bsj_02/.test(c)).join(' ')}`);
}

// ---- Vincent's shot (queueShot -> playerShot in the tick): bsj_051 at the pulled-back muzzle, after the pellets
{
  const pl = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const calls = [];
  const Wx = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, spreadRand: () => 0.5, quiet: true,
    sound: (name, pos, range) => calls.push({ name, pos: pos && pos.slice(), range }),
    roomRay: (a, b) => { const d = b.map((x, k) => x - a[k]), l = Math.hypot(...d), r = a.map((x, k) => x + d[k] / l * 50); r.surface = 0x10000; return r; } });
  const muzzle = [0, -15, 0], aim = [100, -15, 0], chest = [-1, -14, 0];
  Wx.queueShot(muzzle, aim, WV, chest);
  const ev = Wx.tick(1.2, pl.pos, pl.pos);
  const k = Math.fround(Math.hypot(1, 1) * -0.8);      // FUN_00563148: back along the shot by 0.8 x |muzzle - chest|
  ok(ev.some(e => e.startsWith('player shot')) && calls[0] && calls[0].name === 'bsj_051' && near(calls[0].pos, [k, -15, 0]),
    `Vincent's shot: ${calls[0] && calls[0].name} at [${calls[0] && calls[0].pos.map(x => x.toFixed(3))}] (bsj_051 at the pulled-back muzzle [${k.toFixed(3)}, -15, 0])`);
  for (let i = 0; i < 30; i++) Wx.tick(1.2, pl.pos, pl.pos);
  const walls = calls.filter(c => /^bsj_02/.test(c.name));
  ok(walls.length === WV.pellets && walls.every(c => c.name === wallName(1, 1)),
    `his ${WV.pellets} pellets end on a material-1 wall: ${walls.map(c => c.name).join(' ')}`);
}

// ---- Vincent's pellet through a soldier with a wall behind him: no wall sound for it (GUESS gate, T: w172_sound3 f789's
// bullet vs Vincent); a pellet beside him (a near miss) ends on the wall and sounds (test_enemy_hits' straight shots)
{
  const { modelPose, boneRows } = await import(pathToFileURL(path.join(here, 'enemy_hit.js')).href);
  const eJ = path.join(here, 'data/enemies/e027.json'), eB = path.join(here, 'data/enemies/e027_local.bin');
  if (!existsSync(eJ) || !existsSync(eB)) ok(false, 'data/enemies/e027.json / e027_local.bin missing');
  else {
    const e027 = JSON.parse(readFileSync(eJ, 'utf8')).local_pose, b = readFileSync(eB);
    const P0 = modelPose(e027, new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), 'r_st_a', 0);
    for (const [x, want] of [[0, 0], [4.5, 1]]) {
      const calls = [];
      const ai = AI.createEnemyAI({ data, player: { pos: [0, 0, -200], hp: 780, id: 0x16, f118: 0, s64: 0 }, quiet: true, log: () => {},
        rand: () => 0.5, sound: (name) => calls.push(name),
        roomRay: (a, e) => { const r = [a[0], a[1], 3]; r.surface = 0x20000; return r; } });   // a wall at z = 3, right behind him: the hit and the end on one frame
      const a = ai.addActor({ rec: 45, mode: 0, pos: [0, 0, 0], face: [0, 0, 1], clip: 'r_st_a' });
      ai.boneWorld = () => bn => boneRows(P0.R[bn], P0.S[bn], P0.P[bn], a.pos, a.face);
      ai.playerShot([x, -9, -60], [x, -9, 60], { ...WV, spread: null, pellets: 1 });
      for (let i = 0; i < 10; i++) ai.tick(1.2, [0, 0, -200], [0, 0, -200]);
      const walls = calls.filter(c => /^bsj_02/.test(c)).length;
      ok(walls === want && (x === 0 ? a.hp < 100 : a.hp === 100),
        `Vincent's pellet ${x === 0 ? 'through #67' : '4.5 u beside #67'} with a wall behind: ${walls} wall sound(s) (${want}), HP ${a.hp}`);
    }
  }
}

// ---- draw / holster (aim_core WeaponSystem)
{
  const core = new AC.WeaponSystem(WV, null, {});
  const got = [];
  core.sound = (name) => got.push(name);
  core.draw(true); core.holster(true);
  ok(got.join() === 'bsj_018,bsj_048', `draw / holster, class ${WV.class}: ${got.join(' ')} (bsj_018, bsj_048; T: w172_sound3 f796)`);
  // the names come from weapon.json: other tables, other names; no tables, no sound (and no throw)
  const c2 = new AC.WeaponSystem({ ...WV, se_draw: ['x0', 'x1', 'x2', 'x3'], se_holster: ['y0', 'y1', 'y2', 'y3'] }, null, {});
  const g2 = []; c2.sound = (name) => g2.push(name); c2.draw(true); c2.holster(true);
  ok(g2.join() === `x${WV.class},y${WV.class}`, `draw / holster names read from weapon.json se_draw / se_holster: ${g2.join(' ')}`);
  const { se_draw, se_holster, ...W0 } = WV;
  const c3 = new AC.WeaponSystem(W0, null, {});
  const g3 = []; c3.sound = (name) => g3.push(name);
  const warn = console.warn; console.warn = () => {};
  try { c3.draw(true); c3.holster(true); } finally { console.warn = warn; }
  ok(g3.length === 0 && c3.P.drawn === false, `weapon.json without se_draw / se_holster: no sound (${g3.length}), the draw / holster still run`);
}

// ---- enemy_ai without ai.json se: no gun / wall sound, the same events otherwise
{
  const run = (d) => {
    const pl = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 }, calls = [], log = [];
    const Wx = AI.createEnemyAI({ data: d, player: pl, rand: () => 0.5, spreadRand: () => 0.5, quiet: true, log: m => log.push(m),
      sound: (name) => calls.push(name),
      roomRay: (a, b) => { const v = b.map((x, k) => x - a[k]), l = Math.hypot(...v), r = a.map((x, k) => x + v[k] / l * 50); r.surface = 0x20000; return r; } });
    Wx.queueShot([0, -15, 0], [100, -15, 0], WV, [-1, -14, 0]);
    let ev = [];
    for (let i = 0; i < 30; i++) ev = ev.concat(Wx.tick(1.2, pl.pos, pl.pos));
    return { calls, ev, log };
  };
  const a = run(data), { se, ...noSe } = data, b = run(noSe);
  ok(a.calls.includes(data.se.gun[12]) && a.calls.filter(c => c === wallName(2, 1)).length === WV.pellets,
    `with se: ${a.calls.join(' ')}`);
  ok(b.calls.length === 0 && JSON.stringify(a.ev) === JSON.stringify(b.ev) && b.log.some(m => /no se tables/.test(m)),
    `without se: no sounds (${b.calls.length}), same events, warned`);
}

// ---- draws per impact by material: 3 (variant + decal x 2), material 6 only the variant (FUN_002e2840 skips 6; its
// FUN_00550098 effect draws are not translated: warned)
{
  for (const [surface, want] of [[0x20000, 3], [0x60000, 1]]) {
    let n = 0; const log = [], names = [];
    const pl = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 };
    const Wx = AI.createEnemyAI({ data, player: pl, quiet: true, log: m => log.push(m), spreadRand: () => 0.5, rand: () => { n++; return 0.75; },
      sound: (name) => names.push(name),
      roomRay: (a, b) => { const v = b.map((x, k) => x - a[k]), l = Math.hypot(...v), r = a.map((x, k) => x + v[k] / l * 50); r.surface = surface; return r; } });
    Wx.queueShot([0, -15, 0], [100, -15, 0], { ...WV, pellets: 1 }, [-1, -14, 0]);
    for (let i = 0; i < 30; i++) Wx.tick(1.2, pl.pos, pl.pos);
    const m = (surface >> 16) & 0xf;
    ok(n === want && names.includes(wallName(m, 1)) && (m !== 6 || log.some(x => /material 6/.test(x))),
      `material ${m}: ${n} draws for one impact (${want}), ${names.filter(x => x !== data.se.gun[12]).join(' ')}`);
  }
}

// ---- the wall impact's RNG draws, replayed from the game's twister state (trace w173_rng: TRACE_RNG=1 TRACE_CALLLOG=rng).
// The game draws 6 for each of Vincent's shots (f831 / f861: 3 pellets x the cone's 2, FUN_005405b0 -> FUN_0025a058) and
// 3 for each wall impact (f834-836, f864-866: FUN_0054ff50 then FUN_002e0160 twice), nothing else from f828 to f870.
// The page's enemy_ai, fed the GameRandom loaded with the record-f828 state, must draw the same values in the same
// order and pick the game's wall sounds (022 021 021 / 022 021 022).
{
  const T = path.join(here, '../../tools/trace/out/w173_rng');
  if (!existsSync(T + '.jsonl') || !existsSync(T + '.calls.jsonl')) console.log('SKIP: tools/trace/out/w173_rng trace missing (wall impact RNG replay)');
  else {
    const rec = JSON.parse(readFileSync(T + '.jsonl', 'utf8').split('\n')[1].replace(/\bNaN\b/g, 'null'));
    const calls = readFileSync(T + '.calls.jsonl', 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
    const rf = (v) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, (v & 0x7fffff) | 0x3f800000); return Math.fround(b.getFloat32(0) - 1.0); };
    const want = calls.filter(e => e.hook === 'draw' && e.frame >= rec.frame).map(e => rf(e.v0 >>> 0));
    const wantNames = calls.filter(e => e.hook === 'play_name' && e.frame >= rec.frame).map(e => Buffer.concat(e['a1+0x0'].u.map(x => {
      const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(x, 16)); return b; })).toString('latin1').split('\0')[0]).filter(n => n !== data.se.gun[12]);
    const shots = [...new Set(calls.filter(e => e.hook === 'play_name' && e.frame >= rec.frame).filter(e => e.a1 === calls.find(c => c.hook === 'play_name' && c.frame === 831).a1).map(e => e.frame))];
    const g = new AI.GameRandom(1);
    for (let i = 0; i < 624; i++) g.s[i] = Buffer.from(rec.rng_state.slice(8 * i, 8 * i + 8), 'hex').readUInt32LE(0);
    g.i = rec.rng_idx;
    const got = [], names = [];
    const pl = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 };
    const Wx = AI.createEnemyAI({ data, player: pl, quiet: true, rand: () => { const v = g.rand(); got.push(v); return v; },
      sound: (name) => { if (name !== data.se.gun[12]) names.push(name); },
      roomRay: (a, b) => { const v = b.map((x, k) => x - a[k]), l = Math.hypot(...v), r = a.map((x, k) => x + v[k] / l * 50); r.surface = 0x20000; return r; } });
    for (let fr = rec.frame; fr < 870; fr++) {
      if (shots.includes(fr)) Wx.queueShot([0, -15, 0], [100, -15, 0], WV, [-1, -14, 0]);
      Wx.tick(1.2, pl.pos, pl.pos);
    }
    ok(want.length === 30 && shots.join() === '831,861', `trace w173_rng: ${want.length} draws from f${rec.frame}, Vincent's shots at f${shots.join(' / f')}`);
    ok(got.length === want.length && got.every((v, k) => v === want[k]),
      `page draws = the game's draws, value for value: ${got.length} / ${want.length}${got.findIndex((v, k) => v !== want[k]) >= 0 ? ' (first diff at ' + got.findIndex((v, k) => v !== want[k]) + ')' : ''}`);
    ok(names.join() === wantNames.join(), `wall sounds: page ${names.join(' ')} / game ${wantNames.join(' ')}`);
  }
}

// ---- play.js's listener (audio.js soundListener): frame k sends with the state of frame k - 2, the camera's M[2] as the
// forward, Vincent's position - 7 y
{
  const h = [];
  const Ls = [0, 1, 2, 3, 4].map(k => AU.soundListener(h, [k, 0, 0], [0, 0, 1], { x: 10 * k, y: 5, z: 0 }));
  ok(Ls.map(L => L.pos[0]).join() === '0,0,0,1,2' && Ls[4].alt.join() === '20,-2,0' && Ls[4].fwd.join() === '0,0,1' && h.length === 3,
    `two frames back: eye x ${Ls.map(L => L.pos[0]).join(' ')}, alt ${Ls[4].alt.join(' ')} (pos - 7 y)`);
  // FollowCamera's M[2] (what play.js passes) looks from the eye towards Vincent (the pivot at; not along eye -> at
  // exactly: the camera sits off his axis), as the game's CAM+0x80 (+0x3820) does on every traced record (below)
  const PJ = await import(pathToFileURL(process.env.PLAYER_JS || path.join(here, 'player.js')).href);
  const cam = new PJ.FollowCamera(null); cam.reset({ x: 0, y: 0, z: 0 });
  cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 0, stick: 0, pad: null });
  const v = cam.at.map((x, k) => x - cam.eye[k]), l = Math.hypot(...v), c = cam.M[2].reduce((t, x, k) => t + x * v[k] / l, 0);
  ok(c > 0.9, `FollowCamera M[2] points from the eye towards Vincent: cos ${c.toFixed(3)} with at - eye`);
  // against the game: feed trace records (start of each frame: CAM+0x90, CAM+0x80, C+0x30) through soundListener and
  // compare with the listener FUN_003e9ed0 used on that frame (call-log hook 'listener')
  const T = path.join(here, '../../tools/trace/out/w172_sound3');
  if (!existsSync(T + '.jsonl') || !existsSync(T + '.calls.jsonl')) console.log('SKIP: tools/trace/out/w172_sound3 trace missing (listener vs game)');
  else {
    const recs = readFileSync(T + '.jsonl', 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')));
    const lis = new Map(readFileSync(T + '.calls.jsonl', 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')))
      .filter(e => e.hook === 'listener').map(e => [e.frame, e]));
    const hh = []; let n = 0, bad = 0, fwdAhead = 0;
    for (const r of recs) {
      const m = r.matrix[3], L = AU.soundListener(hh, r.cam_eye, r.cam_fwd, { x: m[0], y: m[1], z: m[2] });
      const P = [m[0], m[1], m[2]], d = P.map((x, k) => x - r.cam_eye[k]);
      if (d[0] * r.cam_fwd[0] + d[1] * r.cam_fwd[1] + d[2] * r.cam_fwd[2] > 0) fwdAhead++;
      const g = lis.get(r.frame);
      if (!g || hh.length < 3) continue;
      n++;
      const eq = (a, b) => a.every((x, k) => Math.abs(x - b[k]) < 2e-3);
      if (!(eq(L.pos, g['a0+0x3810'].f) && eq(L.fwd, g['a0+0x3820'].f) && eq(L.alt, g['a0+0x3850'].f))) bad++;
    }
    ok(n > 10 && bad === 0, `listener vs the game (w172_sound3): ${n - bad} / ${n} frames`);
    ok(fwdAhead === recs.length, `the game's CAM+0x80 points from the eye towards Vincent on every record (${fwdAhead} / ${recs.length})`);
  }
}

// ---- audio.js SoundEmitters: queued until update(), listener-positioned slots, 3D values
{
  const played = [];
  const audio = { se: { names: { bsj_004: { id: 1005, flags: 0 }, bsj_063: { id: 1060, flags: 0 }, bgm_x: { id: 9, flags: 2 } } },
    playId: (id, vol, pan) => played.push([id, vol, pan]) };
  const S = new AU.SoundEmitters(audio);
  S.play('bsj_063', null); S.play('bsj_004', [0, 0, 100], 400); S.play('bgm_x', [0, 0, 1]); S.play('nope', [0, 0, 1]);
  ok(played.length === 0, 'nothing plays before update()');
  S.setListener({ pos: [0, 0, 0], fwd: [0, 0, 1], alt: [0, 0, 0], useAlt: true });
  S.update();
  ok(JSON.stringify(played) === JSON.stringify([[1060, 117, 0x81], [1005, 87, 0x41]]),
    `update(): ${JSON.stringify(played)} (063 at the listener: 117 / 0x81; 004 100 u ahead: 87 / 0x41; stream and unknown names skipped)`);
}
// ---- GameAudio.playId keeps rendered buffers by (id, vol, pan, driver random counter): a hit only when the
// counter is where that render started, and the hit moves the counter to where the render left it
{
  const G = new AU.GameAudio();
  let renders = 0, starts = 0;
  G.se = { programs: { 7: '0001000000' } };        // prog[1..2] = bank 1
  const rd = { rngIndex: 0, render() { renders++; this.rngIndex = (this.rngIndex + 5) & 0xff; return { left: new Float32Array(4), right: new Float32Array(4) }; } };
  G.renderers = { 1: rd };
  G.ctx = { destination: {}, createBuffer: () => ({ copyToChannel() {} }), createBufferSource: () => ({ connect() {}, start() { starts++; } }) };
  G.playId(7, 100, 0x40); G.playId(7, 100, 0x40);  // counter moved: second play renders again
  ok(renders === 2 && rd.rngIndex === 10, `render cache: a repeat with the counter moved renders again (${renders} renders, counter ${rd.rngIndex})`);
  rd.rngIndex = 0; G.playId(7, 100, 0x40);
  ok(renders === 2 && rd.rngIndex === 5, `render cache: same counter -> reuse, counter set to the render's end (${renders}, ${rd.rngIndex})`);
  rd.rngIndex = 0; G.playId(7, 99, 0x40);
  ok(renders === 3 && starts === 4, `render cache: other vol renders (${renders} renders, ${starts} started)`);
}
done();
