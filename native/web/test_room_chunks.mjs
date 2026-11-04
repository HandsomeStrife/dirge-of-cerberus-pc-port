// test_room_chunks.mjs -- the room per chunk against GS dumps (worker 0260; notes/room-blend-streaming.md 'Grades per chunk').
// Renders the room alone (room.js + room_vis + room_occl) from each fixture's fitted camera (room_grade_fixture.py, then room_vertex_match.py: default
// tools/trace/out/w260/fit, from the route states of notes/route-states.md) to NAME_page.png, and grades them against the dump's room with fog and bilinear
// (tools/gsdump/src/room_chunk_grade.py; SSIM + edges, the sky left out). WEBDIR: another copy of native/web (mutants); ROOM_QUERY: page options.
// Run: flock tools/trace/out/.browser.lock node native/web/test_room_chunks.mjs [NAME ...]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.ROOM_CHUNKS || path.join(here, '../../tools/trace/out/w260/fit');
const NAMES = process.argv.slice(2).length ? process.argv.slice(2) : ['r02_stairs3', 'r03_start', 'r04_east', 'r05_west', 'r06_market', 'r07_beat', 'r08_walk', 'r09_walk', 'r0b_walk'];
const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = createRequire(path.join(g, '/'))('playwright');
const { PNG } = (() => { try { return createRequire(path.join(g, '/'))('pngjs'); } catch (e) { return {}; } })();
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', process.env.WEBDIR || here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const HTML = `<!doctype html><meta charset="utf-8"><script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js" } }</script><body></body>`;
try {
  const pg = await browser.newPage();
  pg.on('pageerror', e => console.log('pageerror', e.message));
  pg.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
  await pg.route('**/__grade.html*', r => r.fulfill({ contentType: 'text/html', body: HTML }));
  for (let k = 0; ; k++) { try { await pg.goto(`http://127.0.0.1:${port}/__grade.html${process.env.ROOM_QUERY || ''}`, { waitUntil: 'load' }); break; } catch (e) { if (k > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.evaluate(async () => {
    const THREE = await import('three');
    const room = await import('./room.js');
    const rv = await import('./room_vis.js');
    const occlMod = await import('./room_occl.js');
    const visData = await fetch('data/z128_vis.json').then(r => r.ok ? r.json() : null);
    const roomVis = visData && rv.createRoomVis(visData);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
    renderer.setSize(432, 512, false); renderer.sortObjects = false; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    document.body.appendChild(renderer.domElement);
    let R = null; const occlV = new Float32Array(16);
    window.roomShot = async (meta) => {
      if (!R) { R = await room.loadRoom({ skip: d => d.kind === 'char' }); renderer.setClearColor(new THREE.Color().setRGB(...R.scene.clear, THREE.LinearSRGBColorSpace), 1); }
      const vm = rv.createVisMask();
      if (roomVis) vm.setCamera(roomVis.probe(meta.cam.slice(0, 3), meta.chunks).mask);
      window.probeBits = roomVis ? vm.bits() : null;
      room.showChunks(R.root, meta.chunks, roomVis ? vm : null);
      // scrolling UVs from the state's times (tools/trace/uvanim_fixture.py; as test_room_grade): meta.uv.frames page frames to the dump's last frame
      if (R.uvAnim) {
        const ua = R.uvAnim; ua.time.clear(); ua.frame(meta.chunks, 0);
        if (meta.uv) {
          for (const sl of meta.uv.slots) { const T = ua.time.get(sl.chunk); if (T) ua.byChunk.get(sl.chunk).forEach((ai, k) => { T[k] = sl.times[ua.anims[ai].index]; }); }
          for (let k = 0; k < meta.uv.frames; k++) ua.frame(meta.chunks);
        } else { ua.off.fill(0); ua.tex.needsUpdate = true; }
      }
      const FB_W = 432, FB_H = 512, SCR_W = 448, FOV = 73.5, AY = 1.5, CX = 213, CY = 256;
      const SCRZ = SCR_W * 0.5 / Math.tan(FOV * 0.008726647);
      const cam = new THREE.PerspectiveCamera(60, 1, 1, R.lo.distanceTo(R.hi) * 1.2);
      const hw = Math.max(CX, FB_W - CX), hh = Math.max(CY, FB_H - CY);
      cam.fov = 2 * Math.atan(hh / (SCRZ * AY)) * 180 / Math.PI;
      cam.setViewOffset(2 * hw, 2 * hh, hw - CX, hh - CY, FB_W, FB_H);
      cam.aspect = (2 * hw / SCRZ) / (2 * hh / (SCRZ * AY)); cam.near = 1;
      const v = meta.cam; cam.position.set(v[0], v[1], v[2]); cam.up.set(v[6], v[7], v[8]); cam.lookAt(v[3], v[4], v[5]);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      if (R.occl) { R.occl.frame(occlMod.viewOf(cam, occlV), meta.chunks); room.showChunks(R.root, meta.chunks, roomVis ? vm : null, R.occl); }
      renderer.clear(); renderer.render(R.root, cam);
      return renderer.domElement.toDataURL('image/png');
    };
  });
  // the GS colour math per env slot (FUN_0026afe8 / FUN_00265560, GS MODULATE and fog), on one textured quad at view depth w: SSIM cannot see these
  const scene = JSON.parse(readFileSync(path.join(process.env.WEBDIR || here, 'data/scene.json'), 'utf8'));
  if (!scene.env_fog) console.log('SKIP colour quads: data/scene.json has no env_fog (old export; re-run export_z128_room.py + export_web_room.py)');
  else {
    const res = await pg.evaluate(async (envFog) => {
      const THREE = await import('three'); const room = await import('./room.js');
      const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false }); r.setSize(16, 16, false); r.outputColorSpace = THREE.LinearSRGBColorSpace;
      const tx = new THREE.DataTexture(new Uint8Array([200, 150, 77, 128]), 1, 1, THREE.RGBAFormat); tx.needsUpdate = true;
      const out = [];
      for (const cv of [90, 128]) for (const slot of [0, 2, 5, 8, 20, 23]) for (const w of [60, 200, 500, 700, 2000]) {
        const g = new THREE.BufferGeometry(), a = w * 2;
        g.setAttribute('position', new THREE.Float32BufferAttribute([-a, -a, w, a, -a, w, a, a, w, -a, -a, w, a, a, w, -a, a, w], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0.5), 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute([].concat(...Array(6).fill([cv / 255, cv / 255, cv / 255, 128 / 255])), 4));
        g.setAttribute('envSlot', new THREE.Float32BufferAttribute(new Array(6).fill(slot), 1));
        const sc = new THREE.Scene();
        sc.add(new THREE.Mesh(g, room.makeMaterial({ fog: envFog[0], env_fog: envFog }, tx, { kind: 'x', aref: -1, fog: true }, 0, { cull: false })));
        const cam = new THREE.PerspectiveCamera(60, 1, 1, 20000); cam.up.set(0, -1, 0); cam.position.set(0, 0, 0); cam.lookAt(0, 0, 1); cam.updateMatrixWorld();
        r.setClearColor(0, 1); r.clear(); r.render(sc, cam);
        const px = new Uint8Array(4); r.getContext().readPixels(8, 8, 1, 1, r.getContext().RGBA, r.getContext().UNSIGNED_BYTE, px);
        out.push({ cv, slot, w, px: [px[0], px[1], px[2]] });
      }
      r.dispose();
      return out;
    }, scene.env_fog);
    let bad = 0;
    for (const { cv, slot, w, px } of res) {
      const e = scene.env_fog[slot];
      const F = e.far === e.near ? 255 : Math.floor(255 * Math.min(1, Math.max(e.min, (e.far - w) / (e.far - e.near))));
      const want = [200, 150, 77].map((t, i) => Math.floor((F * Math.floor(t * cv / 128) + (255 - F) * e.color[i]) / 256));
      if (want.some((v, i) => Math.abs(v - px[i]) > 0)) { bad++; console.log(`  Cv ${cv} slot ${slot} w ${w}: page ${px}, GS ${want}`); }
    }
    console.log(`${bad ? 'FAIL' : 'ok  '} GS MODULATE + fog per env slot: ${res.length - bad} / ${res.length} quads exact`);
    if (bad) process.exitCode = 1;
  }
  // TEX1 per texture (FUN_002659b8): each level a flat colour, quads at view depth w; the level the GS LOD picks = log2(w) + K, K = -6, rounded, up to MXL
  {
    const res = await pg.evaluate(async () => {
      const THREE = await import('three'); const room = await import('./room.js');
      const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false }); r.setSize(16, 16, false); r.outputColorSpace = THREE.LinearSRGBColorSpace;
      const lvl = (v, n) => { const d = new Uint8Array(n * n * 4); for (let i = 0; i < n * n; i++) d.set([v, v, v, 128], i * 4); return { data: d, width: n, height: n }; };
      const tx = new THREE.DataTexture(lvl(40, 8).data, 8, 8, THREE.RGBAFormat);
      tx.mipmaps = [lvl(40, 8), lvl(120, 4), lvl(200, 2)]; tx.generateMipmaps = false; tx.minFilter = THREE.LinearMipmapNearestFilter; tx.magFilter = THREE.LinearFilter; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.needsUpdate = true;
      const out = [];
      const sc0 = { textures: { t: { mips: [{}, {}] } }, meshes: {} };
      for (const w of [20, 60, 80, 88, 96, 128, 170, 186, 400, 2000]) {
        const g = new THREE.BufferGeometry(), a = w * 2;
        g.setAttribute('position', new THREE.Float32BufferAttribute([-a, -a, w, a, -a, w, a, a, w, -a, -a, w, a, a, w, -a, a, w], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0.5), 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute([].concat(...Array(6).fill([128 / 255, 128 / 255, 128 / 255, 128 / 255])), 4));
        const sc = new THREE.Scene();
        sc.add(new THREE.Mesh(g, room.makeMaterial(sc0, tx, { kind: 'x', tex: 't', aref: -1, fog: false }, 0, { cull: false })));
        const cam = new THREE.PerspectiveCamera(60, 1, 1, 20000); cam.up.set(0, -1, 0); cam.position.set(0, 0, 0); cam.lookAt(0, 0, 1); cam.updateMatrixWorld();
        r.setClearColor(0, 1); r.clear(); r.render(sc, cam);
        const px = new Uint8Array(4); r.getContext().readPixels(8, 8, 1, 1, r.getContext().RGBA, r.getContext().UNSIGNED_BYTE, px);
        out.push({ w, v: px[0] });
      }
      r.dispose();
      return out;
    });
    let bad = 0;
    for (const { w, v } of res) {
      const lod = Math.log2(w) - 6, L = lod <= 0 ? 0 : Math.min(Math.floor(lod + 0.5), 2);
      if (v !== [40, 120, 200][L]) { bad++; console.log(`  w ${w}: page ${v}, level ${L} is ${[40, 120, 200][L]}`); }
    }
    console.log(`${bad ? 'FAIL' : 'ok  '} GS LOD on the game's levels (Cv 128): ${res.length - bad} / ${res.length} quads`);
    if (bad) process.exitCode = 1;
    // per-texture TEX1 in every fixture's dump against the export's levels
    let n = 0, wrong = [];
    for (const nm of NAMES) {
      const f = path.join(FIX, nm + '_tex1.json');
      if (!existsSync(f)) continue;
      const T = JSON.parse(readFileSync(f, 'utf8'));
      for (const [tx, rows] of Object.entries(T)) for (const [mxl, mmin, k] of rows) {
        n++;
        const lv = scene.textures[tx]?.mips?.length ?? 0;
        if (mxl !== lv || (mxl ? mmin !== 4 || k !== 0xfa0 : mmin !== 1 || k !== 0)) wrong.push(`${nm} ${tx}: dump MXL ${mxl} MMIN ${mmin} K ${k}, export ${lv} levels`);
      }
    }
    console.log(`${wrong.length || !n ? 'FAIL' : 'ok  '} TEX1 per texture: ${n - wrong.length} / ${n} dump bindings = the export ${wrong.slice(0, 6).join('; ')}`);
    if (wrong.length || !n) process.exitCode = 1;
  }
  for (const n of NAMES) {
    const f = path.join(FIX, n + '.json');
    if (!existsSync(f)) { console.log('SKIP', n); continue; }
    const m = JSON.parse(readFileSync(f, 'utf8'));
    const uvf = path.join(FIX, 'uvanim_' + n + '.json');
    if (existsSync(uvf)) m.uv = { slots: JSON.parse(readFileSync(uvf, 'utf8')).slots, frames: 2 };
    const url = await pg.evaluate(mm => window.roomShot(mm), m);
    writeFileSync(path.join(FIX, n + '_page.png'), Buffer.from(url.split(',')[1], 'base64'));
    const bits = await pg.evaluate(() => window.probeBits);
    console.log(n, 'mask page', (bits || []).join(), 'state', m.mask.join());
  }
} finally { await browser.close(); srv.kill(); }
// the floors: this checkout's numbers (notes/room-blend-streaming.md 'Grades per chunk'), 0.01 down
const FLOOR = { r02_stairs3: [0.98, 0.98], r03_start: [0.97, 0.95], r04_east: [0.98, 0.97], r05_west: [0.96, 0.96], r06_market: [0.93, 0.94], r07_beat: [0.98, 0.98], r08_walk: [0.98, 0.98], r09_walk: [0.98, 0.98], r0b_walk: [0.98, 0.98] };
const rep = execSync(`python3 -I ${path.join(here, '../../tools/gsdump/src/room_chunk_grade.py')} ${FIX} ${NAMES.join(' ')}`, { encoding: 'utf8' });
let fail = 0;
for (const ln of rep.trim().split('\n')) {
  const m = /^(\S+)\s.*ssim ([\d.]+) edge ([\d.]+)/.exec(ln);
  const ok = m && (!FLOOR[m[1]] || (+m[2] >= FLOOR[m[1]][0] && +m[3] >= FLOOR[m[1]][1]));
  console.log((ok ? 'ok   ' : 'FAIL ') + ln);
  if (!ok) fail++;
}
console.log(fail || process.exitCode ? `${fail} chunks FAILED or the colour math` : 'all ok');
process.exit(fail || process.exitCode ? 1 : 0);
