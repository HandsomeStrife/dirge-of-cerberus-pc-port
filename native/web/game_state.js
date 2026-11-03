// Game-state bits (worker 0220; agreed with worker 0219's stage controller): the bit words at *(*DAT_0046e294 + 4),
// set / clear / test by FUN_00326018 / FUN_00326040 / FUN_00326068 (-> FUN_0036b5b0 / FUN_0036b5e0 / FUN_0036b610).
// One module-level store, as the game has one (reset() at a stage reload).
// Bits used on the page (decoded; notes/message-research.md):
//   2  Zone.event FUN_0037e048 sets, battle FUN_0037cf30 clears (worker 0219)
//   6  AI paused: FUN_00325b10(on); Zone.peace FUN_00380290(ev, 1) -> FUN_0037def0 sets it, chaos clears it.
//      Read by the AI scheduler FUN_00365008 (FUN_00325b40), the melee attack FUN_00569dc0, FUN_00569870, and the
//      player's damage FUN_0055c7f8
//   10 peace / chaos counter (FUN_0037df80 -> FUN_003809a8, worker 0219)
//   11 user control off: FUN_00325b60(on) from set_usercontrol / free_usercontrol; FUN_00331f08 skips the player's
//      control update (vt+0x5c) while it is set, FollowCamera FUN_0032ace0 takes no stick input
const words = new Uint32Array(4);
const listeners = new Set();

export const AI_PAUSED = 6;
export const NO_USER_CONTROL = 11;

function note(n, on) { for (const f of listeners) f(n, on); }
export function set(n) { const w = n >>> 5, b = 1 << (n & 31); if (!(words[w] & b)) { words[w] |= b; note(n, true); } }     // FUN_00326018
export function clear(n) { const w = n >>> 5, b = 1 << (n & 31); if (words[w] & b) { words[w] &= ~b; note(n, false); } }  // FUN_00326040
export function test(n) { return (words[n >>> 5] >>> (n & 31)) & 1; }                                                      // FUN_00326068
export function reset() { for (let i = 0; i < words.length; i++) words[i] = 0; note(-1, false); }
// FUN_00325b40: the AI pause test
export function aiPaused() { return test(AI_PAUSED) !== 0; }
// tests / page probes
export function snapshot() { return Array.from(words); }
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }
