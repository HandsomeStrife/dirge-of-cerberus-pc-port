// test_event_se.mjs -- the events' own sound effects (worker 0266; notes/story-cutscenes.md 'Event sounds').
//   node --import ./native/web/test_hooks.mjs native/web/test_event_se.mjs
// Needs data/event/ev0100_stage.json and data/audio (tools/audio/extract.py: se_z128.json, se_ev100.json, wave0000).
// A player's path through main: an event plays, its loadSoundEffectEx_l(0, 100) puts the event block 0x0c064800 in SE block
// slot 1, its setSoundEffect calls find their programs there and play to their end, its (1, 100) brings the zone's block back;
// wro_kaisetu's loops stop on unsetSoundEffect and its playBgSound opens a placed-sound entry that the next event releases.
// MUTATE=block|restore|unset|aheadfade|pausehold|holdrender|fromstart|bgpos|release|pause|pipe|skippipe|resume|pausedecode|twice|cachekey|relstop|relnow|offset20|slotfade|restartcut|restartone|restartfade|skipse|bothstops|skipslots|nokeyoff|nokeyon|no40|nokeep|heldtail|heldtailev runs one mutant of the modules in a scratch copy.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUT = process.env.MUTATE;
let fails = 0, oks = 0;
const ok = (c, m) => { if (c) oks++; else { fails++; console.log('FAIL ' + m); } };
const A = (f) => path.join(HERE, 'data/audio', f);
for (const f of ['data/event/ev0100_stage.json', 'data/audio/se_ev100.json', 'data/audio/se_z128.json', 'data/audio/wave0000.bin']) {
  if (!fs.existsSync(path.join(HERE, f))) { console.log('SKIP: no ' + f); process.exit(0); }
}
const data = JSON.parse(fs.readFileSync(path.join(HERE, 'data/event/ev0100_stage.json')));

let base = HERE;
if (MUT) {
  const SUB = {
    block: ['audio.js', 'const b1 = this.block1 || this.se;', 'const b1 = this.se;'],
    restore: ['event_sound.js', 'else if (a === 1) code = zoneCode ?? null;', 'else if (a === 1) code = null;'],
    unset: ['event_sound.js', 'if (s.stop20) this.fadeHeard(s);', ''],
    aheadfade: ['event_sound.js', 'if (s.stop20) this.fadeHeard(s);', 'if (s.stop20) s.stream.rd.stopFade(10);'],
    pausehold: ['event_sound.js', 'while (pend.length && pend[0] <= st.t) { pend.shift(); st.rd.holdVoices(); }', ''],
    holdrender: ['event_sound.js', 's.holdTicks.push(!c ? s.stream.t : c.at <= now ? c.snap.t + Math.floor((now - c.at) * TICK_HZ) : c.snap.t);', 's.holdTicks.push(s.stream.t);'],
    fromstart: ['event_sound.js', 'st.rd.restore(c.snap.rd); st.t = c.snap.t; st.done = c.snap.done;', ''],
    bgpos: ['ambient.js', 'if (Math.hypot(pos[0], pos[1], pos[2]) === 0) flags |= 0x8000;', ''],
    release: ['stage_controller.js', 'if (bg && bg.releaseAll) bg.releaseAll();', ''],
    pause: ['audio.js', 'if (this.eventSe) this.eventSe.setPaused(on);', ''],
    pipe: ['event_sound.js', 'const at = ring.heard(b);', 'const at = ctx.currentTime;'],
    skippipe: ['event_sound.js', 'const ctx = this.au && this.au.ctx, end = ctx ? pcmRing(ctx).heard(pcmRing(ctx).blockAt(ctx.currentTime)) : 0;', 'const ctx = this.au && this.au.ctx, end = 0;'],
    resume: ['event_sound.js', 'else this.start(rec, ring.blockAt(now)); }', 'else { rec.skipped = false; this.start(rec, ring.blockAt(now)); } }'],
    pausedecode: ['event_sound.js', 'if (this.paused) return;                       // held', '// held'],
    twice: ['event_sound.js', 'for (const o of this.playing.filter((x) => x.name === name)) {', 'for (const o of []) {'],
    cachekey: ['audio.js', 'const key = `${hex}:', 'const key = `${id}:'],
    relstop: ['event_sound.js', 'if (s.stop10000 && s.sentFrame < this.frameNo) { s.stop10000 = false; this.fadeHeard(s); }', ';'],
    relnow: ['event_sound.js', '    this.live.push(s);\n', '    this.live.push(s); if (s.stop10000) { s.stop10000 = false; this.fadeHeard(s); }\n'],
    offset20: ['event_sound.js', 'next: au.ctx.currentTime,   // sent now', 'next: au.ctx.currentTime + 0.02,   // sent now'],
    restartcut: ['audio.js', 'if (this.eventSe) this.eventSe.endAll(keep);', 'if (this.eventSe) this.eventSe.stopAll();'],
    skipse: ['event_sound.js', 'if (au && au.skipSe) au.skipSe();', ''],
    restartone: ['audio.js', 'if (!keep.includes(p.id)) this.fade(p, 10, true);', 'if (!keep.includes(p.id)) this.fade(p, 10);'],
    nokeyoff: ['audio.js', '      trk.active = false; ended.push(trk);\n      for (const v of trk.voices) this.keyOff(v);', '      trk.active = false; ended.push(trk);'],
    bothstops: ['audio.js', 'const out = rd.render(p.prog, p.vol, p.pan, 8, p.holds || [], p.stops);', 'const out = rd.render(p.prog, p.vol, p.pan, 8, p.holds || [], p.stop);'],
    skipslots: ['audio.js', '    if (this.slotStreams) this.slotStreams.endAll(keep, false);\n', ''],
    nokeyon: ['audio.js', '    this.keyOnQueue = this.keyOnQueue.filter((k) => !ended.includes(k.trk));\n', ''],
    no40: ['audio.js', 'if (!this.tracks || (this.prog[4] & 0x40)) return;', 'if (!this.tracks) return;'],
    nokeep: ['audio.js', 'for (const p of this.playing || []) if (!keep.includes(p.id)) this.fade(p, 10, true);', 'for (const p of this.playing || []) this.fade(p, 10, true);'],
    heldtail: ['audio.js', 'if (end && held && !(p.prog[4] & 0x40)) {', 'if (false) {'],
    heldtailev: ['event_sound.js', '    if (end && held) {\n      for (const x of s.srcs)', '    if (false) {\n      for (const x of s.srcs)'],
    restartfade: ['event_sound.js', 'if (end) st.rd.endNow(); else st.rd.stopFade(10);', 'st.rd.stopFade(10);'],
    slotfade: ['ambient.js', 'if (s.flags & 0x20) { this.fadeHeard(s); s.closing = true;', 'if (s.flags & 0x20) { s.stream.rd.stopFade(10); s.closing = true;'],
  }[MUT];
  if (!SUB) throw new Error('unknown mutant ' + MUT);
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-evse-'));
  for (const f of fs.readdirSync(HERE)) if (f.endsWith('.js')) fs.copyFileSync(path.join(HERE, f), path.join(base, f));
  const p = path.join(base, SUB[0]), s = fs.readFileSync(p, 'utf8');
  if (!s.includes(SUB[1])) throw new Error('mutant does not apply: ' + SUB[1]);
  fs.writeFileSync(p, s.replace(SUB[1], SUB[2]));
}
const imp = (f) => import(pathToFileURL(path.join(base, f)));
const { createStageController } = await imp('stage_controller.js');
const { AreaStream } = await imp('area_stream.js');
const { EventActors } = await imp('event_actor_rt.js');
const { GameAudio, emitterVolPan, hexBytes, SeRenderer } = await imp('audio.js');
const { SeStream } = await imp('music.js');
const { PlacedSounds, SlotStreams } = await imp('ambient.js');
const { createEventWindows } = await imp('event_window.js');
const { loadPauseData } = await imp('pause.js');
const { loadStageInfoData } = await imp('stage_info.js');

// A stand-in AudioContext: buffers and sources are recorded, the clock is moved by the test (no sound is made)
class FakeCtx {
  constructor() { this.currentTime = 0; this.started = []; this.state = 'running'; this.destination = {}; }
  createBuffer(ch, n, rate) { const d = [new Float32Array(n), new Float32Array(n)]; return { duration: n / rate, length: n, copyToChannel: (a, c) => d[c].set(a), d }; }
  createBufferSource() { const s = { buffer: null, connect() {}, start: (at, off = 0) => { s.at = at; s.off = off; this.started.push(s); }, stop: () => { s.stopped = this.currentTime; } }; return s; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
}
function gameAudio(ctx) {
  const G = new GameAudio();
  const j = (f) => JSON.parse(fs.readFileSync(A(f)));
  const w = j('wave0000.json');
  G.drv = j('driver.json'); G.se = j('se_z128.json'); G.res = fs.existsSync(A('se_res.json')) ? j('se_res.json') : null;
  const ev = j('se_ev100.json');
  G.evBlocks = { [ev.code]: ev }; G.zoneCode = 0x6800005; G.block1 = null;
  G.banks = { 0: { instruments: w.instruments, data: new Uint8Array(fs.readFileSync(A('wave0000.bin'))) } };
  G.renderers = {};
  G.ctx = ctx;
  return G;
}
const Gz = (o) => { const g = new Uint8Array(64); for (const k in o) g[k] = o[k]; return g; };
function make(v, globalFlags, au, bg, windows = null) {
  const stream = new AreaStream([], [6, 7]);
  const c = createStageController({ data, warn: () => {}, flags: () => v, stream: () => stream, globalFlags, windows,
    actors: new EventActors({ clipFrames: () => 10, warn: () => {} }), onSceneSave: () => {},
    sound: { audio: () => au, bg: () => bg },
    battleObject: n => ({ tag: n, matrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], lend() {}, show() {}, release() {}, place() {} }) });
  const run = (n, stop) => { for (let f = 0; f < n && !c.done; f++) { stream.progress(); c.tick(20); if (stop && stop()) return true; } return false; };
  return { c, R: c.rt, run };
}

// 1. A player steps on trigger 18 (stage 0 = 20): first_encounter plays out. Its eight SEs asj_154 .. asj_161 (ids 50026 ..)
// are programs of the event block, not of the zone's: every one is found and played; the zone's block is back after it.
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  const S = make({ 0: 20, 1: 8 }, Gz({ 0: 1, 1: 21 }), au, null);
  const sent = [], blocks = [];
  let inEvent = false;
  S.run(6000, () => {
    if (S.R.seSent) { sent.push(...S.R.seSent); S.R.seSent = null; }
    const now = S.R.vm.frames.some(F => F.m.name === 'first_encounter');
    if (now && !inEvent) blocks.push(['start', au.block1 ? au.block1.code : 'zone']);
    if (now) blocks.push(['in', au.block1 ? au.block1.code : 'zone']);
    inEvent = now;
    return S.R.gflags[1] === 22 && S.R.battle;
  });
  const names = sent.map(e => e.name);
  ok(['asj_154', 'asj_155', 'asj_156', 'asj_157', 'asj_158', 'asj_159', 'asj_160', 'asj_161'].every(n => names.includes(n)), 'first_encounter sends asj_154 .. 161: ' + names.join());
  ok(sent.length && sent.every(e => e.found), 'every first_encounter SE is found in the SE blocks: ' + sent.filter(e => !e.found).map(e => e.name).join());
  ok(blocks.some(([, c]) => c === 0xc064800), 'slot 1 holds the event block 0x0c064800 inside first_encounter');
  ok(au.block1 === null, 'the zone\'s block is back in slot 1 after it (loadSoundEffectEx_l(1, 100))');
  ok(au.program(50026) === null, 'after the event the event-only program 50026 (asj_154) is not found');
  ok(au.program(au.se.names.bsj_063 ? au.se.names.bsj_063.id : -1) !== null || !au.se.names.bsj_063, 'a zone SE (bsj_063) is found again');
  const ES = au.eventSe;
  ok(ES && ES.log.length === sent.length, 'each sent SE opened an event SE stream: ' + (ES ? ES.log.length : 0) + ' / ' + sent.length);
  ok(ES && ES.log.every(x => !x.kept), 'setSoundEffect releases its slot at once (release 1): the SEs play to their end');
  ok(ctx.started.length > 20, 'the streams were scheduled: ' + ctx.started.length + ' chunks');
  if (ES) ES.stopAll();
}

// 2. EventSeSlots directly: a kept loop (setSoundEffectLoop asj_335, row bit 3) fades and ends on unsetSoundEffect; a one-shot
// (asj_334) runs to its end; the pause holds the streams and the resume plays the unheard chunk from where it stopped.
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  const R = { sePending: [] };
  au.seBlock1(0xc064800);
  const { sendEventSe } = await imp('event_sound.js');
  R.sePending.push({ name: 'asj_335', vol: 127, rel: false }, { name: 'asj_334', vol: 127, rel: true });
  sendEventSe(R, au);
  const ES = au.eventSe, loop = ES.live.find(s => s.name === 'asj_335'), one = ES.live.find(s => s.name === 'asj_334');
  ok(loop && loop.kept && loop.stop20, 'asj_335 (setSoundEffectLoop): a kept slot with row bit 3');
  ok(one && !one.kept, 'asj_334 (setSoundEffect): released at once');
  const step = (s) => { for (let t = 0; t < s * 40; t++) { ctx.currentTime += 0.025; ES.pump(); } };
  step(4);
  ok(one.stream.done, 'asj_334 (2.7 s) ended by itself');
  ok(!loop.stream.done, 'asj_335 is still playing after 4 s (an endless program)');
  // the pause: chunks not yet heard are stopped and kept; no new chunk is rendered while held
  const before = ctx.started.length;
  au.setPaused(true);
  ok(loop.queue.length > 0 && loop.srcs.length === 0, 'the pause holds asj_335: its unheard chunks are kept (' + loop.queue.length + ')');
  step(1);
  ok(ctx.started.length === before, 'nothing new is scheduled while paused');
  au.setPaused(false);
  ok(loop.queue.length === 0 && ctx.started.length > before, 'the resume plays the kept chunks again');
  // the stop reaches the tick being heard (not the render point, EV_AHEAD_S ahead): mid-tick, the stream is rendered again to it
  ctx.currentTime += 0.0021;
  const now = ctx.currentTime, cur = loop.srcs.find(c => c.at <= now && now < c.end), x = (now - cur.at) * 240, H = cur.snap.t + Math.floor(x);
  const n0 = ctx.started.length, ahead = loop.stream.t - H;
  ES.unset('asj_335');
  const nw = ctx.started[n0], k = (H - cur.snap.t) * 200, same = nw && [0, 1].every(c => nw.buffer.d[c].slice(0, 200).every((v, i) => v === cur.buf.d[c][k + i]));
  ok(nw && nw.at === now && Math.abs(nw.off - (x - Math.floor(x)) / 240) < 1e-9 && cur.src.stopped === now, `the chunks past the heard point are replaced: the new one from now, tick ${H} + ${(x % 1).toFixed(2)} (render point was ${ahead} ticks ahead)`);
  ok(same, 'the re-render (from the chunk\'s snapshot, after the pause\'s hold) is the heard sound up to the stop tick');
  step(1);
  ok(loop.stream.done, 'unsetSoundEffect(asj_335) fades it out and ends it (request 0x12)');
  // the fade is 16 sequence ticks (tempo-dependent in driver ticks): a stream faded at H on its own ends where this one does
  const ref = new SeStream(...loop.args); ref.ticks(H); ref.rd.stopFade(10); while (!ref.done) ref.ticks(1);
  ok(Math.abs(loop.stream.t - ref.t) <= 12, `it ends where a stream faded at the heard tick ${H} ends (${loop.stream.t} vs ${ref.t}, one chunk)`);
}

// 2b. unsetSoundEffect during the event pause: asj_335 paused at 0.40 s (a voice in decay). The game holds the track at the tick
// heard at the pause (IOP command 6) and the fade starts there; on the resume the page plays the held, fading stream from that
// tick. Reference: a stream of its own, held and faded at the heard tick. And the rebuild is cheap after a long run (it replays
// one chunk from its snapshot, not the stream from its start).
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  au.seBlock1(0xc064800);
  const { sendEventSe } = await imp('event_sound.js');
  sendEventSe({ sePending: [{ name: 'asj_335', vol: 127, rel: false }] }, au);
  const ES = au.eventSe, loop = ES.live.find(s => s.name === 'asj_335');
  const t0 = loop.srcs[0].at + 0.2;                 // worker 0271: from the stream's start (was loop.next after the pump)
  while (ctx.currentTime < t0 + 0.40) { ctx.currentTime += 0.025; ES.pump(); }
  ctx.currentTime = t0 + 0.4021;
  au.setPaused(true);
  const q = loop.queue[0], H = q.snap.t + Math.floor(q.off * 240);
  ctx.currentTime += 1; ES.unset('asj_335');
  const n0 = ctx.started.length;
  ctx.currentTime += 1; au.setPaused(false);
  for (let i = 0; i < 12; i++) { ctx.currentTime += 0.025; ES.pump(); }
  const got = [[], []]; for (const c of ctx.started.slice(n0)) for (const ch of [0, 1]) got[ch].push(...c.buffer.d[ch].slice(Math.round(c.off * 48000)));
  const ref = new SeStream(...loop.args); ref.ticks(H);
  const decaying = ref.rd.holdVoices(true);
  ref.rd.holdVoices(); ref.rd.stopFade(10);
  const want = ref.ticks(60), n = 60 * 200;
  let diff = 0; for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs((got[0][i] ?? 9) - want.left[i]), Math.abs((got[1][i] ?? 9) - want.right[i]));
  ok(decaying && diff === 0, `paused at 0.40 s (tick ${H}, a voice in decay: ${decaying}), unset, resumed: held and faded at the heard tick (max diff ${diff} over 60 ticks)`);
  // pause (a voice in decay), resume, unset 2 ms later while a chunk rendered before the pause plays: its snapshot has no hold, so
  // the replay holds at the pause's heard tick P; the sound from the stop tick on = a stream held at P and faded at H
  {
    sendEventSe({ sePending: [{ name: 'asj_335', vol: 127, rel: false }] }, au);
    const l3 = ES.live.at(-1), s0 = l3.srcs[0].at + 0.2;   // worker 0271: from the stream's start (l3.next after the pump depends on float noise)
    while (ctx.currentTime < s0 + 0.40) { ctx.currentTime += 0.025; ES.pump(); }
    ctx.currentTime = s0 + 0.4021;
    au.setPaused(true);
    const P = l3.holdTicks.at(-1);
    ctx.currentTime += 1; au.setPaused(false);
    ctx.currentTime += 0.006;                        // 1.4 ticks on
    const now = ctx.currentTime, cur = l3.srcs.find(c => c.at <= now && now < c.end), x = (now - cur.at) * 240, H2 = cur.snap.t + Math.floor(x);
    const m0 = ctx.started.length;
    ES.unset('asj_335');
    for (let i = 0; i < 12; i++) { ctx.currentTime += 0.025; ES.pump(); }
    const g = [[], []]; for (const c of ctx.started.slice(m0).filter(c => l3.srcs.some(e => e.src === c) || c.at >= now)) for (const ch of [0, 1]) g[ch].push(...c.buffer.d[ch].slice(Math.round(c.off * 48000)));
    const r2 = new SeStream(...l3.args); r2.ticks(P); const dec2 = r2.rd.holdVoices(true); r2.rd.holdVoices(); r2.ticks(Math.max(0, H2 - P)); r2.rd.stopFade(10);
    const nh = new SeStream(...l3.args); nh.ticks(H2); nh.rd.stopFade(10);
    const w2 = r2.ticks(61), wn = nh.ticks(61), o = Math.round((x % 1) * 200);
    let d2 = 0, dn = 0; for (let i = 0; i < 60 * 200; i++) for (const [ch, a, b] of [[0, w2.left, wn.left], [1, w2.right, wn.right]]) {
      d2 = Math.max(d2, Math.abs((g[ch][i] ?? 0) - a[i + o])); dn = Math.max(dn, Math.abs((g[ch][i] ?? 0) - b[i + o])); }
    ok(g[0].length > 30 * 200 && cur.snap.nHolds === 0 && dec2 && P < H2 && d2 === 0 && dn > 0, `resumed, unset at tick ${H2} in a pre-pause chunk: held at the pause's tick ${P} (decay ${dec2}), then faded (diff ${d2}; vs no hold ${dn.toFixed(4)}; ${(g[0].length / 200).toFixed(1)} ticks heard)`);
  }
  // a long run: the unset replays at most one chunk from its snapshot (counted, not timed)
  sendEventSe({ sePending: [{ name: 'asj_335', vol: 127, rel: false }] }, au);
  const l2 = ES.live.at(-1);
  for (let i = 0; i < 60 * 40; i++) { ctx.currentTime += 0.025; ES.pump(); }
  ES.unset('asj_335');
  ok(!l2.kept && l2.stream.t < 61 * 240 && l2.replayed >= 0 && l2.replayed <= 12, `unset after a 60 s loop replays ${l2.replayed} ticks (from the chunk's snapshot, at most one chunk)`);
}

// 3. wro_kaisetu (stage 1 = 32): its loops are set and unset, the event ends with the zone's block and playBgSound(asj_030, 48):
// one placed-sound entry with no position (pan 0x40) and its fixed volume 48; the next event start releases it.
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  const slots = new SlotStreams(au, { emitterVolPan, SeStream, hexBytes });
  const bg = new PlacedSounds({ objects: [] }, slots);
  const v = { 0: 24, 1: 32 }, g = Gz({ 0: 1, 1: 25 });
  const dir = path.join(HERE, 'data');
  const D = fs.existsSync(path.join(dir, 'pause.json')) ? loadStageInfoData(JSON.parse(fs.readFileSync(path.join(dir, 'stage_info.json'))), loadPauseData(JSON.parse(fs.readFileSync(path.join(dir, 'pause.json'))))) : null;
  const W = createEventWindows({ D, warn: () => {}, se: () => {} });
  const S = make(v, g, au, bg, W);
  let opened = null, wait = 0, pressed = false;
  const sent = [];
  S.run(20000, () => {
    if (S.R.seSent) { sent.push(...S.R.seSent); S.R.seSent = null; }
    if (!opened && bg.table.some(Boolean)) opened = { names: bg.playingNames(), block: au.block1, slot: [...slots.slots.values()][0] };
    // the choice box: ✕ on its first row ('Nothing') ends the talk (test_story_cutscenes.mjs 8)
    const e = W.entries.find(x => x.id > 0 && x.kind === 27 && x.box && x.box.box);
    if (!pressed && e && e.box.box.result === 0 && !(e.box.box.flags & 0x30) && ++wait > 5) { W.choiceKey('cross'); pressed = true; }
    return g[1] === 26 && opened;
  });
  const log = S.R.log.map(x => x[1]);
  ok(log.includes('unset asj_335'), 'wro_kaisetu unsets its loops');
  ok(log.includes('bgsound asj_030 48'), 'wro_kaisetu ends with playBgSound(asj_030, 48): ' + log.filter(m => /bgsound|sebank/.test(m)).join());
  ok(opened && opened.names.join() === 'asj_030' && opened.block === null, 'one table entry asj_030, opened with the zone\'s block back');
  if (opened && opened.slot) {
    const { vol, pan } = emitterVolPan(opened.slot, { pos: [500, 0, 300], fwd: [0, 0, 1], alt: [500, 0, 300] });
    ok(vol === 48 && pan === 0x40, 'its volume is fixed at 48 and it has no pan (zero position): vol ' + vol + ' pan ' + pan);
    ok(!!au.program(opened.slot.id), 'asj_030 (id ' + opened.slot.id + ') is a program of the zone\'s block');
  } else ok(false, 'no slot opened for asj_030');
  const loops = (au.eventSe ? au.eventSe.log : []).filter(x => x.kept).map(x => x.name);
  ok(loops.includes('asj_335'), 'its setSoundEffectLoop (asj_335, the talk\'s loop on this path) opened a kept slot: ' + loops.join());
  ok(!au.eventSe || au.eventSe.live.every(s => !s.kept), 'no loop is still held after the event (all unset)');
  // the next event start (FUN_0037e048 with bit 0 clear) releases the table
  S.R.enterEvent(0);
  ok(!bg.table.some(Boolean), 'the next event\'s start releases the entry (FUN_003e6538)');
  if (au.eventSe) au.eventSe.stopAll();
}

// 3b. The same SE id names another program in the event's block (10011, 50017, 51020): a gameplay sound played during the
// event must not reuse the zone program's rendered buffer (audio.js's render cache)
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  au.renderers[0] = new SeRenderer(au.drv, au.banks[0]);
  const ids = ['10011', '50017', '51020'].filter((k) => au.se.programs[k] && au.evBlocks[0xc064800].programs[k] && au.se.programs[k] !== au.evBlocks[0xc064800].programs[k]);
  const k = +ids[0], r0 = au.renderers[0].rngIndex;
  au.playId(k, 0x7f, 0x40); const a = au.playing && au.playing[au.playing.length - 1];
  au.seBlock1(0xc064800); au.renderers[0].rngIndex = r0;
  au.playId(k, 0x7f, 0x40); const b = au.playing && au.playing[au.playing.length - 1];
  ok(ids.length > 0 && a && b && a.prog !== b.prog && a.buf !== b.buf, 'id ' + k + ' in the event block: its own render, not the zone program\'s cached one');
  au.seBlock1(au.zoneCode);
}

// 4. A voice line (playVoice) through the PCM ring (pcm_ring.js; its trace checks: test_voice_ring.mjs): the first block mixed
// after the call holds the offset-0 frame, sample 0 is heard with the next one; the mouths start at once. A Skip stops the
// channels but what was mixed plays on to the end of its last block (worker 0271; was a 480 ms constant, worker 0266).
{
  const { VoicePlayer } = await imp('event_sound.js');
  const { pcmRing } = await imp('pcm_ring.js');
  const made = [];
  const ctx = { currentTime: 5, decodeAudioData: async () => ({ duration: 1.5 }), createGain: () => ({ gain: {}, connect() {} }),
    createBufferSource() { const n = { connect() {}, start(t, o) { n.at = t; n.off = o; made.push(n); }, stop(t) { n.stop = t; } }; return n; } };
  const ring = pcmRing(ctx), H = (t) => ring.heard(ring.blockAt(t));
  const V = new VoicePlayer({ ctx }); V.out = {}; V.meta = {}; V.ready = Promise.resolve(V);
  V.bufs.set('10110sk', { file: Promise.resolve(new ArrayBuffer(4)), buf: null });
  V.play('10110sk');
  await new Promise(r => setTimeout(r, 5));
  const d = made[0] && made[0].at - 5;
  ok(made.length === 1 && made[0].at === ring.heard(ring.blockAt(5) + 1) && made[0].off === 0 && d > 0.45 && d < 0.53, 'playVoice at t 5: heard from the second block mixed after it, ' + (d * 1000).toFixed(1) + ' ms on, offset 0');
  ctx.currentTime = 5.2; V.stopAll();
  ok(made[0].stop === H(5.2) && made[0].stop > 5.6, 'Skip at t 5.2: the mixed blocks play on (stop at ' + made[0].stop.toFixed(4) + ')');
  // a decode slower than the ring: the channel had no data (FUN_003eab20 returns before moving), so it starts later from 0
  const V2 = new VoicePlayer({ ctx }); V2.out = {};
  let release; V2.bufs.set('x', { file: new Promise(r => { release = r; }), buf: null });
  ctx.currentTime = 10; V2.play('x'); ctx.currentTime = 10.6; release(new ArrayBuffer(4));
  await new Promise(r => setTimeout(r, 5));
  ok(made.length === 2 && made[1].at === ring.heard(ring.blockAt(10.6) + 1) && made[1].off === 0, 'a late decode starts later from its beginning: ' + JSON.stringify([made[1].at, made[1].off]));
  // the event pause (FUN_003ea9f0 / FUN_003eaa78): what was mixed plays out, the resume goes on at the next block mixed
  made.length = 0;
  const V3 = new VoicePlayer({ ctx }); V3.out = {};
  V3.bufs.set('y', { file: Promise.resolve(new ArrayBuffer(4)), buf: null });
  ctx.currentTime = 20; V3.play('y'); await new Promise(r => setTimeout(r, 5));
  const b0 = ring.blockAt(20) + 1;
  ctx.currentTime = 20.8; V3.pause(true);
  const bp = ring.blockAt(20.8), off = (bp - b0) * 1024 / 48000;
  ok(made[0].stop === ring.heard(bp) && Math.abs(V3.playing[0].off - off) < 1e-9, 'pause 0.8 s after playVoice: heard to the end of the last mixed block, ' + (bp - b0) + ' blocks in');
  ctx.currentTime = 30; V3.pause(false);
  ok(made.length === 2 && made[1].at === H(30) && Math.abs(made[1].off - off) < 1e-9, 'resume at 30: from the next block mixed, at that offset: ' + JSON.stringify([made[1].at, made[1].off]));
  // a voice that finishes decoding during the pause: nothing mixed (no data, then held); after the resume the offset-0 frame first
  made.length = 0;
  const V4 = new VoicePlayer({ ctx }); V4.out = {};
  let rel4; V4.bufs.set('z', { file: new Promise(r => { rel4 = r; }), buf: null });
  ctx.currentTime = 40; V4.play('z'); ctx.currentTime = 40.1; V4.pause(true); ctx.currentTime = 41; rel4(new ArrayBuffer(4));
  await new Promise(r => setTimeout(r, 5));
  ok(made.length === 0 && V4.playing.length === 1, 'decoded during the pause: nothing started');
  ctx.currentTime = 42; V4.pause(false);
  ok(made.length === 1 && made[0].at === ring.heard(ring.blockAt(42) + 1) && made[0].off === 0, 'resumed: from offset 0 after the offset-0 block: ' + JSON.stringify([made[0].at, made[0].off]));
  // playVoice again on the same name: the one channel restarts (FUN_003eaf10 -> FUN_003ead30); the old mix is heard until then
  made.length = 0;
  const V5 = new VoicePlayer({ ctx }); V5.out = {};
  V5.bufs.set('w', { file: Promise.resolve(new ArrayBuffer(4)), buf: null });
  ctx.currentTime = 50; V5.play('w'); await new Promise(r => setTimeout(r, 5));
  ctx.currentTime = 50.4; V5.play('w'); await new Promise(r => setTimeout(r, 5));
  ok(made.length === 2 && made[0].stop === H(50.4) && V5.playing.length === 1 && made[1].at === ring.heard(ring.blockAt(50.4) + 1),
    'the second playVoice: the old mix to the end of its last block, the new one a block later: ' + made[0].stop + ', ' + V5.playing.length + ' playing');
}

// 5. setSoundEffect (release != 0) on a row with bit 3 (slot 0x20): FUN_003e8ff8 -> FUN_003e9830 finds the slot not sent and sets
// 0x10000; FUN_003e9ed0 sends it, and on the next frame (its voice handle back: FUN_003e80d8 -> FUN_003e8970) FUN_003e9830 sends
// the stop request: the SE fades from the tick heard one frame after its start. No z128 event does this (worker 0271's scan of
// ev0100's 181 setSoundEffect* calls: the bit-3 rows are wro_kaisetu's loops asj_335 .. 339), so asj_335 stands in, released.
// A released row without bit 3 (asj_154) plays to its end.
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  au.seBlock1(0xc064800);
  const { sendEventSe, eventSeFrame } = await imp('event_sound.js');
  ctx.currentTime = 3;
  eventSeFrame(au);                                  // frame f: FUN_003e9ed0 (nothing yet), then the sends
  sendEventSe({ sePending: [{ name: 'asj_335', vol: 127, rel: true }] }, au);
  const ES = au.eventSe, s = ES.live.find(x => x.name === 'asj_335');
  ok(s && s.srcs[0].at === 3, 'the released asj_335 is sent and heard from now (no 20 ms offset): ' + (s && s.srcs[0].at));
  const n0 = ctx.started.length;
  ctx.currentTime = 3.02; eventSeFrame(au);         // frame f + 1: its 0x10000 -> the stop request at the heard tick
  const h = Math.floor(0.02 * 240);
  for (let i = 0; i < 40; i++) { ctx.currentTime += 0.025; ES.pump(); }
  // what is heard from 3.02 on (0.8 of tick 4 in): a stream faded at tick 4, from that sample
  const got = [[], []], o = Math.round((0.02 * 240 - h) * 200);
  const ref = new SeStream(...s.args); ref.ticks(h); ref.rd.stopFade(10); const post = ref.ticks(80);
  const later = ctx.started.slice(n0).filter(c => c.at >= 3.02 - 1e-9);
  for (const c of later) for (const ch of [0, 1]) got[ch].push(...c.buffer.d[ch].slice(Math.round(c.off * 48000)));
  // the fade ends the track (stopFade: 16 sequence ticks): the heard part is compared up to its end, and the reference is silent after it
  const n = got[0].length;
  let diff = 0; for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(got[0][i] - post.left[i + o]), Math.abs(got[1][i] - post.right[i + o]));
  let rest = 0; for (let i = n + o; i < post.left.length; i++) rest = Math.max(rest, Math.abs(post.left[i]), Math.abs(post.right[i]));
  ok(s.replayed === h && n > 10 * 200 && diff === 0 && rest === 0, `the stop request one frame after the start: faded at tick ${h} (replayed ${s.replayed}; ${(n / 200).toFixed(1)} ticks heard after it, max diff ${diff} vs a stream faded there, then silent)`);
  const c2 = new FakeCtx(), a2 = gameAudio(c2);
  a2.seBlock1(0xc064800); a2.eventSe = null;
  eventSeFrame(a2); sendEventSe({ sePending: [{ name: 'asj_154', vol: 127, rel: true }] }, a2);
  const k = a2.eventSe.live.find(x => x.name === 'asj_154');
  c2.currentTime = 0.02; eventSeFrame(a2);
  ok(k && !k.stop10000 && k.replayed === undefined && !a2.eventSe.live.some(x => x.stream.rd.tracks.some(t => t.fadeStop)), 'asj_154 (no bit 3), released: no stop request, it plays to its end');
}

// 6. A placed-sound slot's release (ambient.js SlotStreams.close: FUN_003e8ff8 -> FUN_003e9830, slot 0x20 -> request 0x12): the
// fade reaches the track at the tick being heard, not at the stream's render point 200 ms ahead (playBgSound's asj_030, released by
// the next event start; the EM barrier's hum). Reference: a stream of its own faded at the heard tick (worker 0271).
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  const slots = new SlotStreams(au, { emitterVolPan, SeStream, hexBytes });
  ctx.currentTime = 1;
  const hd = slots.open('asj_030', [0, 0, 0], 48);
  slots.update({ pos: [0, 0, 0, 1], fwd: [0, 0, 1], alt: [0, 0, 0], useAlt: false });
  const sl = slots.slots.get(hd);
  ok(sl && sl.srcs.length && sl.srcs[0].at === 1, 'asj_030 sent: heard from now (was + 20 ms)');
  while (ctx.currentTime < 1.35) { ctx.currentTime += 0.025; slots.pump(); }
  ctx.currentTime = 1.3712;
  const n0 = ctx.started.length;
  slots.close(hd);
  for (let i = 0; i < 40; i++) { ctx.currentTime += 0.025; slots.pump(); }
  const x = 0.3712 * 240, H = Math.floor(x), o = Math.round((x - H) * 200);
  const ref = new SeStream(...sl.args); ref.ticks(H); ref.rd.stopFade(10); const post = ref.ticks(200);
  const got = [[], []];
  for (const c of ctx.started.slice(n0)) for (const ch of [0, 1]) got[ch].push(...c.buffer.d[ch].slice(Math.round(c.off * 48000)));
  const n = got[0].length;
  let diff = 0; for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(got[0][i] - post.left[i + o]), Math.abs(got[1][i] - post.right[i + o]));
  let rest = 0; for (let i = n + o; i < post.left.length; i++) rest = Math.max(rest, Math.abs(post.left[i]), Math.abs(post.right[i]));
  ok(sl.replayed <= 12 && n > 10 * 200 && diff === 0 && rest === 0, `released at 0.3712 s: faded at the heard tick ${H} (replayed ${sl.replayed} ticks; ${(n / 200).toFixed(1)} ticks heard, max diff ${diff} vs a stream faded there, then silent)`);
}

// 7. The Restart (pause menu OK: FUN_003c0a20 -> FUN_00380b00 = FUN_003e7f60(-1, -1, -1) -> IOP command 0x23, irx FUN_0000cdf8 ->
// FUN_00007d90): every SE playing but the keep list (menu queue entries >= 0, 0x461 .. 0x463) and any program whose flag byte has
// 0x40 has its tracks ended (+0 = 0) and its voice keyed off (+0x70 |= 2, applied by FUN_000025ac on the next driver tick): it
// finishes its release. The menu is up, so the pause's IOP command 6 holds the flag-0 SEs (volume 0, pitch 0): FUN_00007620 puts
// back only their envelope and the resume skips their ended tracks: those go silent (worker 0271; review fixes).
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  au.seBlock1(0xc064800); au.eventSe = null; au.playing = []; au.slotStreams = null; au.menuQ = [0, 0, 0, 0];
  au.renderers[0] = new SeRenderer(au.drv, au.banks[0]);
  const { sendEventSe } = await imp('event_sound.js');
  // (a) not paused: a kept event loop (asj_335, flag byte 0x80: command 6 never holds it) ends at the heard tick with the key-off
  ctx.currentTime = 2;
  sendEventSe({ sePending: [{ name: 'asj_335', vol: 127, rel: false }] }, au);
  const ES = au.eventSe, s = ES.live.find(x => x.name === 'asj_335');
  while (ctx.currentTime < 2.5) { ctx.currentTime += 0.025; ES.pump(); }
  ctx.currentTime = 2.6123;
  const n0 = ctx.started.length;
  au.restartSe();
  for (let i = 0; i < 80; i++) { ctx.currentTime += 0.025; ES.pump(); }
  const x = 0.6123 * 240, H = Math.floor(x), o = Math.round((x - H) * 200);
  // the reference, from the decoded rule written out here: tracks off, every voice of them keyed off before tick H
  const ref = new SeStream(...s.args); ref.ticks(H);
  const before = ref.rd.voices.filter(v => v.phase !== 0).length;
  const off = ref.rd.tracks.filter(t => t.active);
  for (const t of off) { t.active = false; for (const v of t.voices) ref.rd.keyOffQueue.includes(v) || ref.rd.keyOffQueue.push(v); }
  ref.rd.keyOnQueue = ref.rd.keyOnQueue.filter(k => !off.includes(k.trk));   // irx 0x7ee4: +0x70 &= ~9 (the pending key-on)
  const one = ref.ticks(1), rel = ref.rd.voices.filter(v => v.phase !== 0).every(v => v.phase === 4);
  const post = ref.ticks(480);
  const want = [Float32Array.from([...one.left, ...post.left]), Float32Array.from([...one.right, ...post.right])];
  const got = [[], []];
  for (const c of ctx.started.slice(n0)) for (const ch of [0, 1]) got[ch].push(...c.buffer.d[ch].slice(Math.round(c.off * 48000)));
  const n = got[0].length;
  let diff = 0; for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(got[0][i] - want[0][i + o]), Math.abs(got[1][i] - want[1][i + o]));
  ok(before > 0 && rel && n > 0 && diff === 0 && s.stream.done, `Restart at 0.6123 s into asj_335: ${before} voices in release from tick ${H} (the key-off on the next driver tick), ${(n / 200).toFixed(1)} ticks heard, max diff ${diff} vs the rule`);
  // (b) kept: id 1123 (0x463, flag byte 0x18) and a flag-0x40 program (id 1, 0x59) play on; a flag-0 one-shot (50017) ends
  ctx.currentTime = 5;
  au.playId(1123, 0x7f, 0x40); const pk = au.playing.at(-1);
  au.playId(1, 0x7f, 0x40); const p40 = au.playing.at(-1), b40 = p40.buf;
  au.playId(50017, 0x7f, 0x40); const p0 = au.playing.at(-1);
  ctx.currentTime = 5.1043;                          // 25.03 driver ticks in
  au.restartSe();
  ok(!pk.stop && pk.buf && au.playing.includes(pk), 'id 1123 (0x463: in FUN_003e7f60\'s keep list) is not ended');
  ok(p40.buf === b40 || (p40.buf.length === b40.length && p40.buf.d[0].every((v, i) => v === b40.d[0][i])), 'id 1 (flag byte 0x59: 0x40) plays on unchanged (FUN_00007d90 skips +0x61 bit 0x40)');
  ok(p0.stop && p0.stop.end === true && p0.stop.tick === 25 && !p0.stop.silent, `the one-shot 50017 ended at the tick it reached (${p0.stop && p0.stop.tick})`);
  // (c) the menu up first (setPaused: command 6 holds the flag-0 SEs), then the Restart: held ones go silent and stay so after the menu
  ctx.currentTime = 8;
  au.playing = [];
  au.playId(50017, 0x7f, 0x40); const ph = au.playing.at(-1);
  au.playId(1123, 0x7f, 0x40); const pkh = au.playing.at(-1);
  sendEventSe({ sePending: [{ name: 'asj_154', vol: 127, rel: false }] }, au);
  const sh = ES.live.at(-1);
  for (let i = 0; i < 8; i++) { ctx.currentTime += 0.025; ES.pump(); }
  au.setPaused(true);
  const m0 = ctx.started.length;
  au.restartSe();
  au.setPaused(false);
  for (let i = 0; i < 40; i++) { ctx.currentTime += 0.025; ES.pump(); }
  const after = ctx.started.slice(m0).filter(c => c.buffer === ph.buf || sh.srcs.some(e => e.src === c));
  ok(ph.stop && ph.stop.silent && !au.playing.includes(ph) && sh.silent && !ES.live.includes(sh) && after.length === 0,
    'held by the pause, then the Restart: the flag-0 one-shot and event SE stay silent after the menu (nothing started for them)');
  ok(!pkh.stop && au.playing.includes(pkh) && pkh.held === false, 'held, kept (1123): resumes after the menu');
}

// 7b. A Restart while a stop fade runs (request 0x12, then the Restart's 0x23): the fade stays under the end, the volume does not
// jump back (render gets both stops)
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  au.seBlock1(0xc064800); au.eventSe = null; au.playing = []; au.slotStreams = null;
  au.renderers[0] = new SeRenderer(au.drv, au.banks[0]);
  ctx.currentTime = 1;
  au.playId(50017, 0x7f, 0x40); const p = au.playing.at(-1), b0 = p.buf;
  ctx.currentTime = 1 + 30.5 / 240; au.fade(p, 10); const bf = p.buf;
  ctx.currentTime = 1 + 40.5 / 240; au.restartSe(); const be = p.buf;
  const S0 = 30 * 200, S1 = 40 * 200;
  let sameFade = true, fadeActs = false;
  for (let i = 0; i < S1; i++) { if (be.d[0][i] !== bf.d[0][i]) sameFade = false; if (i > S0 + 400 && be.d[0][i] !== b0.d[0][i]) fadeActs = true; }
  ok(p.stops && p.stops.length === 2 && sameFade && fadeActs, `fade at tick 30, Restart at tick 40: the render keeps the fade through tick 40 (${p.stops && p.stops.length} stops; same as the fade-only render: ${sameFade}; differs from no fade: ${fadeActs})`);
}

// 8. Skip while first_encounter's SEs play (FUN_00372f70 -> FUN_003e6fc8 -> FUN_003e9a58 -> request 0x1a -> FUN_003e7f60(A, B, 4) ->
// IOP command 0x23): the player presses Skip; every event SE still sounding ends at the tick heard (tracks ended, voices released),
// none plays on (worker 0271; the page used to leave them playing).
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  au.eventSe = null;
  const S = make({ 0: 20, 1: 8 }, Gz({ 0: 1, 1: 21 }), au, null);
  let t = 0;
  const live = () => au.eventSe ? au.eventSe.live.filter(x => x.stream.rd.tracks.some(k => k.active)) : [];
  const playing = S.run(6000, () => { t += 0.02; ctx.currentTime = t; if (au.eventSe) au.eventSe.pump(); return live().length > 0 && S.R.vm.frames.some(F => F.m.name === 'first_encounter'); });
  const was = live().map(x => x.name);
  let skipped = false;
  if (playing) { S.run(2000, () => { t += 0.02; ctx.currentTime = t; return S.R.vm.pending && S.R.skippable && S.R.skippable(); }); skipped = S.R.requestSkip(); }
  const after = live().map(x => x.name);
  const ended = au.eventSe ? au.eventSe.live.filter(x => was.includes(x.name)).every(x => x.stream.rd.tracks.every(k => !k.active)) : false;
  ok(playing && skipped && was.length > 0 && after.length === 0 && ended, `Skip in first_encounter with ${was.join()} sounding: all ended at the heard tick (${after.join() || 'none left'})`);
}

// 9. Skip also ends the placed sounds' SEs (FUN_003e9a58 sends FUN_003e9830 to every slot but the two area slots, then 0x23):
// playBgSound's loop asj_030 in SlotStreams ends at the heard tick, its slot stays open (FUN_003e9a58 frees none). The keep list is
// FUN_003e7f60's: the area id, 4, the menu queue's entries 0 / 1 when >= 0 (0 after FUN_003e87f8), 0x461 .. 0x463.
{
  const ctx = new FakeCtx(), au = gameAudio(ctx);
  au.seBlock1(au.zoneCode); au.eventSe = null; au.playing = []; au.menuQ = [0, 0, 0, 0]; au.menuN = 0; au.areaId = -1;
  const slots = new SlotStreams(au, { emitterVolPan, SeStream, hexBytes });
  ctx.currentTime = 1;
  const hd = slots.open('asj_030', [0, 0, 0], 48);
  slots.update({ pos: [0, 0, 0, 1], fwd: [0, 0, 1], alt: [0, 0, 0], useAlt: false });
  const sl = slots.slots.get(hd);
  while (ctx.currentTime < 1.3) { ctx.currentTime += 0.025; slots.pump(); }
  ok(JSON.stringify(au.keepList(au.areaId, -1, 4)) === JSON.stringify([4, 0, 0, 0x461, 0x462, 0x463]), 'Skip\'s keep list before any menu sound: ' + JSON.stringify(au.keepList(au.areaId, -1, 4)));
  au.skipSe();
  ok(sl.stream.rd.tracks.every(t => !t.active) && slots.slots.get(hd) === sl, 'Skip: asj_030 (playBgSound) ended, its slot still open');
  au.menuN = 0; au.playMenu('msj_017'); au.menuQ[1] = -5;           // a menu sound, then a stop request in entry 1 (FUN_003e9d30)
  const k2 = au.keepList(-1, -1, -1);
  ok(k2[0] === au.seIdOf('msj_017') && k2.length === 4, 'Restart\'s keep list after a menu sound: ' + JSON.stringify(k2));
}

console.log((fails ? 'FAILED ' : 'ok ') + oks + ' passed, ' + fails + ' failed' + (MUT ? ' (mutant ' + MUT + ')' : ''));
process.exit(fails ? 1 : 0);
