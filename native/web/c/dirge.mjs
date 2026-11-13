// c/dirge.mjs -- loads the C build (native/web/wasm/dirge.mjs + .wasm, from `cmake --build --preset wasm`) for the
// node tests, without running main: the adapters next to this file call its exports. Migration plan step 0,
// "How parity is checked": a node test that takes a module path runs against the C by passing c/<module>.mjs.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = process.env.DIRGE_WASM ? path.resolve(process.env.DIRGE_WASM) : path.join(here, '../wasm/dirge.mjs');   // DIRGE_WASM: another build (mutation runs)
if (!existsSync(mod)) throw new Error('c/dirge.mjs: no native/web/wasm/dirge.mjs; build it: source ~/emsdk/emsdk_env.sh; cd native; cmake --preset wasm; cmake --build --preset wasm');
const { default: createDirge } = await import(pathToFileURL(mod).href);
export const M = await createDirge({ print: () => {}, printErr: s => console.error('[c]', s) });

// float scratch in the wasm heap (n floats, kept for the process)
export function floats(n) {
  const p = M._malloc(n * 4);
  return { ptr: p, set(i, v) { M.HEAPF32[(p >> 2) + i] = v; } };
}
