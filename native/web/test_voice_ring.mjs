// test_voice_ring.mjs -- the EE PCM ring and the IOP buffer (pcm_ring.js, worker 0271): when a voice / BGM block is heard.
//   node native/web/test_voice_ring.mjs
// T (gitignored; a SKIPPED line when absent): tools/trace/out/w266/w266_open(.calls).jsonl, w266_sk(.calls).jsonl
// (TRACE_FIELDSET=lipsync TRACE_CALLLOG=lipsync): every frame's EE ring w / r (DAT_0047d754), the IOP slot sent next
// (DAT_0047d768), the IOP's play address (*DAT_00510bc8) and the six voice channels (DAT_004f7c38, +0x10 read offset).
// MUTATE=loop|full|room|skip0|late runs one mutant of pcm_ring.js / event_sound.js in a scratch copy.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TR = path.join(HERE, '../../tools/trace/out/w266');
const MUT = process.env.MUTATE;
let fails = 0, oks = 0;
const ok = (c, m) => { if (c) { oks++; console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };

let base = HERE;
if (MUT) {
  const SUB = {
    loop: ['pcm_ring.js', 'while (n < 1000 && this.send(play)) { n++; this.mix(canMix); }', 'if (this.send(play)) { n++; this.mix(canMix); }'],
    full: ['pcm_ring.js', 'if (play === this.next) return 0;', ''],
    room: ['pcm_ring.js', "while (canMix && ((this.w + 1) & (EE_SLOTS - 1)) !== this.r)", "while (canMix && ((this.w + 2) & (EE_SLOTS - 1)) !== this.r)"],
    skip0: ['event_sound.js', 'if (!rec.skipped) { rec.b1 = b; rec.skipped = true; b++; }', 'if (!rec.skipped) { rec.b1 = b; rec.skipped = true; }'],
    late: ['event_sound.js', 'this.start(rec, ring.blockAt(rec.ready));', 'this.start(rec, ring.blockAt(T)); rec.off = 0;'],
  }[MUT];
  if (!SUB) throw new Error('unknown mutant ' + MUT);
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-ring-'));
  for (const f of fs.readdirSync(HERE)) if (f.endsWith('.js')) fs.copyFileSync(path.join(HERE, f), path.join(base, f));
  const p = path.join(base, SUB[0]), s = fs.readFileSync(p, 'utf8');
  if (!s.includes(SUB[1])) throw new Error('mutant does not apply: ' + SUB[1]);
  fs.writeFileSync(p, s.replace(SUB[1], SUB[2]));
}
const R = await import(pathToFileURL(path.join(base, 'pcm_ring.js')));
const { PcmQueues, PcmRing, BLOCK_S, FRAME_S } = R;

// ---- 1. T: the queues' rule against every frame of w266 ----
function readTrace(nm) {
  const recs = fs.readFileSync(path.join(TR, nm + '.jsonl'), 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
  const calls = fs.readFileSync(path.join(TR, nm + '.calls.jsonl'), 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null').replace(/-?Infinity/g, 'null')));
  const st = recs.map(r => {
    const b = Buffer.from(r.pcm_ring, 'hex'), base1 = Buffer.from(r.iop_base, 'hex').readUInt32LE(4);
    const reply = r.iop_reply & 0xffffff;
    const ch = [0, 1, 2, 3, 4, 5].map(i => { const v = Buffer.from(r['ev_vc' + i], 'hex'); return { off: v.readUInt32LE(16), size: v.readUInt32LE(12), on: (v.readUInt32LE(28) & 2) && v.readUInt32LE(8) /* +8 0: FUN_003eab20 mixes nothing */ }; });
    return { f: r.frame, w: b.readUInt16LE(0), r: b.readUInt16LE(2), next: r.iop_next, play: reply ? (reply - base1) / 0x1000 : null, ch };
  });
  return { st, calls };
}
const have = ['w266_open', 'w266_sk'].every(n => fs.existsSync(path.join(TR, n + '.jsonl')) && fs.existsSync(path.join(TR, n + '.calls.jsonl')));
if (!have) console.log('SKIPPED T checks: tools/trace/out/w266/w266_open(.calls).jsonl / w266_sk(.calls).jsonl not present (gitignored trace)');
const gameDelays = [];
if (have) {
  for (const nm of ['w266_open', 'w266_sk']) {
    const { st, calls } = readTrace(nm);
    const music = calls.filter(c => c.hook === 'music2' || c.hook === 'music3').map(c => c.frame);
    let n = 0, badSend = 0, badW = 0, stall = 0, badVoice = 0, multi = 0;
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i], b = st[i + 1];
      if (b.play === null) continue;
      n++;
      // the wake of frame a.f -> b.f sees the IOP slot of b's reply (the last FUN_0041ad50 of that frame)
      const q = new PcmQueues({ w: a.w, r: a.r, next: a.next });
      const sends = q.wake(Math.floor(b.play) & 15);
      if (sends > 1) multi++;
      if (q.next !== b.next || q.r !== b.r) badSend++;
      // the mixer waits for a BGM stream's disc data (not on the page): count those frames apart
      const inStall = music.some(m => b.f >= m && b.f <= m + 10);
      if (q.w !== b.w) { if (inStall) stall++; else badW++; }
      // a playing voice channel moves one 0x60 frame per block mixed
      const mixed = (b.w - a.w) & 7;
      for (let k = 0; k < 6; k++) if (a.ch[k].on && b.ch[k].on && a.ch[k].off && b.ch[k].off < b.ch[k].size && b.ch[k].off - a.ch[k].off !== 0x60 * mixed) badVoice++;
    }
    ok(n > 500 && badSend === 0, `${nm}: FUN_003ed8e0's sends (loop while the IOP slot != DAT_0047d768) = the trace on ${n - badSend} / ${n} frames (${multi} with more than one send)`);
    ok(badW === 0, `${nm}: FUN_003ed000 refills the ring to 7 after each send on every frame outside a BGM open (${stall} frames of the open's disc wait apart)`);
    ok(badVoice === 0, `${nm}: a playing voice channel takes one 0x60 frame per mixed block (${badVoice} misses)`);
    // the voices: playVoice's frame -> the block holding sample 0 (the second one mixed for the channel) -> its IOP slot -> heard
    for (const c of calls.filter(c => c.hook === 'ev_voice')) {
      const i0 = st.findIndex(s => s.f === c.frame);
      if (i0 < 1) continue;
      let i = i0 - 1, k = -1;
      for (; i + 1 < st.length && i < i0 + 6; i++) { k = st[i].ch.findIndex((x, j) => x.off === 0x60 && st[i + 1].ch[j].off === 0xc0); if (k >= 0) break; }
      if (k < 0) continue;
      const slot = st[i].w;                           // the block mixed in frame i -> i + 1 sits at ring slot w
      let h = i + 1, iop = null;
      for (; h + 1 < st.length && iop === null; h++) {
        let r = st[h].r, nx = st[h].next;
        while (r !== st[h + 1].r) { if (r === slot) iop = nx; r = (r + 1) & 7; nx = (nx + 1) & 15; }
      }
      const pEnd = st[h].play, ahead = ((iop - pEnd) % 16 + 16) % 16;
      let adv = 0;
      for (let j = i0; j <= h; j++) adv += ((st[j].play - st[j - 1].play) % 16 + 16) % 16;
      const slots = adv + ahead;                      // from the start of playVoice's frame (record i0 - 1)
      // the same from the rules: replay the wakes from playVoice's frame with the trace's IOP slots
      const q = new PcmQueues({ w: st[i0 - 1].w, r: st[i0 - 1].r, next: st[i0 - 1].next, mixed: 0, sent: 0 });
      let mixedIdx = [], j = i0 - 1, b0 = null, sentAt = null;
      // the channel's first block = the first mixed in or after playVoice's frame (the trace's channel shows which frame)
      const firstFrame = i;                           // frame i -> i + 1 mixed sample 0's block; the offset-0 block was before it
      for (; j + 1 < st.length; j++) {
        const m0 = q.mixed, s0 = q.sent, nx0 = q.next;
        q.wake(Math.floor(st[j + 1].play) & 15);
        if (j === firstFrame && q.mixed > m0) b0 = m0 + 7;     // its index among the sends from here (7 queued ahead of it)
        if (b0 !== null && q.sent > b0) { sentAt = { j, slot: (nx0 + (b0 - s0)) & 15 }; break; }
      }
      const rel = sentAt ? (() => { let a2 = 0; for (let x = i0; x <= sentAt.j + 1; x++) a2 += ((st[x].play - st[x - 1].play) % 16 + 16) % 16; return a2 + (((sentAt.slot - st[sentAt.j + 1].play) % 16 + 16) % 16); })() : null;
      // the page's loads take no time: measured from the start of the frame that mixed the offset-0 block (the game's
      // voice data was in 0 / 1 / 2 frames after playVoice: FUN_003eab20 mixes nothing until then)
      let wait = 0; for (let j = i0; j < i; j++) wait += ((st[j].play - st[j - 1].play) % 16 + 16) % 16;
      gameDelays.push((slots - wait) * BLOCK_S);
      ok(rel === slots, `${nm} playVoice f${c.frame}: sample 0 heard ${slots} slots (${(slots * BLOCK_S * 1000).toFixed(1)} ms) after its frame's start; the rules give ${rel}`);
    }
  }
}

// ---- 2. The page's ring on the AudioContext clock ----
{
  const ring = new PcmRing(0);
  let worst = [99, -99], q7 = true;
  for (let t = FRAME_S; t < 20; t += FRAME_S) {
    ring.advance(t + 1e-6);
    const ahead = ring.q.sent - Math.floor(t / BLOCK_S * 4 + 1e-9) / 4;   // the IOP's reply moves in 256-sample steps (T)
    worst = [Math.min(worst[0], ahead), Math.max(worst[1], ahead)];
    if (ring.q.queued() !== 7) q7 = false;
  }
  ok(q7 && worst[0] >= 15 && worst[1] <= 16, `page ring over 20 s: 7 queued after every wake, the IOP ${worst[0].toFixed(2)} .. ${worst[1].toFixed(2)} slots ahead (T w266: 7, 15.25 .. 16)`);
  // a voice asked for at the start of a frame (as T's records): heard over a range of phases
  const r2 = new PcmRing(0), d = [];
  for (let k = 1; k < 500; k++) { const T = k * FRAME_S + 1e-6; d.push(r2.heard(r2.blockAt(T) + 1) - T); }
  const lo = Math.min(...d), hi = Math.max(...d);
  const q4 = BLOCK_S / 4;                         // T's play address: 256-sample steps
  ok(lo > 0.45 && hi < 0.56 && (!gameDelays.length || gameDelays.every(g => g >= lo - q4 && g <= hi + q4)),
    `page: sample 0 heard ${(lo * 1000).toFixed(1)} .. ${(hi * 1000).toFixed(1)} ms after playVoice at a frame's start (T: ${gameDelays.map(g => (g * 1000).toFixed(1)).join(', ') || 'SKIPPED'} ms from the start of the frame that mixed its offset-0 block; T's play address in 5.3 ms steps)`);
}

{
  // blockAt(T) after the wakes have run past T (music.js pump's mixedAt looks ahead): the same count as without the look-ahead
  const a = new PcmRing(0), b = new PcmRing(0);
  let bad = 0;
  for (let k = 1; k < 300; k++) { const T = k * FRAME_S * 0.731; const x = a.blockAt(T); b.mixedAt(a.q.mixed + 40); if (b.blockAt(T) !== x) bad++; }
  ok(bad === 0, `blockAt(T) after a look-ahead past T = without it (${bad} of 299 differ)`);
}

// ---- 3. VoicePlayer on the ring (a stand-in AudioContext) ----
{
  const { VoicePlayer } = await import(pathToFileURL(path.join(base, 'event_sound.js')));
  const { pcmRing } = await import(pathToFileURL(path.join(base, 'pcm_ring.js')));
  const made = [];
  const ctx = { currentTime: 0, destination: {}, decodeAudioData: async () => ({ duration: 3 }),
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBufferSource: () => { const s = { connect() {}, start: (at, off) => { s.at = at; s.off = off; made.push(s); }, stop: (t) => { s.stop = t; } }; return s; } };
  const ring = pcmRing(ctx);
  const V = new VoicePlayer({ ctx });
  const chan = (n, p = Promise.resolve(new ArrayBuffer(4))) => V.bufs.set(n, { file: p, buf: null });
  chan('a');
  ctx.currentTime = 1.0; V.play('a'); await new Promise(r => setTimeout(r, 5));
  const b1 = ring.blockAt(1.0);
  ok(made.length === 1 && made[0].at === ring.heard(b1 + 1) && made[0].off === 0, `playVoice at 1.0 s: the offset-0 frame in block ${b1}, sample 0 heard with block ${b1 + 1} at ${made[0].at.toFixed(4)} s`);
  // decoded late (the channel had no data, FUN_003eab20 returns before moving): starts later from its beginning
  let rel; chan('b', new Promise(r => { rel = r; }));
  ctx.currentTime = 2.0; V.play('b'); ctx.currentTime = 2.7; rel(new ArrayBuffer(4)); await new Promise(r => setTimeout(r, 5));
  ok(made.length === 2 && made[1].off === 0 && made[1].at === ring.heard(ring.blockAt(2.7) + 1), `a voice decoded 0.7 s late starts from 0 at ${made[1].at.toFixed(4)} s (block ${ring.blockAt(2.7) + 1}), not skipped in`);
  // the event pause: what was mixed plays to the end of its last block; the resume goes on from there at the next block
  made.length = 0; chan('c');
  ctx.currentTime = 4.0; V.play('c'); await new Promise(r => setTimeout(r, 5));
  const s0 = made[0], b0 = ring.blockAt(4.0) + 1, rc = V.playing.find(x => x.name === 'c');
  ctx.currentTime = 5.0; V.pause(true);
  const bp = ring.blockAt(5.0);
  ok(s0.stop === ring.heard(bp) && Math.abs(rc.off - (bp - b0) * BLOCK_S) < 1e-9, `pause at 5.0: heard to block ${bp}'s start (${s0.stop.toFixed(4)} s), ${bp - b0} blocks of it mixed`);
  ctx.currentTime = 7.0; V.pause(false);
  const sr = rc.src;
  ok(sr.at === ring.heard(ring.blockAt(7.0)) && Math.abs(sr.off - (bp - b0) * BLOCK_S) < 1e-9, `resume at 7.0: from block ${ring.blockAt(7.0)} at that offset`);
  // Skip (FUN_003ea3d0): the mixed blocks play out
  ctx.currentTime = 7.5; V.stopAll();
  ok(sr.stop === ring.heard(ring.blockAt(7.5)), 'stopAll at 7.5: heard to the next block mixed');
}

console.log((fails ? 'FAILED ' : 'ok ') + oks + ' passed, ' + fails + ' failed' + (MUT ? ' (mutant ' + MUT + ')' : ''));
process.exit(fails ? 1 : 0);
