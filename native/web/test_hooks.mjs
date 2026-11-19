// Node loader hook for the unit tests: stubs the three.js import (player.js only needs a few names),
// and turns missing test data into SKIP (FAIL under DIRGE_REQUIRE_DATA=1; see test_data.mjs).
import { register } from 'node:module';
import './test_data.mjs';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: 'data:text/javascript,' + encodeURIComponent('export class AnimationMixer{}; export const LoopRepeat=2201, LoopOnce=2200; export class Vector3{}; export class DataTexture{constructor(d){this.image={data:d};}}; export const RGFormat=1030, FloatType=1015, NearestFilter=1003;'), shortCircuit: true };
  return next(spec, ctx);
}`));
