// (workers 0217, 0253) Plan a walk-mesh route for route.py: START=x,y,z [BLOCK=x0,x1,y0,y1,z0,z1;...] OUT=route.json node route_plan.mjs T1 T2 ...
// T = keys of out/route/chunkwps.json (chunk targets; game-derived, gitignored). Dijkstra over polygon neighbours, ladders and
// same-height (MAXDY, default 12 u) off-edge steps. OUT = [{chunk, pts: [{p, k, file}]}]; flatten pts to waypoints.
import fs from 'fs';
import { loadCollision } from '../../native/web/collision.js';
const W = new URL('../../native/web/data/', import.meta.url).pathname;
const buf = fs.readFileSync(W + 'z128_collision.bin');
const col = await loadCollision(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const P = col.polys, n = P.length;
const cen = i => [0,1,2].map(k => P[i].v.reduce((s, q) => s + q[k], 0) / P[i].v.length);
const adj = Array.from({length: n}, () => []);
const BLK = (process.env.BLOCK || '').split(';').filter(Boolean).map(t => t.split(',').map(Number));
const blocked = pt => BLK.some(b => pt[0] >= b[0] && pt[0] <= b[1] && pt[1] >= b[2] && pt[1] <= b[3] && pt[2] >= b[4] && pt[2] <= b[5]);
const add = (a, b, kind, pt) => { if (!blocked(pt)) adj[a].push({to: b, kind, pt}); };
for (let i = 0; i < n; i++) { const p = P[i]; if (!p.ok) continue;
  for (let e = 0; e < p.nv; e++) { const a = p.v[e], b = p.v[(e + 1) % p.nv];
    const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
    if (p.nbr[e] !== null) { if (P[p.nbr[e]].ok) add(i, p.nbr[e], 'e', mid); continue; }
    const en = p.edges[e], L = Math.hypot(en[0], en[2]) || 1;
    for (const d of [0.5, 2, 5]) { const x = mid[0] + en[0]/L*d, z = mid[2] + en[2]/L*d;
      const f = col.locate(x, mid[1], z);
      if (f && f[0] !== i && P[f[0]].ok) { if (Math.abs(P[f[0]].v[0][1] - mid[1]) < +(process.env.MAXDY||12)) { add(i, f[0], (p.flags & 2) ? 'c' : 'x', mid); break; } } } } }
const lad = JSON.parse(fs.readFileSync(W + 'z128_ladders.json')); const LL = lad.ladders || lad;
for (const L of LL) { const b = L.bottom.origin, t = L.top.origin;
  const pb = col.locate(b[0], b[1] - 2, b[2]), pt = col.locate(t[0], t[1] - 2, t[2]);
  if (pb && pt) { add(pb[0], pt[0], 'L' + L.id + 'up', b); add(pt[0], pb[0], 'L' + L.id + 'dn', t); } }
function path(src, dst) {           // Dijkstra on centroids
  const d = new Float64Array(n).fill(Infinity), pr = new Int32Array(n).fill(-1), pk = Array(n);
  d[src] = 0; const q = [[0, src]];
  while (q.length) { q.sort((a, b) => b[0] - a[0]); const [dd, i] = q.pop(); if (dd > d[i]) continue; if (i === dst) break;
    const ci = cen(i);
    for (const ed of adj[i]) { const cj = cen(ed.to); const w = Math.hypot(cj[0]-ci[0], cj[1]-ci[1], cj[2]-ci[2]) + (ed.kind[0] === 'L' ? 50 : 0);
      if (dd + w < d[ed.to]) { d[ed.to] = dd + w; pr[ed.to] = i; pk[ed.to] = ed; q.push([d[ed.to], ed.to]); } } }
  if (!isFinite(d[dst])) return null;
  const seq = []; for (let i = dst; i !== src; i = pr[i]) seq.push({poly: i, via: pk[i]}); seq.reverse();
  return {len: d[dst], seq};
}
const wps = JSON.parse(fs.readFileSync(new URL('out/route/chunkwps.json', import.meta.url)));
const S0 = (process.env.START || '-1395.63,-98.6,-1110.51').split(',').map(Number); const start = col.locate(S0[0], S0[1], S0[2])[0];
const order = process.argv.slice(2).map(Number);
let cur = start; const out = [];
for (const c of order) { const w = wps[c]; const t = col.locate(w[0], w[1], w[2]); const r = path(cur, t[0]);
  if (!r) { console.log('no path to', c); break; }
  const chunks = []; for (const s of r.seq) { const f = P[s.poly].file; if (chunks[chunks.length-1] !== f) chunks.push(f); }
  const specials = r.seq.filter(s => s.via.kind !== 'e').map(s => s.via.kind + '@' + s.via.pt.map(v => v.toFixed(0)).join(','));
  console.log('to', c, 'len', r.len.toFixed(0), 'chunks', chunks.join('>'), specials.join(' '));
  out.push({chunk: c, pts: r.seq.map(s => ({p: s.via.pt.map(v => +v.toFixed(1)), k: s.via.kind, file: P[s.poly].file}))});
  cur = t[0]; }
fs.writeFileSync(process.env.OUT || 'route.json', JSON.stringify(out));
