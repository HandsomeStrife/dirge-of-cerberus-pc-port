// The soldiers' bullets vs Vincent (enemy_ai.js spreadAim / roomProbe / enemyBulletHit / playerPartTest,
// enemy_hit.js partTest / cylinderHit), checked call by call against the PCSX2 call logs:
//   - the aim point (vt+0x5c = FUN_00563720: bone 3) = the traced pose's bone 3 at each shot;
//   - the cone (FUN_005405b0 -> FUN_0025a058) from the logged draws = the logged direction;
//   - the room probe (FUN_00553808 -> FUN_0026a320, flags 0x18d) stops #67's k_bullet2 f875 bullet where the game does;
//   - every logged hit test of a soldier's bullet (FUN_00556870 -> FUN_005442d8 -> FUN_0055d100 / FUN_0055bda8 ->
//     FUN_005ad118) with Vincent's traced pose: hit or not, and the part (k_bullet1 f789 6, f879 0;
//     k_bullet2 f789 6; w168_e8_bullet f1011 1).
// Traces (tools/trace/out, game-derived, gitignored): k_bullet1 / k_bullet2 (+ .calls, out/spread), w168_e8_bullet /
// w168_e8_spread (.calls), and the pose traces w168_b1_a / w168_b1_b / w168_e8_pose* (TRACE_FIELDSET=pose; scripts in
// tools/trace/scripts). Pose record k = the state a call tagged k + 1 sees (the call runs in the step from record k).
//   node native/web/test_bullet_hit.mjs [enemy_ai.js]       (SKIP when the traces or data/enemies are missing)
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { partTest, cylinderHit } from './enemy_hit.js';
import { loadPoses, boneWorldAt } from './trace_pose.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const AI = await import(pathToFileURL(path.resolve(process.argv[2] || path.join(here, 'enemy_ai.js'))).href);
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const dataPath = path.join(here, 'data/enemies/ai.json');
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const done = () => { console.log(fail ? `${fail} FAILED of ${n}` : `all ok (${n})`); process.exit(fail ? 1 : 0); };
const need = ['k_bullet1.calls.jsonl', 'k_bullet2.calls.jsonl', 'w168_e8_bullet.calls.jsonl', 'w168_e8_spread.calls.jsonl',
  'spread/k_bullet1.calls.jsonl', 'spread/k_bullet2.calls.jsonl', 'w168_b1_a.jsonl', 'w168_b1_b.jsonl', 'w168_e8_pose760.jsonl'];
const missing = need.filter(f => !existsSync(path.join(OUT, f)));
if (missing.length || !existsSync(dataPath)) { console.log(`SKIP: missing ${missing.length ? missing.join(', ') : dataPath}`); done(); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const jl = f => readFileSync(path.join(OUT, f), 'utf8').trim().split('\n').map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')));   // the logs write NaN for non-float words
const v3 = e => e.u.slice(0, 3).map(h => { const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(h, 16) >>> 0); return b.readFloatLE(0); });   // exact floats (the f values are rounded)

// ---- data
const boxes = data.hitboxes && data.hitboxes.p000;
ok(boxes && boxes.length === 13 && boxes[6].bone === 19 && boxes[0].bone === 5, `Vincent's part boxes: ${boxes && boxes.length} (13, 07703201 marker.mkd; part 0 bone 5, part 6 bone 19)`);
const W2 = data.weapons[2];
ok(W2.spread && W2.spread.join() === '25,25,25' && W2.flags === 0x100, `e027 weapon 2: spread ${W2.spread} (25 / 25 / 25), W+4 0x${W2.flags.toString(16)}`);

// ---- poses (trace_pose.mjs): run -> frame -> record
const P1 = loadPoses(OUT, ['w168_b1_a', 'w168_b1_b']);                   // k_bullet1 (engage7 inputs)
const P2 = loadPoses(OUT, ['w168_e8_a', 'w168_e8_b', 'w168_e8_pose760', 'w168_e8_pose815', 'w168_e8_pose870', 'w168_e8_pose925', 'w168_e8_pose980']);
const poses = { size: P1.size + P2.size };
ok(poses.size > 300, `pose records: ${poses.size}`);

// one world with Vincent; the tests set his position / pose per call
const player = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 };
let draws = [];
const W = AI.createEnemyAI({ data, player, rand: () => 0.5, spreadRand: () => draws.shift(), damage: true, quiet: true });
const T = W.t;
// a call tagged frame k: the pose of record k - 1; 'after' Vincent's C update: record k - 1's bones with record k's matrix
const at = (run, frame) => {
  const set = run === 'k1' ? P1 : P2, p = set.get(frame - 1);
  if (!p) return null;
  player.pos = p.pos.slice();
  W.playerBoneWorld = boneWorldAt(set, frame);
  return p;
};

// ---- shots: aim point, cone
const shots = [['k1', 'spread/k_bullet1.calls.jsonl'], ['k2', 'spread/k_bullet2.calls.jsonl'], ['k2', 'w168_e8_spread.calls.jsonl']];
let shotN = 0;
for (const [run, file] of shots) {
  const L = jl(file).slice(1);
  for (let i = 0; i < L.length; i++) {
    const c = L[i];
    if (c.hook !== 'cone' || c.f12 < 20) continue;                         // e027 shots (s 24.39; Vincent's are 2.9)
    const r = L.filter(x => x.frame === c.frame && x.hook === 'rand').slice(-2), sp = L.find(x => x.frame === c.frame && x.hook === 'spawn');
    const muzzle = v3(sp['a1+0x0']), aim = v3(sp['a2+0x0']);
    // aim = vt+0x5c of the target: bone 3 of the pose the call sees
    // the shooter: #66 (record 44) runs its C update before Vincent's, #67 (record 45) after (the save's C list)
    const shooter = c.frame === 875 ? 45 : 44;                             // #67 fires at f875, #66 at f786 / f1008 (the traces)
    const p = at(run, c.frame);
    if (p) {
      const tp = T.targetPoint(player, shooter === 45), e = Math.hypot(...tp.map((x, k) => x - aim[k]));
      const other = T.targetPoint(player, shooter !== 45), e2 = Math.hypot(...other.map((x, k) => x - aim[k]));
      ok(e < 2e-3, `${run} f${c.frame} record ${shooter}: aim point = Vincent's bone 3 (vt+0x5c FUN_00563720) ${shooter === 45 ? 'after' : 'before'} his C update, off ${e.toFixed(5)} (the other order: ${e2.toFixed(5)})`);
    }
    draws = [r[0].f0, r[1].f0];
    const out = T.spreadAim(data.weapons[2], 50, muzzle, aim, AI.ENEMY_STATUS);
    const d = out.map((x, k) => x - muzzle[k]), l = Math.hypot(...d), want = v3(c['a1+0x0']);
    const e = Math.max(...d.map((x, k) => Math.abs(x / l - want[k])));
    ok(e < 1e-4, `${run} f${c.frame}: cone s ${c.f12.toFixed(6)} from draws ${r[0].f0} / ${r[1].f0} -> dir off ${e.toExponential(1)}`);
    shotN++;
  }
}
ok(shotN === 5, `e027 shots checked: ${shotN} (k_bullet1 f786 / f875, k_bullet2 f786 / f875, engage8 f1008)`);

// ---- room probe: k_bullet2 #67 f875 stops at its last logged position
{
  const colBin = path.join(here, 'data/z128_collision.bin');
  if (!existsSync(colBin)) console.log('skip room probe: data/z128_collision.bin missing');
  else {
    const { loadCollision, probeSet } = await import('./collision.js');
    const buf = readFileSync(colBin), col = await loadCollision(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    const ray = flags => (a, b) => { const h = col.segment({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, probeSet(flags)); return h ? [h.point.x, h.point.y, h.point.z] : null; };
    const L = jl('k_bullet2.calls.jsonl').slice(1).filter(c => c.hook === 'hit_test' && c['a3+0x128'] && c['a3+0x128'].u[0] === '0xffff002d');
    const last = v3(L[L.length - 1]['a3+0x90']), start = v3(L[0]['a3+0xc0']);
    const dir = v3(jl('spread/k_bullet2.calls.jsonl').slice(1).find(c => c.hook === 'cone' && c.frame === 875)['a1+0x0']);
    const end = start.map((x, k) => Math.fround(x + Math.fround(dir[k] * 515)));
    const W3 = AI.createEnemyAI({ data, player, quiet: true, roomRay: ray(0x18d) });
    const b = { start, end: end.slice(), endDist: 515, f120: 0x2000 };
    W3.t.roomProbe(b);
    const e = Math.hypot(...b.end.map((x, k) => x - last[k]));
    ok(e < 2e-3 && Math.abs(b.endDist - 362.31) < 0.01, `room probe (flags 0x18d): #67's f875 bullet ends at [${b.end.map(x => x.toFixed(3))}] (game [${last}]), ${b.endDist.toFixed(2)} u, off ${e.toFixed(5)}`);
    // the probe set matters: without the 0x18d filter (all of collision.js's triangles) the same ray must agree here,
    // and a ray through a sub-tree-0-only primitive is not the bullets' (checked by count)
    const all = col.info.length, kept = Array.from(col.info).filter(probeSet(0x18d)).length;
    // z128: 113161 of the page's triangles are sub-tree +0x58 packets that pass (packet flags & ~(0x18d | 0x100)) != 0
    // (FUN_0026f8a0, machine code 0x26f934); the rest are sub-tree-0 tag-1 primitives or packets of the other probes
    ok(kept === 113161 && all === 145565, `probe set 0x18d: ${kept} of ${all} page triangles (113161 of 145565: sub-tree 1 packets passing the flag test)`);
  }
}

// ---- every logged hit test of a soldier's bullet, with the traced pose
let tested = 0, parts = [];
for (const [run, file] of [['k1', 'k_bullet1.calls.jsonl'], ['k2', 'k_bullet2.calls.jsonl'], ['k2', 'w168_e8_bullet.calls.jsonl']]) {
  const L = jl(file).slice(1);
  for (const c of L) {
    if (c.hook !== 'hit_test') continue;
    const owner = c['a3+0x128'] ? c['a3+0x128'].u[0] : null;
    const isSoldier = owner === '0xffff002c' || owner === '0xffff002d';
    if (!isSoldier || !at(run, c.frame)) continue;
    const b = { prev: v3(c['a3+0xe0']), pos: v3(c['a3+0x90']), f120: 0x2000, shooter: 0x2c, from: {}, damage: 45, kind: 0 };
    player.hp = 780;
    const r = T.enemyBulletHit(b);
    const pr = L.find(x => x.frame === c.frame && x.hook === 'part_ray');
    const msg = `${run} ${file.split('.')[0]} f${c.frame}: hit ${r} (game ${c.v0})` + (pr ? `, part ${player.part} (game ${pr.v0})` : '');
    ok(r === c.v0 && (!pr || player.part === pr.v0) && (r ? player.hp === 736 : player.hp === 780), msg + `, HP ${player.hp}`);
    if (pr) parts.push(pr.v0);
    tested++;
  }
}
ok(tested >= 8 && parts.join() === '6,0,6,1', `hit tests checked: ${tested}; parts ${parts} (6, 0, 6, 1)`);

// ---- the part test is a real discriminator: a capsule-only hit would also take the near misses
{
  const p = at('k1', 789);
  const A = [-1046.222, -155.297, -1098.283], B = [-1104.316, -160.516, -1112.349];
  const part = partTest(boxes, p.rows, A, B);
  ok(part === 6, `k_bullet1 f789 segment: part ${part} (6; box 5 is 0.0003 behind, a near tie)`);
  // 2 u above his head (passes the capsule's top disc but no part box): capsule hit, no part -> no hit
  const top = [p.pos[0], p.pos[1] - 17.5, p.pos[2]];
  const b = { prev: [top[0] - 30, top[1], top[2]], pos: [top[0] + 30, top[1], top[2]], f120: 0x2000, shooter: 0x2c, from: {}, damage: 45, kind: 0 };
  player.hp = 780; delete player.part;
  const r = T.enemyBulletHit(b);
  ok(r === 0 && player.hp === 780, `a bullet through his capsule 17.5 above his feet but past every part box: no hit (${r}), HP ${player.hp}`);
}
// ---- the capsule's radius (P+0x2c = 5) on the traced f789 pose: a horizontal bullet that crosses a part box between 2.5
// and 5 u from his axis hits; one that crosses a box only outside 5 u (the capsule first) does not
{
  const p = at('k1', 789), ax = p.pos;
  const shoot = (h, d) => ({ prev: [ax[0] - 40, ax[1] - h, ax[2] + d], pos: [ax[0] + 40, ax[1] - h, ax[2] + d], f120: 0x2000, shooter: 0x2c, from: {}, damage: 45, kind: 0 });
  let inside = null, outside = null;
  for (let h = 2; h <= 17 && !(inside && outside); h += 0.5) for (const sg of [1, -1]) for (let d = 2.6; d <= 7; d += 0.1) {
    const b = shoot(h, sg * d), part = partTest(boxes, p.rows, b.prev, b.pos);
    if (part < 0) continue;
    if (d < 4.9 && !inside) inside = { h, d: sg * d, part };
    if (d > 5.1 && !outside) outside = { h, d: sg * d, part };
  }
  const run = c => { player.hp = 780; player.pos = p.pos.slice(); return T.enemyBulletHit(shoot(c.h, c.d)); };
  ok(inside && run(inside) === 1, `a bullet ${inside && Math.abs(inside.d).toFixed(1)} u from his axis (inside r 5, outside 2.5) through part ${inside?.part}: hit`);
  ok(outside && run(outside) === 0, `a bullet ${outside && Math.abs(outside.d).toFixed(1)} u from his axis through part ${outside?.part} but outside the capsule: no hit (the capsule first)`);
}

// ---- the filter / handler guards (FUN_0055d100, FUN_005720c8) on the k_bullet1 f789 hit
{
  const seg = { prev: [-1046.2216, -155.297, -1098.2831], pos: [-1104.3156, -160.5159, -1112.3488] };
  const go = (bullet, setup = () => {}) => {
    at('k1', 789); player.hp = 780; player.f118 = 0; setup();
    const r = T.enemyBulletHit({ ...seg, f120: 0x2000, shooter: 0x2c, from: {}, damage: 45, kind: 0, ...bullet });
    return [r, player.hp];
  };
  ok(go({}).join() === '1,736', `guard baseline: hit, HP 736 (${go({})})`);
  ok(go({}, () => { player.hp = 0; }).join() === '0,0', `dead Vincent (FUN_00316cf8): the bullet passes (${go({}, () => { player.hp = 0; })})`);
  ok(go({ shooter: 0x16 }).join() === '0,780', `his own bullet (owner id = his +0x100): no hit (${go({ shooter: 0x16 })})`);
  ok(go({ f120: 0x2000 | 0x8000 }).join() === '0,780', `bullet bit 0x8000 (W+5 bit 0 clear): no hit on a hostile (${go({ f120: 0xa000 })})`);
  ok(go({ f120: 0x2000 | 0x4000 }).join() === '0,780', `bullet bit 0x4000: no hit (${go({ f120: 0x6000 })})`);
  ok(go({}, () => { player.f118 = 0x20; }).join() === '0,780', `P+0x118 bit 0x20 (FUN_005720c8): returns 0, the bullet flies on, no damage (${go({}, () => { player.f118 = 0x20; })})`);
  player.f118 = 0;
  const Woff = AI.createEnemyAI({ data, player, quiet: true, damage: false });
  Woff.playerBoneWorld = boneWorldAt(P1, 789); player.pos = P1.get(788).pos.slice(); player.hp = 780;
  const r = Woff.t.enemyBulletHit({ ...seg, f120: 0x2000, shooter: 0x2c, from: {}, damage: 45, kind: 0 });
  ok(r === 1 && player.hp === 780 && Woff.events.includes('hit player (damage off)'), `damage off (?enemydmg=0): the bullet still hits (${r}), HP ${player.hp}`);
  // the hit effect (FUN_0055db50 -> FUN_003361b8, param_3 = the hit point): spawned at the capsule contact point
  // (FUN_0055bda8's hit, FUN_0025c770), not at the bullet's step end
  const spawned = [];
  const Wfx = AI.createEnemyAI({ data, player, quiet: true, damage: false, effect: { wall() {}, hit: (k, p) => spawned.push([k, p.slice()]) } });
  Wfx.playerBoneWorld = boneWorldAt(P1, 789); player.pos = P1.get(788).pos.slice(); player.hp = 780;
  Wfx.t.enemyBulletHit({ ...seg, f120: 0x2000, shooter: 0x2c, from: {}, damage: 45, kind: 0 });
  const A = player.pos.slice(), cp = cylinderHit(AI.R_PLAYER, seg.prev, seg.pos, A, [A[0], A[1] - 18, A[2]]);
  const dEnd = spawned[0] ? Math.hypot(...spawned[0][1].map((x, k) => x - seg.pos[k])) : NaN;
  ok(spawned.length === 1 && cp && spawned[0][1].every((x, k) => x === cp.point[k]) && dEnd > 1,
    `hit effect at the contact point ${cp && cp.point.map(x => x.toFixed(2))} (${spawned[0] && spawned[0][1].map(x => x.toFixed(2))}; ${dEnd.toFixed(1)} u from the step end)`);
}

// ---- end to end: #66 (record 44) shoots Vincent 30 u away through the real tick; a wall 10 u in front of the muzzle
// (roomRay stub) stops the bullet at the countdown end: no hit. Without the wall: hit (bullet flags 0x2000 -> roomProbe)
for (const wall of [false, true]) {
  const rec = data.records[44], pl = { pos: [rec.pos[0] - 30, rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const p = P2.get(788), rays = [];
  const old = pl.pos.slice(), aside = [old[0], old[1], old[2] + 20];
  const Wx = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true,
    roomRay: (a, b) => { rays.push([a, b]); if (!wall) return null; const d = b.map((x, k) => x - a[k]), l = Math.hypot(...d); return a.map((x, k) => x + d[k] / l * 10); } });
  // his skeleton at his start-of-frame position (old): the drawn pose, placed where he stood
  Wx.playerBoneWorld = () => b => { const m = p.bonesOf(b); const rows = p.rowsWith(m); return rows.map((r, i) => i === 3 ? r.map((x, k) => x - p.pos[k] + old[k]) : r); };
  Wx.addActor({ rec: 44, mode: 2, hp: 1, astate: 1 });
  let ev = [], shotAt = null;
  for (let i = 0; i < 40; i++) {
    // on the hit frame (shot + 3) he steps 20 u aside: the bullets test his start-of-frame position (FUN_0034c388
    // rewrites C+0x00 after the object lists), so the hit stands
    const moving = shotAt != null && i === shotAt + 3;
    pl.pos = moving ? aside.slice() : old.slice();
    const e = Wx.tick(1.2, old, pl.pos);
    if (shotAt == null && e.some(x => x.startsWith('shot '))) shotAt = i;
    ev = ev.concat(e);
  }
  const shots = ev.filter(e => e.startsWith('shot ')).length;
  const rayLen = rays.length ? Math.hypot(...rays[0][1].map((x, k) => x - rays[0][0][k])) : 0;
  ok(shots >= 1 && rays.length === shots && Math.abs(rayLen - 515.1) < 1e-3 && (wall ? pl.hp === 780 && ev.includes('bullet wall') : pl.hp === 736),
    `end to end, ${wall ? 'a wall 10 u in front' : 'open, he steps 20 u aside on the hit frame'}: ${shots} shot(s), ${rays.length} room probe(s) at the countdown end (ray ${rayLen.toFixed(3)} u = range 515 + 0.1), HP ${pl.hp}`);
}
done();
