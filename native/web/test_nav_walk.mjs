// Mover 0xd, the nav-graph path follower (path_mover.js navTick = FUN_00351928, worker 0163), against the
// PCSX2 trace w161_chase (tools/trace/scripts/w161_chase.json; TRACE_PATH_BODY=1; game-derived, not committed)
// and hand cases.
//   1. node tracking FUN_0033dda8 (nav_graph.js nodeFrom): +0x108 from the last frame's node, every frame
//   2. open loop: each frame, the game's follow state (list, C+0x310..0x318, C+0x398, C+0x1c0, C+0x1d8,
//      position) -> one navTick -> the next record's state and wanted move (C+0xc0, C+0xcc)
//   3. closed loop: the game's lists fed in at its request frames; the follower, the body step (mode 0xc,
//      FUN_003590c8 limits) and the real walk mesh move the soldiers; positions vs the game per frame
//   4. hand cases: queued search (FUN_00368250 / FUN_00368420: 40 steps a frame), the stop's counts and
//      cancel (FUN_00352a60), the blocked first link (FUN_0033f850), the end event (FUN_0034f8c0 event 4)
//   node --import ./native/web/test_hooks.mjs native/web/test_nav_walk.mjs
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PM = await import(pathToFileURL(path.join(here, 'path_mover.js')).href);
const NG = await import(pathToFileURL(path.join(here, 'nav_graph.js')).href);
const tracePath = path.join(process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out'), 'w161_chase.jsonl');
const dataPath = path.join(here, 'data/enemies/ai.json');
const f = Math.fround;
let fail = 0;
const skipped = [];
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const skip = m => { console.log('SKIP ' + m); skipped.push(m); };
const done = () => {
  const sk = skipped.length ? ` (${skipped.length} SKIPPED: ${skipped.join('; ')})` : '';
  console.log(fail ? `${fail} FAILED${sk}` : `all ok${sk}`); process.exit(fail ? 1 : 0);
};
const quiet = () => {};
const DT = f(0.019999999552965164);

// ------------------------------------------------ 4. hand cases (no game data)
function graph(ps, edges) {
  const adj = ps.map(() => []);
  for (const [a, b, c, fl] of edges) { adj[a].push([b, c, fl ?? 0]); adj[b].push([a, c, fl ?? 0]); }
  const nodes = [], links = [];
  ps.forEach((p, i) => { nodes.push([p[0], p[1], p[2], adj[i].length, links.length, 2]); links.push(...adj[i]); });
  return NG.makeGraph({ nodes, links });
}
const mkActor = pos => {
  const a = { pos: pos.slice(), face: [1, 0, 0], node108: -1 };
  a.C = PM.bodyInit({ mover: 0, f1c0: 0x200 | 0x100, f45c: 0x36, mm: 0 }, 50);
  a.B = { poly: 0, state: 0, vel: [0, 0, 0], want: [0, 0, 0], acc: 2.5, turn: f(4 * Math.PI), dt: DT };
  return a;
};
const flatWalk = (a, mv) => [f(a.pos[0] + mv[0]), a.pos[1], f(a.pos[2] + mv[2])];
{
  // a line 0 - 1 - 2 - 3 along +x, 20 u apart
  const G = graph([[0, 0, 0], [20, 0, 0], [40, 0, 0], [60, 0, 0]], [[0, 1, 2000], [1, 2, 2000], [2, 3, 2000]]);
  const svc = NG.makeService();
  const evs = [];
  const a = mkActor([0, 0, 0]);
  NG.trackNode(G, a);
  const nav = { G, svc, rng: () => 0.5, warn: quiet, event: (e, n) => { evs.push([e, n]); if (n !== -1) NG.setNode(G, a, n); } };
  PM.navRequestTo(a, a.node108, 3, 0x60);
  PM.navStart(a, nav, () => {});
  ok(a.C.mover === 0xd && a.C.nst === 0 && a.C.mm === 0xc, 'FUN_0055a590 + FUN_0034edf0(C, 0xd): mover 0xd, follow state 0, move mode 0xc');
  PM.approachFrame(a, null, 1.2, flatWalk, quiet, false, nav);
  ok(a.C.nst === 1 && a.C.qslot === 0 && a.C.list[0] === -1 && !NG.queueFree(svc), `queued request (flags 6 | 0x60, no bit 0): state 1, slot 0, list pending (state ${a.C.nst})`);
  PM.approachFrame(a, null, 1.2, flatWalk, quiet, false, nav);
  ok(a.C.nst === 1, 'no service update yet: still waiting');
  NG.serviceUpdate(svc);
  ok(a.C.list.join() === '0,1,2,3,-1' && NG.queueFree(svc) && svc.used === 0, `FUN_00368420: done within 40 steps, list ${a.C.list}, slot and records free`);
  PM.approachFrame(a, null, 1.2, flatWalk, quiet, false, nav);
  ok(a.C.nst === 4 && a.C.nlen === 4 && [0, 1, 2, 3].every(n => G.occ1d[n] === 1), `state 1 -> 2 -> 3 -> 4 in one call; FUN_00353700 holds every node (+0x1d = ${[...G.occ1d]})`);
  ok(Math.abs(a.C.want[0] - 1) < 1e-6 && Math.abs(a.C.wk - f(50 / 60)) < 1e-6, `first leg: at the midpoint of nodes 0 / 1, C+0xcc = 50 / 60 (${a.C.want.map(v => v.toFixed(3))}, ${a.C.wk})`);
  let n = 0, endAt = -1;
  for (; n < 400; n++) { NG.trackNode(G, a); const r = PM.approachFrame(a, null, 1.2, flatWalk, quiet, false, nav); NG.trackNode(G, a); if (r === 'nav end') { endAt = n; break; } }
  ok(endAt > 0 && Math.abs(a.pos[0] - 60) <= 3.0 && a.C.mover === 0, `walks the line and ends within 3 u of node 3 (x ${a.pos[0].toFixed(2)}, frame ${endAt})`);
  ok(evs.filter(e => e[0] === 5).map(e => e[1]).join() === '0,1,2' && evs.at(-1).join() === '4,3', `listener: event 5 for nodes 0, 1, 2 as passed, event 4 with the last node (${evs.map(e => e.join(':'))})`);
  ok([0, 1, 2, 3].every(n => G.occ1d[n] === 0) && a.C.list[0] === -1, 'FUN_00352a60: +0x1d back to 0, list[0] = -1');
  ok((a.C.f45c & 0x380000) === 0 && a.C.mm === 0xc && a.C.wk === 0, `stop: body limits from C+0x1c0 bits 24-26 (none set), mode 0xc kept, FUN_0034b110(0)`);
  // C+0x1c0 bit 4: 0.3 x the speed
  const b = mkActor([0, 0, 0]); b.C.f1c0 |= 0x10 | 0x1000000 | 0x4000000;
  NG.trackNode(G, b);
  PM.navRequest(b, { goal: 3, s4: 0, max: 10, mode: 0, flags: 0x61, c: 0 }, b.node108);
  PM.navStart(b, { ...nav, event: null }, () => {});
  ok((b.C.f45c & 0x280000) === 0x280000, 'FUN_0034f178 case 0xd: body flags 19 / 21 from C+0x1c0 bits 24 / 26');
  PM.approachFrame(b, null, 1.2, flatWalk, quiet, false, { ...nav, event: null });
  ok(b.C.nst === 4 && Math.abs(b.C.wk - f(f(50 * f(0.3)) * 0.016666668)) < 1e-7, `sync request (flags bit 0): searched and on the path in one call, speed x 0.3 with C+0x1c0 bit 4 (C+0xcc ${b.C.wk})`);
  // cancel a queued search still running: FUN_00352a60 -> FUN_00368398
  const c = mkActor([0, 0, 0]); NG.trackNode(G, c);
  PM.navRequestTo(c, c.node108, 3, 0x60); PM.navStart(c, nav, () => {});
  PM.approachFrame(c, null, 1.2, flatWalk, quiet, false, nav);
  const busy = !NG.queueFree(svc);
  PM.moverStop(c);
  ok(busy && NG.queueFree(svc) && c.C.qslot === 0xf && svc.used === 0, 'stop while the queued search runs: the slot is dropped, records back');
  // a closed first link (FUN_0033f850 flags 1): the mover ends on its first call
  const G2 = graph([[0, 0, 0], [20, 0, 0], [40, 0, 0]], [[0, 1, 2000], [1, 2, 2000]]);
  const d = mkActor([0, 0, 0]); NG.trackNode(G2, d);
  const nav2 = { G: G2, svc: NG.makeService(), rng: () => 0.5, warn: quiet, event: null };
  PM.navRequest(d, { goal: 2, s4: 0, max: 10, mode: 0, flags: 0x61, c: 0 }, d.node108);
  PM.navStart(d, nav2, () => {});
  G2.links[G2.nodes[0][4]][2] = 2;                       // flag 2 alone: blocked only with a way round (none here)
  PM.approachFrame(d, null, 1.2, flatWalk, quiet, false, nav2);
  ok(d.C.mover === 0xd, 'first link flag 2 with no detour (FUN_0033f6a0): not blocked');
  // stuck (FUN_003528d8): bit 18 and no progress for 61 frames -> link flags |= 2, mover ends
  d.C.f1c0 |= 0x40000;
  let k = 0, r = null;
  for (; k < 80 && r !== 'nav end'; k++) r = PM.approachFrame(d, null, 1.2, a2 => a2.pos.slice(), quiet, false, nav2);
  ok(r === 'nav end' && k === 61, `stuck with C+0x1c0 bit 18 for 61 frames within 1.5 u: the mover ends (frame ${k})`);
}

// ---- single-call cases of FUN_00351928 (state 4 / 5) and the tracker / service edges
{
  const G = graph([[0, 0, 0], [3, 0, 0], [4.5, 0, 0], [40, 0, 0], [0, 0, 200]], [[0, 1, 300], [1, 2, 150], [2, 3, 3000]]);
  const nav = { G, svc: NG.makeService(), rng: () => 0.5, warn: quiet, event: null };
  const at = (p, st) => {
    const a = mkActor(p);
    Object.assign(a.C, { mover: 0xd, mm: 0xc, list: [0, 1, 2, 3, -1], nlen: 4, nidx: 0, nst: 4, qslot: 0xf, climb: 0, n316: 0, n318: 0, n398: 0, speed: 0, ...st });
    a.node108 = a.C.n398;
    return a;
  };
  // leg 1 -> 2 seen from 0 (both ahead, < 45 deg), B 4.5 u away (< 5 xz): next node
  let a = at([0, 0, 0], { nidx: 1, n316: 1, n398: 1 });
  PM.navTick(a, nav);
  ok(a.C.nidx === 2, `state 4: B within 5 u (x / z) with A and B ahead -> next node (index ${a.C.nidx})`);
  a = at([-1.0, 0, 0], { nidx: 1, n316: 1, n398: 1 });
  PM.navTick(a, nav);
  ok(a.C.nidx === 1, `state 4: B 5.5 u away, A and B ahead: stays on the leg (index ${a.C.nidx})`);
  // the actor's node C+0x398 neither a leg node nor openly linked to one: the mover ends
  a = at([0, 0, 0], { nidx: 1, n316: -1, n398: 4 });
  ok(PM.navTick(a, nav) === 1, 'state 4: the actor on node 4 (no link to the leg): FUN_0033f650 fails -> 1 (end)');
  // state 5: within 3 u (x / z) of the last node -> end; 3.2 u -> walk on
  a = at([37.2, 0, 0], { nidx: 3, nst: 5, n316: 3, n398: 3 });
  ok(PM.navTick(a, nav) === 1, 'state 5: 2.8 u from the last node -> 1 (end)');
  a = at([36.8, 0, 0], { nidx: 3, nst: 5, n316: 3, n398: 3 });
  ok(PM.navTick(a, nav) === 0 && a.C.wk > 0, 'state 5: 3.2 u from the last node -> walk on');
  // FUN_0033dda8: a neighbour with the same score as the old node does not take it (strict <)
  const T = graph([[0, 0, 0], [10, 0, 0]], [[0, 1, 1000]]);
  ok(NG.nodeFrom(T, 0, [5, 0, 0]) === 0 && NG.nodeFrom(T, 1, [5, 0, 0]) === 1, 'FUN_0033dda8: a tie keeps the old node');
  // FUN_00369e40: a search that reaches its end on the budget's last call is handed over on the next update
  const R = { start: 0, goal: 3, s4: 2, max: 0x80, mode: 0, flags: 0x66, c: 0 };
  const S0 = NG.searchBegin(G, R, () => 0.5, quiet, NG.makeService());
  let steps = 0; while (S0.state !== 3) { NG.searchStep(S0); steps++; }
  const sv = NG.makeService({ budget: steps }), out = { list: null };
  NG.enqueue(sv, G, R, out);
  NG.serviceUpdate(sv);
  const first = out.list.join();
  NG.serviceUpdate(sv);
  ok(first === '-1' && out.list.join() === '0,1,2,3,-1', `${steps} steps with a budget of ${steps}: list after the 2nd update (1st: ${first})`);
}
// ---- review cases (worker 0164): a closed link, the corner's `near` test, the service budget
{
  // FUN_0033f850: a first link with flags 1 is closed: the mover ends on its first call
  const G1 = graph([[0, 0, 0], [20, 0, 0], [40, 0, 0]], [[0, 1, 2000], [1, 2, 2000]]);
  const a = mkActor([0, 0, 0]); NG.trackNode(G1, a);
  const nv = { G: G1, svc: NG.makeService(), rng: () => 0.5, warn: quiet, event: null };
  PM.navRequestTo(a, a.node108, 2, 0x60);                                    // queued: the link closes after the search
  PM.navStart(a, nv, () => {});
  PM.approachFrame(a, null, 1.2, flatWalk, quiet, false, nv);
  NG.serviceUpdate(nv.svc);
  G1.links[G1.nodes[0][4]][2] = 1;
  const r = PM.approachFrame(a, null, 1.2, flatWalk, quiet, false, nv);
  ok(r === 'nav end' && a.C.mover === 0, `first link flags 1 (FUN_0033f850): the mover ends on the list's first call (${r}, mover ${a.C.mover})`);
  // state 4, the corner: A (14, 0, 6), B (0, 0, 0), N (0, 0, 30), the actor at (0, 0, 6) = lerp(B, N, fr - 0.5) with
  // fr = 14 / 20 = 0.7: B 6 u away, A nearer than N (no corner pass), but the target point is under 1 u -> near
  const G2 = graph([[14, 0, 6], [0, 0, 0], [0, 0, 30], [0, 0, 60]], [[0, 1, 2000], [1, 2, 2000], [2, 3, 2000]]);
  const nv2 = { G: G2, svc: NG.makeService(), rng: () => 0.5, warn: quiet, event: null };
  const b = mkActor([0, 0, 6]);
  Object.assign(b.C, { mover: 0xd, mm: 0xc, list: [0, 1, 2, 3, -1], nlen: 4, nidx: 0, nst: 4, qslot: 0xf, climb: 0, n316: 0, n398: 0, speed: 0 });
  b.node108 = 0;
  // a malformed list (list[i + 2] not in the graph): the missing-node warning and the end, no throw
  const m = mkActor([0, 0, 6]), warns = [];
  Object.assign(m.C, { mover: 0xd, mm: 0xc, list: [0, 1, 99, -1], nlen: 3, nidx: 0, nst: 4, qslot: 0xf, climb: 0, n316: 0, n398: 0, speed: 0 });
  let mr; try { mr = PM.navTick(m, { ...nv2, warn: w => warns.push(w) }); } catch (e) { mr = e.message; }
  ok(mr === 1 && warns.length === 1, `state 4, list[i + 2] = 99 (no such node): ends with the missing-node warning (${mr}, ${warns.length} warning)`);
  PM.navTick(b, nv2);
  ok(b.C.nidx === 1, `state 4: the corner point within 1 u (near) -> next node, though B is 6 u away and A is nearer than N (index ${b.C.nidx})`);
  // FUN_00368420: 40 steps a frame (svc+0): a 60-node line needs several updates
  const ps = [], es = [];
  for (let i = 0; i < 60; i++) { ps.push([20 * i, 0, 0]); if (i) es.push([i - 1, i, 2000]); }
  const G3 = graph(ps, es);
  const R = { start: 0, goal: 59, s4: 2, max: 0x80, mode: 0, flags: 0x66, c: 0 };
  const S0 = NG.searchBegin(G3, R, () => 0.5, quiet, NG.makeService());
  let steps = 0; while (S0.state !== 3) { NG.searchStep(S0); steps++; }
  const sv = NG.makeService(), out = { list: null };
  NG.enqueue(sv, G3, R, out);
  let ups = 0; while (out.list[0] === -1 && ups < 1000) { NG.serviceUpdate(sv); ups++; }
  ok(steps > 40 && ups === Math.floor(steps / 40) + 1 && out.list.length === 61, `default budget 40: a ${steps}-step search is handed over on update ${ups} (want ${Math.floor(steps / 40) + 1})`);
}
// ------------------------------------------------ 7. the AI world, hand cases (ai.json only; a flat stand-in walk mesh)
// Hits, death and switch-off during mover 0xd give the path's nodes back (FUN_0034edf0 / FUN_003533e0 ->
// FUN_00352a60 case 0xd; FUN_00559748 -> FUN_00563a50(-1)); layers 2 / 3 / 5 / 6 edges; node tracking.
if (!existsSync(dataPath)) skip('ai.json missing: AI hand cases not run');
else {
  const AI = await import(pathToFileURL(path.join(here, 'enemy_ai.js')).href);
  const D = JSON.parse(readFileSync(dataPath, 'utf8'));
  if (!D.nav) skip('ai.json has no nav block: AI hand cases not run');
  else {
    const r46 = D.records[46];
    const mesh = { locate: () => [0, r46.pos[1]], navMove: (pi, x, y, z, dx, dz) => [x + dx, y, z + dz, pi, false, false] };
    const GOAL = 278;                                                        // 46's node 272 -> 273 274 276 279 278 (area 2)
    const world = (plPos = [r46.pos[0] + 300, r46.pos[1], r46.pos[2] + 50]) => {
      const pl = { pos: plPos.slice(0, 3), hp: 780, id: 0x16, f118: 0, s64: 0 };
      const W = AI.createEnemyAI({ data: D, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh, los: () => false });
      const a = W.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
      W.tick(1.2, pl.pos, pl.pos);
      const nav = W.t.navOf(a);
      return { W, pl, a, nav, G: nav.G, svc: nav.svc };
    };
    const sum = v => v.reduce((s, x) => s + x, 0);
    const walking = w => {                                                   // a sync path to GOAL, on its first leg
      PM.navRequest(w.a, { goal: GOAL, s4: 0, max: 0x80, mode: 0, flags: 0x61, c: 0 }, w.a.node108);
      PM.navStart(w.a, w.nav, () => {});
      PM.navTick(w.a, w.nav);
    };
    const queued = w => {                                                    // a queued search, not yet run
      PM.navRequestTo(w.a, w.a.node108, GOAL, 0x60);
      PM.navStart(w.a, w.nav, () => {});
      PM.navTick(w.a, w.nav);
    };
    for (const hit of ['flinch', 'die']) {
      let w = world();
      const base = sum(w.G.occ1d);
      walking(w);
      const held = sum(w.G.occ1d) - base, len = w.a.C.nlen;
      w.W.t[hit](w.a, [-1, 0, 0]);
      ok(len >= 3 && held === len && sum(w.G.occ1d) === base && w.a.C.list[0] === -1 && w.a.C.mover === (hit === 'die' ? 0xb : 9),
         `${hit} on mover 0xd (a ${len}-node path, +0x1d held ${held}): counts back to ${base} (${sum(w.G.occ1d)}), list[0] -1, mover ${w.a.C.mover}`);
      w = world();
      queued(w);
      const busy = !NG.queueFree(w.svc) && w.a.C.nst === 1;
      w.W.t[hit](w.a, [-1, 0, 0]);
      const freed = NG.queueFree(w.svc) && w.a.C.qslot === 0xf && w.svc.used === 0;
      for (let k = 0; k < 30; k++) NG.serviceUpdate(w.svc);
      ok(busy && freed && w.a.C.list[0] === -1 && sum(w.G.occ1d) === base,
         `${hit} with the queued search pending: the slot is dropped (FUN_00368398), and the service writes nothing into C.list later (${w.a.C.list.slice(0, 3)})`);
    }
    // switch-off (0x109) during mover 0xd, then three on / off cycles: no +0x1d / +0x1e count stays behind
    {
      const w = world();
      const e0 = sum(w.G.occ1e) - 1;                                          // without 46 (his node: +1)
      walking(w);
      const id = w.a.id;
      w.W.setActive(w.a, 0);
      let okc = sum(w.G.occ1d) === 0 && sum(w.G.occ1e) === e0;
      const after1 = [sum(w.G.occ1d), sum(w.G.occ1e)];
      for (let k = 0; k < 3; k++) {
        w.W.setActive(w.W.objects.get(id), 1);
        const b = w.W.objects.get(id);
        okc = okc && sum(w.G.occ1e) === e0 + 1 && b.node108 !== -1;
        w.W.setActive(b, 0);
        okc = okc && sum(w.G.occ1e) === e0;
      }
      ok(okc, `switch-off on mover 0xd: +0x1d ${after1[0]} (0), +0x1e ${after1[1]} (${e0}); 3 on / off cycles leave +0x1e at ${sum(w.G.occ1e)} (FUN_00563a50(-1); the stop is a GUESS)`);
    }
    // node tracking every frame (trackMoved) and listener event 5 (FUN_00563a50(node))
    {
      const w = world();
      const n0 = w.a.node108, nb = NG.neighbour(w.G, n0, 0), q = w.G.nodes[nb];
      w.a.pos = [q[0], q[1], q[2]];
      w.W.tick(1.2, w.pl.pos, w.pl.pos);
      ok(w.a.node108 === nb && w.G.occ1e[nb] >= 1 && w.G.occ1e[n0] === 0, `a standing soldier put on node ${nb}: +0x108 ${w.a.node108} on the next frame (FUN_0033dda8), +0x1e moved from ${n0}`);
      w.nav.event(5, GOAL);
      ok(w.a.node108 === GOAL && w.a.C.n398 === GOAL && w.G.occ1e[GOAL] >= 1 && w.G.occ1e[nb] === 0, `listener event 5 (node ${GOAL} passed): +0x108 / C+0x398 = ${w.a.node108}, +0x1e moved`);
    }
    // layer 2 state 0, same area: queue room -> queued mode 0 (FUN_0055a590); full -> mode 6 (+4 4, cap 7, flags 7 | bit 0)
    const g = D.nav.nodes[GOAL];
    for (const full of [false, true]) {
      const w = world(g);
      w.W.t.setTarget(w.a.ai, w.pl); w.W.t.setActionLayer(w.a.ai, 2);
      w.a.ai.astate28 = 0; w.a.ai.flags &= ~2;
      if (full) NG.enqueue(w.svc, w.G, { start: 0, goal: 1, s4: 2, max: 0x80, mode: 0, flags: 6, c: 0 }, { list: null });
      w.W.t.action2(w.a.ai);
      const q = w.a.C.nreq || {};
      const want = full ? (q.mode === 6 && q.s4 === 4 && q.max === 7 && (q.flags & 7) === 7) : (q.mode === 0 && !(q.flags & 1));
      ok(w.pl.node108 === GOAL && w.a.C.mover === 0xd && w.a.ai.astate28 === 1 && want,
         `layer 2, same area, queue ${full ? 'full' : 'free'}: mode ${q.mode} +4 ${q.s4} cap ${q.max} flags 0x${q.flags?.toString(16)} goal ${q.goal}, state ${w.a.ai.astate28}`);
      if (!full) {
        PM.moverStop(w.a);
        w.W.t.action2(w.a.ai);
        ok(w.a.ai.astate28 === 0, `layer 2 state 1: the mover has ended -> state 0 (${w.a.ai.astate28})`);
      }
    }
    // layers 5 / 6 with the queue full: sync (flags | 1), cap 7 + (int)(0.5 x 3) = 8 / cap 5
    for (const [m, max] of [[5, 8], [6, 5]]) {
      const w = world(g);
      w.W.t.setTarget(w.a.ai, w.pl); w.W.t.setActionLayer(w.a.ai, m);
      w.a.ai.astate28 = 0; w.a.ai.d34 = 100;
      NG.enqueue(w.svc, w.G, { start: 0, goal: 1, s4: 2, max: 0x80, mode: 0, flags: 6, c: 0 }, { list: null });
      w.W.t.action56(w.a.ai, m);
      const q = w.a.C.nreq || {};
      ok(w.a.C.mover === 0xd && (q.flags & 1) && q.max === max, `layer ${m}, queue full: sync request, cap ${q.max} (want ${max}), flags 0x${q.flags?.toString(16)}`);
    }
    // layer 3 state 2 on mover 0xd, out of view, C+0x1c0 bit 20 -> stop (FUN_003533e0), turn mode 6, state 4
    {
      const w = world();
      w.W.t.setTarget(w.a.ai, w.pl); w.W.t.setActionLayer(w.a.ai, 3);
      walking(w);
      w.a.ai.astate28 = 2; w.a.ai.flags &= ~2; w.a.ai.d34 = w.a.ai.d38 = 200;
      w.a.C.f1c0 = (w.a.C.f1c0 | 0x100000) >>> 0;
      w.W.t.action3(w.a.ai);
      ok(w.a.ai.astate28 === 4 && w.a.C.mover === 0 && sum(w.G.occ1d) === 0 && w.a.C.s214 === 6,
         `layer 3 state 2, C+0x1c0 bit 20: stopped (mover ${w.a.C.mover}, +0x1d ${sum(w.G.occ1d)}), turn mode ${w.a.C.s214}, state ${w.a.ai.astate28}`);
    }
  }
}
// ------------------------------------------------ the trace
if (!existsSync(tracePath) || !existsSync(dataPath)) { skip('w161_chase trace or ai.json missing'); done(); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
if (!data.nav) { skip('ai.json has no nav block'); done(); }
const recs = readFileSync(tracePath, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
const hex = s => Buffer.from(s, 'hex');
function rec(r, e) {
  const p = `e${e}_`;
  if (!r[p + 'cmat']) return null;
  const cm = hex(r[p + 'cmat']), c = hex(r[p + 'c310']), mv = hex(r[p + 'mv']), w = hex(r[p + 'want']), s = hex(r[p + 'srch']);
  const lb = hex(r[p + 'list']).subarray(2), list = [];
  for (let i = 0; i + 1 < lb.length; i += 2) { const v = lb.readInt16LE(i); list.push(v); if (v === -1) break; }
  return {
    pos: [0, 1, 2].map(i => cm.readFloatLE(48 + 4 * i)),
    mover: hex(r[p + 'path']).readUInt32LE(0),
    nlen: c.readInt16LE(0), nidx: c.readInt16LE(2), nst: c[4], b315: c[5], n316: c.readInt16LE(6), n318: c.readInt16LE(8),
    list, f1c0: mv.readUInt32LE(0), speed: mv.readFloatLE(0x18), spd: mv.readFloatLE(0x14),
    want: [0, 1, 2].map(i => w.readFloatLE(4 * i)), wk: w.readFloatLE(12),
    a108: r[p + 'a108'] & 0xffff, c398: r[p + 'c398'] & 0xffff,
    req: { start: s.readInt16LE(0), goal: s.readInt16LE(2), s4: s.readInt16LE(4), max: s.readInt16LE(6), mode: s[8], flags: s.readUInt16LE(10), c: s.readFloatLE(12) },
    bvel: [0, 1, 2].map(i => hex(r[p + 'bvel']).readFloatLE(0x10 + 4 * i)),
    bst: hex(r[p + 'bst']).readUInt32LE(0), bfl: hex(r[p + 'bst']).readUInt32LE(4),
  };
}
const s16 = v => (v << 16) >> 16;
const G = NG.makeGraph(data.nav);
// ------------------------------------------------ 1. FUN_0033dda8
{
  let n = 0, bad = 0, near = 0;
  for (const e of [0, 1]) for (let i = 1; i < recs.length; i++) {
    const x0 = rec(recs[i - 1], e), x = rec(recs[i], e);
    n++;
    if (NG.nodeFrom(G, s16(x0.a108), x.pos) !== s16(x.a108)) bad++;
    if (NG.nearestNode(G, x.pos) !== s16(x.a108)) near++;
  }
  ok(n > 500 && bad === 0, `FUN_0033dda8 from the last node: ${n - bad}/${n} frames give the game's +0x108 (the plain nearest node: ${n - near}/${n})`);
}
// ------------------------------------------------ 2. open loop
{
  let zeroed = 0, n = 0, st = 0, wantOk = 0, worst = 0, at = '', skipReq = 0, evOk = 0, evN = 0;
  for (const e of [0, 1]) for (let i = 0; i + 1 < recs.length; i++) {
    const x = rec(recs[i], e), y = rec(recs[i + 1], e);
    if (x.mover !== 0xd || y.mover !== 0xd || x.nst !== 4 && x.nst !== 5) continue;
    if (y.list.join() !== x.list.join() || y.nidx < x.nidx && y.nst === 4 && x.list.join() !== y.list.join()) { skipReq++; continue; }
    if (y.req.goal !== x.req.goal || y.req.start !== x.req.start || y.req.flags !== x.req.flags) { skipReq++; continue; }   // a new request this frame
    const a = mkActor(x.pos);
    const C = Object.assign(a.C, {
      mover: 0xd, mm: 0xc, list: x.list.slice(), nlen: x.nlen, nidx: x.nidx, nst: x.nst, qslot: x.b315 & 0xf, climb: x.b315 >> 4,
      n316: x.n316, n318: x.n318, n398: s16(x.c398), f1c0: x.f1c0, speed: x.speed, spd: x.spd, nreq: x.req,
    });
    a.node108 = s16(x.a108);
    const evs = [];
    const nav = { G, svc: NG.makeService(), rng: () => 0.5, warn: quiet, event: (ev, nd) => evs.push([ev, nd]) };
    const r = PM.navTick(a, nav);
    n++;
    const same = C.nst === y.nst && C.nidx === y.nidx && (C.n316 === y.n316 || y.n316 === s16(y.c398) && C.n316 === -1 && false);
    if (C.nst === y.nst && C.nidx === y.nidx && C.n316 === y.n316 && !r) st++;
    const dw = Math.max(...[0, 1, 2].map(k => Math.abs(C.want[k] - y.want[k])), Math.abs(C.wk - y.wk));
    if (dw < 1e-4) wantOk++;
    else if (y.wk === 0) zeroed++;                       // the game's C+0xcc = 0 with C+0xc0 = facing: written after the mover
    if (dw > worst) { worst = dw; at = `f${recs[i].frame} e${e} st${x.nst} i${x.nidx}`; }
    if (process.env.NAV_DEBUG && dw >= 1e-5) console.log('dbg', recs[i].frame, e, x.nst, x.nidx, x.nlen, 'f1c0', x.f1c0.toString(16), 'spd', x.speed, 'port', C.want.map(v => v.toFixed(4)), C.wk, 'game', y.want.map(v => v.toFixed(4)), y.wk);
    if (y.nidx > x.nidx) { evN++; if (evs.some(v => v[0] === 5 && v[1] === x.list[x.nidx])) evOk++; }
  }
  ok(n > 400 && st === n, `follow state (C+0x312 / +0x314 / +0x316) as the game's next record: ${st}/${n} frames (${skipReq} request frames skipped)`);
  ok(n > 400 && wantOk + zeroed === n && zeroed <= 2, `wanted move C+0xc0 / C+0xcc within 1e-4: ${wantOk}/${n}; ${zeroed} frames where the game's move is 0 (C+0xc0 = facing, C+0xcc = 0: FUN_0034b110(0) after the mover, writer not found)`);
  ok(evN > 3 && evOk === evN, `every node change sends listener event 5 with the node passed: ${evOk}/${evN}`);
}
// ------------------------------------------------ 3. closed loop with the real walk mesh
{
  let Col = null;
  try { ({ Collision: Col } = await import(pathToFileURL(path.join(here, 'collision.js')).href)); } catch (e) { /* stub needed */ }
  const colPath = path.join(here, 'data/z128_collision.bin');
  if (!Col || !existsSync(colPath)) skip('collision.js / z128_collision.bin missing: closed loop not run');
  else {
    const buf = readFileSync(colPath), col = new Col(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    for (const e of [0, 1]) {
      const x0 = rec(recs[0], e);
      const a = mkActor(x0.pos);
      Object.assign(a.C, { mover: 0, mm: 0xc, f1c0: x0.f1c0, spd: x0.spd, f45c: x0.bfl, n398: s16(x0.c398) });
      a.B.vel = rec(recs[0], e).bvel.slice();
      a.B.poly = (col.locate(...a.pos) || [null])[0];
      a.node108 = s16(x0.a108);
      a.C.want = [0, 0, 0]; a.C.wk = 0;
      const walk = (b, mv) => { const r = col.navMove(b.B.poly, b.pos[0], b.pos[1], b.pos[2], mv[0], mv[2], false); b.B.poly = r[3]; return [r[0], r[1], r[2]]; };
      const nav = { G, svc: NG.makeService(), rng: () => 0.5, warn: quiet, event: (ev, nd) => { if (nd !== -1) NG.setNode(G, a, nd); } };
      // the game's follow state at f1000, then its lists at each request frame
      Object.assign(a.C, { mover: 0xd, list: x0.list.slice(), nlen: x0.nlen, nidx: x0.nidx, nst: x0.nst, qslot: 0xf, climb: 0, n316: x0.n316, n318: 0, nreq: x0.req, nav, speed: x0.speed });
      let worst = 0, at = '', n = 0, within = 0, reqs = 0;
      for (let i = 1; i < recs.length; i++) {
        const y = rec(recs[i], e), x = rec(recs[i - 1], e);
        if (y.req.goal !== x.req.goal || y.req.start !== x.req.start || y.req.flags !== x.req.flags || y.list.join() !== x.list.join() && y.nidx === 0 && y.nst === 4 && y.n316 === -1) {
          // a request this frame (the AI before the body): the game's list in, as FUN_0055a628 + the search
          PM.navRequest(a, y.req, y.req.start); PM.navStart(a, nav, () => {});
          const l = y.list.slice(); l.push(-1);
          a.C.nreq = { ...y.req, flags: y.req.flags & ~1 };       // the list is handed in through the queue path
          a.C.nst = 1; a.C.list = l; reqs++;
        }
        a.C.f1c0 = (a.C.f1c0 & ~0x40000) | (x.f1c0 & 0x40000);   // the walk's contact bit (FUN_00357d48) from the game
        PM.approachFrame(a, null, 1.2, walk, quiet, false, nav);
        NG.trackNode(G, a);
        const d = Math.hypot(a.pos[0] - y.pos[0], a.pos[2] - y.pos[2]);
        n++; if (d < 0.05) within++;
        if (process.env.NAV_DEBUG2 && e === +process.env.NAV_DEBUG2 - 1 && i < 60) console.log('cl', recs[i].frame, d.toFixed(3), 'port', a.pos.map(v => v.toFixed(2)), 'game', y.pos.map(v => v.toFixed(2)), 'pw', a.C.want.map(v => v.toFixed(3)), a.C.wk.toFixed(3), 'gw', y.want.map(v => v.toFixed(3)), y.wk.toFixed(3), 'pv', a.B.vel.map(v => v.toFixed(3)), 'gv', y.bvel.map(v => v.toFixed(3)), a.C.nst, a.C.nidx, y.nst, y.nidx);
        if (d > worst) { worst = d; at = `f${recs[i].frame}`; }
      }
      // GUESS-limited: FUN_00357d48's rewrite of body+0x40 (contact-corrected velocity) is not translated, so
      // the body's velocity turns faster than the game's (the wanted move itself matches, see 2.)
      ok(reqs > 5 && worst < (e ? 5.0 : 1.5), `e${e} (record ${46 + e}) closed loop over ${n} frames, ${reqs} game lists fed in: worst ${worst.toFixed(3)} u at ${at}; ${within}/${n} frames within 0.05 u`);
    }
  }
}
// ------------------------------------------------ 5. the AI world: brain 5 -> action layers 2 / 3 -> mover 0xd
{
  let Col = null;
  try { ({ Collision: Col } = await import(pathToFileURL(path.join(here, 'collision.js')).href)); } catch (e) { /* stub */ }
  const colPath = path.join(here, 'data/z128_collision.bin');
  if (!Col || !existsSync(colPath)) skip('collision.js / z128_collision.bin missing: AI-world cases not run');
  else {
    const AI = await import(pathToFileURL(path.join(here, 'enemy_ai.js')).href);
    const buf = readFileSync(colPath), col = new Col(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    // the trace's scene: 46 at its f1000 point, Vincent where he stands (matrix row 3), out of view
    const r0 = recs[0], x0 = rec(r0, 0), vpos = r0.matrix[3].slice(0, 3);
    const pl = { pos: vpos, hp: 780, id: 0x16, f118: 0, s64: 0 };
    const W = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: col, los: () => true });
    const a = W.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
    a.pos = x0.pos.slice();
    W.t.setTarget(a.ai, pl); W.t.setMode(a.ai, 5);
    let first = null, req = null, wk = null, l2 = false;
    for (let i = 0; i < 40 && first == null; i++) {
      W.tick(1.2, pl.pos, pl.pos);
      if (a.ai.amode === 2) l2 = true;
      if (a.C.mover === 0xd) { first = i; req = { ...a.C.nreq }; }
    }
    for (let i = 0; i < 3; i++) W.tick(1.2, pl.pos, pl.pos);
    wk = a.C.wk;
    ok(pl.node108 === 111, `Vincent's node at the trace's spot: ${pl.node108} (the game's: 111, the common neighbour of every goal it drew)`);
    const g = x0.req;
    ok(l2 && first != null && first <= 12, `mode 5, Vincent out of view: action layer 2 -> mover 0xd on frame ${first} (the game: within ~10 frames)`);
    ok(req && req.mode === g.mode && req.s4 === g.s4 && req.max === g.max && req.flags === g.flags && req.c === g.c && req.start === s16(x0.a108),
       `layer 2's request as the game's: mode ${req?.mode} +4 ${req?.s4} cap ${req?.max} flags 0x${req?.flags?.toString(16)} c ${req?.c} start ${req?.start} (game ${g.mode} ${g.s4} ${g.max} 0x${g.flags.toString(16)} ${g.c} ${s16(x0.a108)})`);
    ok(Math.abs(wk - x0.wk) < 1e-6, `on the path at C+0xcc ${wk} = 50 x 0.3 / 60 (game ${x0.wk})`);
    // a same-area target: the queued mode 0 search (FUN_0055a590), finished by the service updates
    const rec70 = data.records[70], vn = data.nav.nodes[10];
    const pl2 = { pos: vn.slice(0, 3), hp: 780, id: 0x16, f118: 0, s64: 0 };
    const W2 = AI.createEnemyAI({ data, player: pl2, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: col, los: () => true });
    const b = W2.addActor({ rec: 70, astate: 3, f118: 0 });
    W2.t.setTarget(b.ai, pl2); W2.t.setMode(b.ai, 5);
    let q = null, listAt = null;
    for (let i = 0; i < 300 && listAt == null; i++) {
      W2.tick(1.2, pl2.pos, pl2.pos);
      if (q == null && b.C.mover === 0xd && b.C.nreq.mode === 0) q = i;
      if (q != null && b.C.nst >= 3) listAt = i;
    }
    ok(q != null && listAt != null && listAt > q && b.C.list.at(-1) === -1 && b.C.list[b.C.nlen - 1] === b.C.nreq.goal,
       `same area: queued mode 0 request on frame ${q}, the service's list (to goal ${b.C.nreq?.goal}) taken on frame ${listAt}`);
    // action layers 5 / 6 (FUN_003670e8 / FUN_003672d8): one request from the soldier's node to Vincent's node
    for (const [m, draws, want] of [
      [6, [0.5, 0.8], { mode: 2, s4: 3, max: 13, flags: 0xe, bit4: 0 }],
      [6, [0.99, 0.7], { mode: 2, s4: 3, max: 15, flags: 0xe, bit4: 0x10 }],
      [5, [0.5], { mode: 3, s4: 3, max: 25, flags: 0x6e, c: 150, bit4: 'keep' }],
    ]) {
      const seq = draws.slice();
      const pl5 = { pos: vpos, hp: 780, id: 0x16, f118: 0, s64: 0 };
      const W5 = AI.createEnemyAI({ data, player: pl5, rand: () => (seq.length ? seq.shift() : 0.5), quiet: true, log: () => {}, walkMesh: col, los: () => true });
      const c = W5.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
      c.pos = x0.pos.slice();
      W5.t.setTarget(c.ai, pl5);
      W5.tick(1.2, pl5.pos, pl5.pos);                                       // Vincent's node (tick step 1a)
      seq.splice(0, seq.length, ...draws);
      W5.t.setActionLayer(c.ai, m);
      c.ai.astate28 = 0; c.ai.d34 = 211.5; c.C.f1c0 = (c.C.f1c0 | 0x10) >>> 0;
      W5.t.action56(c.ai, m);
      const r = c.C.nreq || {};
      const b4 = c.C.f1c0 & 0x10;
      const cWant = want.c ?? 211.5;
      ok(c.C.mover === 0xd && c.ai.astate28 === 1 && r.goal === pl5.node108 && r.start === c.node108 && r.mode === want.mode && r.s4 === want.s4 &&
         r.max === want.max && r.flags === want.flags && Math.abs(r.c - cWant) < 1e-4 && (want.bit4 === 'keep' ? b4 === 0x10 : b4 === want.bit4),
         `layer ${m}, draws ${draws}: ${c.C.nreq ? `mode ${r.mode} +4 ${r.s4} cap ${r.max} flags 0x${r.flags.toString(16)} c ${r.c} goal ${r.goal} (Vincent's node ${pl5.node108})` : 'no request'}, C+0x1c0 bit 4 ${b4 ? 'set' : 'clear'}, state ${c.ai.astate28}`);
      if (m === 6 && draws[0] === 0.5) {
        W5.t.action56(c.ai, m);
        const held = c.ai.astate28 === 1;
        PM.moverStop(c);
        W5.t.action56(c.ai, m);
        ok(held && c.ai.astate28 === 0, 'state 1 holds while the mover runs, back to 0 when it has ended');
      }
    }
    // in view (the page's LOS: collision.js segment): brain 5 state 13 runs layer 6 on mover 0xd
    {
      const losP = (u, v) => !!(col.segment && col.segment({ x: u[0], y: u[1], z: u[2] }, { x: v[0], y: v[1], z: v[2] }));
      const pl6 = { pos: data.nav.nodes[37].slice(0, 3), hp: 780, id: 0x16, f118: 0, s64: 0 };
      const W6 = AI.createEnemyAI({ data, player: pl6, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: col, los: losP });
      const e70 = W6.addActor({ rec: 70, astate: 3, f118: 0 });
      W6.runEvent(e70, 8, [10, 0, 0, 0]);
      let at = null, seen = 0;
      for (let i = 0; i < 400 && at == null; i++) { W6.tick(1.2, pl6.pos, pl6.pos); if (e70.ai.flags & 2) seen++; if (e70.ai.amode === 6 && e70.C.mover === 0xd) at = i; }
      ok(e70.ai.mode === 5 && at != null && seen > at * 0.9, `record 70 hit with Vincent in view at 177 u: layer 6 on mover 0xd from frame ${at} (in view ${seen} frames)`);
    }
    // action layer 3 state 2: the cone (Vincent ahead -> mover 3; behind -> stays on the path)
    for (const [ahead, want] of [[true, 3], [false, 0xd]]) {
      const pl3 = { pos: [x0.pos[0] + (ahead ? 40 : -40), x0.pos[1], x0.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
      const W3 = AI.createEnemyAI({ data, player: pl3, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: col, los: () => true });
      const c = W3.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
      c.pos = x0.pos.slice();
      W3.t.setTarget(c.ai, pl3); W3.t.setActionLayer(c.ai, 3);
      c.ai.astate28 = 1; c.ai.d34 = c.ai.d38 = 200; c.ai.flags &= ~2;
      W3.t.action3(c.ai);                                                   // nav branch -> state 2, mover 0xd
      const on = c.ai.astate28 === 2 && c.C.mover === 0xd;
      if (ahead) { const q = c.C.nreq || {}; ok(q.mode === 1 && q.s4 === 6 && q.max === 10 && q.flags === 0xef && q.c === 100,
        `layer 3 nav branch (other area): mode ${q.mode} +4 ${q.s4} cap ${q.max} flags 0x${q.flags?.toString(16)} c ${q.c} (MIPS 0x366ad8: +4 6, cap 10; w161_chase 0xef requests)`); }
      c.face = [1, 0, 0]; c.ai.flags |= 2; c.ai.d34 = c.ai.d38 = 40; c.ai.d40 = 0;
      W3.t.action3(c.ai);
      ok(on && c.C.mover === want, `layer 3 state 2, Vincent in view 40 u ${ahead ? 'ahead' : 'behind'}: mover ${c.C.mover} (${want === 3 ? 'inside the 30 deg cone: mover 3' : 'outside the cone: stays on the path'})`);
    }
  }
}
// ------------------------------------------------ 6. in view: trace k_inview17a-e (worker 0163)
// k_enemy_engage8's route without its shots; TRACE_POKE turns every 'AI mode 2' of scripts 108 / 109 into 5, so #66 /
// #67 (records 44 / 45) wake in brain mode 5 with Vincent standing in view (31 u / 118 u). Five 299-frame windows,
// f780-2278 (tools/trace/scripts/k_inview17a.json has the env). Request fields per layer, the list follower on the
// game's own list, and the mode-2 / mode-3 searches on the game's requests.
{
  const files = 'abcde'.split('').map(c => path.join(process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out'), `k_inview17${c}.jsonl`));
  if (!files.every(existsSync)) skip('k_inview17a-e traces missing');
  else {
    const R = files.flatMap(fn => readFileSync(fn, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l))).sort((x, y) => x.frame - y.frame);
    const reqs = [];
    for (const e of [0, 1]) {
      let prev = '';
      for (let i = 1; i < R.length; i++) {
        const x = rec(R[i], e), q = x.req, k = JSON.stringify(q);
        if (k === prev || x.nst < 2 || x.list[0] === -1) continue;   // a new request once its list is in
        prev = k;
        const ai = hex(R[i - 1][`e${e}_ai`]);
        reqs.push({ e, f: R[i].frame, q, list: x.list, d34: ai.readFloatLE(0x34 - 0x14) });
      }
    }
    const L6 = reqs.filter(r => r.q.mode === 2), L5 = reqs.filter(r => r.q.mode === 3), L3 = reqs.filter(r => r.q.mode === 6);
    ok(L6.length >= 10 && L6.every(r => r.q.s4 === 3 && r.q.flags === 0xe && r.q.max >= 10 && r.q.max <= 15 && r.q.goal === 111),
       `layer 6 (FUN_003672d8) in the game: ${L6.length} requests, all mode 2, +4 3, flags 0xe, cap 10-15 (${[...new Set(L6.map(r => r.q.max))].sort()}), goal 111 = Vincent's node`);
    const cErr = Math.max(...L6.map(r => Math.abs(r.q.c - r.d34)));
    ok(cErr < 1e-3, `layer 6's c = the AI's d34 (+0x34) at the request: worst ${cErr.toExponential(1)} over ${L6.length}`);
    ok(L5.length >= 5 && L5.every(r => r.q.s4 === 3 && r.q.flags === 0x6e && r.q.c === 150 && r.q.max >= 20 && r.q.max <= 30),
       `layer 5 (FUN_003670e8): ${L5.length} requests, all mode 3, +4 3, flags 0x6e, c 150, cap 20-30 (${[...new Set(L5.map(r => r.q.max))].sort()})`);
    ok(L3.length >= 1 && L3.every(r => r.q.s4 === 4 && r.q.max === 7 && r.q.flags === 0xe7 && r.q.c === 100),
       `layer 3 same-area mode 6: ${L3.length} request(s): +4 4, cap 7, flags 0xe7, c 100 (the MIPS immediates)`);
    // the mode-2 / mode-3 lists: no random term; the port's search with empty occupancy and no cover cost
    let same = 0, n = 0;
    for (const r of [...L6, ...L5]) {
      const l = NG.search(G, { ...r.q, flags: r.q.flags | 1 }, () => 0.5, quiet);
      n++; if (l.join() === r.list.join()) same++;
    }
    ok(n > 10 && same >= n / 2, `mode 2 / 3 lists: ${same}/${n} identical with empty occupancy (flags 2 / 4) and no cover cost (flags 8, MISSING); the rest part at one near-tie`);
    // the follower on the game's list: #67 at f1553 (layer 6, list 128 .. 113): the 11 u drop at 133 -> 136 turns him back
    let Col = null;
    try { ({ Collision: Col } = await import(pathToFileURL(path.join(here, 'collision.js')).href)); } catch (e) { /* stub */ }
    const colPath = path.join(here, 'data/z128_collision.bin');
    const r67 = L6.find(r => r.e === 1 && r.list.join() === '128,127,131,133,136,137,112,113,-1');
    if (!Col || !existsSync(colPath) || !r67) skip('collision data or the f1553 list missing: follower check not run');
    else {
      const buf = readFileSync(colPath), col = new Col(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const i0 = R.findIndex(r => r.frame === r67.f), x0 = rec(R[i0], 1);
      const a = mkActor(x0.pos);
      Object.assign(a.C, { f1c0: x0.f1c0, f45c: x0.bfl, spd: x0.spd });
      a.B.vel = x0.bvel.slice(); a.B.poly = (col.locate(...a.pos) || [null])[0];
      a.node108 = s16(x0.a108);
      const nav = { G, svc: NG.makeService(), rng: () => 0.5, warn: quiet, event: (ev, nd) => { if (nd !== -1) NG.setNode(G, a, nd); } };
      Object.assign(a.C, { mover: 0xd, mm: 0xc, list: x0.list.slice(), nlen: x0.nlen, nidx: x0.nidx, nst: x0.nst, qslot: 0xf, climb: 0,
                           n316: x0.n316, n318: 0, n398: s16(x0.c398), nreq: x0.req, nav, speed: x0.speed, want: x0.want.slice(), wk: x0.wk });
      const walk = (b, mv) => { const q = col.navMove(b.B.poly, b.pos[0], b.pos[1], b.pos[2], mv[0], mv[2], false); b.B.poly = q[3]; return [q[0], q[1], q[2]]; };
      let endP = null, endG = null, adv = [], gadv = [];
      for (let i = i0 + 1; i < R.length && (endP == null || endG == null); i++) {
        const y = rec(R[i], 1), yp = rec(R[i - 1], 1);
        if (endG == null && y.mover === 0) endG = [R[i].frame, y.pos];
        if (endG == null && y.nidx > yp.nidx && y.list.join() === yp.list.join()) gadv.push(R[i].frame);
        if (endP != null) continue;
        const was = a.C.nidx;
        PM.approachFrame(a, null, 1.2, walk, quiet, false, nav);
        NG.trackNode(G, a);
        if (a.C.nidx > was) adv.push(R[i].frame);
        if (a.C.mover === 0) endP = [R[i].frame, a.pos.slice()];
      }
      const dEnd = endP && endG ? Math.hypot(endP[1][0] - endG[1][0], endP[1][2] - endG[1][2]) : 1e9;
      ok(endP && endG && Math.abs(endP[0] - endG[0]) <= 15 && dEnd < 1.0 && adv.length === gadv.length,
         `#67 on the game's f1553 list: node changes ${adv} (game ${gadv}); the path ends at f${endP?.[0]} (game f${endG?.[0]}), ${dEnd.toFixed(2)} u from the game's point`);
    }
  }
}
done();
