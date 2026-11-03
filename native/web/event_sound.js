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

const f32 = Math.fround;

// FUN_003eacb8(pi / 4): the voice channel's L / R gains (short)(cos / sin(pi / 4) x 4096) = 2896; FUN_003eb330 mixes
// sample x gain >> 12 into the 48 kHz ring (DAT_0047d714 != 0: stereo; 2 in the sea-of-flames save)
export const VOICE_GAIN = Math.trunc(f32(f32(Math.cos(f32(0.7853982))) * 4096)) / 4096;

// FUN_003eb930(name): the sdb row (FUN_003eb868) has +0xc & 0x84 == 0x84 (bgm.json "flags": bgm_001 0x94 yes,
// bgm_274 0x04 no)
export function rowStreamed(flags) { return flags != null && (flags & 0x84) === 0x84; }

// The six voice channels DAT_004f7c38 (0x40 each): loadVoice2 fills one (command 0x11 -> the file in RAM), playVoice
// sets +0x1c bit 1 (FUN_003ead30), FUN_003ed000 decodes a frame per ring frame and mixes it (tools/audio/voice.py has
// the decode facts; the FLAC holds the mixed samples). Skip stops all six (FUN_00372f70 -> FUN_003ea5f0 -> FUN_003ea3d0).
export class VoicePlayer {
  constructor(audio, base = 'data/audio/voice/') {
    this.au = audio; this.base = base; this.meta = null; this.bufs = new Map(); this.playing = []; this.out = null;
    this.warned = new Set(); this.log = [];
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
  // FUN_003eaf10(pi / 4, name, 0) -> FUN_003ead30: the loaded channel starts at the next ring frame
  play(name) {
    this.log.push(name);
    const ctx = this.au && this.au.ctx;
    if (!ctx) { this.warnOnce('voice: ' + name + ' asked for before the first gesture (no AudioContext): lost (L)'); return; }
    const ch = this.bufs.get(name);
    if (!ch) return;                                 // FUN_003eaf10: no channel holds it -> nothing
    ch.buf ??= ch.file.then((ab) => (ab ? ctx.decodeAudioData(ab.slice(0)) : null)).catch((e) => { this.warnOnce('voice: ' + name + ' ' + e); return null; });
    ch.buf.then((buf) => {
      if (!buf || this.bufs.get(name) !== ch) return;    // freed by a Skip while decoding
      if (!this.out) {
        // the ring goes out through the IOP's core-1 input volume (music.js BGM_GAIN): voices are mixed after the
        // decoder's offset (changeMusicVol does not reach them)
        this.out = ctx.createGain(); this.out.gain.value = 0x7fff / 32768; this.out.connect(ctx.destination);
      }
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; g.gain.value = VOICE_GAIN;
      // mono block x gain into L and R: a mono buffer feeds both speakers equally
      src.connect(g); g.connect(this.out); src.start(ctx.currentTime);
      const rec = { name, src };
      this.playing.push(rec);
      src.onended = () => { this.playing = this.playing.filter((x) => x !== rec); };
    });
  }
  // FUN_003ea3d0 -> FUN_003ea2c0 per channel: the file (+0x4) and the stream (+0x8) freed: playing voices stop and a
  // later playVoice finds no channel (nothing plays until a new loadVoice2)
  stopAll() {
    for (const v of this.playing) { try { v.src.stop(); } catch (e) { /* not started */ } }
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
      return h;
    },
    // playVoice (FUN_003a0900): FUN_003eaf10(pi / 4, name, 0) (no skip test of its own)
    'fake/KerberosSound.playVoice(Ljava/lang/String;)V': (vm, [s]) => {
      const name = str(s); log('voice ' + name);
      const v = get('voices'); if (v) v.play(name.slice(0, 7));
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
// fixed volume, pan 0x40). The release (FUN_003e8ff8) lets a rendered SE play to its end (audio.js SoundEmitters).
export function sendEventSe(R, audio) {
  const list = R.sePending; R.sePending = [];
  const sent = [];
  for (const e of list) {
    const row = audio && (audio.row ? audio.row(e.name) : audio.se && audio.se.names[e.name]);   // FUN_003eb868
    if (!row || (row.flags & 2)) continue;               // a stream row (FUN_003eb088) is not played by the page
    sent.push({ name: e.name, id: row.id, vol: e.vol, pan: 0x40 });
    if (audio.ctx) audio.playId(row.id, e.vol, 0x40);
  }
  return sent;
}

// FUN_00372f70's sound part on Skip: FUN_003e9950 (stream SE slots stopped), FUN_003ea5f0 (the voice channels)
export function skipSound(o) {
  const v = o.voices && o.voices();
  if (v) v.stopAll();
}
