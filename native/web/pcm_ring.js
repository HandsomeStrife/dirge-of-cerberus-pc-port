// pcm_ring.js - when a block mixed on the EE is heard (worker 0271; notes/fidelity-audit.md 'Voice / BGM delay').
// The event voices and the BGM are mixed on the EE into 1024-sample stereo blocks (0x1000 bytes, 48 kHz: one ATRAC3 frame of
// the BGM, one 0x60-byte frame of each voice channel) and go out through two queues:
//   FUN_003ed000 (the mixer, thread FUN_003ecad0: called again at once while it can mix, else sleeps 200): the EE ring
//     DAT_0047d754, 8 slots, a block mixed into slot w while (w + 1) & 7 != r (7 queued at most), w + 1. With a BGM stream
//     open (DAT_004fab80) a block is mixed only when the stream's disc buffer holds data (else it returns -1).
//   FUN_003ed8e0 (the sender, called by thread FUN_003eca08 in a loop while it returns 1, then the thread waits on event 7):
//     the oldest block (slot r) goes to the IOP's 16-slot buffer at slot DAT_0047d768 unless that is the slot the IOP is
//     playing (FUN_0041ad50: (play address - base) / slot size); then DAT_0047d768 + 1 (mod 16), r + 1.
// The IOP plays its 16 slots in a loop at 48 kHz, so a block sent to slot s is heard when the play position reaches s.
// T: w266_open / w266_sk (TRACE_FIELDSET=lipsync): this rule gives every frame's send(s) and the ring's w / r (test_voice_ring).
// The page keeps only the counters (no sample data goes through here): blocks are numbered as mixed; the IOP clock is the
// AudioContext's; the voices (event_sound.js VoicePlayer) and the BGM (music.js GameMusic) schedule their sources at the
// heard time of the block they would be in.
// L: the BGM stream's disc reads are not on the page (its loads take no time), so the mixer never waits for them: in the game
// the ring drains for a few frames when a BGM stream opens (w266_open f1362-1369) and every block mixed then is heard later.

export const EE_SLOTS = 8, IOP_SLOTS = 16;
export const BLOCK_SAMPLES = 1024, OUT_RATE = 48000;
export const BLOCK_S = BLOCK_SAMPLES / OUT_RATE;
// GUESS: the sender thread (FUN_003eca08) is woken once a PAL frame. Event 7's signaller is not located; in w266 the sends of a
// frame see the IOP slot of the next frame's record (the end of the frame). See notes/fidelity-audit.md 'Voice / BGM delay'.
export const FRAME_S = 1 / 50;

// The two queues' state and the code that moves it (the same rules the trace test replays).
export class PcmQueues {
  // w / r: the EE ring's write / read slot (DAT_0047d754 +0 / +2); next: DAT_0047d768; mixed / sent: blocks so far (page
  // counters: block k is the k-th mixed, and goes out as the k-th sent)
  constructor({ w = 0, r = 0, next = 0, mixed = 0, sent = 0 } = {}) { Object.assign(this, { w, r, next, mixed, sent }); }
  queued() { return (this.w - this.r) & (EE_SLOTS - 1); }
  // FUN_003ed000: mix while the ring has room (FUN_003ecad0 calls it again at once). canMix: the BGM stream's data (always on the page)
  mix(canMix = true) {
    let n = 0;
    while (canMix && ((this.w + 1) & (EE_SLOTS - 1)) !== this.r) { this.w = (this.w + 1) & (EE_SLOTS - 1); this.mixed++; n++; }
    return n;
  }
  // FUN_003ed8e0 with the IOP playing slot `play` (FUN_0041ad50): 1 when a block was sent
  send(play) {
    if (this.w === this.r) return 0;                          // *DAT_0047d754 == DAT_0047d754[1]: nothing queued
    if (play === this.next) return 0;                         // the slot the IOP is playing
    this.next = (this.next + 1) & (IOP_SLOTS - 1);
    this.r = (this.r + 1) & (EE_SLOTS - 1);
    this.sent++;
    return 1;
  }
  // one wake of FUN_003eca08: FUN_003ed8e0 again while it sends (up to 1000), each send waking the mixer (semaphore 6)
  wake(play, canMix = true) {
    let n = 0;
    while (n < 1000 && this.send(play)) { n++; this.mix(canMix); }
    return n;
  }
}

// The queues on the AudioContext clock. The game's ring runs from boot (DAT_0047d794), so the page starts it full, as T shows
// it every frame (w266: 7 queued, the IOP 15.25 .. 16 slots ahead): blocks 0..15 in the IOP (block 0 playing at t0), 16..22 in
// the ring. A block b is then sent while the IOP plays b - 15 .. b - 1 and heard at t0 + b x BLOCK_S (the page's IOP never
// starves: it is woken every 20 ms and a slot lasts 21.3 ms).
export class PcmRing {
  constructor(t0) {
    this.t0 = t0;
    this.q = new PcmQueues({ w: 7, r: 0, next: 0, mixed: 23, sent: 16 });
    this.k = 0;                                   // wakes done (at t0 + k x FRAME_S)
    this.hist = [];                               // [time, mixed before, mixed after] of recent wakes that mixed
  }
  // the IOP's playing slot at time t (unwrapped)
  playAt(t) { return Math.floor((t - this.t0) / BLOCK_S + 1e-9); }
  // run the wakes up to time t
  advance(t) {
    while (this.t0 + (this.k + 1) * FRAME_S <= t + 1e-9) {
      this.k++;
      const tf = this.t0 + this.k * FRAME_S, m0 = this.q.mixed;
      if (this.q.wake(this.playAt(tf) & (IOP_SLOTS - 1))) this.hist.push([tf, m0, this.q.mixed]);
    }
    while (this.hist.length > 4096) this.hist.shift();
  }
  // the index of the next block mixed at or after time T (the blocks mixed before T: what a channel changed at T is in)
  blockAt(T) {
    this.advance(T);
    if (this.t0 + (this.k + 1) * FRAME_S > T + 1e-9 && this.t0 + this.k * FRAME_S <= T + 1e-9) return this.q.mixed;
    // the wakes already run past T (mixedAt looks ahead): the count after the last wake at or before T
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i][0] <= T + 1e-9) return this.hist[i][2];
    return this.hist.length ? this.hist[0][1] : this.q.mixed;
  }
  // when block b is heard (its first sample)
  heard(b) { return this.t0 + b * BLOCK_S; }
  // when block b is mixed (the wake that mixes it; the game's clock then)
  mixedAt(b) {
    if (b < 23) return this.t0;
    while (this.q.mixed <= b) this.advance(this.t0 + (this.k + 1) * FRAME_S);
    for (let i = this.hist.length - 1; i >= 0; i--) { const [tf, m0, m1] = this.hist[i]; if (b >= m0 && b < m1) return tf; if (b >= m1) break; }
    return this.t0;
  }
}

// one ring per AudioContext: the voices and the BGM share it (FUN_003ed000 mixes the voices into the BGM's block)
const RINGS = new WeakMap();
export function pcmRing(ctx) {
  let r = RINGS.get(ctx);
  if (!r) { r = new PcmRing(ctx.currentTime); RINGS.set(ctx, r); }
  return r;
}
