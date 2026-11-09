// event_sound.js -- the KerberosSound natives an event script calls, for the opening event (worker 0222;
// notes/event-vm-research.md "Event sound"). Translated from the game (PAL SLES_541.85); each native cites its C
// function (method +0x0c of fake/KerberosSound, read from the class registry DAT_004ef498 in the w210 start1704 state).
//
// The page's back ends (all optional; a missing one is warned once and the call left out):
//   o.music()  music.js GameMusic   (playMusic2 / playMusic3 / changeMusicVol / stopMusic; FUN_003ec500 / FUN_003ec560)
//   o.area()   { play(name, vol) }  (playBgAreaSound_l -> FUN_003e6c88: music.js AreaSound)
//   o.audio()  audio.js GameAudio   (setSoundEffect2_l's SE: playId; the voices' AudioContext)
//   o.voices() VoicePlayer below    (loadVoice2 / playVoice; data/audio/voice from tools/audio/voice.py)
//   o.bgmRow(name) -> the sdb row's flags (bgm.json "flags") for FUN_003eb930
//
// Order inside a frame: an SE asked for on frame f is sent by FUN_003e9ed0 on frame f + 1 (audio.js SoundEmitters);
// `frame()` (called once per event frame, before the VM window) sends last frame's requests.

import { block } from './event_vm.js';
import { SeStream } from './music.js';
import { hexBytes, SPU_RATE, TICK_HZ } from './audio.js';
import { pcmRing, BLOCK_S } from './pcm_ring.js';

const f32 = Math.fround;

// FUN_003eacb8(pi / 4): the voice channel's L / R gains (short)(cos / sin(pi / 4) x 4096) = 2896; FUN_003eb330 mixes
// sample x gain >> 12 into the 48 kHz ring (DAT_0047d714 != 0: stereo; 2 in the sea-of-flames save)
export const VOICE_GAIN = Math.trunc(f32(f32(Math.cos(f32(0.7853982))) * 4096)) / 4096;

// The voices' way out: FUN_003ed000 mixes each voice channel, a 0x60-byte frame per 1024-sample block, into the EE PCM ring;
// FUN_003ed8e0 sends the ring's blocks to the IOP's 16-slot buffer (pcm_ring.js has both queues; T w266_open / w266_sk).
// A voice's first block is mixed by the first send after playVoice and holds nothing (FUN_003eab20: the frame at offset 0
// is not mixed; voice.py drops it), so its sample 0 is in the next block, heard when the IOP plays that block
// (T: 512 / 528 / 533 ms after the start of the playVoice frame). The mouths (texture animations) are drawn at once.
export const VOICE_BLOCK_S = BLOCK_S;

// FUN_003eb930(name): the sdb row (FUN_003eb868) has +0xc & 0x84 == 0x84 (bgm.json "flags": bgm_001 0x94 yes,
// bgm_274 0x04 no)
export function rowStreamed(flags) { return flags != null && (flags & 0x84) === 0x84; }

// The six voice channels DAT_004f7c38 (0x40 each): loadVoice2 fills one (command 0x11 -> the file in RAM), playVoice
// sets +0x1c bit 1 (FUN_003ead30), FUN_003ed000 decodes a frame per ring frame and mixes it (tools/audio/voice.py has
// the decode facts; the FLAC holds the mixed samples). Skip stops all six (FUN_00372f70 -> FUN_003ea5f0 -> FUN_003ea3d0).
export class VoicePlayer {
  constructor(audio, base = 'data/audio/voice/') {
    this.au = audio; this.base = base; this.meta = null; this.bufs = new Map(); this.playing = []; this.out = null;
    this.warned = new Set(); this.log = []; this.timing = [];
  }
  warnOnce(m) { if (!this.warned.has(m)) { this.warned.add(m); console.warn(m); } }
  init() {
    if (!this.ready) this.ready = fetch(this.base + 'voice.json').then((r) => { if (!r.ok) throw new Error('voice.json ' + r.status); return r.json(); })
      .then((j) => { this.meta = j; return this; })
      .catch((e) => { this.warnOnce('voice: no data/audio/voice (tools/audio/voice.py): the event voices are left out ' + e); this.meta = {}; return this; });
    return this.ready;
  }
  // loadVoice2's command 0x11: the page fetches the FLAC (its load takes no event time: 'event loads' row); it is
  // decoded at the first play (the AudioContext may not exist yet: the browser's first gesture)
  load(name) {
    if (this.bufs.has(name)) return;
    const p = this.init().then(async () => {
      const info = this.meta[name];
      if (!info) { this.warnOnce('voice: ' + name + ' not exported (tools/audio/voice.py --names)'); return null; }
      const r = await fetch(this.base + info.file);
      if (!r.ok) throw new Error(info.file + ' ' + r.status);
      return r.arrayBuffer();
    }).catch((e) => { this.warnOnce('voice: ' + name + ' not loaded ' + e); return null; });
    this.bufs.set(name, { file: p, buf: null });
  }
  // FUN_003eaf10(pi / 4, name, 0) -> FUN_003ead30: the loaded channel (one per name) restarts at playVoice's time T. The
  // blocks it mixed before T are in the ring and are heard to the end of the last one (pcm_ring.js heard(blockAt(T))).
  // FUN_003eab20 mixes nothing while the channel has no data (it returns before moving its offset): the page's decode
  // stands for that load, so a voice decoded after T starts later from its beginning; then the first block mixed holds
  // the offset-0 frame (nothing heard) and sample 0 is in the next one (rec.b0).
  play(name) {
    this.log.push(name);
    const ctx = this.au && this.au.ctx;
    if (!ctx) { this.warnOnce('voice: ' + name + ' asked for before the first gesture (no AudioContext): lost (L)'); return; }
    const ch = this.bufs.get(name);
    if (!ch) return;                                 // FUN_003eaf10: no channel holds it -> nothing
    const ring = pcmRing(ctx), T = ctx.currentTime, cut = ring.heard(ring.blockAt(T));
    for (const o of this.playing.filter((x) => x.name === name)) {
      if (o.src) { o.src.onended = null; try { o.src.stop(cut); } catch (e) { /* not started */ } }
      this.playing = this.playing.filter((x) => x !== o);
    }
    const rec = { name, buf: null, off: 0, skipped: false, asked: T };
    ch.rec = rec;
    ch.buf ??= ch.file.then((ab) => (ab ? ctx.decodeAudioData(ab.slice(0)) : null)).catch((e) => { this.warnOnce('voice: ' + name + ' ' + e); return null; });
    ch.buf.then((buf) => {
      if (!buf || this.bufs.get(name) !== ch || ch.rec !== rec) return;    // freed by a Skip, or played again, while decoding
      if (!this.out) {
        // the ring goes out through the IOP's core-1 input volume (music.js BGM_GAIN): voices are mixed after the
        // decoder's offset (changeMusicVol does not reach them)
        this.out = ctx.createGain(); this.out.gain.value = 0x7fff / 32768; this.out.connect(ctx.destination);
      }
      rec.buf = buf;
      rec.ready = Math.max(T, ctx.currentTime);      // the data is there: the channel mixes from the next block on
      this.playing.push(rec);
      if (this.paused) return;                       // held (+0x1c 0x8000): nothing mixed until the resume
      this.start(rec, ring.blockAt(rec.ready));
      this.timing.push({ name, asked: T, heard: rec.t0 });   // tests: playVoice's time, when offset 0 is heard
    });
  }
  // the channel mixes from block b on: the offset-0 frame first when it has not been mixed yet (rec.skipped), then rec.off on
  // (mono block x gain into L and R: a mono buffer feeds both speakers equally). rec.t0: when its offset 0 is (or would be) heard
  start(rec, b) {
    const ctx = this.au.ctx, ring = pcmRing(ctx), src = ctx.createBufferSource(), g = ctx.createGain();
    if (!rec.skipped) { rec.b1 = b; rec.skipped = true; b++; }
    rec.b0 = b; rec.off0 = rec.off;
    src.buffer = rec.buf; g.gain.value = VOICE_GAIN;
    src.connect(g); g.connect(this.out);
    const at = ring.heard(b);
    src.start(at, rec.off);
    rec.src = src; rec.t0 = at - rec.off;
    src.onended = () => { this.playing = this.playing.filter((x) => x !== rec); };
  }
  // the event pause at time Tp: the blocks mixed before it hold the voice up to there; a voice whose offset-0 frame was not
  // mixed yet still needs it at the resume
  hold(rec, Tp) {
    const ring = pcmRing(this.au.ctx), bp = ring.blockAt(Tp);
    if (!rec.src) return;
    if (bp <= rec.b1) rec.skipped = false;
    rec.off = Math.min(rec.off0 + Math.max(0, bp - rec.b0) * BLOCK_S, rec.buf.duration);
    rec.src.onended = null;
    try { rec.src.stop(ring.heard(Math.max(bp, rec.b0))); } catch (e) { /* not started */ }
    rec.src = null;
  }
  // the event pause: FUN_003ea9f0 sets a loaded channel's +0x1c bit 0x8000 (FUN_003eaf90 then returns 0: not decoded, not
  // mixed), FUN_003eaa78 clears it: a voice goes on where it stopped, from the first block mixed after the resume (worker
  // 0261). A source can't pause: stopped at its offset, a new one from there
  pause(on) {
    if (on === !!this.paused) return;
    this.paused = on;
    if (!this.au || !this.au.ctx) return;
    const now = this.au.ctx.currentTime, ring = pcmRing(this.au.ctx);
    for (const rec of this.playing) { if (on) this.hold(rec, now); else this.start(rec, ring.blockAt(now)); }
  }
  // FUN_003ea3d0 -> FUN_003ea2c0 per channel: the file (+0x4) and the stream (+0x8) freed: playing voices stop and a
  // later playVoice finds no channel (nothing plays until a new loadVoice2). The blocks already mixed are in the ring
  // and play on: each source stops at the end of the last block mixed before now
  stopAll() {
    const ctx = this.au && this.au.ctx, end = ctx ? pcmRing(ctx).heard(pcmRing(ctx).blockAt(ctx.currentTime)) : 0;
    for (const v of this.playing) { if (v.src) { try { v.src.stop(end); } catch (e) { /* not started */ } } }
    this.playing = [];
    this.bufs.clear();
  }
}

// R: the EventRuntime (R.skip = +0x156c, R.view / R.cams for the camera, R.cmd / R.slots, R.log, R.frameNo)
export function soundNatives(R, o = {}) {
  const warned = new Set();
  const warnOnce = (m) => { if (!warned.has(m)) { warned.add(m); R.warn(m); } };
  const str = (s) => (typeof s === 'string' ? s : s == null ? null : String(s));
  const log = (m) => R.log.push([R.frameNo, m]);
  const get = (k) => (o[k] ? o[k]() : null);
  const skip = () => R.skip | 0;
  const music = (what) => { const m = get('music'); if (!m) warnOnce('event: ' + what + ': no music (music.js / tools/audio/bgm.py): left out'); return m; };
  const streamed = (name) => { const f = o.bgmRow ? o.bgmRow(name) : null; if (f == null) warnOnce('event: no sdb flags for ' + name + ' (bgm.json): FUN_003eb930 taken false'); return rowStreamed(f); };
  R.sePending = [];
  return {
    // loadSoundEffectEx_l(a, b, c) (FUN_003a0be8 -> FUN_00378d40: command 0x10, +0x20 a, +0x28 b, +0x2c c; its handle) ->
    // FUN_003825e8 in the command loop: the file into SE block slot 1 (FUN_003e78a8(mgr, 1, code, 0)), done when the
    // sound thread's load ends (FUN_003e7310(4) == 0). code: a == 2 and the zone record DAT_0047dbb0 -> FUN_00250a48(zone, b)
    // (0x0azz00bb); a == 1 -> FUN_00250970(zone) = the zone's sep.bin; else FUN_002508b0(b < 0 ? the event's +0xc : b) + c =
    // 0x0c000800 + b x 0x1000 + c. The stage's events call (0, 100) at their start (the event block 0x0c064800, whose
    // programs the zone's sdb names: asj_041 .., asj_154 ..) and (1, 100) at their end (the zone's block back) (worker 0266).
    // The page's block switch takes no event time (its blocks are fetched with the zone's: 'event loads' row).
    'fake/KerberosSound.loadSoundEffectEx_l(III)I': (vm, [a, b, c]) => {
      const au = get('audio');
      const zoneCode = au && au.zoneCode;
      let code;
      if (a === 2) { warnOnce('event: loadSoundEffectEx_l(2, ..): FUN_00250a48\'s zone file (0x0a..) not exported: left out'); code = null; }
      else if (a === 1) code = zoneCode ?? null;
      else code = (((b < 0 ? (R.evId ?? 0) : b) * 0x1000 + 0xc000800) + c) >>> 0;   // FUN_0037cdd8: the event's +0xc (>= 0)
      if (b < 0 && a !== 1 && a !== 2) warnOnce('event: loadSoundEffectEx_l with b < 0: the event\'s own id (+0xc) is not kept by the page (0 taken)');
      log('sebank ' + a + ' ' + b + ' ' + c + (code != null ? ' 0x' + code.toString(16) : ''));
      R.seBlock = code;
      if (code != null) { if (au && au.seBlock1) au.seBlock1(code); else warnOnce('event: no audio: the SE block switch (loadSoundEffectEx_l) left out'); }
      const h = R.cmd(0x10, { a, b, c });
      R.slots = R.slots.filter((x) => x.h !== h);                         // done at once (the page's loads take no event time)
      return h;
    },
    // unsetSoundEffect (FUN_0039ff08 -> FUN_003e90d0(mgr, name)): every live slot whose id is the name's sdb row id
    // (row +0x10; +8 for a stream row) -> FUN_003e9830(slot, 0) (slot flag 0x20 = row bit 3: request 0x12, the stop fade) and
    // the slot freed. The event SEs' slots are event_sound.js EventSeSlots (wro_kaisetu's loops asj_335 .. 339)
    'fake/KerberosSound.unsetSoundEffect(Ljava/lang/String;)V': (vm, [s]) => {
      const name = str(s); log('unset ' + name);
      const au = get('audio');
      R.sePending = R.sePending.filter((e) => e.name !== name || e.rel);   // FUN_003e9830 on a slot not sent yet (+0x18 -1): never sent
      if (au && au.eventSe) au.eventSe.unset(name);
    },
    // playBgSound(name, vol) (FUN_0039de38): the position is a zeroed quad (sq zero at 0x39de78; Ghidra drops it) ->
    // FUN_003e6d70(name, (0, 0, 0), no object, vol): an entry of the 8-entry placed-sound table DAT_004f5920 (ambient.js
    // PlacedSounds.bgPlayRaw), a zero position = no pan (FUN_003e8bc8 flag 0x8000), volume fixed at vol (FUN_003e8b70;
    // FUN_003e6ec8 keeps it for an entry without an object). Released by the next event's start (FUN_0037e048 ->
    // FUN_003e6538, stage_controller.js enterEvent). wro_kaisetu (asj_030, 48) and help_orei02 (asj_031, 48) end with it
    'fake/KerberosSound.playBgSound(Ljava/lang/String;I)V': (vm, [s, v]) => {
      const name = str(s); log('bgsound ' + name + ' ' + v);
      const bg = get('bg');
      if (bg && bg.bgPlayRaw) bg.bgPlayRaw(name, [0, 0, 0], v); else warnOnce('event: no placed-sound table (ambient.js): playBgSound ' + name + ' left out');
    },
    // setVoiceBufferType (FUN_003a0ac8 -> FUN_0037fc88(ev, n, 1)): waits for the voice loads to settle (FUN_00400ee8)
    // and re-sizes the voice buffers; the page's buffers are per voice, so nothing changes (loads are at once)
    'fake/KerberosSound.setVoiceBufferType(I)V': (vm, [n]) => { log('voicebuf ' + n); },
    // loadVoice2 (FUN_003a0968 -> FUN_00378c88): skip 0 -> command 0x11 with the name (7 chars), its handle;
    // skip != 0 -> 0x7fffffff (nothing loaded). The page's load is resident: the command is done at once.
    'fake/KerberosSound.loadVoice2(Ljava/lang/String;)I': (vm, [s]) => {
      const name = str(s);
      if (skip() !== 0) return 0x7fffffff;
      const h = R.cmd(0x11, { name });
      R.slots = R.slots.filter((c) => c.h !== h);
      const v = get('voices'); if (v) v.load(name.slice(0, 7)); else warnOnce('event: no voice player: voices left out');
      log('loadvoice ' + name);
      R.voiceHeld ??= new Map(); R.voiceHeld.set(name.slice(0, 7), Infinity);   // the channel holds it from the load (below)
      return h;
    },
    // playVoice (FUN_003a0900): FUN_003eaf10(pi / 4, name, 0) (no skip test of its own)
    'fake/KerberosSound.playVoice(Ljava/lang/String;)V': (vm, [s]) => {
      const name = str(s); log('voice ' + name);
      const v = get('voices'); if (v) v.play(name.slice(0, 7));
      // the channel is freed when its stream ends: row +0x14 ms after the play (FUN_003ed000; data.voiceMs: tools/audio/voice.py's rows)
      const ms = R.data.voiceMs && R.data.voiceMs[name.slice(0, 7)];
      if (R.voiceHeld && R.voiceHeld.has(name.slice(0, 7))) { if (ms == null) warnOnce('event: voice ' + name + ': no length (data.voiceMs): waitVoiceFinish does not wait'); R.voiceHeld.set(name.slice(0, 7), ms == null ? 0 : (R.clock + ms) >>> 0); }
    },
    // waitVoiceFinish (FUN_003a09b8): polls while +0x156c == 0, the abort bit is clear and FUN_003eaea8(name): a voice channel (DAT_004f7c3c x 6)
    // holds that name (worker 0261). isVoicePlaying (FUN_003a0a38): 0 under Skip, else FUN_003eaea8
    'fake/KerberosSound.waitVoiceFinish(Ljava/lang/String;)V': (vm, [s]) => {
      const name = str(s).slice(0, 7), held = () => R.voiceHeld && R.voiceHeld.has(name) && R.clock < R.voiceHeld.get(name);
      return block(() => R.skip !== 0 || !held(), () => { if (R.voiceHeld && !held()) R.voiceHeld.delete(name); });
    },
    'fake/KerberosSound.isVoicePlaying(Ljava/lang/String;)Z': (vm, [s]) => {
      if (R.skip !== 0) return 0;
      const name = str(s).slice(0, 7);
      return R.voiceHeld && R.voiceHeld.has(name) && R.clock < R.voiceHeld.get(name) ? 1 : 0;
    },
    // setSoundEffect2_l(name, x1, y1, z1, x2, y2, z2, at, vol, release) (FUN_0039ff68), skip 0 only:
    //   at == 0: position = the first active event camera's eye (FUN_0037cc30 / FUN_0037cd18), direction aim - eye;
    //            the slot gets bit 18 (FUN_003e8a30: 0x40000, no 3D: pan 0x40) and a fixed volume (FUN_003e8b70:
    //            min(vol, 0x7f), flag 0x40)
    //   at != 0: position (x1, y1, z1), direction (x2..) - (x1..), volume from the distance
    //   FUN_003e8e18 opens the slot (sdb row), FUN_003e97f8(-1) requests it, release != 0 -> FUN_003e8ff8
    'fake/KerberosSound.setSoundEffect2_l(Ljava/lang/String;FFFFFFZIZ)V': (vm, [s, x1, y1, z1, x2, y2, z2, at, vol, rel]) => {
      const name = str(s);
      if (skip() !== 0) { log('se ' + name + ' (skip)'); return; }
      log('se ' + name);
      if (at) { warnOnce('event: setSoundEffect2_l with a position (3D) not translated (scr001 never passes one): ' + name + ' left out'); return; }
      R.sePending.push({ name, vol: Math.min(vol >>> 0, 0x7f), rel: !!rel });
    },
    // playBgAreaSound_l (FUN_0039dd80 -> FUN_003e6c88(name, vol))
    'fake/KerberosSound.playBgAreaSound_l(Ljava/lang/String;I)V': (vm, [s, v]) => {
      log('area ' + str(s) + ' ' + v); R.lastArea = [str(s), v];
      const a = get('area'); if (a) a.play(str(s), v); else warnOnce('event: no area sound: ' + str(s) + ' left out');
    },
    // playMusic2 (FUN_003a02b8): a known name (FUN_003eb9a0) and (skip 0 or FUN_003eb930) -> FUN_003ec500(name, 0) =
    // FUN_003ec6f8(file, loop, 0, 1), then FUN_003ebb18 (polls up to 1000 x 200 us for the stream to open: the page's
    // open is not waited for, as its loads take no event time)
    'fake/KerberosSound.playMusic2(Ljava/lang/String;)V': (vm, [s]) => {
      const name = str(s);
      const go = skip() === 0 || streamed(name);
      log('music2 ' + name + (go ? '' : ' (skip)'));
      if (!go) return;
      R.lastMusic = [name, 0];
      const m = music('playMusic2'); if (m) m.open(name, 0);
    },
    // playMusic3 (FUN_003a0198): skip 0: fade < 1 -> FUN_003ec500(name, vol), else FUN_003ec560(name, fade, vol);
    // skip != 0: FUN_003ebfa0 (stop), then FUN_003ec500(name, vol) when FUN_003eb930
    'fake/KerberosSound.playMusic3(Ljava/lang/String;II)V': (vm, [s, vol, fade]) => {
      const name = str(s);
      log('music ' + name + ' ' + vol + ' ' + fade + (skip() ? ' (skip)' : ''));
      const m = music('playMusic3');
      R.lastMusic = [name, vol];
      if (skip() === 0) { if (m) m.playMusic3(name, vol, fade); return; }
      if (m) m.stopMusic();
      if (streamed(name) && m) m.open(name, vol);
    },
    'fake/KerberosSound.changeMusicVol(II)V': (vm, [vol, t]) => { log('musicvol ' + vol + ' ' + t); const m = music('changeMusicVol'); if (m) m.changeMusicVol(vol, t); },   // FUN_003a5308 -> FUN_003ed740
    'fake/KerberosSound.stopMusic()V': () => { log('stopmusic'); const m = music('stopMusic'); if (m) m.stopMusic(); },   // FUN_003a0148 -> FUN_003ebfa0
  };
}

// FUN_003e9ed0's send of last frame's event SEs (vol / pan per audio.js emitterVolPan with flags 0x40000 | 0x40: the
// fixed volume, pan 0x40), looked up in the SE blocks loaded then (audio.js program: slot 1 = the event's block between
// the event's loadSoundEffectEx_l(0, ..) and (1, ..)). Played by EventSeSlots below.
// FUN_003e9ed0's pass over the event SEs' sent slots (EventSeSlots.frame), before the frame's new sends: once a page frame (play.js
// calls it before the event runtimes' ticks: the opening runs two of them in one frame)
export function eventSeFrame(audio) { if (audio && audio.eventSe && audio.eventSe.frame) audio.eventSe.frame(); }

export function sendEventSe(R, audio) {
  const list = R.sePending; R.sePending = [];
  const sent = [];
  for (const e of list) {
    const row = audio && (audio.row ? audio.row(e.name) : audio.se && audio.se.names[e.name]);   // FUN_003eb868
    if (!row || (row.flags & 2)) continue;               // a stream row (FUN_003eb088) is not played by the page
    const prog = audio.program ? audio.program(row.id) : null;
    sent.push({ name: e.name, id: row.id, vol: e.vol, pan: 0x40, found: !!prog });
    // FUN_003e80d8 finds no block holding the id: nothing plays (the game's silence too)
    if (!prog && R.warn && !(R.seMissWarned ??= new Set()).has(e.name)) { R.seMissWarned.add(e.name); R.warn('event: SE ' + e.name + ' (id ' + row.id + ') is in no loaded SE block: silent'); }
    if (audio.ctx && prog) (audio.eventSe ??= new EventSeSlots(audio)).play(e.name, row, prog, e.vol, e.rel);
  }
  return sent;
}

// The event SEs' emitter slots (FUN_0039ff68 with at == 0: FUN_003e8e18 opens the slot, FUN_003e8a30(.., 1) = 0x40000 (no 3D:
// pan 0x40), FUN_003e8b70 the fixed volume; FUN_003e9ed0 sends it the frame after: request 2). release != 0 (setSoundEffect)
// -> FUN_003e8ff8 at once: a row without bit 3 (slot 0x20) is freed and its voice plays to its end; with 0x20 FUN_003e9830
// finds the slot not sent (+0x18 -1) and sets 0x10000: FUN_003e9ed0 sends it, and once its voice handle is back (the sound
// thread FUN_003e7150 -> FUN_003e80d8 -> FUN_003e8970 after that send) the next FUN_003e9ed0 calls FUN_003e9830 again: the stop
// request 0x12 one frame after the start (EventSeSlots.frame; no z128 event releases a bit-3 row: wro_kaisetu's asj_335 .. 339
// are loops; L: the sound thread is taken to answer within the frame); release 0
// (setSoundEffectLoop) keeps the slot until unsetSoundEffect (FUN_003e90d0 -> FUN_003e9830: slot 0x20 -> request 0x12 =
// SeRenderer.stopFade(10); without 0x20 the slot is only freed). Skip (FUN_00372f70) ends them: FUN_003e6fc8's IOP command 0x23
// (audio.js skipSe; its FUN_003e9950 touches stream slots only, flag 0x4000). The pause (audio.js setPaused: IOP command 6) holds
// them as the other SEs.
// Each plays as a stream (music.js SeStream) rendered a little ahead of the AudioContext clock (a page scheduler, not game
// logic): the event SEs run up to 14 s (asj_246), too long to render inside one frame.
// GUESS: own random-table counter per stream (as music.js AreaSound; IOP FUN_0000a870 keeps one for every SE; see notes/fidelity-audit.md)
const EV_AHEAD_S = 0.2, EV_CHUNK_TICKS = 12;
export class EventSeSlots {
  constructor(au) { this.au = au; this.live = []; this.paused = false; this.timer = null; this.log = []; }
  play(name, row, hex, vol, rel) {
    const au = this.au, prog = hexBytes(hex), bank = au.banks && au.banks[prog[1] | (prog[2] << 8)];
    if (!bank || !au.ctx) return null;
    const s = { name, id: row.id, flags: prog[4], kept: !rel, stop20: !!(row.flags & 8), srcs: [], queue: [], holdTicks: [],
      args: [au.drv, bank, prog, Math.min(vol, 0x7f), 0x40], next: au.ctx.currentTime,   // sent now (was + 20 ms, uncited)
      stop10000: !!rel && !!(row.flags & 8), sentFrame: this.frameNo | 0 };   // FUN_003e8ff8 -> FUN_003e9830 on the unsent slot
    s.stream = new SeStream(...s.args);
    this.live.push(s);
    this.log.push({ name, id: row.id, vol, kept: s.kept });
    this.pump();
    if (!this.timer) { this.timer = setInterval(() => this.pump(), 25); if (this.timer.unref) this.timer.unref(); }
    return s;
  }
  // FUN_003e9ed0's 0x10000 check, once a frame before the frame's new sends (event_rt.js / stage_controller.js frame): a slot
  // released before it was sent (stop10000) gets FUN_003e9830 on the first frame after its send, its handle being back
  frame() {
    this.frameNo = (this.frameNo | 0) + 1;
    for (const s of this.live) if (s.stop10000 && s.sentFrame < this.frameNo) { s.stop10000 = false; this.fadeHeard(s); }
  }
  // FUN_003e90d0: the kept slots with this name's id
  unset(name) {
    const row = this.au.row ? this.au.row(name) : null;
    if (!row) return;
    for (const s of this.live) {
      if (!s.kept || s.id !== row.id) continue;
      s.kept = false;
      if (s.stop20) this.fadeHeard(s);
    }
  }
  // The stop request (0x12 -> IOP command 0x2f, SeRenderer.stopFade(10)) reaches the track at the tick being heard, not at the
  // stream's render point (EV_AHEAD_S ahead): the stream is rendered again from the heard chunk's start (its renderer snapshot)
  // to that tick, faded there, and the chunks scheduled past that point are replaced. The game's pause hold (IOP command 6) is on
  // the tick heard at the pause (s.holdTicks; the page applied it at the render point, L): a pause the snapshot predates is
  // applied in the replay at that tick (or at once, for a chunk rendered past it), an unset while paused included.
  // end: IOP command 0x23 (the Restart, SeRenderer.endNow) instead of the fade
  fadeHeard(s, end = false) {
    const ctx = this.au.ctx, now = ctx ? ctx.currentTime : 0, held = this.paused && !(s.flags & 0xc0);
    // ended (0x23) while held by IOP command 6 (volume 0, pitch 0): FUN_00007620 puts back only the envelope and the track is off, so
    // the resume skips it: silent from the pause on (audio.js GameAudio.fade)
    if (end && held) {
      for (const x of s.srcs) { try { x.src.stop(); } catch (e) { /* not started */ } }
      s.srcs = []; s.queue = []; s.stream.done = true; s.silent = true;
      this.live = this.live.filter((x) => x !== s);
      return;
    }
    let c = null, h = s.stream.t, off = 0;
    if (!held) {
      c = s.srcs.find((x) => x.end > now) || null;
      if (c && c.at <= now) { const x = (now - c.at) * TICK_HZ; h = c.snap.t + Math.floor(x); off = (x - Math.floor(x)) / TICK_HZ; }
      else if (c) { h = c.snap.t; s.next = c.at; }
    } else if (s.queue.length) { c = s.queue[0]; h = c.snap.t + Math.floor(c.off * TICK_HZ); }
    let st = s.stream;
    if (c) {
      st = new SeStream(...s.args);
      st.rd.restore(c.snap.rd); st.t = c.snap.t; st.done = c.snap.done;
      const pend = s.holdTicks.slice(c.snap.nHolds), t0 = st.t;
      for (;;) {
        while (pend.length && pend[0] <= st.t) { pend.shift(); st.rd.holdVoices(); }
        if (st.t >= h || st.done) break;
        st.ticks(1);
      }
      s.replayed = st.t - t0;                        // tests: the ticks rendered again
    }
    if (end) st.rd.endNow(); else st.rd.stopFade(10);
    s.stream = st;
    for (const x of s.srcs) { try { x.src.stop(); } catch (e) { /* not started */ } }
    s.srcs = []; s.queue = [];
    if (!ctx || held) return;
    if (s.next < now || off > 0) s.next = now;
    const k = this.chunk(s);
    this.sched(s, k.buf, off, k.snap);
    this.pump();
  }
  // the next EV_CHUNK_TICKS of the stream, with the renderer's state at its start (fadeHeard replays from there)
  chunk(s) {
    const ctx = this.au.ctx, snap = { t: s.stream.t, done: s.stream.done, nHolds: s.holdTicks.length, rd: s.stream.rd.snapshot() };
    const { left, right } = s.stream.ticks(EV_CHUNK_TICKS);
    const buf = ctx.createBuffer(2, left.length, SPU_RATE);
    buf.copyToChannel(left, 0); buf.copyToChannel(right, 1);
    return { buf, snap };
  }
  pump() {
    const ctx = this.au.ctx;
    if (!ctx) return;
    for (const s of this.live) {
      if (this.paused && !(s.flags & 0xc0)) continue;
      {
        while (!s.stream.done && s.next < ctx.currentTime + EV_AHEAD_S) {
          const k = this.chunk(s);
          this.sched(s, k.buf, 0, k.snap);
        }
      }
    }
    for (const s of this.live) s.srcs = s.srcs.filter((c) => c.end > ctx.currentTime);
    this.live = this.live.filter((s) => !s.stream.done || s.srcs.length || s.queue.length);
    if (!this.live.length && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  // snap: the stream's state at the buffer's start (chunk)
  sched(s, buf, off, snap) {
    const ctx = this.au.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const at = Math.max(s.next, ctx.currentTime);
    src.start(at, off);
    s.next = at + (buf.duration - off);
    s.srcs.push({ src, buf, at: at - off, end: s.next, snap });
  }
  // IOP command 6 (audio.js setPaused): a held track's timing stops and a voice in decay goes to sustain (SeRenderer.holdVoices);
  // menu-flagged programs (0x40 / 0x80) play on. The rendered chunks not yet heard are kept and played from where they stopped.
  // L: the hold reaches the renderer up to EV_AHEAD_S late (the chunks already rendered keep their decay)
  setPaused(on) {
    on = !!on;
    if (on === this.paused) return;
    this.paused = on;
    const ctx = this.au.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const s of this.live) {
      if (s.flags & 0xc0) continue;
      if (on) {
        const c = s.srcs.find((x) => x.end > now);   // the tick heard now: the game's hold is there
        s.holdTicks.push(!c ? s.stream.t : c.at <= now ? c.snap.t + Math.floor((now - c.at) * TICK_HZ) : c.snap.t);
        s.queue = s.srcs.filter((c) => c.end > now).map((c) => ({ buf: c.buf, off: Math.max(0, now - c.at), snap: c.snap }));
        for (const c of s.srcs) { try { c.src.stop(); } catch (e) { /* not started */ } }
        s.srcs = [];
        s.stream.rd.holdVoices();
      } else {
        s.next = now;
        for (const q of s.queue) this.sched(s, q.buf, q.off, q.snap);
        s.queue = [];
      }
    }
    if (!on) this.pump();
  }
  stopAll() {
    for (const s of this.live) for (const c of s.srcs) { try { c.src.stop(); } catch (e) { /* not started */ } }
    this.live = [];
  }
  // The Restart's IOP command 0x23 (audio.js GameAudio.restartSe): every stream not kept is ended at its heard tick (its tracks end,
  // its voices are keyed off and finish their release); the slots are gone with the stage reload (worker 0271)
  endAll(keep = []) {
    for (const s of this.live) { if (keep.includes(s.id)) continue; s.kept = false; s.stop10000 = false; this.fadeHeard(s, true); }
  }
}

// FUN_00372f70's sound part on Skip: FUN_003e9950 (stream SE slots stopped), FUN_003ea5f0 (the voice channels), FUN_003e6fc8 (every
// SE but the area sounds ends: audio.js skipSe, worker 0271)
export function skipSound(o) {
  const v = o.voices && o.voices();
  if (v) v.stopAll();
  const au = o.audio && o.audio();
  if (au && au.skipSe) au.skipSe();
}
