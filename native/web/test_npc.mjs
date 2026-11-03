// Townspeople wake (worker 0223; notes/npc-research.md): trigger 96's script 23 sets NPCs 111 / 113 / 114 up and wakes
// them (cmd 0x40 / 0x10e locator, 0x14a, 0x104 var4 = 1, 0x108), their event 3 (manager event 7) asks for 'fear' with
// cmd 0x141. T: w223_npc95 (trigger 95 poked to run script 23; tools/trace/out, gitignored): 113 / 114 wake on f783 in
// 'st', 'fear' from f784, 114 at locator 5; RAM at f800 / f826: 111 at locator 6, var4 = 1, stances 0xe / 0xd / 0xc, mode 0.
// Worker 0228: the townspeople are actors (the soldiers' class 0x58e1f8, brain mode 0 = empty): cmd 0x141 = motion class 2,
// cmd 0x131 path walk (113 along path 96; T w223_npc95 / w228_npc95x), the path node event (manager 0x10 -> script event
// 0x14), cmd 0x16a (+0x38 0x210), Vincent's bullets, death (script event 0x17), and the rescue chain (soldiers 69-71 dead ->
// trigger 24 -> 113 / 114 run paths 33 / 44).
// Run: node --import ./native/web/test_hooks.mjs native/web/test_npc.mjs   (ENEMY_AI_JS=path: another enemy_ai.js copy)
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { modelPose, boneRows } from './enemy_hit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(process.env.ENEMY_AI_JS || path.join(here, 'enemy_ai.js')).href);
const aiPath = path.join(here, 'data/enemies/ai.json');
if (!existsSync(aiPath)) { console.log('SKIP: data/enemies/ai.json missing (run tools/byo/build_web.sh)'); process.exit(0); }
const data = JSON.parse(readFileSync(aiPath, 'utf8'));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const near = (a, b, e = 0.02) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= e);

const NPC = [111, 113, 114];
const trig = k => data.triggers[k].m[3].slice(0, 3);
function wake(extra = {}) {
  const player = { pos: [-1395, -99, -1110], hp: 780, id: 0x16, f118: 0, s64: 0 }, act = [];
  const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, deadRecs: [41, 42, 43],
    onActivate: (rec, a) => act.push({ rec: rec.rec, model: rec.model, pos: (a ? a.pos : rec.pos).slice(), face: (a ? a.face : rec.face).slice(), actor: !!a }),
    ...extra });
  const [x, y, z] = trig(96), a = [x - 40, y - 5, z], b = [x + 40, y - 5, z];
  player.pos = a; W.tick(1.0, a, a);
  const before = NPC.map(k => W.objects.get(k + 22).C?.n640 ?? null);
  player.pos = b; W.tick(1.0, a, b);                 // enters trigger 96 (ev 0xd)
  return { W, act, before, player, b };
}

{
  const { W, act, before } = wake();
  const o = k => W.objects.get(k + 22);
  ok(NPC.every(k => o(k).flags28 & 1), `trigger 96: NPCs ${NPC.join(' / ')} active (+0x28 bit 0; T w223_npc95 f783: 0x20c40b)`);
  ok(NPC.every(k => act.some(x => x.rec === k && x.actor) && o(k).kind === 'actor' && o(k).ai && o(k).ai.mode === 0),
     'activation builds an actor with an AI in brain mode 0 (FUN_00559748 -> FUN_00365c50; T w223_npc95 AI mode 0)');
  ok([69, 70, 71].every(k => act.some(x => x.rec === k && x.actor)), 'the same script wakes soldiers 69-71 with actors');
  ok(NPC.every(k => o(k).vars[4] === 1), `var4 = 1 before the 0x108 (cmd 0x104; T RAM f800: ${NPC.map(k => o(k).vars[4]).join(' ')})`);
  // T RAM f800 / f826 (actor +0x60 row 3): 111 (-1016.41, -0.30, -1174.90) = locator 6, 114 (-1074.37, -0.13, -1274.05) = locator 5.
  // 113 starts at locator 4 and slides along path 96 (cmd 0x131) until f791 (below)
  const at = k => act.find(x => x.rec === k);
  ok(near(at(111).pos, [-1016.40979, -0.300191, -1174.902588]) && near(at(114).pos, [-1074.373657, -0.126812, -1274.051636]),
     `built at their cmd 0x10e locators: 111 ${at(111).pos.map(v => v.toFixed(2))}, 114 ${at(114).pos.map(v => v.toFixed(2))} (T f783-826)`);
  ok(near(at(113).pos, data.locators[4].m.slice(12, 15)), `113 at locator 4 (path 96's start) ${at(113).pos.map(v => v.toFixed(2))}`);
  // T: face (actor body C+0x20) = the placement's for 111 / 114 (0x10e moves the position only)
  ok(near(at(114).face, [0.684093, 0.0, 0.729395], 0.001) && near(at(111).face, [-0.389761, 0.0, 0.920916], 0.001), 'placement facing kept');
  ok(before.every(m => m == null) && NPC.every(k => o(k).C.n640 === 'fear' && o(k).C.motion.cls === 2 && o(k).C.clip === 'st' && o(k).astate === 1),
     `event 3 -> cmd 0x141: C+0x640 ${NPC.map(k => `${k} ${o(k).C.n640}`).join(', ')}, motion class 2, still 'st' on the wake tick, actor state 1 (T: 'st' f783, +0x104 = 1)`);
  W.tick(1.2, [0, 0, 0], [0, 0, 0]);
  ok(NPC.every(k => o(k).C.clip === 'fear' && o(k).C.loop && o(k).C.flags === 3 && o(k).C.blendLen === 10),
     `next tick: class 2 phase 0 requests 'fear' (FUN_003448c0(C, 0, 1): flags 3, looped; blend C+0x6c0 10) (T: 'fear' from f784)`);
  ok(NPC.every(k => (o(k).C.f564 & 0x204000) === 0x204000), 'class 2 enter 0x593c20: C+0x564 bits 0x4000 | 0x200000');
  ok(NPC.every(k => data.records[k].mode === 0), 'AI mode (section-1 +8) 0 (T AI +0xd0 = 0)');
  const st = Object.fromEntries(NPC.map(k => [k, data.records[k].stance]));
  ok(st[111] === 0xe && st[113] === 0xd && st[114] === 0xc, `stances (FUN_00564228) 111 ${st[111]} / 113 ${st[113]} / 114 ${st[114]} (T C+0x664: 0xe / 0xd / 0xc)`);
  ok(data.stances['13'] && data.stances['13'].motions[0] === 'st' && data.stances['13'].flags === 0, 'stance 0xd row 0 = st, flags 0 (T C+0x808 = 0)');
}

// the NPC bodies in the push-out (+0x38 bit 9) and the lock-on list (never lockable): T RAM +0x38 = 0x391, size 5 / 18
// (113 / 114) and 5 / 14 (111) = ai.json sizes
{
  const { W } = wake();
  const lt = W.lockTargets().filter(t => [111, 113, 114].some(k => t.id === k + 22));
  ok(lt.length === 3 && lt.every(t => !t.lockable && t.probeBits === 0x391) && lt.find(t => t.id === 114 + 22).height === 18,
     `lock-on list: NPCs ${lt.map(t => t.id - 22).join(' / ')} listed, not lockable (+0x38 0x391)`);
  const p114 = [-1074.373657, -0.126812, -1274.051636];
  const push = W.pushOut([p114[0] + 6, p114[1], p114[2]]);
  ok(push[0] > 0 && Math.abs(push[2]) < 1e-3, `Vincent 6 u east of 114 is pushed east (${push.map(v => v.toFixed(3))})`);
  const far = W.pushOut([p114[0] + 20, p114[1], p114[2]]);
  ok(far.every(v => v === 0), 'and not at 20 u');
}

// FUN_005661e8 case 0x141 needs the body (+0xe8): an inactive record has none -> nothing (117 n029: event 3 with var4 = 1
// asks for 'fear', as its neighbours do once active)
{
  const { W } = wake();
  const o = W.objects.get(117 + 22);
  o.vars[4] = 1;
  W.runEvent(o, 3);
  ok(!(o.flags28 & 1) && o.motion == null, `inactive record 117: cmd 0x141 does nothing (motion ${o.motion ?? 'none'})`);
  W.setActive(o, 1); const a = W.objects.get(117 + 22); W.runEvent(a, 3);
  ok((a.flags28 & 1) && a.kind === 'actor' && a.C.n640 === 'fear', `once active: 117 C+0x640 ${a.C.n640}`);
}

// the FUN_00566198 gate (status dead and not +0xc bit 1) with r2: a dead NPC with a body takes 0x141 only when r2 != 0;
// the body gate: a deactivated record (FUN_00588330: no body) takes none. Script 9997 ev 2: 0x141(data 'fear2', 0, r2)
{
  const mk = r2 => ({ locals: 0, data: '6665617232000000',
    code: [[32, 0], [37, 0], [4, 0], [4, r2], [52, 0], [26, 2], [26, 1], [26, 0], [4, -2], [38, 0x141], [2, 0], [4, 0], [17, 0]] });
  const { W } = wake();
  const o = W.objects.get(114 + 22), keep = o.script;
  const run = r2 => { data.scripts[9997] = { 2: mk(r2) }; o.script = 9997; W.runEvent(o, 2); o.script = keep; };
  ok(o.C.n640 === 'fear' && o.astate === 1, `after the wake: 114 ${o.C.n640}, actor state ${o.astate} (FUN_0055b8e0(a, 1, 0, 0); T +0x104 = 1)`);
  o.hp = 0; run(0);
  ok(o.C.n640 === 'fear', `dead, r2 = 0: no change (${o.C.n640})`);
  run(1);
  ok(o.C.n640 === 'fear2', `dead, r2 = 1: plays (${o.C.n640})`);
  o.hp = 58; W.setActive(o, 0); const r = W.objects.get(114 + 22); data.scripts[9997] = { 2: mk(1) }; r.script = 9997; W.runEvent(r, 2); r.script = keep;
  ok(r.kind === 'record' && r.motion == null, `no body after the deactivation: nothing (${r.motion ?? 'none'})`);
  delete data.scripts[9997];
}

// 113's slide along path 96 (cmd 0x131 from script 23, after its 0x108): mover 1, move mode 9, speed 50 (ai.json speed), turn
// mode 5, 'fear' playing (motion class 2 has no locomotion). T (w223_npc95, per frame): f783 (-1077.82, -0.12, -1287.42) .. f791
// (-1081.11, -0.01, -1280.13), facing (-0.411, 0, 0.911), move mode 0 at f791, speed 0 from f792. The page's tick k + 1 = the
// game's f783 + k: the game's trigger runs before the bodies in its frame, the page's after (test_path_walk: the same offset).
// The path's last node: listener event 3 (FUN_0034fad0) -> manager 0x10 -> script event 0x14 (r0 = 1; script 73 does nothing
// with var4 = 1); its end: event 2 -> manager 0xf -> script event 0x13: 0x16a(1), var6 = 2, 0x141 'fear' again.
const SLIDE = [[-1077.823, -0.123, -1287.424], [-1078.234, -0.109, -1286.513], [-1078.645, -0.094, -1285.601], [-1079.056, -0.080, -1284.690],
  [-1079.467, -0.065, -1283.779], [-1079.879, -0.051, -1282.867], [-1080.290, -0.037, -1281.956], [-1080.701, -0.022, -1281.044], [-1081.112, -0.008, -1280.133]];
{
  const { W, b } = wake();
  const a = W.objects.get(113 + 22), got = [], ev = [];
  ok(a.C.mover === 1 && a.C.path === 96, `113: cmd 0x131 path ${a.C.path}, mover ${a.C.mover} (T: move mode 9 from f783)`);
  for (let k = 0; k < 12; k++) {
    W.tick(1.2, b, b);
    got.push(a.pos.slice());
    ev.push(...W.events.filter(e => /135/.test(e)).map(e => `${k} ${e}`));
  }
  const err = Math.max(...SLIDE.map((p, k) => Math.max(...p.map((v, i) => Math.abs(v - got[k][i])))));
  ok(err < 0.002, `path 96 slide: page ticks 1-9 = game f783-791 (max error ${err.toFixed(4)} u)`);
  ok(near(got[11], SLIDE[8], 0.002) && near(a.face, [-0.411, 0, 0.911], 0.001), `stops at (${got[11].map(v => v.toFixed(2))}) facing (${a.face.map(v => v.toFixed(3))})`);
  ok(got.every(() => true) && a.C.clip === 'fear', `'fear' plays through the slide (no walk clip; T e0_motion 'fear' f784-791): ${a.C.clip}`);
  const i14 = ev.findIndex(e => / ev 20 r 1,0/.test(e)), i13 = ev.findIndex(e => / ev 19 /.test(e)), iend = ev.findIndex(e => /path end 135/.test(e));
  ok(i14 >= 0 && iend >= 0 && i13 > iend && ev[iend].startsWith('9 '), `node event 0x14 (r0 1), path end on tick ${ev[iend]?.split(' ')[0]} (= f792: T speed 0), then event 0x13`);
  ok(a.vars[6] === 2 && ev.some(e => /motion 135 fear/.test(e)) && a.f38 === 0x391, `event 0x13 (var4 = 1): var6 = ${a.vars[6]}, 0x141 'fear' again, 0x16a(1)`);
}

// Vincent's bullets on a townsperson (worker 0228): the soldiers' path (FUN_005ad118 part test on the n024 part boxes, FUN_0055db50
// damage x zone, the flinch, FUN_0055c7f8 HP) and the death FUN_0055cac8 -> script 74 event 0x17: 0x16a(0) (+0x38 &= ~0x210: off
// the push-out), 0x125 scream se_0494, var4 = 1 -> var5 = 1 and message 1 to 113, whose event 2 (r0 != 0) runs path 33.
const D = p => path.join(here, 'data', p);
if (!existsSync(D('enemies/n024.json')) || !existsSync(D('aim/weapon.json'))) console.log('skip  bullets: n024 model / weapon.json not built');
else {
  const n24 = JSON.parse(readFileSync(D('enemies/n024.json'), 'utf8')).local_pose;
  const n24d = new Float32Array(readFileSync(D('enemies/n024_local.bin')).buffer.slice(0));
  const straight = { ...JSON.parse(readFileSync(D('aim/weapon.json'), 'utf8')), spread: null, pellets: 1 };
  const sounds = [];
  const { W, b } = wake({ sound: (n, p, r) => sounds.push(n) });
  const P0 = modelPose(n24, n24d, 'fear', 0);
  W.boneWorld = x => k => boneRows(P0.R[k], P0.S[k], P0.P[k], x.pos, x.face);
  const n = () => W.objects.get(114 + 22), ev = [];
  ok(data.hitboxes.n024 && data.hitboxes.n024.length === 13 && data.zones[String(data.records[114].zones)], 'ai.json: n024 part boxes (13, the mkd chunk) and zone set 16');
  // a miss beside the body: the cylinder but no part (AI +0x70 + 1)
  const c0 = W.boneWorld(n())(3)[3], fw = n().face;
  W.playerShot([c0[0] + 60 * fw[0], c0[1] - 7, c0[2] + 60 * fw[2]], [c0[0] - 60 * fw[0], c0[1] - 7, c0[2] - 60 * fw[2]], straight);
  for (let i = 0; i < 6; i++) W.tick(1.2, b, b);
  ok(n().hp === 58, `a shot over the crouched body: no part, HP ${n().hp} (58)`);
  for (let k = 0; k < 6 && n().hp > 0; k++) {
    const c = W.boneWorld(n())(3)[3], f = n().face;                         // through the chest bone, along its facing
    W.playerShot([c[0] + 60 * f[0], c[1], c[2] + 60 * f[2]], [c[0] - 60 * f[0], c[1], c[2] - 60 * f[2]], straight);
    for (let i = 0; i < 6; i++) { W.tick(1.2, b, b); ev.push(...W.events); }
  }
  const hits = ev.filter(e => /^hit 136 /.test(e));
  ok(hits.length >= 2 && /hp 34$/.test(hits[0]), `hits: ${hits.join(' | ')}`);
  ok(n().hp === 0 && n().astate === 7 && /^dead/.test(n().C.clip), `killed: HP ${n().hp}, actor state ${n().astate}, clip ${n().C.clip} (stance 0xc death rows 0x2a-0x35)`);
  ok(ev.some(e => /event 136 script 74 ev 23/.test(e)) && n().f38 === 0x181, `death -> script event 0x17: 0x16a(0) +0x38 0x${n().f38.toString(16)} (0x181)`);
  ok(sounds.includes('se_0494') && n().vars[5] === 1, `scream ${sounds.join(',')}, var5 = ${n().vars[5]}`);
  const lt = W.lockTargets().find(t => t.id === 136);
  ok(lt && !lt.lockable && !lt.alive && lt.probeBits === 0x181, `the corpse in the lock list: not lockable, +0x38 0x${lt && lt.probeBits.toString(16)}`);
  const q = W.objects.get(113 + 22);
  ok(ev.some(e => /event 135 script 73 ev 2 r 1,0,136/.test(e)) && q.C.path === 33 && q.C.mover === 1 && q.vars[6] === 1,
     `113 gets message 1 from 114: event 2 -> var6 = 1, 0x142(2), path ${q.C.path}`);
  // FUN_005690c8 case 3's FUN_00563970(a, -1) after each node event (enemy_ai a.listen -> trackMoved): the actor's nav node
  // +0x108 follows the run. With a node, FUN_0033dda8(40, G, node, p, 0) from it (nav_graph trackNode); its spawn node
  // (FUN_00559748's tail, 50 u) is otherwise kept, as the mode-0 brain runs no action layer.
  const n0 = q.node108, seen = [];
  for (let i = 0; i < 300; i++) {
    W.tick(1.2, b, b);
    if (W.events.some(e => /event 135 script 73 ev 20 /.test(e))) seen.push({ n: q.node108, p: q.pos.slice() });
    if (i === 39) ok(q.astate === 2 && q.C.clip === 'rn', `113 runs (actor state ${q.astate}, motion 3: ${q.C.clip})`);
  }
  const G = data.nav, d = (k, p) => Math.hypot(G.nodes[k][0] - p[0], G.nodes[k][1] - p[1], G.nodes[k][2] - p[2]);
  const nodes = [...new Set(seen.map(x => x.n))];
  ok(seen.length >= 5 && nodes.length >= 3 && nodes[nodes.length - 1] !== n0 && seen.every(x => x.n === -1 || d(x.n, x.p) < 40),
     `node events re-pick 113's nav node (FUN_00563970): spawn ${n0}, then ${nodes.join(' ')} over ${seen.length} node events, each within 40 u`);
  // the listener's own FUN_00563970, apart from the page's per-frame trackMoved (enemy_ai tick, a GUESS on 'when'): moved 0.5 u
  // short of another node with no tick in between, the node event alone re-picks the node (from the old one: FUN_0033dda8)
  const pick = G.nodes.findIndex((v, k) => k !== q.node108 && d(k, q.pos) > 60);
  q.pos = [G.nodes[pick][0] + 0.5, G.nodes[pick][1], G.nodes[pick][2]];
  const before = q.node108; q.listen(3, 99);
  ok(q.node108 !== before && (q.node108 === -1 || d(q.node108, q.pos) < 40),
     `node event -> FUN_00563970(a, -1) at once: node ${before} -> ${q.node108} after a move to node ${pick}`);
}

// The rescue at trigger 24 (box +-52 u around (-1090.7, 0, -1273.2), script 138): soldiers 69-71 (scripts 24-26) count their
// deaths in manager short 13; the third death's event 0x17 sends message 0 to trigger 24, whose event 2 sets short 19 = 1 (Vincent
// not inside: var0 0). Vincent entering it (event 0xd): short 19 = 0, message 0 to 113, 0x10a deletes the trigger. 113's event 2
// (r0 0, var5 != 1): message 0 to 114; 114's event 2 (r0 0): manager counter 56 += 2, short 79 = 1, **event flag 1 = 5** (the
// stage program's minor flag). Neither runs: the r0 == 0 branch ends there (script 73 / 74 disassembly).
{
  const { W, b } = wake();
  const ev = [];
  for (const r of [69, 70, 71]) {
    const s = W.objects.get(r + 22);
    W.t.hitEnemy(s, { damage: 9999, kind: 0, dir: [1, 0, 0], shooter: 0x16, f148: 0, hit: 0, f120: 0x800 }, s.pos.slice());
    for (let i = 0; i < 3; i++) { W.tick(1.2, b, b); ev.push(...W.events); }
  }
  ok([69, 70, 71].every(r => W.objects.get(r + 22).hp === 0) && W.eventFlags[1] !== 5, 'soldiers 69-71 dead; flag 1 not yet 5');
  const c = trig(24), out = [c[0], c[1] - 5, c[2] + 80], inn = [c[0], c[1] - 5, c[2]];
  W.tick(1.2, out, out); W.tick(1.2, out, inn); ev.push(...W.events);
  for (let i = 0; i < 4; i++) { W.tick(1.2, inn, inn); ev.push(...W.events); }
  ok(ev.some(e => /event 135 script 73 ev 2 r 0,0/.test(e)) && ev.some(e => /event 136 script 74 ev 2 r 0,0,135/.test(e)) && ev.some(e => /delete t24/.test(e)),
     'Vincent in trigger 24: message 0 -> 113 -> 114, trigger 24 deleted');
  ok(W.eventFlags[1] === 5, `rescue beat: event flag 1 = ${W.eventFlags[1]} (114's event 2, cmd 0xb)`);
  ok([113, 114].every(k => W.objects.get(k + 22).C.mover === 0 && W.objects.get(k + 22).C.clip === 'fear'), 'both stay cowering (no path on r0 0)');
}

// against the trace file, when present (gitignored)
{
  const f = path.join(here, '../../tools/trace/out/w223_npc95.jsonl');
  if (!existsSync(f)) console.log('skip  trace w223_npc95.jsonl not here');
  else {
    const rows = readFileSync(f, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')));
    const wakeF = e => rows.find(r => r[e + '_flags'] & 1)?.frame;
    const mot = (e, fr) => rows.find(r => r.frame === fr)?.[e + '_motion'];
    const w0 = wakeF('e0'), w1 = wakeF('e1');
    ok(w0 === w1 && mot('e0', w0) === 'st' && mot('e1', w0 + 1) === 'fear' && mot('e0', w0 + 1) === 'fear',
       `trace: 113 / 114 wake on the same frame (${w0} / ${w1}) in st, fear from the next (the page: same tick, event 3 at its end)`);
    const p = (e, fr) => { const h = rows.find(r => r.frame === fr)[e + '_face_pos']; const b = Buffer.from(h, 'hex'); return [16, 20, 24].map(o => b.readFloatLE(o)); };
    ok(near(p('e1', w1), [-1074.373657, -0.126812, -1274.051636], 0.01), `trace: 114 at locator 5 on its wake frame ${p('e1', w1).map(v => v.toFixed(2))}`);
  }
}

// w228_npc95x (worker 0228; tools/trace/scripts/w228_npc95x.json, same env as w223_npc95, TRACE_LOG_AT=9e000): f783-1099.
// 113 / 114 per frame against the page: page tick k + 1 = f783 + k (see the slide above), position, clip, actor state, HP, AI mode.
{
  const f = path.join(here, '../../tools/trace/out/w228_npc95x.jsonl');
  if (!existsSync(f)) console.log('skip  trace w228_npc95x.jsonl not here');
  else {
    const rows = readFileSync(f, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')));
    const pos = (r, e) => { const b = Buffer.from(r[e + '_face_pos'], 'hex'); return [16, 20, 24].map(o => b.readFloatLE(o)); };
    const { W, b } = wake();
    const A = { e0: W.objects.get(113 + 22), e1: W.objects.get(114 + 22) };
    let maxP = 0, bad = [];
    for (const r of rows) {
      W.tick(1.2, b, b);
      for (const e of ['e0', 'e1']) {
        const a = A[e], g = pos(r, e);
        maxP = Math.max(maxP, ...g.map((v, i) => Math.abs(v - a.pos[i])));
        const want = { clip: r.frame === 783 ? 'st' : r[e + '_motion'], st: r[e + '_astate'] & 0xff, hp: r[e + '_hp'], mode: r[e + '_ai_mode'] };
        // the page's clip is C+0x570 after its tick: 'fear' requested one tick after the wake (the game's f784)
        const have = { clip: a.C.clip, st: a.astate, hp: a.hp, mode: a.ai.mode };
        if (r.frame > 783 && JSON.stringify(want) !== JSON.stringify(have) && bad.length < 3) bad.push(`f${r.frame} ${e} game ${JSON.stringify(want)} page ${JSON.stringify(have)}`);
      }
    }
    ok(rows.length >= 300 && maxP < 0.01, `w228_npc95x: ${rows.length} frames (f${rows[0].frame}-${rows.at(-1).frame}), 113 / 114 position max error ${maxP.toFixed(4)} u`);
    ok(bad.length === 0, `clip / actor state / HP / AI mode every frame${bad.length ? ': ' + bad.join(' | ') : ''}`);
  }
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
