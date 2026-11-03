// test_audio.mjs -- audio.js on synthetic data (no game files). node native/web/test_audio.mjs
// AUDIO_JS=<path> tests another copy (mutation runs).
import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = await import(pathToFileURL(process.env.AUDIO_JS || path.join(here, 'audio.js')).href);
let pass = 0;
const t = (name, f) => { f(); pass++; console.log('ok', name); };

// Blocks: A filter 0 shift 0 (nibbles 0..15, 15..4); B filter 2 shift 3 with loop start; C filter 4,
// shift 13 (SPU2 uses 9), end + repeat. Expected values from tools/audio/adpcm.py (cross-checked
// against native/assets/audio/dirge_wd on all 248 regions of wave0000).
const ABC = Uint8Array.from([0, 0, 16, 50, 84, 118, 152, 186, 220, 254, 239, 205, 171, 137, 103, 69, 35, 4, 135, 25, 15, 195,
  135, 25, 15, 195, 135, 25, 15, 195, 85, 102, 77, 3, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120]);
const ABC_PCM = [0, 4096, 8192, 12288, 16384, 20480, 24576, 28672, -32768, -28672, -24576, -20480, -16384, -12288, -8192,
  -4096, -4096, -8192, -12288, -16384, -20480, -24576, -28672, -32768, 28672, 24576, 20480, 16384, 16384, 12032, 4724,
  -776, -5745, -9693, -11214, -14323, -13042, -15894, -21547, -25292, -28452, -30575, -30287, -31628, -28640, -29861,
  -32768, -32768, -32768, -32256, -29800, -29387, -26033, -20342, -12329, -2554, 6625, 15079, 22469, 28750, 32767, 32767,
  31679, 29725, 26900, 23466, 19449, 15131, 10546, 5974, 1437, -2806, -6761, -10202, -13174, -15493, -17247, -18297,
  -18774, -18579, -17880, -16610, -14965, -12900];

t('ADPCM blocks (filters 0 / 2 / 4, shift 13 -> 9, clamping)', () => {
  const { pcm, loop } = A.decodeSample(ABC, 0);
  assert.deepStrictEqual(Array.from(pcm), ABC_PCM);
  assert.strictEqual(loop, 28);                    // B's loop-start flag, kept because C repeats
});

t('ADPCM loop start then end without repeat: no loop', () => {
  const L = new Uint8Array(32); L[0] = 0; L[1] = 4; L[16] = 0; L[17] = 1;   // block 0 loop start, block 1 end (no repeat)
  assert.strictEqual(A.decodeSample(L, 0).loop, -1);
  L[17] = 3;                                                                    // end + repeat keeps it
  assert.strictEqual(A.decodeSample(L, 0).loop, 0);
});

t('pitch product is the 32-bit truncated mult (FUN_000012b0 mflo; srl 16)', () => {
  const big = { semitone: Array(12).fill(0xfffff), fine: Array(256).fill(0xffff) };
  // key 127: shift (10 - 10) = 0, product 0xfffff * 0xffff overflows 32 bits
  assert.strictEqual(A.spuPitch(big, 127 << 20, 0, 0, 0), 0xffef);   // low 32 bits 0xffef0001
});

t('ADPCM end without repeat drops the loop; filter 1 / shift 12 continues the history', () => {
  const D = Uint8Array.from([28, 1, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17]);
  const AD = new Uint8Array(32); AD.set(ABC.subarray(0, 16)); AD.set(D, 16);
  const { pcm, loop } = A.decodeSample(AD, 0);
  assert.strictEqual(pcm.length, 56);
  assert.strictEqual(loop, -1);
  assert.deepStrictEqual(Array.from(pcm.subarray(28, 34)), [15361, 14401, 13501, 12658, 11867, 11126]);
});

const drv = {
  semitone: Array.from({ length: 12 }, (_, i) => (1 << 20) + i * 4096),
  fine: Array.from({ length: 256 }, (_, i) => 0x10000 + i * 16),
  pan: Array.from({ length: 256 }, (_, i) => i * 2),
  rng: Array.from({ length: 256 }, (_, i) => (i * 37) & 0xff),
};

t('pitch FUN_000012b0: octave shift, tune, negative wrap, fine step', () => {
  assert.strictEqual(A.spuPitch(drv, 60 << 20, 0, 0, 0), (1 << 20) >>> 5);
  assert.strictEqual(A.spuPitch(drv, 60 << 20, 0, -(12 * 256) << 16, 0), (1 << 20) >>> 6);
  assert.strictEqual(A.spuPitch(drv, 0, 0, -256 << 16, 0), ((1 << 20) + 11 * 4096) >>> 11);
  assert.strictEqual(A.spuPitch(drv, 61 << 20, 3, 0, 0), Math.floor(((1 << 20) + 4096) / 32 * (0x10000 + 48) / 65536));
});

t('region select FUN_00001c5c: key splits', () => {
  const regs = [{ flags: 0x10000, keyHi: 40, velHi: 127 }, { flags: 0, keyHi: 70, velHi: 127 }, { flags: 0x200, keyHi: 127, velHi: 127 }];
  assert.strictEqual(A.selectRegion(regs, 30, 0), 0);
  assert.strictEqual(A.selectRegion(regs, 50, 0), 1);
  assert.strictEqual(A.selectRegion(regs, 100, 0), 2);
  assert.strictEqual(A.selectRegion(regs, 40, 0), 0);    // key == high key stays in the region
  assert.strictEqual(A.selectRegion(regs, 70, 0), 1);
  assert.strictEqual(A.selectRegion([{ flags: 0, keyHi: 10 }, { flags: 0x200, keyHi: 90 }], 50, 0), 0);  // no 0x30000: first
});

// One looping block (flags 7), ADSR1 0x000f (fast attack, sustain level 15), ADSR2 0x1fc0 | 0x0d.
const loopBlk = new Uint8Array(16); loopBlk[0] = 0x00; loopBlk[1] = 7; loopBlk.fill(0x77, 2);
const bank = { instruments: [[{ flags: 0x200, start: 0, loop: 0, adsr: (0x1fcd << 16) | 0x000f, tune: 0, keyHi: 127, velHi: 127, vol: 127, pan: 0, mode: 0 }]], data: loopBlk };
// playback tables: note 60 -> pitch 0x1000 (48 kHz)
const drv2 = { ...drv, semitone: Array.from({ length: 12 }, (_, i) => 0x20000 + i * 0x2000) };
const prog = (track) => Uint8Array.from([1, 0, 0, 0, 0, track.length, 0, ...track]);

t('SE tick FUN_00007224: 240 Hz ticks, 120 / 300 counter, key-on / auto key-off one tick late', () => {
  // delta 0: program 0; delta 0: note on 60; delta 10: end
  const r = new A.SeRenderer(drv2, bank);
  const o = r.render(prog([0, 0x20, 0, 0, 0x12, 60, 10, 0]));
  // sequence ticks at driver ticks 0, 2, 5, 7, 10, ... (counter 1 - 120 -> +300); the note's 10 ticks
  // reach 1 at driver tick 22 -> key-off queued, applied at 23
  assert.deepStrictEqual(o.events.filter((e) => 'on' in e || 'off' in e).slice(0, 2), [{ t: 1, on: 60 }, { t: 23, off: 60 }]);
  assert.strictEqual(Math.max(...o.left.subarray(0, 200).map(Math.abs)), 0);   // nothing before tick 1
  assert.ok(Math.max(...o.left.subarray(200, 400).map(Math.abs)) > 0);
});

t('SE tick rate over a long note: 2 sequence ticks per 5 driver ticks', () => {
  // delta 120 (VLQ 0x78): remaining reaches 1 at sequence tick 119 = driver tick 59 * 5 + 2 = 297
  const r = new A.SeRenderer(drv2, bank);
  const o = r.render(prog([0, 0x20, 0, 0, 0x12, 60, 0x78, 0]));
  assert.deepStrictEqual(o.events.slice(0, 2), [{ t: 1, on: 60 }, { t: 298, off: 60 }]);
});

t('hold (0x2a) ignores note-off; the last track ending keys the voice off', () => {
  const r = new A.SeRenderer(drv2, bank);
  const o = r.render(prog([0, 0x2a, 0, 0x20, 0, 0, 0x12, 60, 10, 0]));
  assert.deepStrictEqual(o.events.slice(0, 2), [{ t: 1, on: 60 }, { t: 26, off: 60 }]);   // end at 25, applied 26
});

t('loops 0x04 / 0x05 n run the body n times', () => {
  const r = new A.SeRenderer(drv2, bank);
  const o = r.render(prog([0, 0x20, 0, 0, 0x04, 0, 0x12, 60, 1, 0x05, 3, 0, 0]));
  assert.strictEqual(o.events.filter((e) => 'on' in e).length, 3);
});

t('volume law FUN_00001380 (master 0x7f, full volume / expression, region vol 127, pan 0x40)', () => {
  const r = new A.SeRenderer(drv, bank);
  const trk = { expr: 0x3fff000, vol: 0x3fff000, seqVol: 0x7f << 12, pan: 0x40 << 12 };
  const v = { trk, region: bank.instruments[0][0], vel: 0, vflags: 0, note: 60 << 20, pitchRnd: 0, volRnd: 0, panRnd: 0 };
  r.updateVoice(v);
  assert.strictEqual(v.volL, 8127);                 // master 507: 16255 * pan[0x40] (128) >> 8
  assert.strictEqual(v.volR, 8000);                 // 16255 * pan[0x3f] (126) >> 8
});

// worker 0215: the IOP's update / stop of a running SE (placed sounds, ambient.js SlotStreams)
// an endless track: instrument 0, note on, loop back forever (op 0x06) after a long delta
const endless = prog([0, 0x20, 0, 0, 0x04, 0, 0x12, 60, 100, 0x81, 0x00, 0x06]);
t('cmd 0x30 (SeRenderer.update): pan / sequence volume slide over time x 96 / 60 = 16 sequence ticks', () => {
  const r = new A.SeRenderer(drv2, bank);
  r.start(endless, 0x40, 0x40);
  const trk = r.tracks[0];
  r.update(0x20, 0x60, 10);
  assert.strictEqual(trk.seqVolTicks, 16);
  assert.strictEqual(trk.seqVolStep, Math.trunc((((0x20 << 12) | 0x800) - (0x40 << 12)) / 16));
  assert.strictEqual(trk.panTicks, 16);
  assert.strictEqual(trk.panStep, Math.trunc((((0x60 << 12) | 0x800) - (0x40 << 12)) / 16));
  // 16 sequence ticks = 40 driver ticks (96 / s at 240 Hz): the slide lands on the targets' >> 12
  const L = new Float32Array(200 * 60), R = new Float32Array(200 * 60);
  for (let i = 0; i < 60; i++) r.tick(i, L, R, i * 200);
  assert.strictEqual(trk.seqVol >> 12, 0x20);
  assert.strictEqual(trk.pan >> 12, 0x60);
  assert.strictEqual(trk.seqVolTicks, 0);
});

t('cmd 0x30 skips programs whose flag byte has 0x10 (track +0x1a1)', () => {
  const r = new A.SeRenderer(drv2, bank);
  const p = endless.slice(); p[4] = 0x10;
  r.start(p, 0x40, 0x40);
  r.update(0x20, 0x60, 10);
  assert.strictEqual(r.tracks[0].seqVolTicks, 0);
});

t('cmd 0x2f (SeRenderer.stopFade): sequence volume to 0 over 16 ticks, then the track ends and the voice is keyed off', () => {
  const r = new A.SeRenderer(drv2, bank);
  r.start(endless, 0x7f, 0x40);
  const L = new Float32Array(200 * 400), R = new Float32Array(200 * 400);
  let t0 = 0;
  for (; t0 < 10; t0++) r.tick(t0, L, R, t0 * 200);
  r.stopFade(10);
  const trk = r.tracks[0];
  assert.strictEqual(trk.seqVolTicks, 16);
  assert.strictEqual(trk.seqVolStep, Math.trunc((0x800 - (0x7f << 12)) / 16));
  let done = false;
  for (; t0 < 400 && !done; t0++) done = r.tick(t0, L, R, t0 * 200);
  assert.strictEqual(trk.active, false);
  assert.ok(done, 'the SE ends after the fade (release)');
  assert.ok(t0 > 10 + 40 - 2 && t0 < 400, 'ends after the 16-tick fade: ' + t0);
});

console.log(`${pass} passed`);
