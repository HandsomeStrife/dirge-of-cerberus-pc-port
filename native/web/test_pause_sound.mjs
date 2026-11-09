// test_pause_sound.mjs -- the pause menu's Restart and the SEs it holds (worker 0271; notes/audio-research.md 'Skip / Restart end
// the SEs'). Drives pause_layer.js setupPause (its key handler and hud hook, PauseFlow) as a player does: Start, the Restart entry,
// ✕, the box's cursor to OK, ✕. The OK sends IOP command 0x23 (FUN_003c0a20 -> FUN_00380b00 = FUN_003e7f60(-1, -1, -1); play.js
// onRequest -> audio.js restartSound) while command 6 still holds the flag-0 SEs, before the menu's unpause: those end silent.
// And the menu-sound queue's count is reset every frame (FUN_00247508 -> FUN_00246c98 -> FUN_003e9ed0: DAT_0047d72c = 0, paused or
// not), so FUN_003e7f60's keep list holds the frame's last menu sound (entry 0).
//   node native/web/test_pause_sound.mjs        MUTATE=noreset|nosilent|twice runs one mutant in a scratch copy; MUTATE=late: the old
// play.js wiring (0x23 sent by restart() after the menu has closed). (Swapping pause_layer's onRequest / sync is equivalent: the
// OK's sync does not close the pause yet, the menu closes over the next frames.)
// Needs data/pause.json and data/audio (se_z128.json, se_ev100.json, se_res.json, wave0000).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'url';

// three.js stand-in: pause_layer.js builds its mesh / material; nothing is drawn
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: 'data:text/javascript,' + encodeURIComponent(\`
    class O { constructor(a) { if (a && typeof a === 'object') Object.assign(this, a); } }
    export class BufferGeometry extends O { constructor() { super(); this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; } setDrawRange() {} }
    export class BufferAttribute extends O { constructor(arr, n) { super(); this.array = arr; this.itemSize = n; } }
    export class RawShaderMaterial extends O {} export class Mesh extends O {} export class DataTexture extends O {}
    export class Scene extends O { add() {} } export class OrthographicCamera extends O { updateProjectionMatrix() {} }
    export class Vector3 extends O {} export class Quaternion extends O {} export class AnimationMixer extends O {}
    export const UnsignedByteType = 1, OneFactor = 1, NoColorSpace = '', NearestFilter = 1, ZeroFactor = 0, RedFormat = 1,
      RGBAFormat = 1, OneMinusSrcAlphaFactor = 1, GLSL3 = '300 es', DoubleSide = 2, CustomBlending = 5, AddEquation = 1,
      LoopRepeat = 2201, LoopOnce = 2200, RGFormat = 1030, FloatType = 1015;\`), shortCircuit: true };
  return next(spec, ctx);
}`));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUT = process.env.MUTATE;
let fails = 0, oks = 0;
const ok = (c, m) => { if (c) { oks++; console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
for (const f of ['data/pause.json', 'data/audio/se_z128.json', 'data/audio/se_ev100.json', 'data/audio/se_res.json', 'data/audio/wave0000.bin']) {
  if (!fs.existsSync(path.join(HERE, f))) { console.log('SKIPPED: no ' + f + ' (game data: build_web.sh)'); process.exit(0); }
}
let base = HERE;
if (MUT) {
  const SUB = {
    noreset: ['pause_layer.js', '    if (au) au.menuN = 0;\n', ''],
    nosilent: ['audio.js', 'if (end && held && !(p.prog[4] & 0x40)) {', 'if (false) {'],
    twice: ['audio.js', '    if (!this.sent) restartSound(au, slots);\n    if (slots) slots.freeAll();', '    restartSound(au, slots);\n    if (slots) slots.freeAll();'],
  }[MUT];
  if (!SUB && MUT !== 'late') throw new Error('unknown mutant ' + MUT);
  if (SUB) {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-pause-'));
  for (const f of fs.readdirSync(HERE)) if (f.endsWith('.js')) fs.copyFileSync(path.join(HERE, f), path.join(base, f));
  const p = path.join(base, SUB[0]), s = fs.readFileSync(p, 'utf8');
  if (!s.includes(SUB[1])) throw new Error('mutant does not apply: ' + SUB[1]);
  fs.writeFileSync(p, s.replace(SUB[1], SUB[2]));
  }
}
const imp = (f) => import(pathToFileURL(path.join(base, f)));
const { GameAudio, SeRenderer, RestartSound, emitterVolPan, hexBytes } = await imp('audio.js');
const { SlotStreams } = await imp('ambient.js');
const { SeStream } = await imp('music.js');
const { sendEventSe } = await imp('event_sound.js');
const { setupPause } = await imp('pause_layer.js');

// a stand-in AudioContext (sources recorded, the clock moved by the test)
class FakeCtx {
  constructor() { this.currentTime = 0; this.started = []; this.destination = {}; this.state = 'running'; }
  createBuffer(ch, n, rate) { const d = [new Float32Array(n), new Float32Array(n)]; return { duration: n / rate, length: n, copyToChannel: (a, c) => d[c].set(a), d }; }
  createBufferSource() { const s = { buffer: null, connect() {}, start: (at, off = 0) => { s.at = at; s.off = off; this.started.push(s); }, stop: () => { s.stopped = true; } }; return s; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
}
const A = (f) => path.join(HERE, 'data/audio', f), j = (f) => JSON.parse(fs.readFileSync(A(f)));
const au = new GameAudio(), ctx = new FakeCtx();
const w = j('wave0000.json');
Object.assign(au, { ctx, drv: j('driver.json'), se: j('se_z128.json'), res: j('se_res.json'), banks: { 0: { instruments: w.instruments, data: new Uint8Array(fs.readFileSync(A('wave0000.bin'))) } } });
au.renderers = { 0: new SeRenderer(au.drv, au.banks[0]) };
au.evBlocks = { 0xc064800: j('se_ev100.json') }; au.zoneCode = 0x6800005;
// a placed sound playing (playBgSound's asj_030, a zone program: the slot is sent while the zone's block is in slot 1)
au.seBlock1(au.zoneCode);
const slots = new SlotStreams(au, { emitterVolPan, SeStream, hexBytes });
ctx.currentTime = 0.01;
const hd = slots.open('asj_030', [0, 0, 0], 48);
slots.update({ pos: [0, 0, 0, 1], fwd: [0, 0, 1], alt: [0, 0, 0], useAlt: false });
const sl = slots.slots.get(hd);
au.seBlock1(0xc064800);
// play.js's wiring: seRestart = new RestartSound(() => ({ au, slots: amb.slots })); onRequest(r) -> seRestart.pauseRequest(r, mark)
const rs = new RestartSound(() => ({ au, slots }));
let marked = 0;

// the page's keys, its frames (output.hud) and clock
let handler = null;
globalThis.addEventListener = (type, fn) => { if (type === 'keydown') handler = fn; };
globalThis.fetch = async (u) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(HERE, u))) });
let t = 0;
const output = { hud: null };
const sound = { audio: au, music: null };
let keepAtOk = null, playedBefore = null;
const menuPlays = [];
const pm = au.playMenu.bind(au);
au.playMenu = (n, x, y) => { const r = pm(n, x, y); menuPlays.push(r.id); return r; };
const pause = await setupPause({ output, sound, now: () => t, onPause() {},
  // play.js: onRequest('restart') -> seRestart (audio.js restartSound) first
  onRequest(r) { if (r === 'restart') { keepAtOk = au.keepList(-1, -1, -1); playedBefore = menuPlays.at(-1); pausedAtOk = au.sePaused; }
    if (MUT !== 'late') rs.pauseRequest(r, () => marked++); else if (r === 'restart') marked++; } });
let pausedAtOk = null;
if (!pause) { console.log('SKIPPED: setupPause returned null'); process.exit(0); }
const o = { renderer: { render() {} }, cx: 0, cy: 0, x0: 0, y0: 0, kx: 1, ky: 1, w: 640, h: 448 };
const frame = () => { t += 20; ctx.currentTime = t / 1000; output.hud(o); if (au.eventSe) au.eventSe.pump(); slots.pump(); };
const key = (code) => handler({ code, repeat: false, target: { tagName: 'BODY' }, preventDefault() {}, stopImmediatePropagation() {} });
const until = (f, n = 400) => { for (let i = 0; i < n; i++) { if (f()) return true; frame(); } return f(); };

// the sounds playing when the player pauses: a flag-0 one-shot (50017) and an event SE (asj_154, flag 0), both held by command 6
for (let i = 0; i < 5; i++) frame();
au.playId(50017, 0x7f, 0x40); const p1 = au.playing.at(-1);
sendEventSe({ sePending: [{ name: 'asj_154', vol: 127, rel: true }] }, au);
const s1 = au.eventSe.live.at(-1);
for (let i = 0; i < 5; i++) frame();
key('Enter');
const F = pause.flow;
ok(until(() => { const s = F.screen; return s && s.cur === s.total && s.hasFocus && s.focus.id === 3; }), 'pause menu open, Restart focused');
ok(au.sePaused && p1.held !== false && p1.held !== undefined && au.eventSe.paused, 'command 6 holds the one-shot and the event SE');
key('Space');
ok(until(() => !!F.box && F.box.cur === F.box.total), 'the confirm box is up');
key('ArrowLeft');
ok(until(() => F.box.focus.id === 6), 'the box cursor on OK');
for (let i = 0; i < 3; i++) frame();
const n0 = ctx.started.length;
key('Space');                                       // OK: onRequest('restart') (0x23), then the menu's unpause
for (let i = 0; i < 60; i++) frame();
if (MUT === 'late') rs.reload();                   // the mutant: 0x23 only in restart() after the menu closed (the old wiring)
const after = ctx.started.slice(n0);
ok(keepAtOk !== null && !!pausedAtOk && !au.sePaused, 'OK: the Restart request sent while the SEs are still held, then the pause closed');
ok(p1.stop && p1.stop.silent && !au.playing.includes(p1) && !after.some(c => c.buffer === p1.buf),
  'the held one-shot 50017 stays silent after the menu (0x23 at the OK, before the unpause)');
ok(s1.silent && !au.eventSe.live.includes(s1) && !after.some(c => s1.srcs.some(e => e.src === c)), 'the held event SE asj_154 stays silent');
// the keep list at the OK: the menu queue's entry 0 = the last menu sound (the box cursor), the count reset every frame
ok(keepAtOk && playedBefore != null && keepAtOk[0] === ((playedBefore << 16) >> 16), `keep list at the OK ${JSON.stringify(keepAtOk)}: entry 0 is the frame's last menu sound (${playedBefore}; menu sounds ${JSON.stringify(menuPlays)})`);

ok(marked === 1 && rs.sent, 'pauseRequest: the restart flags set once, 0x23 sent');
ok(sl.stream.rd.tracks.every(k => !k.active) && !slots.slots.size, 'the placed sound asj_030 (SlotStreams) ended at the OK, its slot freed');
// between the OK and restart(): a new SE (a flag-0 one-shot) is not ended by restart(): 0x23 goes once per Restart
au.seBlock1(au.zoneCode);
au.playId(au.se.names.bsj_063.id, 0x7f, 0x40); const p2 = au.playing.at(-1);
frame();
rs.reload();                                        // play.js musicRestart -> seRestart.reload()
ok(!p2.stop && au.playing.includes(p2) && !rs.sent, 'restart() after the OK: no second 0x23 (an SE started since plays on)');
// the game over's Restart (no OK): restart() sends it
au.playId(au.se.names.bsj_063.id, 0x7f, 0x40); const p3 = au.playing.at(-1);
frame();
rs.reload();
ok(p3.stop && p3.stop.end, 'the game over\'s Restart: restart() sends the 0x23 (the one-shot ends)');

console.log((fails ? 'FAILED ' : 'ok ') + oks + ' passed, ' + fails + ' failed' + (MUT ? ' (mutant ' + MUT + ')' : ''));
process.exit(fails ? 1 : 0);
