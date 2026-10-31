// The stage nav graph and its path search (worker 0161): a direct translation of the game's graph
// object (vtable 0x4a18b0, FUN_0033d918) and the search service DAT_0046e290 +100 (FUN_003682e8 ->
// FUN_00369d88 / FUN_00369ed8 -> FUN_003691f8 states FUN_003692e0 / FUN_003693c0 / FUN_003693f0, open
// list FUN_00369788, the node list FUN_00369f40). notes/enemy-ai-hook.md 'Nav graph and search'.
//
// Data: ai.json `nav` (export_web_triggers.py nav_graph: stage sections 5 / 6 / 7):
//   nodes[i] = [x, y, z, link count (+7), first link (+0xc), area (+0xe)]; positions = the node's words
//   0-2 low 24 bits / 256 (psllw / psraw 8, vitof12, x 16: exact in f32)
//   links[j] = [neighbour (+2), cost x 100 (+4), flags (+5)]
// Runtime per node (G.occ): +0x1d = paths that hold it (FUN_00353700 / FUN_00352a60), +0x1e = actors on it
// (FUN_00563a50). Both start at 0 (the file's bytes are 0).
//
// A search request is the 16-byte struct the callers build (C+0x330 once started, FUN_0055a628):
//   { start +0, goal +2, s4 +4, max +6 (list length cap), mode +8, flags +0xa, c +0xc (f32) }
// mode: 0 = to the goal node (heuristic = distance); 1-6 = away / around (goal test FUN_0x33ee38: c
// from the start after 3 steps, or the length cap); heuristic 0 for 1 / 2 / 5, -distance for 3 / 4.
// flags: 1 synchronous (FUN_003682e8; else queued, FUN_00368250), 2 / 4 cost the +0x1e / +0x1d counts,
// 8 / 0x10 cost the cover test FUN_0033fa58 (MISSING), 0x20 / 0x40 allow up / down vertical links,
// 0x80 cost climbing away from the goal.
const f = Math.fround;

export const POOL = 3000;                     // svc+0x14 pool capacity (save RAM: svc +8 = 0xbb8)
const FLT_MAX = 3.4028234663852886e38;        // DAT_004a17d0 / 17d8 = 0x7f7fffff

export function makeGraph(nav) {
  if (!nav) return null;                       // FUN_0033ef48: no sections -> DAT_0046e878 +0x10 = 0
  const n = nav.nodes.length;
  return { nodes: nav.nodes, links: nav.links, n, occ1d: new Uint8Array(n), occ1e: new Uint8Array(n) };
}
const pos = (G, i) => { const q = G.nodes[i]; return [q[0], q[1], q[2]]; };
// FUN_0033e118: node record i (null for -1 or i >= the header count)
export const node = (G, i) => (G && i !== -1 && i >= -0x8000 && i < G.n && i >= 0) ? G.nodes[i] : null;
// vt+0x14 (0x33e540): neighbour of node a through its link k, -1 past the link count
export function neighbour(G, a, k) {
  const q = G.nodes[a];
  return k < q[3] ? G.links[q[4] + k][0] : -1;
}
// vt+0x1c (FUN_0033e5d0): link k of a is open: flags & (1, or 0x11 when G+0x64 < 0x2c; 48 here)
export function passable(G, a, k, g64 = 48) {
  const q = G.nodes[a];
  if (!(k < q[3])) return false;
  return (G.links[q[4] + k][2] & (g64 < 0x2c ? 0x11 : 1)) === 0;
}
// FUN_0033e190: link record k of node a
const link = (G, a, k) => (k < G.nodes[a][3] ? G.links[G.nodes[a][4] + k] : null);
// FUN_0033e280 / FUN_0033e1e0: the link from a to b, or null
export function linkTo(G, a, b) {
  const q = G.nodes[a];
  for (let k = 0; k < q[3]; k++) if (G.links[q[4] + k][0] === b) return G.links[q[4] + k];
  return null;
}
// vmul + vaddbc x 2 + sqrt: |a - b| over x, y, z in f32
function dist(a, b) {
  const x = f(a[0] - b[0]), y = f(a[1] - b[1]), z = f(a[2] - b[2]);
  return f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
}
const dist2 = (a, b) => { const x = f(a[0] - b[0]), y = f(a[1] - b[1]), z = f(a[2] - b[2]); return f(f(f(x * x) + f(y * y)) + f(z * z)); };

// FUN_0033daf0(r, G, p, flat, best): a node within r of p (flat: y difference ignored). best = the
// nearest such node, else the first. GUESS (search order only): this is the routine's linear branch over
// every node; with the stage grid (DAT_0046e880 +0x1170, section 12, FUN_0036d400) the game only visits
// the cells around p (not decoded). The nearest node within r is the same either way unless two are
// equally near or a node within r sits outside those cells.
export function nearestNode(G, p, r = 40.0, flat = false, best = true) {
  let bd = FLT_MAX, hit = -1;
  for (let i = 0; i < G.n; i++) {
    const q = G.nodes[i];
    const x = f(q[0] - p[0]), y = flat ? 0 : f(q[1] - p[1]), z = f(q[2] - p[2]);
    const d = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
    if (d < r && d < bd) {
      if (!best) return i;
      bd = d; hit = i;
    }
  }
  return hit;
}

// FUN_0033dda8(r, G, n, p, flat): from the actor's last node n, the best of n and its neighbours (every
// link, open or not: vt+0x14) by |node - p| over x / z + 2 |dy| (one VADDz: horizontal, plus the height
// twice; T: w161_chase, every frame of 46 / 47 matches). Under r -> that node; else FUN_0033daf0(r, G, p,
// flat, 1), and with none the old node. flat (param 5) re-measures the best in 3D first (no caller here).
export function nodeFrom(G, n, p, r = 40.0, flat = false) {
  const q = node(G, n);
  if (n !== -1 && q) {
    const score = i => {
      const v = G.nodes[i];
      const x = f(v[0] - p[0]), y = f(v[1] - p[1]), z = f(v[2] - p[2]);
      return f(f(Math.sqrt(f(f(x * x) + f(z * z)))) + Math.abs(f(y + y)));
    };
    let best = n, bs = score(n);
    for (let k = 0; k < q[3]; k++) {
      const nb = neighbour(G, n, k);
      if (!node(G, nb)) continue;
      const s = score(nb);
      if (s < bs) { best = nb; bs = s; }
    }
    if (flat) bs = dist(pos(G, best), p);
    if (bs < r) return best;
  }
  const h = nearestNode(G, p, r, flat, true);
  return h !== -1 ? h : (q ? n : -1);
}
// FUN_00563970(a, -1) (the actor's node, actor +0x108): with no node, FUN_0033daf0(40, G, p, 0, 1); with
// one, FUN_0033dda8(40, G, node, p, 0). p = FUN_0054a720 = the actor's position. Then FUN_00563a50.
// The game runs it for an actor when its position is set (vt+0x234: FUN_0055ef78, +0x28 bit 0x10; the
// player's FUN_00573c60 calls it first), from the action layers, and from listener events 0 / 3.
export function trackNode(G, a, p = a.pos) {
  if (!G) return;
  if (a.node108 === undefined) a.node108 = -1;
  setNode(G, a, a.node108 === -1 ? nearestNode(G, p, 40.0, false, true) : nodeFrom(G, a.node108, p, 40.0, false));
}
// FUN_00559748's tail (an actor taking its AI / the stage): FUN_0033daf0(50, G, p, 0, 1) -> FUN_00563a50
export function spawnNode(G, a) {
  if (!G) return;
  if (a.node108 === undefined) a.node108 = -1;
  setNode(G, a, nearestNode(G, a.pos, 50.0, false, true));
}
// FUN_00563a50(a, n): a new node moves the actor's +0x1e count from the old node to it; C+0x398 = n
export function setNode(G, a, n) {
  if (!G) return;
  if (n !== a.node108) {
    if (node(G, a.node108)) G.occ1e[a.node108] = (G.occ1e[a.node108] - 1) & 0xff;
    if (node(G, n)) G.occ1e[n] = (G.occ1e[n] + 1) & 0xff;
    a.node108 = n;
  }
  if (a.C) a.C.n398 = n;
}

// vt+0x34 (0x33ec98): the heuristic of node a toward goal b by the request's mode
// (modes 1 / 2 / 5 need no goal: the mode-1 requests of layers 2 / 3 go out with goal -1 when the target
// has no free neighbour, FUN_0055a628 does not check it)
function heuristic(G, R, a, b) {
  if (R.mode === 1 || R.mode === 2 || R.mode === 5) return 0;
  const d = dist(pos(G, a), pos(G, b));
  return R.mode === 3 || R.mode === 4 ? f(-d) : d;   // 0, 6 and >= 7 (sltiu 7 fails -> 0x33ed70): distance
}
// vt+0x24 (0x33ee38): goal test for node n at depth k. Mode 0 (or >= 7): n is the goal. Modes 1-6: n is
// further than c from the start with k >= 3, or k reached the cap (max - 1).
function isGoal(G, R, n, k) {
  if (R.mode === 0 || R.mode >= 7) return n === R.goal;
  const d = dist(pos(G, n), pos(G, R.start));
  if (R.c < d && k >= 3) return true;
  return !(k < R.max - 1);
}
// vt+0x2c (FUN_0033e660): the cost of leaving node a by its link k (rng = FUN_0040b5c0, mode 1)
function cost(G, R, a, k, rng, warn) {
  const q = G.nodes[a];
  if (!(k < q[3])) return FLT_MAX;
  const L = G.links[q[4] + k];
  const fl = R.flags;
  let c = f(L[1] * f(0.01));
  const b = L[0];
  if (!node(G, b)) return c;
  if (fl & 2) c = f(c + f(G.occ1e[b] * 20.0));
  if (fl & 4) c = f(c + f(G.occ1d[b] * 10.0));
  if (L[2] & 1) c = f(c + 1000.0);
  else if (L[2] & 2) c = f(c + 100.0);
  const D = pos(G, b), B = pos(G, a);
  const Cg = node(G, R.goal) ? pos(G, R.goal) : null;
  if (L[2] & 0x10) {
    if (!(fl & 0x60)) c = f(c + 1000.0);
    else if (f(D[1] - B[1]) < 0.0) c = f(c + ((fl & 0x20) ? 1.0 : 1000.0));
    else c = f(c + ((fl & 0x40) ? 1.0 : 1000.0));
  }
  if (Cg && (fl & 0x18)) warn('nav_graph: search cost flags 8 / 0x10 (cover test FUN_0033fa58) not translated: no term');
  if (fl & 0x80) {
    // GUESS (unset input): with no goal node the game reads an uninitialised C0 here; every caller sets one
    const G0 = Cg || D;
    if (Math.abs(f(G0[1] - B[1])) < Math.abs(f(G0[1] - D[1]))) {
      const dy = Math.abs(f(B[1] - D[1]));
      if (50.0 < dy) c = f(c + 100.0);
      else if (15.0 < dy) c = f(c + 10.0);
    }
    if (L[2] & 0x10) c = f(c + 30.0);
  }
  switch (R.mode & 0xff) {
    case 1: c = f(c + f(f(rng()) * 10.0)); break;
    case 2: c = f(c + f(Math.abs(f(dist(Cg, D) - R.c)) * f(0.1))); break;
    case 3: { const dn = dist(Cg, D); c = f(c - f(dn * f(0.1))); if (dn < dist(Cg, B)) c = f(c + 20.0); break; }
    case 4: case 5: c = f(c + f(Math.abs(f(dist(Cg, D) - dist(pos(G, R.start), D))) * f(0.05))); break;
    case 6: if (dist2(Cg, B) < dist2(Cg, D)) c = f(c + 5.0); break;
  }
  return c;
}

// FUN_00369788: insert by f = g + h, after every record with the same f (open list A+0x1c)
function openInsert(S, r) {
  const fr = f(r.g + r.h);
  let i = 0;
  while (i < S.open.length && !(fr < f(S.open[i].g + S.open[i].h))) i++;
  S.open.splice(i, 0, r);
}

// One search (the 0x50-byte record of FUN_00369d88 / FUN_00369140): open / closed lists, the state
// A+0x10 (0 start, 1 next record, 2 one link, 3 done) and the result. Records come from the service's
// pool (svc+0x14: 3000; FUN_00369238 gives them back when the search ends).
export function makeService(o = {}) {
  // DAT_0046e290 +100 (save RAM): +0 = 40 search steps per update (FUN_00369e40), +4 = 1 queue slot,
  // +0x14 pool of 3000 records
  return { budget: o.budget ?? 40, slots: new Array(o.slots ?? 1).fill(null), next: 0, pool: o.pool ?? POOL, used: 0 };
}
export function searchBegin(G, R, rng = Math.random, warn = () => {}, svc = makeService()) {
  return { G, R, rng, warn, svc, open: [], closed: [], used: 0, res: null, state: 0, cur: null, i: 0 };
}
function alloc(S, node, g, h, parent, depth) { S.used++; S.svc.used++; return { node, g, h, parent, depth }; }
const full = S => !(S.svc.used < S.svc.pool);
// FUN_00369180: one call of the search's state function
export function searchStep(S) {
  const { G, R, rng, warn } = S;
  if (S.state === 0) {                                        // FUN_003692e0
    if (full(S)) { S.res = null; S.state = 3; return; }
    const r = alloc(S, R.start, 0, heuristic(G, R, R.start, R.goal), null, 0);
    openInsert(S, r);
    if (isGoal(G, R, R.start, 1)) { S.res = r; S.state = 3; } else S.state = 1;
    return;
  }
  if (S.state === 1) {                                        // FUN_003693c0
    S.cur = S.open[0] || null;
    if (!S.cur) { S.res = null; S.state = 3; return; }
    S.i = 0; S.state = 2;
    return;
  }
  if (S.state !== 2) return;                                  // 3: FUN_00369720 (done)
  // FUN_003693f0: one link of the current record per call
  const cur = S.cur;
  const nb = neighbour(G, cur.node, S.i);
  if (nb === -1) {
    S.open.splice(S.open.indexOf(cur), 1);                    // unlink
    S.closed.push(cur);                                       // FUN_003698d0
    S.state = 1;
    return;
  }
  if (passable(G, cur.node, S.i)) {
    if (!S.closed.some(r => r.node === nb)) {                 // FUN_00369728
      const g = f(cur.g + cost(G, R, cur.node, S.i, rng, warn));
      const o = S.open.find(r => r.node === nb);              // FUN_00369750
      if (o) {
        if (cur.depth < R.max - 1 && g < o.g) {
          o.parent = cur; o.g = g; o.depth = cur.depth + 1;
          S.open.splice(S.open.indexOf(o), 1); openInsert(S, o);
        }
      } else {
        let r = cur, stop = false;
        if (cur.depth < R.max - 1) {
          if (!full(S)) {
            r = alloc(S, nb, g, 0, cur, cur.depth + 1);
            r.h = heuristic(G, R, nb, R.goal);
            openInsert(S, r);
          } else stop = true;                                 // pool full: end on the current record
        }
        if (isGoal(G, R, nb, r.depth) || stop) { S.res = r; S.state = 3; return; }
      }
    }
  }
  S.i++;
}
// FUN_00369f40 + FUN_00369238: the node list, the records back to the pool
function searchEnd(S) {
  S.svc.used -= S.used; S.used = 0;
  return nodeList(S.R, S.res);
}
// FUN_003682e8 (synchronous search) -> FUN_00369d88 + FUN_00369ed8 (FUN_003691f8: steps until state 3): the
// node list (C+0x3a8: u16 nodes from the start, -1 ended), or null when the pool is full (the request
// fails, the list is untouched). R: the request; rng: the shared random stream (mode 1 costs).
// svc: the service (makeService); a number = a lone pool of that many records (tests).
export function search(G, R, rng = Math.random, warn = () => {}, svc = POOL) {
  if (typeof svc === 'number') svc = makeService({ pool: svc });
  if (!(svc.used < svc.pool)) return null;
  const S = searchBegin(G, R, rng, warn, svc);
  let guard = 0;
  while (S.state !== 3) {
    if (++guard > 50000000) { warn('nav_graph: search did not end'); break; }
    searchStep(S);
  }
  return searchEnd(S);
}
// FUN_00368120: the pool and the queue both have room
export const queueFree = svc => svc.used < svc.pool && svc.slots.some(j => !j);
// FUN_00368250 (queued search; FUN_00368900 takes the next free slot from svc.next round): out = the
// object whose .list the result goes to (C+0x3a8; FUN_00369d88 sets list[0] = -1 now). Returns the slot,
// or -1 (0xffff) when the pool or the queue is full.
export function enqueue(svc, G, R, out, rng = Math.random, warn = () => {}) {
  if (!(svc.used < svc.pool)) return -1;
  const n = svc.slots.length;
  for (let k = 0; k < n; k++) {
    const i = (svc.next + k) % n;
    if (svc.slots[i]) continue;
    svc.next = (i + 1) % n;
    svc.slots[i] = { S: searchBegin(G, { ...R }, rng, warn, svc), out };
    out.list = [-1];
    return i;
  }
  return -1;
}
// FUN_00368420 (once a frame, first in FUN_00323128): each busy slot gets FUN_00369e40: up to svc+0 calls;
// a call that finds the search done writes the list (FUN_00369f40), gives the records back and frees the
// slot (FUN_00368a40) instead of stepping.
export function serviceUpdate(svc) {
  for (let i = 0; i < svc.slots.length; i++) {
    const j = svc.slots[i];
    if (!j) continue;
    for (let k = 0; k < svc.budget; k++) {
      if (j.S.state === 3) { j.out.list = searchEnd(j.S); svc.slots[i] = null; break; }
      searchStep(j.S);
    }
  }
}
// FUN_00368398(svc, slot): a busy slot is dropped (FUN_0036a000: its records back) and freed
export function cancel(svc, i) {
  if (!(i >= 0 && i < svc.slots.length) || !svc.slots[i]) return false;
  svc.used -= svc.slots[i].S.used;
  svc.slots[i] = null;
  return true;
}
// FUN_00369f40: the list from the start to rec (depth order), -1 after; no record -> [start, -1]
export function nodeList(R, rec) {
  if (!rec) return [R.start, -1];
  const out = [];
  let j = rec.depth, first = -1;
  for (let r = rec; r && j >= 0; r = r.parent, j--) {
    if (j < R.max) { if (first === -1) first = j; out[j] = r.node; }
  }
  out[first + 1] = -1;
  return out;
}

// FUN_00563d20(t, 1, 1): a random free neighbour of the target's node (t.node108): links whose neighbour
// links back (FUN_0033e1e0) and has +0x1e == 0, up to 32, one picked by FUN_0040b5c0; -1 without.
export function freeNeighbour(G, t, rng) {
  const q = node(G, t.node108);
  if (!q) return -1;
  const cand = [];
  for (let k = 0; k < q[3] && k <= 0x1f; k++) {
    const nb = neighbour(G, t.node108, k);
    if (!linkTo(G, nb, t.node108)) continue;
    if (node(G, nb) && G.occ1e[nb] === 0) cand.push(k);
  }
  if (cand.length < 1) return -1;
  return neighbour(G, t.node108, cand[Math.trunc(cand.length * f(rng()))]);
}
