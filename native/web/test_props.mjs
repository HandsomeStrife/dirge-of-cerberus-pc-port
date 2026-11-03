// The explosive barrels (props.js in enemy_ai's world; notes/barrel-research.md) against the PCSX2 trace w209_barrel
// (tools/trace/out, game-derived, gitignored: TRACE_FIELDSET=enemy TRACE_ENEMIES=1 TRACE_BARREL=1 TRACE_CALLLOG=barrel,
// pokes in tools/trace/scripts/w209_barrel.json): record 17's barrel moved onto the walkway's shot line, Vincent fires
// at f271 (lock-on on the barrel), the first pellet breaks it at f273 and its explosion hits him.
//   node --import ./native/web/test_hooks.mjs native/web/test_props.mjs
// Checked against the trace: the frame of the hit (2 after the shot), the pellet damage 49 -> HP 0, the explosion's
// radius / damage / owner / position (FUN_0057f040), its sound bsj_065 and effect 0x800 (FUN_00336280), the target list
// (+0x16c: Vincent, then the barrel itself, still active: FUN_0053fa08 defers the delete), Vincent's damage 118
// (780 -> 662), the reaction flags 8 and direction (FUN_00565480's args), the radius growth +0xd0 and the clock +0xc8 of
// every update, and the 51 updates. Fixed-input checks without the trace: the cylinder geometry, the stage-start state,
// a soldier's bullet stopping on a barrel without breaking it (type flag bit 6), no chain reaction (owner -1), the blast
// on a soldier (FUN_0055e498: FUN_00318120 of 120, reaction flags 8, Vincent credited) and a wall in front.
// MUTATE_PROPS / MUTATE_AI = paths of mutated copies of props.js / enemy_ai.js (the mutation runs use them).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const imp = (env, rel) => import(process.env[env] ? pathToFileURL(path.resolve(process.env[env])).href : './' + rel);
const { createProps, nearestOnCylinder, insideCylinder } = await imp('MUTATE_PROPS', 'props.js');
const { createEnemyAI, defence, ENEMY_STATUS } = await imp('MUTATE_AI', 'enemy_ai.js');
const { Areas } = await imp('MUTATE_AREAS', 'areas.js');
const SAVE_POS = [-1395.151611328125, -98.64443969726562, -1111.014892578125];   // Vincent C+0x30 in the save
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const near = (a, b, e) => a.length === b.length && a.every((x, k) => Math.abs(x - b[k]) <= e);
const STEP = 1.1999999284744263;

// ---------------------------------------------------------------- geometry (no data)
{
  const a = [0, 0, 0], b = [0, -10, 0];
  ok(near(nearestOnCylinder(2, [5, -5, 0], a, b), [2, -5, 0], 1e-6), 'FUN_0025d1b8: beside the side -> the side point');
  ok(near(nearestOnCylinder(2, [1, 3, 0], a, b), [1, 0, 0], 1e-6), 'FUN_0025d1b8: below the base inside the rim -> onto the end disc');
  ok(near(nearestOnCylinder(2, [5, 3, 0], a, b), [2, 0, 0], 1e-6), 'FUN_0025d1b8: below the base outside the rim -> the rim');
  ok(near(nearestOnCylinder(2, [0, -14, 1], a, b), [0, -10, 1], 1e-6), 'FUN_0025d1b8: past the top inside the rim -> the top disc');
  ok(insideCylinder(2, [1, -5, 0], a, b) && !insideCylinder(2, [3, -5, 0], a, b) && !insideCylinder(2, [0, 1, 0], a, b), 'FUN_0025c770: inside / outside');
}

const D = p => path.join(here, 'data', p);
const need = [D('enemies/ai.json'), D('props/props.json'), D('aim/weapon.json')];
if (need.some(p => !existsSync(p))) { console.log('SKIP data checks: ' + need.filter(p => !existsSync(p)).join(', ') + ' missing (tools/byo/build_web.sh)'); done(); }
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const aiData = json(D('enemies/ai.json')), W0 = json(D('aim/weapon.json'));
const Wv = W0.W || W0;
ok(['196', '259', '260', '290'].every(k => aiData.scripts[k]), 'ai.json carries the barrels\' scripts 196 / 259 / 260 / 290 (export_web_triggers.py)');

// a world with the barrels; recs: { rec: [x, y, z] } moves a barrel (the trace's TRACE_POKE / cmd 0x121), on: extra active records
function world({ recs = {}, on = [], php = null, roomRay = null } = {}) {
  const pj = json(D('props/props.json'));
  for (const r of pj.records) {
    if (recs[r.rec]) r.m[3] = [...recs[r.rec], 1];
    if (on.includes(r.rec)) r.f4c = -1;                     // extra active records: no parent area (FUN_0053ced8 switches them on)
  }
  const fx = [], snd = [], warns = [];
  const areas = new Areas(aiData.areas);
  const props = createProps({ data: pj, weapons: aiData.weapons, areas, warn: m => warns.push(m),
    effect: { spawn: (id, p, s) => fx.push({ id, p, s }), hit: (k, c, p) => fx.push({ hit: k, p }) } });
  const P = php || { pos: [0, 0, 0], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  const reacts = [];
  const ai = createEnemyAI({ data: aiData, player: P, quiet: true, log: () => {}, props, roomRay,
    sound: (n, p) => snd.push({ n, p: p && p.slice() }), react: h => { reacts.push(h); return 'none'; } });
  // the first frame's area switch at the save position (play.js: areas.frame -> onSwitch -> props.areaSwitch)
  areas.onSwitch = props.areaSwitch; areas.frame(SAVE_POS);
  return { ai, props, areas, P, fx, snd, warns, reacts, b: k => props.barrels.find(o => o.rec === k) };
}

// ---------------------------------------------------------------- stage start (no trace)
{
  const { props, b } = world();
  const on = props.barrels.filter(o => o.flags28 & 1).map(o => o.rec);
  ok(on.length === 1 && on[0] === 17, `stage start: active barrels [${on}] ([17]: FUN_00584220 + areas.js at the save position)`);
  const o = b(17);
  ok(o.hp === 1 && o.script === 196 && o.model === 'e057', `record 17: HP ${o.hp} (1), script ${o.script} (196), model ${o.model}`);
  ok(!!(o.f38 & 4) && !!(o.f38 & 1) && !!(o.f40 & 0x20), `record 17: +0x38 0x${o.f38.toString(16)} (bit 0 bullets, bit 2 lockable), +0x40 0x${o.f40.toString(16)} (bit 5 explosion target)`);
  ok(props.lockTargets().length === 1 && props.lockTargets()[0].lockable, 'the lock-on lists record 17 as lockable (FUN_0054b910)');
}
// the barrels follow their parent area (worker 0223; areas.js -> props.areaSwitch = FUN_0054ef68 -> FUN_00584220)
{
  const { props, areas, b } = world();
  const a1 = areas.byIdx.get(1), c = [0, 1, 2].map(i => (a1.bmin[i] + a1.bmax[i]) / 2);
  areas.frame(c);
  const want = props.barrels.filter(o => o.area === 1 && !(o.f48 & 4)).map(o => o.rec);
  const on = props.barrels.filter(o => o.flags28 & 1).map(o => o.rec);
  ok(areas.cur === 1 && !(b(17).flags28 & 1) && want.length > 0 && want.every(k => on.includes(k)) && on.every(k => [...areas.on].includes(b(k).area) || !areas.has(b(k).area)),
     `Vincent in area 1: record 17 (area 2) off, area 1's barrels [${want}] on (active now [${on}])`);
  const held = props.barrels.filter(o => o.area === 1 && (o.f48 & 4)).map(o => o.rec);
  ok(held.every(k => !(b(k).flags28 & 1)), `+0x48 bit 2 barrels of area 1 [${held}] stay off (FUN_00584220)`);
}

// ---------------------------------------------------------------- the trace
const TR = path.join(OUT, 'w209_barrel.jsonl'), TC = path.join(OUT, 'w209_barrel.calls.jsonl');
if (!existsSync(TR) || !existsSync(TC)) console.log('SKIP trace checks: tools/trace/out/w209_barrel.jsonl / .calls.jsonl missing');
else {
  const recs = readFileSync(TR, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.frame != null);
  const calls = readFileSync(TC, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.hook);
  const at = f => recs.find(r => r.frame === f);
  const hexf = h => { const u = new Uint8Array(h.match(/../g).map(x => parseInt(x, 16))); return Array.from(new Float32Array(u.buffer)); };
  const name = e => e['a1+0x0'].u.map(x => { const v = parseInt(x, 16); return String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24); }).join('').replace(/\0.*$/, '');
  const fire = calls.find(e => e.hook === 'play_name' && name(e) === 'bsj_051');
  const hp = calls.find(e => e.hook === 'b_hp'), xn = calls.find(e => e.hook === 'expl_new');
  const ups = calls.filter(e => e.hook === 'expl_upd'), pd = calls.find(e => e.hook === 'p_damage'), rc = calls.find(e => e.hook === 'blast_react');
  const boom = calls.find(e => e.hook === 'play_name' && name(e) === 'bsj_065'), fxe = calls.find(e => e.hook === 'fx_expl');
  const r0 = at(fire.frame);
  const bpos = hexf(r0.b_pos).slice(0, 3);
  const vpos = r0.matrix[3].slice(0, 3);
  const muzzle = fire['a2+0x0'].f.slice(0, 3);                 // FUN_00577480's sound at the pulled-back muzzle
  const aim = r0.p_aim.slice(0, 3);                             // P+0x2b0: the lock-on's point = the barrel's +0x90
  ok(near(aim, bpos, 1e-3), `trace: the shot's aim (P+0x2b0) is the barrel's centre ${bpos.map(v => v.toFixed(2))} (the lock-on took it)`);
  const php = { pos: vpos.slice(), face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  const T = world({ recs: { 17: bpos }, php });
  const { ai, props } = T;
  // GUESS (test input): no cone (the pellet draws need the twister state, not in the trace); one frame of the page = one record
  ai.playerShot(muzzle, aim, { ...Wv, spread: null });
  const log = [];
  let hitF = null, xF = null;
  for (let i = 0; i < 70; i++) {
    const ev = ai.tick(STEP, php.pos, php.pos);
    const f = fire.frame + i;                                   // tick 0 = the shot's frame (the page's queueShot runs inside it)
    log.push({ f, ev, e: props.explosions[0] ? { ...props.explosions[0] } : null, hp: php.hp });
    if (hitF == null && ev.some(s => s === 'bullet hits p17')) hitF = i;
    if (xF == null && ev.some(s => /^explosion x0 r /.test(s))) xF = i;
  }
  // the page's playerShot runs in the shot's frame (the pellets' countdown 2, 3, 4): the first pellet is updated two
  // frames later; the game's sound (FUN_00577480) is in the shot frame too
  ok(hitF === hp.frame - fire.frame, `hit ${hitF} frames after the shot (game: f${fire.frame} -> f${hp.frame})`);
  ok(hp.a1 === 49 && T.b(17).hp === 0, `pellet damage ${hp.a1} (game 49 = W+0x40) -> barrel HP ${T.b(17).hp} (0)`);
  ok(xF === hitF, 'the explosion starts in the hit frame (script 196 event 0x17 -> cmd 0x2a)');
  const ex0 = log[xF].e;
  ok(ex0 && ex0.d4 === xn.f12 && ex0.dmg === xn.a2 && ex0.owner === xn.a3, `explosion radius ${ex0.d4} / damage ${ex0.dmg} / owner ${ex0.owner} (game ${xn.f12} / ${xn.a2} / ${xn.a3})`);
  ok(near(ex0.pos, xn['a1+0x0'].f.slice(0, 3), 1e-3), `explosion at ${ex0.pos.map(v => v.toFixed(2))} (game ${xn['a1+0x0'].f.slice(0, 3)})`);
  const s65 = T.snd.find(s => s.n === 'bsj_065');
  ok(!!boom && !!s65 && near(s65.p, boom['a2+0x0'].f.slice(0, 3), 1e-3), `sound bsj_065 at the centre (FUN_0033d6b0; game f${boom.frame})`);
  const fx8 = T.fx.find(x => x.id === 0x800);
  ok(fxe && parseInt(fxe.a0, 16) === 0x800 && fx8 && near(fx8.s, [6.5, 6.5, 6.5, 1], 1e-6) && near(fx8.p, ex0.pos, 1e-6), `effect 0x${fx8 ? fx8.id.toString(16) : '?'} (game ${fxe && fxe.a0}) at the centre, scale ${fx8 && fx8.s} (radius x 0.1)`);
  // +0x16a count, +0x16c ids (+0x4c << 16 | +0x20): Vincent 0x160016, the barrel 0x1df01df (object 479)
  const w168 = ups[0]['a0+0x168'].u.map(x => parseInt(x, 16));
  const gameIds = w168.slice(1, 1 + ((w168[0] >> 16) & 0xff)).map(v => v === 0x160016 ? 'P' : v === 0x1df01df ? 'p17' : v.toString(16));
  ok(JSON.stringify(ex0.targets) === JSON.stringify(gameIds), `targets [${ex0.targets}] (game [${gameIds}])`);
  ok(php.hp === at(hp.frame).p_hp && 780 - php.hp === pd.a1, `Vincent HP 780 -> ${php.hp} (game ${at(hp.frame).p_hp}; damage ${pd.a1})`);
  const rx = T.reacts[0];
  ok(rx && rx.flags === rc.a1 && near(rx.dir, rc['a2+0x0'].f.slice(0, 3), 2e-3) && near(rx.point, rc['a3+0x0'].f.slice(0, 3), 1e-3),
     `reaction flags ${rx && rx.flags} (game ${rc.a1}), dir ${rx && rx.dir.map(v => v.toFixed(4))} (game ${rc['a2+0x0'].f.slice(0, 3)}), at the centre`);
  // every update: +0xc8 clock and +0xd0 radius (ups[k] = the k-th update, logged after it)
  let worst = 0, n = 0;
  for (let k = 0; k < ups.length; k++) {
    const L = log[xF + k], g = new Float32Array(new Uint32Array(ups[k]['a0+0xc4'].u.map(x => parseInt(x, 16))).buffer);   // exact words
    if (!L || !L.e) break;
    worst = Math.max(worst, Math.abs(L.e.c8 - g[1]), Math.abs(L.e.d0 - g[3]));
    const idx = parseInt(ups[k]['a0+0x168'].u[0], 16) & 0xff;                // +0x168: targets done (one per update, FUN_0057e7d0)
    if (L.e.i !== idx) worst = Infinity;
    n++;
  }
  ok(n === ups.length - 1 && worst === 0, `${n} updates match the clock / radius / target index to ${worst.toExponential(1)} (game ${ups.length} updates; the last one removes it)`);
  const last = log.findIndex(L => L.ev.some(s => s === 'explosion x0 ends'));
  ok(last - xF + 1 === ups.length, `the explosion ends after ${last - xF + 1} updates (game ${ups.length}: FUN_0053fa08 at +0xc8 >= 60)`);
  ok(!T.b(17).drawn && T.b(17).gone, 'the barrel is gone after the frame (nothing left: FUN_0053fa08)');
}

// ---------------------------------------------------------------- fixed-input cases
const spot = [100, -10, 0];
{ // a soldier's bullet stops on the barrel and does not break it (type flag bit 6, bullet +0x120 bit 2 clear)
  const T = world({ recs: { 17: spot } });
  const a = T.ai.addActor({ rec: 45, mode: 0, pos: [60, 0, 0], face: [1, 0, 0], clip: 'r_st_a' });
  // the soldiers' own shot (FUN_00569340 -> FUN_005409a8 -> FUN_005405b0 cone, FUN_00552dd8 flags: enemy_ai spawnShot), from
  // 6 u in front of the barrel's centre, five shots; their +0x120 has no bit 2 (status +0x60 bit 1 clear)
  let hits = 0, shots = 0;
  for (let k = 0; k < 5; k++) {
    T.ai.t.spawnShot(a, spot.slice(), [94, -10, 0]);
    shots++;
    for (let i = 0; i < 8; i++) hits += T.ai.tick(STEP, [0, 0, 0], [0, 0, 0]).filter(s => s === 'bullet hits p17').length;
  }
  ok(hits >= 1 && T.b(17).hp === 1 && !T.props.explosions.length, `soldier's bullets (spawnShot, ${shots} shots): hit the barrel ${hits}x, HP ${T.b(17).hp} (1), no explosion`);
}
function blast(extra = {}) {   // record 17 at spot, broken by a straight player pellet from 30 u
  const T = world({ recs: { 17: spot, ...(extra.recs || {}) }, on: extra.on || [], php: extra.php, roomRay: extra.roomRay });
  const actor = extra.actorAt ? T.ai.addActor({ rec: 45, mode: 0, pos: extra.actorAt, face: [1, 0, 0], clip: 'r_st_a' }) : null;
  T.ai.playerShot([70, -10, 0], spot, { ...Wv, spread: null });
  const ev = [];
  for (let i = 0; i < 60; i++) ev.push(...T.ai.tick(STEP, T.P.pos, T.P.pos));
  return { ...T, actor, ev };
}
{ // no chain: another barrel 30 u away is listed, takes no damage, no second explosion
  const T = blast({ recs: { 18: [100, -10, 30] }, on: [18], php: { pos: [-300, 0, 0], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 } });
  const x = T.ev.filter(s => /^explosion x\d+ r /.test(s)).length;
  ok(T.b(17).hp === 0 && T.b(18).hp === 1 && x === 1 && T.ev.includes('explosion x0 hits p18'), `chain: barrel 18 listed (${T.ev.includes('explosion x0 hits p18')}), HP ${T.b(18).hp} (1), explosions ${x} (1)`);
}
{ // a soldier in range: FUN_0055e498 (damage FUN_00318120 of 120, kind 1; flags 8; Vincent credited)
  const T = blast({ actorAt: [100, 0, 30], php: { pos: [-300, 0, 0], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 } });
  const want = Math.min(defence({ ...ENEMY_STATUS, lvl: T.actor.lvl }, 120, 1), 9999);
  const m = T.ev.map(s => /^blast (\S+) dmg (\d+) hp (\d+)/.exec(s)).find(Boolean);
  ok(!!m && +m[2] === want && T.actor.hp === Math.max(0, 100 - want), `soldier 30 u away: blast dmg ${m && m[2]} (FUN_00318120: ${want}), HP ${T.actor.hp}`);
  ok(T.actor.ai.f90 === 0x16, `the soldier's AI blames Vincent (+0x90 = 0x${(T.actor.ai.f90 ?? 0).toString(16)}; +0x188 byte 1)`);
  ok(!T.ev.some(s => /^blast player/.test(s)), 'Vincent 400 u away is not hit');
}
{ // out of range: 70 u (radius 65 to the nearest cylinder point: the soldier's side at 65.0 + 5)
  const T = blast({ actorAt: [100, 0, 75], php: { pos: [-300, 0, 0], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 } });
  ok(!T.ev.some(s => /^blast /.test(s)) && T.actor.hp === 100, 'a soldier 75 u away (70 to his side) is out of the 65 u blast');
}
{ // a wall: the room ray from the centre stops 25 u short of Vincent's middle -> blocked (> 10 in front)
  const roomRay = (a, b) => { if (a[0] !== spot[0] || a[2] !== spot[2]) return null; const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d); return [a[0] + d[0] / L * 15, a[1] + d[1] / L * 15, a[2] + d[2] / L * 15]; };   // only the explosion's rays (from the centre)
  const T = blast({ roomRay, php: { pos: [60, 0, 0], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 } });
  ok(T.ev.includes('explosion x0 blocked P') && T.P.hp === 780, `a wall 25 u in front of Vincent blocks the blast (HP ${T.P.hp})`);
}
done();
