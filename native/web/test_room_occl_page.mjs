// test_room_occl_page.mjs -- the room's occluder culling on play.html (worker 0233; room_occl.js).
// play.html runs FUN_00269868 (the volumes) after the visibility probe each game frame and hands it to the room draw
// (room.js showChunks) and the stage effects' cull (effects.js, FUN_002ea6a0's 0x200). Checks, at the start camera,
// with area streaming and with light.json's area boxes stripped (every chunk drawn):
//   - volumes are built (window.__play.roomOccl.count) and some tree nodes are dropped;
//   - a triangle under a dropped node is neither drawn nor hit by the report ray cast (report.js __rayCast follows each
//     geometry's index), a triangle of a kept node in the same chunk is (control);
//   - the stage fire's emitter cull sets 0x200 on emitters inside a volume (the start save's RAM: emitters 4 and 63,
//     w208_fire/save.json; the page's start camera is the save's).
// Run: node native/web/test_room_occl_page.mjs   (needs playwright, the three.js CDN, data/scene.json with 'occl')
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(here, 'data');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
if (!existsSync(path.join(D, 'scene.json'))) { console.log('SKIP: no data/scene.json'); process.exit(0); }
const scene = JSON.parse(readFileSync(path.join(D, 'scene.json'), 'utf8'));
if (!scene.occl) { console.log("SKIP: no 'occl' in data/scene.json (export_z128_room.py + export_web_room.py)"); process.exit(0); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch (e) { console.log('SKIP: no playwright'); process.exit(0); }
const buf = {};
const tri = (d, t) => {
  const f = buf[d.mesh] || (buf[d.mesh] = (q => new Float32Array(q.buffer.slice(q.byteOffset, q.byteOffset + q.byteLength)))(readFileSync(path.join(D, scene.meshes[d.mesh].file))));
  const P = [0, 1, 2].map(k => [0, 1, 2].map(j => f[(t * 3 + k) * 12 + j]));
  const e1 = P[1].map((x, j) => x - P[0][j]), e2 = P[2].map((x, j) => x - P[0][j]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const a = Math.hypot(...n), c = [0, 1, 2].map(j => (P[0][j] + P[1][j] + P[2][j]) / 3);
  return { area: a / 2, n: n.map(x => x / (a || 1)), c };
};

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const [name, strip] of [['play.html', false], ['play.html, no area boxes', true]]) {
    const pg = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    if (strip) await pg.route('**/data/vincent/light.json', async r => {
      const res = await r.fetch(), j = await res.json(); delete j.areas; r.fulfill({ response: res, json: j });
    });
    for (let k = 0; ; k++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&enemydmg=0`, { waitUntil: 'load' }); break; } catch (e) { if (k > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
    await pg.waitForFunction(() => typeof window.__rayCast === 'function' && window.__play && window.__play.stats.ticks > 5, null, { timeout: 240000 });
    // the dropped and kept ranges now (chunks 0..2; groups the mask does not hide)
    const st = await pg.evaluate(() => {
      const O = window.__play.roomOccl, m = window.__play.visMask;
      if (!O) return null;
      let nodes = 0; for (const c of [0, 1, 2]) { const d = O.dropped(c); if (d) for (const x of d) nodes += x; }
      const fx = window.__fx && window.__fx.stage;
      const occ = fx ? fx.emitters.map((e, i) => (e.f0a & 0x200 ? i : -1)).filter(i => i >= 0) : null;
      return { count: O.count, nodes, occ, hidden: m.bits() };
    });
    ok(st && st.count > 0 && st.nodes > 0, `${name}: ${st && st.count} volumes, ${st && st.nodes} nodes dropped at the start camera`);
    // node side: the largest opaque triangles of a dropped and of a kept node, same chunk, group not hidden
    const D0 = await pg.evaluate(c => Array.from(window.__play.roomOccl.dropped(c) || []), 1);
    let gone = null, kept = null;
    scene.draws.forEach((d, di) => {
      if (d.kind !== 'room' || !d.chunks || d.aref >= 0 || d.blend) return;
      for (const r of d.chunks) {
        if (r[0] !== 1 || r[4] <= 0 || (r[3] >= 0 && st.hidden.includes(r[3]))) continue;
        const drop = D0[r[4]] === 1;
        for (let t = r[1] / 3; t < (r[1] + r[2]) / 3; t += Math.max(1, Math.floor(r[2] / 3 / 20))) {
          const q = { ...tri(d, t), draw: di, tri: t, node: r[4] };
          if (drop && (!gone || q.area > gone.area)) gone = q;
          if (!drop && (!kept || q.area > kept.area)) kept = q;
        }
      }
    });
    ok(gone && kept, `${name}: targets in chunk 01: dropped node ${gone && gone.node} (draw ${gone && gone.draw} tri ${gone && gone.tri}), kept node ${kept && kept.node}`);
    if (gone && kept) {
      const cast = (q, off) => pg.evaluate(([o, d]) => window.__rayCast(o, d, 16).hits.map(h => [h.draw, h.tri]), [q.c.map((x, j) => x + q.n[j] * off), q.n.map(x => -x)]);
      const has = (hits, q) => hits.some(([d, t]) => d === q.draw && t === q.tri);
      let off = null;
      for (const o of [4, 12, 30, 60]) if (has(await cast(kept, o), kept)) { off = o; break; }
      ok(off !== null, `${name}: the kept node's triangle is drawn and hit (control; ray start ${off} u off it)`);
      const hh = await cast(gone, off ?? 4);
      ok(!has(hh, gone), `${name}: the dropped node's triangle is not drawn (ray from ${off} u: hits ${JSON.stringify(hh.slice(0, 3))})`);
    }
    if (st && st.occ) ok(st.occ.includes(4) && st.occ.includes(63), `${name}: the stage fire's cull flags 0x200 on emitters [${st.occ}] (the start save's RAM: 4, 63)`);
    else console.log(`SKIP ${name}: no stage effects on the page`);
    ok(errs.length === 0, `${name}: no page errors (${errs.slice(0, 2).join(' | ')})`);
    await pg.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
