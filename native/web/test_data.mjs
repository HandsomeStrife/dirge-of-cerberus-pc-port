// Missing test inputs (our PCSX2 traces, GS dumps, save states, the disc build in data/, elf/, extract/):
// a test that lacks one prints `SKIP <test>: no <kind> <path> (see docs/CONTRIBUTING.md)` and exits 0,
// except in strict mode, where it prints `FAIL ...` and exits 1. Strict is on when the gitignored marker
// tools/trace/out/.require-data exists (a machine that has all the data: ours), or with DIRGE_REQUIRE_DATA=1;
// DIRGE_REQUIRE_DATA=0 turns it off.
//
// Imported by test_hooks.mjs (so every node test run with --import ./native/web/test_hooks.mjs has it);
// a page test can import it directly. On import it wraps the fs calls tests use to look for files, so
// the tests' own `if (!existsSync(trace)) skip` checks are counted too, with no change to the tests:
//  - a lookup under a data folder that finds nothing is remembered; at exit each one is reported
//    (SKIP line; strict: a FAIL line and exit status 1);
//  - an uncaught ENOENT under a data folder ends the test with that SKIP / FAIL instead of a crash;
//  - a test that printed a FAIL line exits 1 whichever way it ends.
// With all data present nothing is reported and no test's result changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REQUIRE_MARKER = path.join(REPO, 'tools/trace/out/.require-data');
const env = process.env.DIRGE_REQUIRE_DATA;
export const REQUIRE_DATA = env === '1' || (env !== '0' && fs.existsSync(REQUIRE_MARKER));
// The save state the trace tools and a few tests load; ours is a symlink, see docs/CONTRIBUTING.md.
export const SAVE_STATE = process.env.DIRGE_SAVE_STATE || path.join(REPO, 'tools/trace/out/save-states/sea-of-flames.p2s');

const ROOTS = [
  ['save state', path.dirname(SAVE_STATE)],
  ['trace', path.join(REPO, 'tools/trace/out')],
  ['GS dump', path.join(REPO, 'tools/gsdump/dumps')],
  ['disc build file', path.join(REPO, 'native/web/data')],
  ['ELF', path.join(REPO, 'elf')],
  ['extract file', path.join(REPO, 'extract')],
];
if (process.env.TRACE_OUT) ROOTS.unshift(['trace', path.resolve(process.env.TRACE_OUT)]);
if (process.env.CAM_TRACES) ROOTS.unshift(['trace', path.resolve(process.env.CAM_TRACES)]);

const testName = () => path.basename(process.argv[1] || 'test', '.mjs');
const rel = p => (p.startsWith(REPO + path.sep) ? path.relative(REPO, p) : p);

/** The kind of data file `p` is ('trace', 'GS dump', ...), or null if it isn't under a data folder. */
export function dataKind(p) {
  if (typeof p !== 'string' && !(p instanceof URL)) return null;
  const abs = path.resolve(p instanceof URL ? fileURLToPath(p) : p);
  for (const [kind, root] of ROOTS) if (abs === root || abs.startsWith(root + path.sep)) return kind;
  return null;
}

const missed = new Map();     // abs path -> kind
let quiet = 0;                // inside rmSync etc., whose own internal lookups aren't the test looking for data
function note(p) {
  const kind = dataKind(p);
  if (quiet) return kind;
  if (kind) missed.set(path.resolve(p instanceof URL ? fileURLToPath(p) : p), kind);
  return kind;
}
/** How many data files this test looked for and didn't find. */
export const dataMissing = () => missed.size;

function line(kind, p) {
  if (kind === 'file') return `FAIL ${testName()}: no ${rel(p)} (not test data: a wrong path in the test)`;
  return REQUIRE_DATA ? `FAIL ${testName()}: no ${kind} ${rel(p)} (strict: ${env === '1' ? 'DIRGE_REQUIRE_DATA=1' : rel(REQUIRE_MARKER)})`
    : `SKIP ${testName()}: no ${kind} ${rel(p)} (see docs/CONTRIBUTING.md)`;
}
function report() {
  for (const [p, kind] of missed) console.log(line(kind, p));
  missed.clear();
}

const rawExists = fs.existsSync;
/** existsSync for a file a test can do without even on our machine (not reported as missing). */
export const optionalExists = p => rawExists(p);

/** For a test that counts a missing input as a failure: 0 when `file` is test data (reported as SKIP or,
 *  under DIRGE_REQUIRE_DATA=1, FAIL by this module), 1 when it isn't (still the test's own failure). */
export function missingIsFail(file) { return note(file) ? 0 : 1; }

/** Stops the test when any of `files` is missing: SKIP (exit 0), or FAIL (exit 1) in strict mode. A missing
 *  path outside the data folders is a bug in the test: FAIL and exit 1 in both modes. */
export function need(...files) {
  let gone = false, bug = false;
  for (const f of files.flat()) if (!fs.existsSync(f)) { gone = true; if (!dataKind(f)) { bug = true; missed.set(path.resolve(f), 'file'); } }
  if (gone) process.exit(REQUIRE_DATA || bug ? 1 : exitCode());
}

// FAIL lines the test printed (the suite's pattern): such a test never exits 0.
let failPrinted = false;
const FAIL_RE = /^\s*(FAIL\b|\d+ FAILED\b)/m;
const exitCode = () => (failPrinted ? 1 : process.exitCode ?? 0);

if (!globalThis.__dirgeTestData) {
  globalThis.__dirgeTestData = true;
  for (const name of ['log', 'error']) {
    const f = console[name];
    console[name] = function (...args) { if (args.length && FAIL_RE.test(String(args[0]))) failPrinted = true; return f.apply(this, args); };
  }
  fs.existsSync = p => { const r = rawExists(p); if (!r) note(p); return r; };
  for (const name of ['readFileSync', 'statSync', 'lstatSync', 'readdirSync', 'openSync', 'accessSync']) {
    const f = fs[name];
    fs[name] = function (p, ...rest) {
      try { return f.call(this, p, ...rest); }
      catch (e) { if (e && e.code === 'ENOENT') note(p); throw e; }
    };
  }
  for (const name of ['rmSync', 'rmdirSync', 'mkdirSync', 'writeFileSync', 'copyFileSync', 'symlinkSync', 'cpSync']) {
    const f = fs[name];
    fs[name] = function (...args) { quiet++; try { return f.apply(this, args); } finally { quiet--; } };
  }
  syncBuiltinESMExports();
  process.on('uncaughtException', e => {
    if (e && e.code === 'ENOENT' && dataKind(e.path)) { note(e.path); process.exit(REQUIRE_DATA ? 1 : exitCode()); }
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
  process.on('exit', code => {
    const bug = [...missed.values()].includes('file');
    if (missed.size) report();
    if ((missed.size && (REQUIRE_DATA || bug)) || (failPrinted && !code)) process.exitCode = 1;
  });
}
