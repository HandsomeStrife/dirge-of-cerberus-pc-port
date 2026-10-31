// The nav graph and its search (nav_graph.js, worker 0161) against hand cases and the PCSX2 trace
// w161_chase (tools/trace/scripts/w161_chase.json: w159_walk95's wake with scripts 127 / 128 putting 46 / 47 in
// brain mode 5; TRACE_FIELDSET=path TRACE_PATH_BODY=1 TRACE_ERECS=46,47 TRACE_ENEMIES=2 TRACE_LOG_AT=9E800
// TRACE_POKE=9540a4=6e,10a2140=6e,1005350=5,10060dc=5; game-derived, not committed).
//   1. hand graphs: A* order and ties (FUN_00369788), the goal tests (0x33ee38), the length cap, closed links
//      (FUN_0033e5d0), the cost terms (FUN_0033e660), the node list (FUN_00369f40)
//   2. the trace: every request's start node = the nearest node within 40 u of the soldier (FUN_00563970 ->
//      FUN_0033daf0); every game list is a chain of open links that ends by the mode-1 rule; the port's search
//      on the same requests gives lists that obey the same rules. (Mode 1 costs carry a random term and the
//      cover test FUN_0033fa58 is not translated, so the lists themselves are not compared.)
//   node native/web/test_nav_graph.mjs [nav_graph.js]
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const NG = await import(pathToFileURL(path.resolve(process.argv[2] ?? path.join(here, 'nav_graph.js'))).href);
const tracePath = path.join(process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out'), 'w161_chase.jsonl');
const dataPath = path.join(here, 'data/enemies/ai.json');
let fail = 0;
const skipped = [];
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const skip = m => { console.log('SKIP ' + m); skipped.push(m); };
const done = () => {
  const sk = skipped.length ? ` (${skipped.length} SKIPPED: ${skipped.join('; ')})` : '';
  console.log(fail ? `${fail} FAILED${sk}` : `all ok${sk}`); process.exit(fail ? 1 : 0);
};
const quiet = () => {};
// a seeded stream for mode-1 costs (the game's is FUN_0040b5c0)
const lcg = (s = 1) => () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) / 16777216; };

// ------------------------------------------------ 1. hand graphs
// build {nodes, links} from positions and an edge list [a, b, cost x 100, flags] (both ways unless one-way)
function graph(ps, edges, oneWay = false) {
  const adj = ps.map(() => []);
  for (const [a, b, c, fl] of edges) { adj[a].push([b, c, fl ?? 0]); if (!oneWay) adj[b].push([a, c, fl ?? 0]); }
  const nodes = [], links = [];
  ps.forEach((p, i) => { nodes.push([p[0], p[1], p[2], adj[i].length, links.length, 2]); links.push(...adj[i]); });
  return NG.makeGraph({ nodes, links });
}
const R0 = (start, goal, o = {}) => ({ start, goal, s4: 2, max: 0x80, mode: 0, flags: 0x67, c: 100, ...o });
{
  // a square 0-1-2 / 0-3-2 with the 1 route cheaper; 4 hangs off 2
  const G = graph([[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10], [20, 0, 10]],
                  [[0, 1, 100], [1, 2, 100], [0, 3, 300], [3, 2, 100], [2, 4, 100]]);
  const L = NG.search(G, R0(0, 4), quiet, quiet);
  ok(L.join() === '0,1,2,4,-1', `mode 0: the cheaper route 0-1-2-4 (${L})`);
  // close link 0->1 (flags bit 0): FUN_0033e5d0 skips it
  G.links[G.nodes[0][4]][2] = 1;
  const L2 = NG.search(G, R0(0, 4), quiet, quiet);
  ok(L2.join() === '0,3,2,4,-1', `closed link 0->1: route 0-3-2-4 (${L2})`);
  G.links[G.nodes[0][4]][2] = 2;           // bit 1: open but +100 (FUN_0033e660)
  const L3 = NG.search(G, R0(0, 4), quiet, quiet);
  ok(L3.join() === '0,3,2,4,-1', `link flag 2 (+100): route 0-3-2-4 (${L3})`);
  G.links[G.nodes[0][4]][2] = 0;
  // occupancy: +0x1e of node 1 x 20 with flags bit 1
  G.occ1e[1] = 1;
  ok(NG.search(G, R0(0, 4), quiet, quiet).join() === '0,3,2,4,-1', 'node 1 held (+0x1e 1, flags 2): x 20 sends the route via 3');
  ok(NG.search(G, R0(0, 4, { flags: 0x65 }), quiet, quiet).join() === '0,1,2,4,-1', 'same without flags bit 1: via 1');
  G.occ1e[1] = 0; G.occ1d[1] = 1;
  ok(NG.search(G, R0(0, 4, { flags: 0x63 }), quiet, quiet).join() === '0,1,2,4,-1' && NG.search(G, R0(0, 4), quiet, quiet).join() === '0,3,2,4,-1',
     '+0x1d x 10 only with flags bit 2');
  G.occ1d[1] = 0;
  // length cap: max 3 -> depth stops at 2; mode 0 then ends on the goal test failing until the open list runs out
  // length cap: max 3 -> records stop at depth 2; 4 is then generated from 2 at the cap, so no record is
  // made and the goal test runs on the current record (FUN_003693f0: iVar6 stays the current one) -> 0,1,2
  const L4 = NG.search(G, R0(0, 4, { max: 3 }), quiet, quiet);
  ok(L4.join() === '0,1,2,-1', `max 3, goal 3 links away: ends on the record before it (${L4})`);
  ok(NG.search(G, R0(0, 4, { max: 2 }), quiet, quiet).join() === '0,-1', 'max 2: the goal is never generated -> [start, -1]');
  // start = goal: found at once
  ok(NG.search(G, R0(2, 2), quiet, quiet).join() === '2,-1', 'start = goal: [start, -1]');
  // a closed link is never taken, even as the only way (FUN_0033e5d0), not just dear
  const G1 = graph([[0, 0, 0], [10, 0, 0], [20, 0, 0]], [[0, 1, 100, 1], [1, 2, 100]]);
  ok(NG.search(G1, R0(0, 2), quiet, quiet).join() === '0,-1', 'only way through a closed link: [start, -1]');
  // unreachable goal
  const G2 = graph([[0, 0, 0], [10, 0, 0], [50, 0, 0]], [[0, 1, 100]]);
  ok(NG.search(G2, R0(0, 2), quiet, quiet).join() === '0,-1', 'unreachable goal: [start, -1]');
}
{
  // ties (FUN_00369788: a new record goes after the records with the same f): two equal routes 0-1-3 / 0-2-3
  // with 1 listed first from 0 -> 1 is expanded first and reaches 3 first
  const G = graph([[0, 0, 0], [10, 0, 0], [0, 0, 10], [10, 0, 10]], [[0, 1, 100], [0, 2, 100], [1, 3, 100], [2, 3, 100]]);
  const R = R0(0, 3, { flags: 0x61 });
  ok(NG.search(G, R, quiet, quiet).join() === '0,1,3,-1', 'tie: the first-listed neighbour wins (0,1,3)');
  // order flipped -> 0,2,3
  const G3 = graph([[0, 0, 0], [10, 0, 0], [0, 0, 10], [10, 0, 10]], [[0, 2, 100], [0, 1, 100], [1, 3, 100], [2, 3, 100]]);
  ok(NG.search(G3, R, quiet, quiet).join() === '0,2,3,-1', 'tie, links flipped: 0,2,3');
}
{
  // mode 1 / 6 goal test (0x33ee38): c from the start after >= 3 links, else the cap max - 1
  const ps = [...Array(12)].map((_, i) => [i * 40, 0, 0]);
  const G = graph(ps, ps.slice(1).map((_, i) => [i, i + 1, 100]));
  const R1 = { start: 0, goal: 11, s4: 6, max: 10, mode: 1, flags: 0x67, c: 100 };
  const L = NG.search(G, R1, lcg(7), quiet);
  ok(L.join() === '0,1,2,3,-1', `mode 1 on a line (40 u apart): ends at depth 3, 120 u out (${L})`);
  ok(NG.search(G, { ...R1, c: 1000 }, lcg(7), quiet).join() === '0,1,2,3,4,5,6,7,8,9,-1', 'c 1000: the cap, depth max - 1 = 9');
  ok(NG.search(G, { ...R1, c: 10 }, lcg(7), quiet).join() === '0,1,2,3,-1', 'c 10: still depth >= 3 first');
  // mode 6 with the goal behind: the +5 for moving away from it doesn't stop the walk out
  ok(NG.search(G, { ...R1, mode: 6, goal: 0, c: 100 }, quiet, quiet).join() === '0,1,2,3,-1', 'mode 6: same end rule');
}
{
  // the heuristic by mode (0x33ec98): a fork at 0, branch A (1, 2, 3) toward the goal 9, branch B (4, 5, 6)
  // away; B's links cheaper. Mode 1 (h 0, rng 0): Dijkstra takes B. Mode 0 / 6 (h = distance): A first.
  // Mode 3 (h = -distance): B.
  const ps = [[0, 0, 0], [40, 0, 0], [80, 0, 0], [120, 0, 0], [-40, 0, 0], [-80, 0, 0], [-120, 0, 0], [0, 0, 0], [0, 0, 0], [400, 0, 0]];
  const G = graph(ps, [[0, 1, 150], [1, 2, 150], [2, 3, 150], [0, 4, 100], [4, 5, 100], [5, 6, 100]]);
  const R = { start: 0, goal: 9, s4: 6, max: 10, mode: 1, flags: 0x61, c: 100 };
  const zero = () => 0;
  ok(NG.search(G, R, zero, quiet).join() === '0,4,5,6,-1', `mode 1 (h 0): the cheap branch away (${NG.search(G, R, zero, quiet)})`);
  ok(NG.search(G, { ...R, mode: 6 }, zero, quiet).join() === '0,1,2,3,-1', `mode 6 (h = distance): toward the goal (${NG.search(G, { ...R, mode: 6 }, zero, quiet)})`);
  ok(NG.search(G, { ...R, mode: 4 }, zero, quiet).join() === '0,4,5,6,-1', `mode 4 (h = -distance): away (${NG.search(G, { ...R, mode: 4 }, zero, quiet)})`);
  // mode 1's random term: rng x 10 per link (FUN_0040b5c0): a stream that makes B dear sends it down A
  let k = 0; const seq = () => [0, 0.9, 0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9][k++] ?? 0.9;
  ok(NG.search(G, R, seq, quiet).join() === '0,1,2,3,-1', 'mode 1: the random term (x 10) can turn the route');
}
{
  // vertical links (flags bit 4): without 0x20 / 0x40 +1000; up (dy < 0, y down) needs 0x20, down 0x40
  const G = graph([[0, 0, 0], [10, -30, 0], [20, 0, 0], [10, 0, 40]],
                  [[0, 1, 100, 0x10], [1, 2, 100, 0x10], [0, 3, 400], [3, 2, 400]]);
  ok(NG.search(G, R0(0, 2, { flags: 0x07 }), quiet, quiet).join() === '0,3,2,-1', 'vertical links, flags 0x60 clear: +1000 each -> the long way');
  ok(NG.search(G, R0(0, 2, { flags: 0x67 }), quiet, quiet).join() === '0,1,2,-1', 'flags 0x60: up / down allowed (+1)');
  // the goal is taken when first generated, whatever that link cost: with 0x20 only, 1 (up, +1) is expanded
  // first and generates 2 through the +1000 way down -> 0,1,2 anyway
  ok(NG.search(G, R0(0, 2, { flags: 0x27 }), quiet, quiet).join() === '0,1,2,-1', 'flags 0x20 only: goal accepted at generation (0,1,2 despite +1000)');
  // and the heuristic picks the record to expand: node 3 nearer the goal than 1 -> 0,3,2 though dearer
  const G4 = graph([[0, 0, 0], [10, -30, 0], [20, 0, 0], [10, 0, 10]], [[0, 1, 100, 0x10], [1, 2, 100, 0x10], [0, 3, 400], [3, 2, 400]]);
  ok(NG.search(G4, R0(0, 2), quiet, quiet).join() === '0,3,2,-1', 'A*: the lower g + h expands first, the goal ends it on generation (0,3,2)');
}
{
  // nodeList (FUN_00369f40) and nearestNode (FUN_0033daf0)
  const a = { node: 5, depth: 0, parent: null }, b = { node: 7, depth: 1, parent: a }, c = { node: 9, depth: 2, parent: b };
  ok(NG.nodeList({ start: 5, max: 10 }, c).join() === '5,7,9,-1' && NG.nodeList({ start: 5, max: 10 }, null).join() === '5,-1', 'nodeList: start..rec, -1; none -> [start, -1]');
  const G = graph([[0, 0, 0], [30, 0, 0], [0, 50, 0]], []);
  ok(NG.nearestNode(G, [20, 0, 0]) === 1 && NG.nearestNode(G, [0, 45, 0]) === 2 && NG.nearestNode(G, [0, 100, 100]) === -1,
     'nearestNode: nearest within 40 u, else -1');
  ok(NG.nearestNode(G, [0, 45, 0], 40, false, false) === 2, 'first hit (best = 0)');
}

{
  // a better g through a record at the length cap does not re-sort the open record (FUN_003693f0:
  // cur.depth < max - 1). Equal positions (h = 0). 0-1-2 cheap, 0-3 dear, 2-3 cheap, 3-4; max 3 = cap depth 2:
  // at 2 (depth 2) node 3 keeps parent 0, so 4 is reached as 0-3-4
  const G = graph([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
                  [[0, 1, 100], [1, 2, 100], [0, 3, 5000], [2, 3, 100], [3, 4, 100]]);
  const L = NG.search(G, R0(0, 4, { max: 3 }), quiet, quiet);
  ok(L.join() === '0,3,4,-1', `re-sort only under the cap: 0-3-4 (${L})`);
  const L2 = NG.search(G, R0(0, 4, { max: 8 }), quiet, quiet);
  ok(L2.join() === '0,1,2,3,4,-1', `below the cap the cheaper parent wins: 0-1-2-3-4 (${L2})`);
}
{
  // FUN_00563d20(t, 1, 1): neighbours of t's node that link back (FUN_0033e1e0) and hold no actor (+0x1e);
  // one FUN_0040b5c0 draw picks among them; none -> -1 and no draw
  // node 0 -> 1 one-way (1 has no link back), 0 <-> 2, 0 <-> 3, 0 <-> 4
  const G = graph([[0, 0, 0], [10, 0, 0], [0, 0, 10], [-10, 0, 0], [0, 0, -10]],
                  [[0, 1, 100], [0, 2, 100], [2, 0, 100], [0, 3, 100], [3, 0, 100], [0, 4, 100], [4, 0, 100]], true);
  let n = 0;
  const r0 = () => { n++; return 0; };
  ok(NG.freeNeighbour(G, { node108: 0 }, r0) === 2 && n === 1, 'one-way neighbour 1 skipped: draw 0 -> node 2, one draw');
  G.occ1e[2] = 1;
  ok(NG.freeNeighbour(G, { node108: 0 }, r0) === 3, 'node 2 held (+0x1e): draw 0 -> node 3');
  ok(NG.freeNeighbour(G, { node108: 0 }, () => 0.99) === 4, 'draw 0.99 of 2 candidates -> the last (node 4)');
  G.occ1e[3] = 1; G.occ1e[4] = 1; n = 0;
  ok(NG.freeNeighbour(G, { node108: 0 }, r0) === -1 && n === 0, 'no free neighbour: -1, no draw');
  ok(NG.freeNeighbour(G, { node108: -1 }, r0) === -1 && n === 0, 'target without a node: -1, no draw');
}

// ------------------------------------------------ 2. the trace
if (!existsSync(dataPath)) { skip('no ai.json (build_web.sh enemy data)'); done(); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
if (!data.nav) { skip('ai.json has no nav graph (re-run export_web_triggers.py)'); done(); }
const G = NG.makeGraph(data.nav);
ok(G.n === 4237 && G.links.length === 24900, `z128 graph: ${G.n} nodes, ${G.links.length} links (sections 5 / 6)`);
if (!existsSync(tracePath)) { skip(`no trace ${tracePath}`); done(); }
const recs = readFileSync(tracePath, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => 'frame' in r);
const hex = h => Buffer.from(h, 'hex');
const reqs = [];
for (let i = 1; i < recs.length; i++) {
  for (const e of ['e0', 'e1']) {
    const s = hex(recs[i][e + '_srch']), s0 = hex(recs[i - 1][e + '_srch']);
    const L = hex(recs[i][e + '_list']).subarray(2), L0 = hex(recs[i - 1][e + '_list']).subarray(2);
    if (s.equals(s0) && L.equals(L0)) continue;
    const list = [];
    for (let k = 0; k + 1 < L.length; k += 2) { const v = L.readInt16LE(k); list.push(v); if (v === -1) break; }
    const cm = hex(recs[i - 1][e + '_cmat']);
    reqs.push({
      frame: recs[i].frame, e, list, pos: [cm.readFloatLE(0x30), cm.readFloatLE(0x34), cm.readFloatLE(0x38)],
      a108: recs[i][e + '_a108'] << 16 >> 16,
      R: { start: s.readInt16LE(0), goal: s.readInt16LE(2), s4: s.readInt16LE(4), max: s.readUInt16LE(6), mode: s[8], flags: s.readUInt16LE(10), c: s.readFloatLE(12) },
    });
  }
}
ok(reqs.length >= 20, `${reqs.length} search requests in the trace (46 / 47, brain mode 5, action layers 2 / 3)`);
// start node = actor +0x108 = FUN_0033daf0(40, G, position before the frame's move)
const nn = reqs.map(q => [q, NG.nearestNode(G, q.pos)]);
// (actor +0x108 itself can move later in the frame: the follower's node event, FUN_005690c8 case 3 / 5)
const bad = nn.filter(([q, n]) => n !== q.R.start);
ok(bad.length === 0, `start = nearest node within 40 u of the soldier, ${nn.length - bad.length}/${nn.length}` +
   (bad.length ? ` (first miss f${bad[0][0].frame} ${bad[0][0].e}: game ${bad[0][0].R.start}, port ${bad[0][1]})` : ''));
// a list obeys the graph and the mode's end rule
function rules(R, list) {
  const n = list.indexOf(-1), nodes = list.slice(0, n);
  if (n < 1 || nodes[0] !== R.start) return 'does not start at the start node';
  for (let k = 0; k + 1 < nodes.length; k++) {
    const q = G.nodes[nodes[k]];
    let kk = -1;
    for (let j = 0; j < q[3]; j++) if (G.links[q[4] + j][0] === nodes[k + 1]) kk = j;
    if (kk < 0) return `no link ${nodes[k]} -> ${nodes[k + 1]}`;
    if (!NG.passable(G, nodes[k], kk)) return `closed link ${nodes[k]} -> ${nodes[k + 1]}`;
  }
  if (new Set(nodes).size !== nodes.length) return 'repeats a node';
  const depth = nodes.length - 1;
  if (R.mode >= 1 && R.mode <= 6) {
    const p0 = G.nodes[R.start], pl = G.nodes[nodes[depth]];
    const d = Math.hypot(pl[0] - p0[0], pl[1] - p0[1], pl[2] - p0[2]);
    if (depth > R.max - 1) return `longer than the cap (${depth})`;
    if (depth < R.max - 1 && !(depth >= 3 && d > R.c)) return `ends at depth ${depth}, ${d.toFixed(1)} u out, short of c and the cap`;
  }
  return null;
}
const modes = new Set(reqs.map(q => `${q.R.mode}/${q.R.flags.toString(16)}`));
const gbad = reqs.map(q => [q, rules(q.R, q.list)]).filter(x => x[1]);
ok(gbad.length === 0, `game lists: open link chains from the start, mode-1 end rule (modes/flags ${[...modes]}), ${reqs.length - gbad.length}/${reqs.length}` +
   (gbad.length ? ` (f${gbad[0][0].frame} ${gbad[0][0].e}: ${gbad[0][1]})` : ''));
const rng = lcg(161);
const pbad = reqs.map(q => [q, NG.search(G, q.R, rng, quiet)]).map(([q, L]) => [q, L, rules(q.R, L)]).filter(x => x[2]);
ok(pbad.length === 0, `port lists for the same requests obey the same rules, ${reqs.length - pbad.length}/${reqs.length}` +
   (pbad.length ? ` (f${pbad[0][0].frame}: ${pbad[0][2]}: ${pbad[0][1]})` : ''));
// the depth the lists end at (cap vs c): same split in the game and the port
const capG = reqs.filter(q => q.list.indexOf(-1) - 1 === q.R.max - 1).length;
const rng2 = lcg(161);
const capP = reqs.map(q => NG.search(G, q.R, rng2, quiet)).filter((L, i) => L.indexOf(-1) - 1 === reqs[i].R.max - 1).length;
console.log(`info lists ending on the cap: game ${capG}/${reqs.length}, port ${capP}/${reqs.length}`);
done();
