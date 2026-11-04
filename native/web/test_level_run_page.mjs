// test_level_run_page.mjs -- the whole first level on the real play.html with real input (worker 0264; plan in notes/route-states.md,
// tools/trace/route_plan.mjs): deck -> results screen, default URL (intro on, real gun, sound, no warp, no poke). The bot only presses
// keys, moves the mouse and READS window.__play; nothing it does writes to the game. It keeps a report of every stuck, death, Restart,
// page error and memory sample. The goals are the route's beats (flags, card keys, gates, fights), each with a `done` test on game state,
// so a Restart from a record re-enters at the right one.
//   node native/web/test_level_run_page.mjs          (takes tools/trace/out/.browser.lock itself, in sittings; see below)
// Env: LEVEL_VIEW=480x360[@dpr]   viewport (default 480x360; a laptop = 1440x900@2)
//      LEVEL_UNTIL=<goal name>    stop after that goal (a section run: the market = 'dogs')
//      LEVEL_HOLD=<seconds>       after LEVEL_UNTIL stay in place that long, sampling memory (a real-time soak)
//      LEVEL_EVENTS=play|skip     main's events and the opening: watch them (default) or Start + ✕ as a player does
//      LEVEL_SITTING=<seconds>    browser lock hold (default 480): then the game's pause, lock released, tab frozen until the next hold
//      LEVEL_OUT=<dir>            log + screenshots (default tools/trace/out/w264)
//      WEBDIR=<dir>               serve another copy (mutation runs)
// Mouse look: under pointer lock CDP's mouse moves arrive with movementX / Y = 0 (Chromium takes them from the OS path), so the bot sends the
// counts as a `mousemove` on window: the event play.js's listener reads, input only. Buttons and keys are CDP's. Headless pointer lock's first
// event also jumps the view (150 px clamp, from the pointer's page position); a real browser's lock doesn't start from there.
// A run this long does not fit one lock hold: between sittings the page is paused (Enter, the pause menu or the event pause), the tab is
// frozen (CDP Page.setWebLifecycleState, as a background tab: no frames, its clock's delta is capped by the frame loop) and the lock let go.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.WEBDIR || here;
const ROOT = path.join(here, '../..');
const OUT = process.env.LEVEL_OUT || path.join(ROOT, 'tools/trace/out/w264');
const LOCK = path.join(ROOT, 'tools/trace/out/.browser.lock');
const [vw, vh, vd] = (process.env.LEVEL_VIEW || '480x360').match(/\d+(\.\d+)?/g).map(Number);
const UNTIL = process.env.LEVEL_UNTIL || null, HOLD = +(process.env.LEVEL_HOLD || 0);
const EVENTS = process.env.LEVEL_EVENTS || 'play', SITTING = +(process.env.LEVEL_SITTING || 480);
const QUERY = process.env.LEVEL_QUERY || '';
mkdirSync(OUT, { recursive: true });
const LOGF = path.join(OUT, `run_${Date.now()}.log`);
const t0 = Date.now();
const sec = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(5);
const log = (...a) => { const l = `${sec()}s ${a.join(' ')}`; console.log(l); appendFileSync(LOGF, l + '\n'); };
let fail = 0;
const ok = (c, m) => { log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
if (!existsSync(path.join(WEB, 'data/z128_collision.bin'))) { console.log('SKIP: no data'); process.exit(0); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: no playwright'); process.exit(0); }

// ---- the walk-mesh route (tools/trace/route_plan.mjs's graph: polygon neighbours, ladders, same-height off-edge steps)
const { loadCollision } = await import(path.join(WEB, 'collision.js'));
const buf = readFileSync(path.join(WEB, 'data/z128_collision.bin'));
const col = await loadCollision(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const Pol = col.polys, N = Pol.length, MAXDY = 12;
const cen = Pol.map(p => [0, 1, 2].map(k => p.v.reduce((s, q) => s + q[k], 0) / p.v.length));
const adj = Array.from({ length: N }, () => []);
for (let i = 0; i < N; i++) { const p = Pol[i]; if (!p.ok) continue;
  for (let e = 0; e < p.nv; e++) { const a = p.v[e], b = p.v[(e + 1) % p.nv], mid = [0, 1, 2].map(k => (a[k] + b[k]) / 2);
    if (p.nbr[e] !== null) { if (Pol[p.nbr[e]].ok) adj[i].push({ to: p.nbr[e], k: 'e', pt: mid }); continue; }
    const en = p.edges[e], L = Math.hypot(en[0], en[2]) || 1;
    for (const d of [0.5, 2, 5]) { const f = col.locate(mid[0] + en[0] / L * d, mid[1], mid[2] + en[2] / L * d);
      if (f && f[0] !== i && Pol[f[0]].ok && Math.abs(Pol[f[0]].v[0][1] - mid[1]) < MAXDY) { adj[i].push({ to: f[0], k: 'x', pt: mid }); break; } } } }
const lad = JSON.parse(readFileSync(path.join(WEB, 'data/z128_ladders.json'))); const LADDERS = lad.ladders || lad;
for (const L of LADDERS) { const b = L.bottom.origin, t = L.top.origin, pb = col.locate(b[0], b[1] - 2, b[2]), pt = col.locate(t[0], t[1] - 2, t[2]);
  if (pb && pt) { adj[pb[0]].push({ to: pt[0], k: 'up', pt: b, lad: L }); adj[pt[0]].push({ to: pb[0], k: 'dn', pt: t, lad: L }); } }
// Dijkstra on centroids; a ladder costs 50 u. Returns waypoints [{p, k, lad}]
function route(from, to) {
  const a = col.locate(from[0], from[1] - 2, from[2]) || col.locate(from[0], from[1], from[2]), b = col.locate(to[0], to[1] - 2, to[2]) || col.locate(to[0], to[1], to[2]);
  if (!a || !b) return null;
  const d = new Float64Array(N).fill(Infinity), pr = new Int32Array(N).fill(-1), pe = Array(N), Q = [[0, a[0]]]; d[a[0]] = 0;
  while (Q.length) { let m = 0; for (let i = 1; i < Q.length; i++) if (Q[i][0] < Q[m][0]) m = i; const [dd, i] = Q.splice(m, 1)[0]; if (dd > d[i]) continue; if (i === b[0]) break;
    for (const e of adj[i]) { const w = Math.hypot(cen[e.to][0] - cen[i][0], cen[e.to][1] - cen[i][1], cen[e.to][2] - cen[i][2]) + (e.lad ? 50 : 0);
      if (dd + w < d[e.to]) { d[e.to] = dd + w; pr[e.to] = i; pe[e.to] = e; Q.push([d[e.to], e.to]); } } }
  if (!isFinite(d[b[0]])) return null;
  const out = []; for (let i = b[0]; i !== a[0]; i = pr[i]) out.push({ p: pe[i].pt, k: pe[i].k, lad: pe[i].lad }); out.reverse(); out.push({ p: to, k: 'end' }); return out;
}

// ---- reading the game (no writes)
const READ = () => {
  const P = window.__play; if (!P) return null;
  const c = P.ctrl, A = P.enemyAI, I = window.__items, f = P.follow, st = P.stage, core = P.aim && P.aim.core, gs = P.gameState;
  const go = P.gameOver && P.gameOver.go, si = P.stageInfo, res = P.results;
  const info = P.renderer.info;
  const act = [];
  if (A) for (const a of A.actors) { if (!a.pos) continue;
    const d = Math.hypot(a.pos[0] - c.pos.x, a.pos[2] - c.pos.z); if (d > 400) continue;
    act.push({ rec: a.rec, hp: a.hp, pos: a.pos.slice(0, 3), d, ai: !!a.ai, mode: a.ai ? a.ai.mode : null, type: a.model || a.type || a.name || null, st: a.astate }); }
  const items = [];
  if (I) for (const x of I.list) { if (!(x.f28 & 1) || !x.pos) continue; const d = Math.hypot(x.pos[0] - c.pos.x, x.pos[2] - c.pos.z); if (d < 200) items.push({ rec: x.rec, pos: x.pos.slice(0, 3), d, id: x.id ?? x.item ?? null }); }
  const fl = {}; if (A) for (const k of [0, 1, 2]) fl[k] = A.eventFlags[k] | 0;
  return {
    ticks: P.stats.ticks, pos: [c.pos.x, c.pos.y, c.pos.z], heading: c.heading, onGround: c.onGround, speed: c.speed, action: c.active ? c.active.name : null, pstate: c.P.state,
    onTarget: !!(core && core.hud && (core.hud.flags & 0x12)), hp: P.php ? P.php.hp : null, loaded: core ? core.ammo.rounds() : null, drawn: core ? core.P.drawn : null, wst: core ? core.P.st : null,
    inv: I ? { key: I.inventory.count(0x6b300001), ammo: I.inventory.count(0x62300000), potion: I.inventory.count(0x69300000), gil: I.inventory.gil, sel: I.inventory.selected ? (I.inventory.selected() || {}).id ?? null : null } : null,
    eye: f.eye ? Array.from(f.eye) : null, at: f.at ? Array.from(f.at) : null,
    aimF: f.M && core ? (() => { const a = core.cam.c1cc, sn = Math.sin(a), cs = Math.cos(a), M = f.M; return [0, 1, 2].map(k => -sn * M[1][k] + cs * M[2][k]); })() : null,   // aim_core reticleRay
    intro: P.intro.active, introPaused: P.intro.paused, introEnded: P.intro.ended,
    ev: !!(st && st.rt.running && !st.rt.battle), evPaused: P.stagePaused, skippable: !!(st && st.rt.running && st.rt.skippable && st.rt.skippable()), evName: st && st.rt.eventName ? st.rt.eventName : null,
    noCtl: !!(gs && gs.test(11)), noUser: !!(gs && (gs.test(7) || gs.test(5))),
    pause: !!(P.pause && P.pause.active), siKind: si ? si.kind : -1, exit: !!(res && res.exit), goMenu: !!(go && go.menu), goOn: !!(go && go.pauseBlocked), restarts: P.restart.count, restartPending: P.restart.pending,
    flags: fl, gflag1: st ? st.globalFlags[1] : 0, gflag19: st ? st.globalFlags[19] : 0, slots: P.light.stream.slots.map(s => s.loaded ? s.chunk : -1), boss: !!(A && A.bossPlugin),
    actors: act, items, locked: document.pointerLockElement === P.renderer.domElement, hidden: document.hidden,
    fps: null, mem: { tex: info.memory.textures, geo: info.memory.geometries, prog: info.programs ? info.programs.length : 0, calls: info.render.calls, tris: info.render.triangles, heap: performance.memory ? performance.memory.usedJSHeapSize : 0, heapTot: performance.memory ? performance.memory.totalJSHeapSize : 0 },
    lost: P.renderer.getContext().isContextLost(),
  };
};

// ---- the browser lock, in sittings: `flock LOCK cat` holds it while node's pipe is open (it dies with node)
let lockProc = null;
const lockTake = () => new Promise(res => { lockProc = spawn('flock', [LOCK, 'cat'], { stdio: ['pipe', 'pipe', 'ignore'] }); lockProc.stdout.once('data', () => res()); lockProc.stdin.write('x\n'); });
const lockDrop = () => { if (lockProc) { lockProc.stdin.end(); lockProc = null; } };

// ---- procs of the browser (RSS: the GPU process holds SwiftShader's textures)
function browserRss(rootPid) {
  try { const ps = execSync(`ps -e -o pid=,ppid=,rss=,args=`, { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return { pid: +m[1], ppid: +m[2], rss: +m[3], a: m[4] }; });
    const kids = new Set([rootPid]); for (let i = 0; i < 4; i++) for (const p of ps) if (kids.has(p.ppid)) kids.add(p.pid);
    let total = 0, gpu = 0, rend = 0; for (const p of ps) if (kids.has(p.pid)) { total += p.rss; if (/--type=gpu-process/.test(p.a)) gpu = p.rss; if (/--type=renderer/.test(p.a)) rend = Math.max(rend, p.rss); }
    return { total: total >> 10, gpu: gpu >> 10, rend: rend >> 10 };
  } catch { return null; }
}

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
await lockTake();
let holdStart = Date.now();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: vd || 1 });
const pg = await ctx.newPage();
const cdp = await ctx.newCDPSession(pg);
const errs = [], warnSeen = new Map();
pg.on('console', m => { const t = m.text();
  if (m.type() === 'error') { errs.push(t); log('console.error', t.slice(0, 300)); }
  if (m.type() === 'warning') { const k = t.slice(0, 80); warnSeen.set(k, (warnSeen.get(k) || 0) + 1); if (warnSeen.get(k) === 1) appendFileSync(LOGF, `${sec()}s warn ${t.slice(0, 200)}\n`); } });
pg.on('pageerror', e => { errs.push(e.message); log('PAGEERROR', e.message, (e.stack || '').split('\n').slice(1, 4).join(' | ')); });
pg.on('crash', () => { errs.push('page crash'); log('PAGE CRASH'); });
const OPTIONAL = new Set(['/game_state.js', '/stage_info.js']);
pg.on('response', r => { if (r.status() === 404) { const u = r.url().replace(/^http:..[^/]+/, ''); if (!OPTIONAL.has(u)) log('404', u); } });
await pg.goto(`http://127.0.0.1:${port}/play.html${QUERY ? '?' + QUERY : ''}`, { waitUntil: 'load', timeout: 240000 });
await pg.waitForFunction(() => window.__play && window.__play.packsReady, null, { timeout: 300000 });
await pg.evaluate(() => window.__play.packsReady);
log(`page up (${vw}x${vh}@${vd || 1}, events ${EVENTS}, log ${LOGF})`);
await pg.addScriptTag({ content: `window.__botRead = ${READ.toString()};` });
await pg.evaluate(() => { window.__lost = []; const c = window.__play.renderer.domElement;
  c.addEventListener('webglcontextlost', () => window.__lost.push(['lost', performance.now()])); c.addEventListener('webglcontextrestored', () => window.__lost.push(['restored', performance.now()])); });

// ---- the aim servo: runs in the page once a frame, because a CDP round trip waits for a frame (SwiftShader: the node loop manages about 3 a
// second, and can't keep a moving target). It reads the camera and the actor and sends input events only: mouse counts to play.js's listener,
// mousedown / mouseup on the canvas (aim.js), F (reload). Node names the target: __botServo.rec.
const SERVO = () => {
  const V = window.__botServo = { rec: null, signX: -1, signY: 1, sens: 0.15 * Math.PI / 180, down: false, shots: 0, on: false, err: [0, 0], last: 0 };
  const P = window.__play, canvas = P.renderer.domElement, btn = (t) => canvas.dispatchEvent(new MouseEvent(t, { button: 0, bubbles: true, clientX: 240, clientY: 180 }));
  const step = () => { requestAnimationFrame(step);
    if (V.down) { btn('mouseup'); V.down = false; }
    if (V.rec == null || !P.enemyAI) return;
    const a = P.enemyAI.actors.find(x => x.rec === V.rec); if (!a || !a.pos || !(a.hp > 0)) { V.rec = null; return; }
    const f = P.follow, core = P.aim.core, M = f.M, c = core.cam.c1cc, sn = Math.sin(c), cs = Math.cos(c), F = [0, 1, 2].map(k => -sn * M[1][k] + cs * M[2][k]);
    const dx = a.pos[0] - f.eye[0], dy = a.pos[1] - 12 - f.eye[1], dz = a.pos[2] - f.eye[2];
    let yaw = Math.atan2(dz, dx) - Math.atan2(F[2], F[0]); while (yaw > Math.PI) yaw -= 2 * Math.PI; while (yaw < -Math.PI) yaw += 2 * Math.PI;
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)) - Math.atan2(F[1], Math.hypot(F[0], F[2]));
    V.err = [yaw, pitch];
    const cl = v => Math.max(-140, Math.min(140, v));
    dispatchEvent(new MouseEvent('mousemove', { movementX: cl(V.signX * yaw / V.sens * 0.6), movementY: cl(V.signY * pitch / V.sens * 0.6) }));
    if (core.ammo.rounds() === 0) { if (performance.now() - V.last > 800) { V.last = performance.now(); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })); dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' })); } return; }
    V.on = !!(core.hud.flags & 0x12) || (Math.abs(yaw) < 0.05 && Math.abs(pitch) < 0.05);
    if (V.on) { btn('mousedown'); V.down = true; V.shots++; }
  };
  step();
};
// ---- input
const held = new Set();
async function hold(want) { for (const k of [...held]) if (!want.has(k)) { held.delete(k); await pg.keyboard.up(k); }
  for (const k of want) if (!held.has(k)) { held.add(k); await pg.keyboard.down(k); } }
const tap = async (k, ms = 60) => { await pg.keyboard.down(k); await pg.waitForTimeout(ms); await pg.keyboard.up(k); };
const release = () => hold(new Set());
let mx = 240, my = 180, lmb = false, SENS = 0.15 * Math.PI / 180, signX = 1, signY = 1;
async function look(dx, dy) { dx = Math.max(-140, Math.min(140, dx)); dy = Math.max(-140, Math.min(140, dy)); if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return; await pg.evaluate(([x, y]) => { dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y })); }, [dx, dy]); }
async function fire(on) { if (on === lmb) return; lmb = on; if (on) await pg.mouse.down(); else await pg.mouse.up(); }
async function ensureLock(s) { if (!s.locked) { await pg.mouse.move(mx, my); await pg.mouse.click(mx, my); await pg.waitForTimeout(150); } }

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function basis(s) { const fx = s.at[0] - s.eye[0], fz = s.at[2] - s.eye[2], L = Math.hypot(fx, fz) || 1; return { f: [fx / L, fz / L], r: null }; }
// the camera's right (play.js aim: camera-relative rows); read as f rotated; the side key's sign comes from calibrate()
let sideSign = 1;
function moveKeys(s, dx, dz) { const b = basis(s), L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  const fwd = dx * b.f[0] + dz * b.f[1], side = (dx * -b.f[1] + dz * b.f[0]) * sideSign;
  const want = new Set(); if (fwd > 0.38) want.add('KeyW'); if (fwd < -0.38) want.add('KeyS'); if (side > 0.38) want.add('KeyD'); if (side < -0.38) want.add('KeyA');
  return { want, fwd, side }; }

// the current state
let S = null;
const read = async () => { S = await pg.evaluate(() => window.__botRead()); return S; };
const wait = ms => pg.waitForTimeout(ms);

// ---- sittings
async function sittingCheck() {
  if ((Date.now() - holdStart) / 1000 < SITTING) return;
  await release(); await fire(false); await servo(null);
  await read();
  const canPause = !S.intro && !S.pause && !S.goOn && S.hp > 0 && S.siKind < 0 && !S.restartPending && !S.exit;
  if (canPause) await tap('Enter');
  await wait(300);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {});
  lockDrop();
  log(`sitting: lock released (${canPause ? 'paused' : 'not paused'})`);
  await new Promise(r => setTimeout(r, 4000));
  await lockTake(); holdStart = Date.now();
  log('sitting: lock taken');
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  if (canPause) { await wait(200); await tap('Enter'); }
}

// ---- memory: a row per chunk swap + one each 30 s
const memRows = []; let lastSlots = '', lastMem = 0;
function sampleMem(why) { const m = S.mem, b = browserPid ? browserRss(browserPid) : null;
  const row = { t: +sec(), ticks: S.ticks, slots: S.slots.join('/'), why, ...m, heapMB: +(m.heap / 1048576).toFixed(0), rss: b, pos: S.pos.map(v => Math.round(v)), f0: S.flags[0] };
  memRows.push(row); appendFileSync(LOGF, `${sec()}s mem ${JSON.stringify(row)}\n`);
  if (S.lost) log('CONTEXT LOST at', S.pos.map(Math.round).join(',')); }
const browserPid = (() => { try { const me = process.pid; for (const l of execSync('ps -e -o pid=,ppid=,args=', { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n')) { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); if (+m[2] === me && /chrome|headless_shell/.test(m[3])) return +m[1]; } } catch { /* no rss */ } return null; })();
function memTick() { const k = S.slots.join('/'); if (k !== lastSlots) { sampleMem('swap'); lastSlots = k; lastMem = Date.now(); } else if (Date.now() - lastMem > 30000) { sampleMem('t'); lastMem = Date.now(); } }

// ---- system states the bot answers before anything else; returns true when it handled the frame
const stats = { deaths: 0, stucks: 0, restarts: 0, events: [], kills: 0, shots: 0 }; let lastEvLog = 0, evSince = 0, wasEv = false;
async function systems() {
  await sittingCheck();
  if (servoRec != null && (S.intro || S.ev || S.evPaused || S.hp === 0 || S.goOn || S.goMenu || S.pause || S.siKind >= 0 || S.noCtl || S.restartPending)) await servo(null);
  memTick();
  lastMove.tk = lastMove.tk ?? 0;
  if (S.lost) { log('context lost: stopping'); throw new Error('webgl context lost'); }
  if (S.intro) { await release(); await fire(false);
    if (EVENTS === 'skip' && !S.introPaused && S.ticks > 50) { await tap('Enter'); await wait(200); await tap('Space'); await wait(800); } else await wait(200);
    return true; }
  if (S.goMenu) { await release(); await fire(false); log('game over menu: Restart'); await tap('Space'); await wait(1500); return true; }
  if (S.hp === 0 || S.goOn || S.restartPending) { await release(); await fire(false); await wait(300); return true; }
  if (S.exit) return false;
  if (!S.locked && S.ticks > 40) { await ensureLock(S); log('pointer lock taken again (one R1)'); }
  if (S.pause) { await release(); await tap('Enter'); await wait(300); return true; }
  if (S.ev || S.evPaused) { await release(); await fire(false);
    if (!wasEv) { wasEv = true; evSince = Date.now(); log('event starts', `flag0 ${S.flags[0]} g1 ${S.gflag1}`, `at ${S.pos.map(Math.round)}`); }
    const long = Date.now() - evSince > 240000;
    if (S.evPaused) { await tap('Space'); await wait(300); return true; }
    if ((EVENTS === 'skip' || long) && S.skippable) { if (long) log('event: over 240 s, skipping'); await tap('Enter'); await wait(250); await read(); if (S.evPaused) await tap('Space'); await wait(600); return true; }
    if (Date.now() - lastEvLog > 2000) { lastEvLog = Date.now(); await tap('Space', 40); }   // a choice box / message in an event takes ✕
    await wait(150); return true; }
  if (wasEv) { wasEv = false; log(`event ends after ${((Date.now() - evSince) / 1000).toFixed(0)} s, flag0 ${S.flags[0]} g1 ${S.gflag1}`); }
  if (S.siKind >= 0 || S.noCtl) { await release(); await fire(false); await tap('Space', 40); await wait(300); return true; }
  return false;
}

// heal when low: E uses the selected item (the save selects the potions, slot 0)
let lastHeal = 0;
async function heal() { if (S.hp > 0 && S.hp < 350 && S.inv && S.inv.potion > 0 && Date.now() - lastHeal > 4000 && S.pstate !== 7) { lastHeal = Date.now(); log(`heal: E at HP ${S.hp}, potions ${S.inv.potion}`); await tap('KeyE'); } }

// ---- fight: turn the view onto the nearest live enemy with a clear line and hold the gun on it
const FOES = a => a.ai && a.hp > 0;
const notTown = new Set();     // records we were told not to shoot: filled by the goal (townspeople)
let ignoreUntil = new Map();
const lineClear = (a, b) => { try { return !col.segment || !col.segment({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }); } catch { return true; } };
function pickFoe(range) { let best = null; for (const a of S.actors) { if (!FOES(a) || a.d > range || notTown.has(a.rec) || (ignoreUntil.get(a.rec) || 0) > Date.now()) continue;
    const eyeP = [S.pos[0], S.pos[1] - 14, S.pos[2]], chest = [a.pos[0], a.pos[1] - 12, a.pos[2]]; if (!lineClear(eyeP, chest)) continue; if (!best || a.d < best.d) best = a; } return best; }
function aimErr(tp) { const dx = tp[0] - S.eye[0], dy = tp[1] - S.eye[1], dz = tp[2] - S.eye[2], F = S.aimF || [S.at[0] - S.eye[0], S.at[1] - S.eye[1], S.at[2] - S.eye[2]];   // the reticle's ray from the eye
  let yaw = Math.atan2(dz, dx) - Math.atan2(F[2], F[0]); while (yaw > Math.PI) yaw -= 2 * Math.PI; while (yaw < -Math.PI) yaw += 2 * Math.PI;
  const pitch = Math.atan2(dy, Math.hypot(dx, dz)) - Math.atan2(F[1], Math.hypot(F[0], F[2])); return { yaw, pitch }; }
async function aimAt(tp) { const e = aimErr(tp); await look(signX * e.yaw / SENS * 0.7, signY * e.pitch / SENS * 0.7); return e; }

let fightT = 0, fightRec = -1, fightHp = 0, fightN = 0;
const fightLog = (a, e, on) => { if (++fightN % 40 === 1) appendFileSync(LOGF, `${sec()}s aim ${a.rec} yaw ${e.yaw.toFixed(3)} pitch ${e.pitch.toFixed(3)} on ${on} hp ${a.hp} rounds ${S.loaded} wst ${S.wst} eye ${S.eye.map(Math.round)} a ${a.pos.map(Math.round)}\n`); };
let servoRec = null;
const servo = async rec => { if (rec === servoRec) return; servoRec = rec; await pg.evaluate(r => { if (window.__botServo) window.__botServo.rec = r; }, rec); };
async function fightStep(range = 110) {
  const a = pickFoe(range);
  if (!a) { await servo(null); fightRec = -1; return null; }
  if (a.rec !== fightRec) { fightRec = a.rec; fightT = Date.now(); fightHp = a.hp; log(`fight ${a.rec} ${a.type || ''} hp ${a.hp} d ${a.d.toFixed(0)} mode ${a.mode}; me hp ${S.hp} rounds ${S.loaded}/${S.inv && S.inv.ammo}`); }
  if (a.hp < fightHp) { fightHp = a.hp; fightT = Date.now(); }
  if (Date.now() - fightT > 25000) { const v = await pg.evaluate(() => { const V = window.__botServo; return { err: V.err, on: V.on, shots: V.shots }; }); log(`fight ${a.rec}: no damage in 25 s, leaving it (hp ${a.hp}, d ${a.d.toFixed(0)}, err ${v.err.map(x => x.toFixed(3))}, on ${v.on}, servo shots ${v.shots})`); ignoreUntil.set(a.rec, Date.now() + 30000); await servo(null); return null; }
  await servo(a.rec);
  return a;
}

// ---- walking
let lastCross = 0, path_ = null, pi = 0, lastMove = { t: 0, p: null }, stuckN = 0;
function planTo(t) { path_ = route(S.pos, t); pi = 0; lastMove = { t: Date.now(), p: S.pos.slice(), tk: S.ticks }; stuckN = 0; return !!path_; }
let lastShot = 0;
async function shot(name) { if (Date.now() - lastShot < 20000) return; lastShot = Date.now(); await pg.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {}); }
// one step toward the plan's next waypoint; 'arrived' at the end. Stuck: ✕, sidestep, replan (a stuck is logged with its place).
async function walkStep(goalName, tol = 5, noLook = false) {
  if (!path_ || pi >= path_.length) return 'arrived';
  // ladders
  if (S.action === 'ladder') { const w = path_[pi]; const dn = w && w.k === 'dn'; const up = S.pos[1] > ((w && w.p[1]) ?? S.pos[1]);
    await hold(new Set([up ? 'KeyW' : 'KeyS'])); await wait(60); return 'ladder'; }
  // advance: the waypoint within tol in xz and near in height, or the next one closer (same floor)
  while (pi < path_.length) { const w = path_[pi];
    if ((w.k === 'up' || w.k === 'dn')) break;
    const d = dist(S.pos, w.p), dy = Math.abs(S.pos[1] - w.p[1]);
    const next = path_[pi + 1];
    if ((d < tol && dy < 30) || (next && next.k !== 'up' && next.k !== 'dn' && dist(S.pos, next.p) < d && dy < 30 && d < 25)) { pi++; continue; }
    break; }
  if (pi >= path_.length) { await release(); return 'arrived'; }
  const w = path_[pi];
  if (w.k === 'up' || w.k === 'dn') { const d = dist(S.pos, w.p);
    if (d < 7) { await release(); const lp = w.k === 'up' ? w.lad.top.origin : w.lad.bottom.origin; const m = moveKeys(S, w.lad.bottom.origin[0] - S.pos[0], w.lad.bottom.origin[2] - S.pos[2]);
      await hold(m.want); await wait(80); await tap('Space'); await wait(250); await read();
      if (S.action === 'ladder') { log(`ladder ${w.lad.id} ${w.k} at ${S.pos.map(Math.round)}`); pi++; return 'ladder'; } } }
  const dx = w.p[0] - S.pos[0], dz = w.p[2] - S.pos[2];
  // the view follows the walk: mouse toward the walking direction, the keys for the rest
  if (!noLook) { const e = aimErr([w.p[0], S.eye[1], w.p[2]]); await look(signX * e.yaw / SENS * 0.25, 0); }
  // a walk polygon up a ladder face (the mesh has them): ✕ at its foot
  if (S.pstate !== 3 && dist(S.pos, w.p) < 9 && S.pos[1] - w.p[1] > 25 && S.ticks - lastCross > 60) { lastCross = S.ticks; await tap('Space'); }
  const m = moveKeys(S, dx, dz); m.want.add('ShiftLeft'); await hold(m.want);
  // stuck: < 4 u in 100 game ticks while not fighting
  if (S.ticks - lastMove.tk > 100) { const moved = Math.hypot(S.pos[0] - lastMove.p[0], S.pos[1] - lastMove.p[1], S.pos[2] - lastMove.p[2]);
    if (moved < 4) { stuckN++; stats.stucks++;
      log(`STUCK ${stuckN} on '${goalName}' at ${S.pos.map(v => v.toFixed(1))} toward ${w.p.map(Math.round)} (${w.k}), wp ${pi}/${path_.length}, state ${S.pstate}, action ${S.action}, flag0 ${S.flags[0]}`);
      await shot(`stuck_${goalName.replace(/\W+/g, '_')}_${stuckN}`);
      const a = stuckN % 4;
      if (a === 1) { await tap('Space'); }
      if (a === 2) { const q = moveKeys(S, -dz, dx); q.want.add('ShiftLeft'); await hold(q.want); await wait(1200); }
      if (a === 3) { const q = moveKeys(S, dz, -dx); q.want.add('ShiftLeft'); await hold(q.want); await wait(1200); }
      if (a === 0) { const q = moveKeys(S, -dx, -dz); await hold(q.want); await wait(1000); const end = path_[path_.length - 1].p; await release(); await read(); path_ = route(S.pos, end) || path_; pi = 0; }
      if (stuckN >= 12) return 'stuck'; }
    else stuckN = Math.max(0, stuckN - 1);
    lastMove = { t: Date.now(), p: S.pos.slice(), tk: S.ticks }; }
  return 'walk';
}
// item pickups on the way (touching = taking; ammo and potions keep the run alive). Straight line, within 40 u and a clear floor line.
const skipItems = new Set();
function nearItem() { let b = null; for (const it of S.items) { if (skipItems.has(it.rec) || it.d > 40 || Math.abs(it.pos[1] - S.pos[1]) > 15) continue; if (!b || it.d < b.d) b = it; } return b; }

// ---- goals. Each has `to` (a spot), optional `done(S)` (state test: skipped at a Restart), `at` (an action there)
const G = [];
const goal = (name, opt) => G.push({ name, ...opt });
const f0 = n => s => (s.flags[0] | 0) >= n;
goal('stairs', { to: [-842, -28, -574], done: f0(2), until: f0(2) });                       // trigger 15, rv_matiawase; the record scene_save(1)
goal('dogs', { to: [-1348, 0, -600], done: s => f0(4)(s), near: 8 });                          // trigger 63 wakes 59-61, 64, 65
goal('square', { to: [-1507, 0, -573], done: s => f0(4)(s), near: 8 });                        // Dan's market spot
goal('alcove', { to: [-1672, 0, -407], done: s => f0(4)(s) || s.inv.key > 0, hunt: 147, near: 10 });   // Cardkey 1: soldier 147's drop
goal('gate1', { to: [-1739, 0, -351], done: f0(4), use: true, near: 12 });                    // script 202 ev 0x11
goal('east', { to: [-728, 0, -37], done: f0(11), near: 12 });
goal('west', { to: [-1420, 0, 684], done: f0(11), near: 12 });
goal('key2', { to: [-1889, 0, 1084], done: s => f0(11)(s) && false, near: 6 });
goal('gate2', { to: [-1305, 0, 851], use: true, near: 12, done: f0(13) });
goal('door', { to: [-1327.5, 0, 1130], use: true, near: 8, done: f0(13) });                   // trigger 12: ✕ facing the door; trigger 14: flag 0 = 13
goal('past door', { to: [-1328, 0, 1205], done: f0(13), until: f0(13), near: 8 });
goal('dragonfly', { to: [-1591, 0, 1364], done: f0(16), until: f0(16), fightOnly: true, near: 8 });
goal('chunk07', { to: [-1753, -44, 1571], done: f0(20), until: f0(20), near: 8 });
goal('e036', { to: [-1753, -44, 1571], done: f0(24), until: f0(24), fightOnly: true, near: 15 });
goal('key3 box', { to: [-703, 0, 845], done: s => f0(36)(s) || s.inv.key > 0, shootBox: 72, near: 12 });
goal('key3', { to: [-700.8, 0, 858.5], done: s => f0(36)(s) || s.inv.key > 0, near: 4 });
goal('gate3', { to: [-478, 0, 801], use: true, done: f0(36), near: 12 });
goal('chunk09', { to: [-80, -40, 606], done: f0(36), near: 12 });
goal('chunk0b', { to: [407, -100, 1471], done: f0(36), until: f0(36), near: 8 });
goal('boss', { to: null, boss: true, done: s => s.exit });
goal('results', { to: null, results: true });

// ---- the run
let reached = null, deaths = 0;
async function calibrate() {     // which way the mouse turns the view, and which way D goes (a player finds this out in the first second)
  await ensureLock(S); await read(); log(`pointer lock ${S.locked}`);
  // the hand-off's first frames have user control off (noUser): retry until the view answers
  const f0v = () => Math.atan2(S.aimF[2], S.aimF[0]), pv = () => Math.atan2(S.aimF[1], Math.hypot(S.aimF[0], S.aimF[2]));
  for (let i = 0; i < 12; i++) { await read(); if (S.noUser || S.noCtl) { await wait(500); continue; }
    const a = f0v(), b = pv(); await look(60, 25); await wait(500); await read(); let da = f0v() - a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; const db = pv() - b;
    log(`mouse +60, +25 px: view yaw ${da.toFixed(4)}, pitch ${db.toFixed(4)} rad (try ${i})`);
    if (Math.abs(da) > 0.05) { signX = da >= 0 ? 1 : -1; SENS = Math.abs(da) / 60; if (Math.abs(db) > 0.01) signY = db >= 0 ? 1 : -1; await look(-60, -25); await wait(200); break; } }
  const q = S.pos.slice(); await hold(new Set(['KeyD'])); await wait(700); await release(); await read();
  const b = basis(S), side = (S.pos[0] - q[0]) * -b.f[1] + (S.pos[2] - q[2]) * b.f[0]; sideSign = side >= 0 ? 1 : -1; await pg.evaluate(SERVO); await pg.evaluate(([x, y, k]) => { Object.assign(window.__botServo, { signX: x, signY: y, sens: k }); }, [signX, signY, SENS]);
  log(`D moved ${side.toFixed(2)} along (-fz, fx); signs x ${signX} y ${signY} side ${sideSign}`);
}

let finished = false, runError = null;
try {
  await pg.waitForFunction(() => { const P = window.__play; return P.intro.active || P.stats.ticks > 40; }, null, { timeout: 300000 });
  await read();
  // the opening
  log(`start: intro ${S.intro}, ticks ${S.ticks}, pos ${S.pos.map(Math.round)}, slots ${S.slots.join('/')}`);
  ok(S.intro === true, 'the opening is on');
  const introStart = Date.now();
  while (true) { await read(); if (await systems()) { if (Date.now() - introStart > 600000) throw new Error('opening: over 600 s'); continue; } break; }
  log(`opening over after ${((Date.now() - introStart) / 1000).toFixed(0)} s; ticks ${S.ticks}, pos ${S.pos.map(Math.round)}`);
  for (let i = 0; i < 40 && !(S.ticks > 40 && S.eye && S.at); i++) { await wait(250); await read(); }
  await calibrate();
  // sample actor types once (log only)
  await read(); appendFileSync(LOGF, `actors ${JSON.stringify(S.actors.slice(0, 6))}\nitems ${JSON.stringify(S.items.slice(0, 6))}\n`);
  let gi = 0, lastRestarts = S.restarts, lastHp = S.hp;
  const logHp = () => { if (S.hp < lastHp - 100) log(`HP ${lastHp} -> ${S.hp} at ${S.pos.map(Math.round)}`); lastHp = S.hp; };
  outer: while (gi < G.length) {
    const g = G[gi]; await read();
    if (g.done && g.done(S)) { gi++; continue; }
    log(`goal '${g.name}' from ${S.pos.map(Math.round)}, HP ${S.hp}, rounds ${S.loaded}/${S.inv && S.inv.ammo}, flag0 ${S.flags[0]}, key ${S.inv && S.inv.key}, slots ${S.slots.join('/')}`);
    if (g.to && !planTo(g.to)) { log(`no route to ${g.to}`); throw new Error('no route for ' + g.name); }
    const startT = Date.now(); let usedN = 0, itemT = 0;
    while (true) {
      await read();
      if (await systems()) { lastMove = { t: Date.now(), p: S.pos.slice(), tk: S.ticks }; if (S.restarts !== lastRestarts) break; continue; }
      if (S.restarts !== lastRestarts) break;
      logHp();
      if (S.exit) { reached = 'exit'; break outer; }
      if (S.hp > 0 && S.hp < lastHp) {}
      await heal();
      if (g.results) { await read(); if (S.exit) { reached = 'exit'; break outer; } await wait(500); continue; }
      if (g.done && g.done(S) && g.until) break;
      if (Date.now() - startT > 900000) { log(`goal '${g.name}': over 900 s, stopping the run`); await shot(`timeout_${g.name.replace(/\W+/g, '_')}`); throw new Error(`timeout on ${g.name}`); }
      // fights first
      // run and gun: the view stays on the foe, the keys keep walking the route; close or on a fight goal he stands (no route left to walk)
      const foe = await fightStep(g.fightOnly || g.boss ? 400 : 110);
      if (foe && (g.fightOnly || g.boss || foe.d < 25 || !g.to)) { await release(); lastMove = { t: Date.now(), p: S.pos.slice(), tk: S.ticks }; continue; }
      if (g.boss) { await wait(100); const r = S.actors.find(a => a.rec === 32); if (r) { const m = moveKeys(S, r.pos[0] - S.pos[0], r.pos[2] - S.pos[2]); } continue; }
      // a pickup near by
      const it = nearItem();
      if (it && !foe) { if (!itemT) itemT = Date.now(); if (Date.now() - itemT > 6000) { skipItems.add(it.rec); itemT = 0; } else { const m = moveKeys(S, it.pos[0] - S.pos[0], it.pos[2] - S.pos[2]); await hold(m.want); await wait(60); continue; } } else itemT = 0;
      const w = g.to ? await walkStep(g.name, g.near && pi >= path_.length - 1 ? g.near : 5, !!foe) : 'arrived';
      if (w === 'stuck') { log(`goal '${g.name}': stuck for good`); await shot(`stuckend_${g.name.replace(/\W+/g, '_')}`); throw new Error(`stuck on ${g.name} at ${S.pos.map(Math.round)}`); }
      if (w === 'arrived') {
        await release();
        if (g.use && usedN < 6) { usedN++; const q = moveKeys(S, g.to[0] - S.pos[0], g.to[2] - S.pos[2]); await hold(q.want); await wait(300); await release(); await tap('Space'); log(`✕ at '${g.name}' (${usedN}), key ${S.inv && S.inv.key}, flag0 ${S.flags[0]}`); await wait(1000); continue; }
        if (g.hunt != null) { const a = S.actors.find(x => x.rec === g.hunt); if (a && a.hp > 0) { await wait(150); continue; } }
        if (g.until) { await wait(150); continue; }
        break;
      }
      await wait(30);
    }
    if (S.restarts !== lastRestarts) { lastRestarts = S.restarts; stats.restarts++; lastHp = 780; log(`Restart #${S.restarts}: back at ${S.pos.map(Math.round)}, flag0 ${S.flags[0]}, g1 ${S.gflag1}`); await read(); gi = G.findIndex(q => !q.done || !q.done(S)); continue; }
    log(`goal '${g.name}' done at ${S.pos.map(Math.round)} in ${((Date.now() - startT) / 1000).toFixed(0)} s, ticks ${S.ticks}`);
    if (UNTIL && g.name === UNTIL) { reached = g.name; break; }
    gi++;
  }
  finished = true;
} catch (e) { runError = e; log('RUN STOPPED:', e.message); await shot('stopped').catch(() => {}); }

await release().catch(() => {}); await fire(false).catch(() => {});
if (HOLD && !runError) { log(`holding ${HOLD} s at ${S.pos.map(Math.round)}`); const end = Date.now() + HOLD * 1000; while (Date.now() < end) { await read(); await systems(); await fightStep(150); await wait(100); await sittingCheck(); } }
await read().catch(() => {});
log(`end: reached ${reached}, ticks ${S.ticks}, HP ${S.hp}, flag0 ${S.flags[0]}, stucks ${stats.stucks}, restarts ${stats.restarts}, servo shots ${await pg.evaluate(() => window.__botServo ? window.__botServo.shots : 0).catch(() => -1)}, page errors ${errs.length}`);
sampleMem('end');
const lostEv = await pg.evaluate(() => window.__lost).catch(() => null);
log('context events', JSON.stringify(lostEv));
appendFileSync(LOGF, `warnings ${JSON.stringify([...warnSeen])}\n`);
ok(errs.length === 0, `no page errors (${errs.length}${errs.length ? ': ' + errs.slice(0, 2).join(' | ').slice(0, 300) : ''})`);
ok(!runError, `the bot was not stopped (${runError ? runError.message : ''})`);
if (!UNTIL) ok(reached === 'exit', `the results screen and Zone.exit reached (${reached})`);
await pg.close().catch(() => {}); await browser.close().catch(() => {}); srv.kill(); lockDrop();
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
