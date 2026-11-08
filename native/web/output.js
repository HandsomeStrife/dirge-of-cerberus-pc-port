// PS2 display output stage (PCRTC merge), as the game sets it every frame.
//
// FUN_0040ce28 (the per-frame flip) calls FUN_0040d228(env, buf, 1, 1), which writes:
//   PMODE    = env.pmode | 0x8021      -> EN1=EN2=1, MMOD=1 (fixed alpha), ALP=0x80, SLBG=0
//   DISPFB1  = DISPFB2 = buf.dispfb    -> both read circuits read the same framebuffer
//   DISPLAY1 = DISPLAY2 - ((1 << 12) | 1)
// so circuit 2 sits one raster line lower (DY+1) and one VCK to the right (DX+1) of
// circuit 1. All GS dumps agree (DISPLAY1 DX 655 DY 71, DISPLAY2 DX 656 DY 72,
// MAGH 5 (6 VCK per pixel), MAGV 0, DW 2552, DH 511 = 512 lines, SMODE2 INT=1 FFMD=0:
// interlaced frame mode, so DY counts framebuffer rows). The merge circuit outputs
//   out = ALP * C1 + (1 - ALP) * C2,  ALP = 0x80 / 255
// with C1 = fb(x, y) and C2 = fb(x - 1 VCK, y - 1 row); BGCOLOR (0) where circuit 2
// has not started (the top row, the first VCK).
//
// Native mode (default): the game's own resolution.
//   Scene: drawn into FRAME FBP 224 (FBW 448, PSM CT32) with SCISSOR 0-431 x 0-511 and
//   XYOFFSET (1824, 1792) in every gameplay draw of every dump: a 432 x 512 target, the
//   same every frame (frame mode: both fields come from the one 512-line frame).
//   Projection: FUN_0040d478 builds the view->screen matrix with FUN_00263c70
//   (sceVu0ViewScreenMatrix: sx = scrz*ax*X/Z + cx, sy = scrz*ay*Y/Z + cy) from the
//   display struct 0x4fc7d0: scrz = +0x304, ax = 1, ay = +0x2f8, cx = 2048 + (+0x320),
//   cy = 2048 + (+0x324). scrz = (+0x2e8) * 0.5 / tan(FOV/2) (FUN_0040ce28, FUN_0040d670).
//   sea-of-flames.p2s RAM: +0x2e8 = 448, +0x300 FOV = 73.5, +0x2f8 = 1.5, +0x320 = -11,
//   +0x324 = 0 -> scrz 299.972, centre at drawable (213, 256). The fitted hero camera
//   (fit_dump_camera.py: 299.971 / 449.957 px, centre 213.0) agrees.
//   GUESS: GS pixel sample point = GL's (pixel centre); the projected centre 213, 256 is put
//   at GL window 213, 256. Not decoded on hardware; matches the GS-dump oracle (gsrender2
//   samples at +0.5) to 0.1 px, where a +0.5 shift left a 0.5 px offset. See fidelity audit.
//   Copy: the frame is copied FBP 224 -> FBP 112 (CT24) as 32-px sprites, X 1:1, which
//   DISPFB (FBP 112, DBX 0, DBY 0) shows. Ported as the same pixels (see GUESS below).
//   Merge: at VCK resolution, (DW + 1) = 2553 VCK x 512 lines, C1 = col floor(k / 6),
//   C2 = col floor((k - 1) / 6) one row up: exact, no fractional offsets.
//   Display: the 2553 x 512 window is shown 4:3 (what PCSX2 and a TV do with it),
//   letterboxed/pillarboxed into the canvas.
// Full mode (the default, Dan's choice 2026-10-28; `?res=native` gives native mode): today's sharp render at
//   canvas resolution, the camera's aspect filling the whole canvas, and the merge with
//   fractional offsets (one line = H / 512 canvas px, one VCK = (4/3 H / 425.5) / 6 px).
// The circuit-2 mix runs by default only in native mode; `?outblur=1` / `0` forces it on / off.
import * as THREE from 'three';

const ALP = 0x80 / 255;          // PMODE.ALP, FUN_0040d228 (| 0x8021)
const LINES = 512;               // DISPLAY.DH + 1
const VCKS = 2552 + 1;           // DISPLAY.DW + 1
const MAGH = 5 + 1;              // VCK per framebuffer pixel
const COLS = VCKS / MAGH;        // 425.5 framebuffer columns shown
const VCK = 1 / MAGH;            // circuit 2 DX + 1, in framebuffer pixels
export const FB_W = 432, FB_H = 512;            // scene SCISSOR (FRAME FBP 224)
const SCR_W = 448, FOV = 73.5, AY = 1.5;        // 0x4fc7d0 +0x2e8, +0x300, +0x2f8
const CX = 2048 - 11 - 1824, CY = 2048 + 0 - 1792;   // +0x320/+0x324 less XYOFFSET -> 213, 256
const SCRZ = SCR_W * 0.5 / Math.tan(FOV * 0.008726647);   // FUN_0040d670
const DISPLAY_ASPECT = 4 / 3;    // PAL 4:3 (the game has no 16:9 output; see fidelity audit)

const VS = `in vec3 position; out vec2 uv;
  void main() { uv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function quadPass(fragmentShader, uniforms) {
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: VS, fragmentShader,
                                            depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  return { mat, scene };
}

export function createOutputStage(renderer, { enabled = true, msaa = false, native = true, wideHud = false } = {}) {
  const qCam = new THREE.Camera();
  const size = new THREE.Vector2();

  // ---- full mode (improvement option): canvas-size target, fractional merge offsets
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true, type: THREE.UnsignedByteType, samples: msaa ? 4 : 0,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const full = quadPass(`precision highp float; in vec2 uv; out vec4 o;
      uniform sampler2D src; uniform vec2 off; uniform float alp;
      void main() {
        vec3 c1 = texture(src, uv).rgb;
        vec2 u2 = uv + vec2(-off.x, off.y);            // GL v is up: the row above is +v
        vec3 c2 = (u2.x >= 0.0 && u2.y <= 1.0) ? texture(src, u2).rgb : vec3(0.0);   // BGCOLOR
        o = vec4(alp * c1 + (1.0 - alp) * c2, 1.0);
      }`, { src: { value: rt.texture }, off: { value: new THREE.Vector2() }, alp: { value: ALP } });

  // ---- native mode: 432x512 scene -> 2553x512 VCK merge -> 4:3 box
  const fbRT = new THREE.WebGLRenderTarget(FB_W, FB_H, {
    depthBuffer: true, type: THREE.UnsignedByteType, samples: msaa ? 4 : 0,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  // GUESS: last scale, the analog picture to canvas pixels, is linear (bilinear) filtered.
  // Not decodable: the PCRTC output is an analog signal and the TV reconstructs it
  // continuously along a line (no pixel edges); the lines themselves are separate, but
  // 512 lines into ~1900 px with nearest would give rows of uneven height. Linear also
  // matches PCSX2's default display filter. See notes/fidelity-audit.md.
  const vckRT = new THREE.WebGLRenderTarget(VCKS, LINES, {
    depthBuffer: false, type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const merge = quadPass(`precision highp float; in vec2 uv; out vec4 o;
      uniform sampler2D src; uniform float alp, c2on;
      void main() {
        int k = int(gl_FragCoord.x);                   // VCK from the window start
        int line = ${LINES - 1} - int(gl_FragCoord.y); // display line, top = 0
        vec3 c1 = texelFetch(src, ivec2(k / ${MAGH}, ${FB_H - 1} - line), 0).rgb;
        vec3 c2 = vec3(0.0);                           // BGCOLOR before circuit 2 starts
        if (k >= 1 && line >= 1) c2 = texelFetch(src, ivec2((k - 1) / ${MAGH}, ${FB_H} - line), 0).rgb;
        if (c2on < 0.5) { o = vec4(c1, 1.0); return; }
        o = vec4(alp * c1 + (1.0 - alp) * c2, 1.0);
      }`, { src: { value: fbRT.texture }, alp: { value: ALP }, c2on: { value: 1 } });
  const present = quadPass(`precision highp float; in vec2 uv; out vec4 o;
      uniform sampler2D src;
      void main() { o = vec4(texture(src, uv).rgb, 1.0); }`, { src: { value: vckRT.texture } });

  // 4:3 box (letterbox / pillarbox) inside a w x h target, GL origin bottom-left
  function box(w, h) {
    let bw = w, bh = Math.round(w / DISPLAY_ASPECT);
    if (bh > h) { bh = h; bw = Math.round(h * DISPLAY_ASPECT); }
    return { x: Math.floor((w - bw) / 2), y: Math.floor((h - bh) / 2), w: bw, h: bh };
  }
  function targetSize(target) {
    if (target) size.set(target.width, target.height); else renderer.getDrawingBufferSize(size);
    return size;
  }

  // GUESS: the event fade's draw (notes/fidelity-audit.md 'GUESS: the event fade's draw'): a black layer in the frame, opacity
  // stage.fade (level / 256). The game's fade is a particle of the effect managers (FUN_002f4480 / FUN_002f4578), which draw
  // before the menu managers, so the menus (pause, Status, event windows) stay above it: not a layer over the canvas
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0, transparent: true, depthTest: false, depthWrite: false });
  const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMat);
  fadeQuad.frustumCulled = false;
  const fadeScene = new THREE.Scene(); fadeScene.add(fadeQuad);
  function drawHud(w, h, nat) {
    const a = renderer.autoClear;
    renderer.autoClear = false;
    // worker 0265: a menu-effect layer (menu_fx.js) that draws the veil in the scene, just before the menu managers' effects, sets
    // stage.fadeDrawn for that frame (FUN_002f4480's particle draws before the menu managers: the stage title card stays above it)
    if (stage.fade > 0 && !stage.fadeDrawn) { fadeMat.opacity = Math.min(1, stage.fade); renderer.render(fadeScene, qCam); }
    stage.fadeDrawn = false;
    renderer.autoClear = a;
    if (!stage.hud) return;
    renderer.autoClear = false;
    const base = { renderer, w, h, x0: CX, y0: CY };
    stage.hud(nat ? { ...base, native: true, cx: CX, cy: CY, kx: 1, ky: 1 }
                  : { ...base, native: false, cx: w / 2, cy: h / 2, kx: (4 / 3) * h / COLS, ky: h / LINES,
                      // OPTION widehud (hud.js): the margin beside the 4:3 picture, 0 on a canvas narrower than 4:3
                      side: stage.wideHud ? Math.max(0, (w - DISPLAY_ASPECT * h) / 2) : 0 });
    renderer.autoClear = a;
  }

  // the previous frame (worker 0202): the GAME OVER title's glow (effects.js type 35, FUN_00278b50) copies the
  // displayed frame buffer (TBP 0xe00 = DISPFB FBP 112: last frame's scene + HUD, copied from FBP 224 at the flip)
  // into its page. While stage.keepFrame is set, each render copies its scene + HUD target (before the PCRTC merge,
  // as FBP 112 holds it) into prev, which the next frame's glow pass reads (gameover_title.js TitleLayer).
  // The camera that drew it is kept with it (prevView / prevProj, the projection with its view offset), so a reader maps
  // a world point to the copy's texels as this render placed it. With msaa the targets are multisampled and the copy
  // (copyTexSubImage2D) is invalid: warned, no previous frame (the glow is then not drawn). Turning keepFrame off frees it.
  let prev = null, msaaWarned = false;
  function keepFrame(w, h, camera) {
    if (!stage.keepFrame || msaa) {
      if (stage.keepFrame && !msaaWarned) { msaaWarned = true; console.warn('output: aa=1 (multisampled targets): no previous-frame copy, the GAME OVER glow is not drawn'); }
      if (prev) { prev.dispose(); prev = null; }
      stage.prevFrame = stage.prevView = stage.prevProj = null;
      return;
    }
    if (!prev || prev.image.width !== w || prev.image.height !== h) {
      if (prev) prev.dispose();
      prev = new THREE.FramebufferTexture(w, h);
      prev.minFilter = prev.magFilter = THREE.LinearFilter;          // the copy samples bilinear (TEX1 0x61, w198 g4)
    }
    renderer.copyFramebufferToTexture(prev);
    stage.prevFrame = prev;
    camera.updateMatrixWorld();
    stage.prevView = camera.matrixWorldInverse.clone(); stage.prevProj = camera.projectionMatrix.clone();
  }

  const stage = {
    enabled,
    renderer,
    keepFrame: false, prevFrame: null, prevView: null, prevProj: null,
    native,
    cols: COLS,                                        // gameover_title.js: the menu draw's x scale (drawHud's kx)
    // OPTION widehud (not in the game; play.js: ON by default at Dan's request, review board 2026-11-02;
    // ?widehud=0 gives the game's 4:3 layout): full mode only, hud.js moves the HUD's left / right
    // panels out by o.side; the reticle, ring, pause and game-over layers ignore it (centred)
    wideHud,
    framebuffer: fbRT,                                 // the 432x512 scene target (headless checks)
    // HUD drawn into the frame after the scene, as the game draws its HUD into the framebuffer
    // before the PCRTC merge: hud({ renderer, native, w, h, x0, y0, cx, cy, kx, ky }) renders into the
    // current target. Frame px (x, y) -> target px: cx + (x - x0) kx, cy + (y - y0) ky (x0, y0 = 213, 256) (native: identity on 432x512;
    // full: the projection centre at the canvas centre, one frame row = h / 512, one frame column
    // = (4/3 h / 425.5), the CRTC's 4:3 picture); full mode also passes side (widehud, below)
    hud: null,
    fade: 0,                                           // the event fade's level, 0..1 (intro.js, stage_view.js)
    fadeDrawn: false,                                  // the veil was drawn in the scene this frame (menu_fx.js; worker 0265)
    // set the camera's projection for this mode (call at start and on resize). fovGame (event cameras, worker 0210):
    // the game's horizontal fov in degrees, FUN_003edce0: screen distance = DAT_004fcab8 (448) / 2 / tan(fov x
    // 0.008726647); null = the gameplay projection (SCRZ)
    fitCamera(camera, fovGame = null) {
      if (camera.userData.fov0 === undefined) camera.userData.fov0 = camera.fov;
      stage.gameCam ??= camera;                        // the first fitted: the page camera (gameover_title.js proj2d)
      const scrz = fovGame == null ? SCRZ : SCR_W * 0.5 / Math.tan(fovGame * 0.008726647);
      if (stage.native) {
        // centre (213, 256) inside a 432 x 512 view: a symmetric frustum of 438 x 512 px
        // (centre 219, 256) cropped to x 6..438
        const hw = Math.max(CX, FB_W - CX), hh = Math.max(CY, FB_H - CY);
        camera.fov = 2 * Math.atan(hh / (scrz * AY)) * 180 / Math.PI;
        camera.setViewOffset(2 * hw, 2 * hh, hw - CX, hh - CY, FB_W, FB_H);
        camera.aspect = (2 * hw / scrz) / (2 * hh / (scrz * AY));   // after: setViewOffset sets aspect = fullW / fullH
      } else {
        // improvement option: today's behaviour, the hero fov with the canvas's aspect (an event camera's fov through
        // the same vertical extent, FB_H / 2 lines, as the hero fov 59.27 = SCRZ's)
        camera.fov = fovGame == null ? camera.userData.fov0 : 2 * Math.atan(FB_H * 0.5 / (scrz * AY)) * 180 / Math.PI;
        camera.clearViewOffset();
        const d = renderer.getDrawingBufferSize(new THREE.Vector2());   // not `size`: gameover_title.js fits during render(), which holds it
        camera.aspect = d.x / d.y;
      }
      camera.updateProjectionMatrix();
    },
    // pick buffer: the size ID renders use, and canvas px (top-first) -> pick px (null = off picture)
    pickSize(w, h) { return stage.native ? { w: FB_W, h: FB_H } : { w, h }; },
    toPick(x, y, w, h) {
      if (!stage.native) return { x, y };
      const b = box(w, h), top = h - b.y - b.h;
      const fx = (x - b.x) / b.w * COLS, fy = (y - top) / b.h * LINES;
      if (fx < 0 || fy < 0 || fx >= COLS || fy >= LINES) return null;
      return { x: fx, y: fy };
    },
    info() {
      return stage.native
        ? { mode: 'native', fb: [FB_W, FB_H], vck: [VCKS, LINES], shown_cols: COLS, aspect: '4:3',
            scrz: +SCRZ.toFixed(3), ay: AY, centre: [CX, CY], merge: stage.enabled }
        : { mode: 'full', merge: stage.enabled };
    },
    // render `scene` through the output stage into `target` (null = the canvas)
    // keep: false = not the frame the game shows (report.js's captures): the kept frame stays the last displayed one
    render(scene, camera, target = null, { keep: keepIt = true } = {}) {
      const keep = keepIt ? keepFrame : () => {};
      const s = targetSize(target);
      if (stage.native) {
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;                    // the passes clear explicitly (else the box's
        renderer.setRenderTarget(fbRT);                // draw would re-clear the bars to the scene colour)
        renderer.clear();
        renderer.render(scene, camera);
        drawHud(FB_W, FB_H, true);
        keep(FB_W, FB_H, camera);
        merge.mat.uniforms.c2on.value = stage.enabled ? 1 : 0;
        renderer.setRenderTarget(vckRT);
        renderer.render(merge.scene, qCam);
        const b = box(s.x, s.y);
        renderer.setRenderTarget(target);
        const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 1);           // outside the display window: black
        renderer.clear(true, true, false);
        renderer.setClearColor(cc, ca);
        // viewport: target.viewport (target px, read by setRenderTarget) or the canvas's (CSS px)
        if (target) { target.viewport.set(b.x, b.y, b.w, b.h); renderer.setRenderTarget(target); }
        else { const k = 1 / renderer.getPixelRatio(); renderer.setViewport(b.x * k, b.y * k, b.w * k, b.h * k); }
        renderer.render(present.scene, qCam);
        if (target) target.viewport.set(0, 0, s.x, s.y);
        else { const k = 1 / renderer.getPixelRatio(); renderer.setViewport(0, 0, s.x * k, s.y * k); }
        renderer.setRenderTarget(null);
        renderer.autoClear = autoClear;
        return;
      }
      if (!stage.enabled) {
        renderer.setRenderTarget(target); renderer.render(scene, camera); drawHud(s.x, s.y, false); keep(s.x, s.y, camera);
        renderer.setRenderTarget(null); return;
      }
      if (rt.width !== s.x || rt.height !== s.y) rt.setSize(s.x, s.y);
      const line = s.y / LINES;                        // one PS2 line, canvas pixels
      const vck = (4 / 3) * s.y / COLS * VCK;          // one VCK, canvas pixels
      full.mat.uniforms.off.value.set(vck / s.x, line / s.y);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      drawHud(s.x, s.y, false);
      keep(s.x, s.y, camera);
      renderer.setRenderTarget(target);
      renderer.render(full.scene, qCam);
      renderer.setRenderTarget(null);
    },
  };
  return stage;
}
