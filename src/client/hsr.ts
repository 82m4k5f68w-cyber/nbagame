// H2K Super Resolution (HSR): render the 3D scene at a reduced internal resolution and rebuild a sharp full-resolution
// image (WebGL path; the WebGPU path uses three's TAAU / FSR1 nodes in fxgpu.ts).
//  Temporal (DLSS / FSR2 style, no ML): Halton(2,3) sub-pixel jitter on the projection; motion vectors = camera
//   reprojection of the depth buffer for the static world + a small velocity pass for the moving rigs and the ball
//   (previous model matrix + previous bone palette, so arms are exact); 3x3 depth dilation; Blackman-Harris
//   reconstruction of the jittered samples at output resolution; history (Catmull-Rom) clipped to the YCoCg variance
//   box; disocclusion from the previous frame's depth; accumulation weight per pixel + a thin-feature lock (net cords,
//   court lines, jersey numbers survive frames where no jittered sample hit them); then RCAS sharpening.
//  Spatial (FSR1 style): EASU edge-adaptive upscale of the anti-aliased low-res frame + RCAS.
// Everything here works on the display-referred (tone-mapped, sRGB) output of the effect chain, so it costs three
// full-screen passes at output resolution while the scene, SSAO, bloom, DOF and the grade all run at the low res.
import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

const VQ = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }";

function halton(i: number, b: number) {
  let f = 1,
    r = 0;
  while (i > 0) (f /= b), (r += f * (i % b)), (i = Math.floor(i / b));
  return r;
}
const HAL: number[][] = Array.from({ length: 128 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

/** Velocity of the moving objects: rg = uv motion (current - previous, unjittered), b = view depth now, a = view depth
 *  in the previous frame. Skinned meshes use their previous bone palette (exact limb motion). */
const VelVS = `
#include <common>
#include <skinning_pars_vertex>
#ifdef USE_SKINNING
uniform highp sampler2D prevBones;
mat4 prevBone(const in float i){
  int size = textureSize(prevBones, 0).x; int j = int(i) * 4; int x = j % size; int y = j / size;
  return mat4(texelFetch(prevBones, ivec2(x, y), 0), texelFetch(prevBones, ivec2(x + 1, y), 0), texelFetch(prevBones, ivec2(x + 2, y), 0), texelFetch(prevBones, ivec2(x + 3, y), 0));
}
#endif
uniform mat4 prevModel, curVP, prevVP;
varying vec4 vC; varying vec4 vP;
void main(){
  vec4 pc = vec4(position, 1.0), pp = pc;
#ifdef USE_SKINNING
  vec4 sv = bindMatrix * pc;
  pc = bindMatrixInverse * (getBoneMatrix(skinIndex.x) * sv * skinWeight.x + getBoneMatrix(skinIndex.y) * sv * skinWeight.y + getBoneMatrix(skinIndex.z) * sv * skinWeight.z + getBoneMatrix(skinIndex.w) * sv * skinWeight.w);
  pp = bindMatrixInverse * (prevBone(skinIndex.x) * sv * skinWeight.x + prevBone(skinIndex.y) * sv * skinWeight.y + prevBone(skinIndex.z) * sv * skinWeight.z + prevBone(skinIndex.w) * sv * skinWeight.w);
#endif
#ifdef USE_INSTANCING
  pc = instanceMatrix * pc; pp = instanceMatrix * pp;
#endif
  vec4 wc = modelMatrix * pc;
#ifdef USE_SKINNING
  vec4 wp = modelMatrix * pp; // attached bind mode: the bones already carry the root motion
#else
  vec4 wp = prevModel * pp;
#endif
  gl_Position = projectionMatrix * viewMatrix * wc; // jittered: lines up with the scene depth
  vC = curVP * wc; vP = prevVP * wp;
}`;
const VelFS = `varying vec4 vC; varying vec4 vP;
void main(){
  if (vP.w < 0.01) { gl_FragColor = vec4(0., 0., vC.w, -1.); return; }
  gl_FragColor = vec4((vC.xy / vC.w - vP.xy / vP.w) * 0.5, vC.w, vP.w);
}`;

/** Low-res prep: motion for every pixel (camera reprojection of the depth, or the moving object's own motion where it
 *  is the visible surface) + current / previous view depth. */
const PrepFS = `uniform sampler2D tDepth, tVel; uniform mat4 invVPj, curVP, prevVP; uniform float hasVel; varying vec2 vUv;
void main(){
  float d = texture2D(tDepth, vUv).x;
  vec4 w = invVPj * vec4(vUv * 2. - 1., d * 2. - 1., 1.); w /= w.w;
  vec4 c = curVP * w, p = prevVP * w;
  vec2 mv = p.w > 0.01 ? (c.xy / c.w - p.xy / p.w) * 0.5 : vec2(4.);
  float cz = c.w, pz = p.w;
  if (hasVel > 0.5) {
    vec4 v = texture2D(tVel, vUv);
    if (v.z > 0. && v.z < cz * 1.03 + 0.1) { mv = v.w < 0. ? vec2(4.) : v.xy; pz = v.w; } // the rig / ball is in front
  }
  gl_FragColor = vec4(mv, min(cz, 6e4), min(pz, 6e4));
}`;

/** Temporal resolve at output resolution (MRT: color + aux [lock, accumulated weight]). */
const ResolveFS = `precision highp float;
uniform sampler2D tCol, tPrep, tPrevPrep, tHist, tAux;
uniform vec2 inSize, outSize, jit; uniform float reset, prevOk, maxW;
varying vec2 vUv;
layout(location = 0) out vec4 oCol;
layout(location = 1) out vec4 oAux;
vec3 toY(vec3 c){ return vec3(.25 * c.r + .5 * c.g + .25 * c.b, .5 * c.r - .5 * c.b, -.25 * c.r + .5 * c.g - .25 * c.b); }
vec3 fromY(vec3 y){ return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
// 5-tap Catmull-Rom (bilinear-optimized) history fetch: keeps the accumulated detail sharp under motion
vec3 histCR(vec2 uv){
  vec2 sp = uv * outSize, tp = floor(sp - .5) + .5, f = sp - tp, f2 = f * f, f3 = f2 * f;
  vec2 w0 = f2 - .5 * (f3 + f), w1 = 1.5 * f3 - 2.5 * f2 + 1., w3 = .5 * (f3 - f2), w2 = 1. - w0 - w1 - w3;
  vec2 s0 = w0, s12 = w1 + w2, s3 = w3, t0 = (tp - 1.) / outSize, t12 = (tp + w2 / s12) / outSize, t3 = (tp + 2.) / outSize;
  vec3 r = texture(tHist, vec2(t12.x, t0.y)).rgb * (s12.x * s0.y) + texture(tHist, vec2(t0.x, t12.y)).rgb * (s0.x * s12.y)
    + texture(tHist, t12).rgb * (s12.x * s12.y) + texture(tHist, vec2(t3.x, t12.y)).rgb * (s3.x * s12.y) + texture(tHist, vec2(t12.x, t3.y)).rgb * (s12.x * s3.y);
  float n = s12.x * s0.y + s0.x * s12.y + s12.x * s12.y + s3.x * s12.y + s12.x * s3.y;
  return max(r / n, 0.);
}
void main(){
  vec2 pIn = vUv * inSize;
  ivec2 ci = ivec2(floor(pIn - jit)); // closest jittered tap: its sample sits at ci + .5 + jit
  ivec2 mx = ivec2(inSize) - 1;
  float cd = 1e9, fd = 0.; ivec2 cb = ci;
  vec3 sum = vec3(0.), m1 = vec3(0.), m2 = vec3(0.), mn = vec3(1e9), mxc = vec3(-1e9); float sw = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 o = ci + ivec2(x, y), t = clamp(o, ivec2(0), mx);
    float z = texelFetch(tPrep, t, 0).z;
    if (z < cd) { cd = z; cb = t; }
    fd = max(fd, z);
    vec2 dl = pIn - (vec2(o) + .5 + jit);
    float w = exp(-2.29 * dot(dl, dl));
    vec3 c = toY(clamp(texelFetch(tCol, t, 0).rgb, 0., 1.));
    sum += c * w; sw += w; m1 += c; m2 += c * c; mn = min(mn, c); mxc = max(mxc, c);
  }
  vec3 cur = sum / max(sw, 1e-5);
  vec2 dc = (pIn - (vec2(ci) + .5 + jit)) * outSize / inSize; // nearest sample's distance in OUTPUT pixels
  float conf = exp(-1.1 * dot(dc, dc)); // how much this frame tells about this output pixel
  vec4 pr = texelFetch(tPrep, cb, 0); // dilated: nearest surface in the neighbourhood (edges move with the object)
  vec2 huv = vUv - pr.xy;
  bool valid = reset < .5 && all(greaterThanEqual(huv, vec2(0.))) && all(lessThanEqual(huv, vec2(1.)));
  float pz = texture(tPrevPrep, huv).z, ez = pr.w;
  bool disocc = prevOk > .5 && ez - pz > .04 * ez + .25 && fd - cd < .02 * cd; // was hidden behind something nearer
  bool zchg = prevOk > .5 && abs(ez - pz) > .04 * ez + .25;
  vec3 mean = m1 / 9.;
  float mot = clamp(length(pr.xy * outSize) / 32., 0., 1.);
  vec3 sig = sqrt(max(m2 / 9. - mean * mean, 0.)) * mix(1.25, .75, mot);
  vec3 bmin = max(mn, mean - sig), bmax = min(mxc, mean + sig);
  vec3 hist = toY(histCR(huv));
  vec4 aux = texture(tAux, huv);
  // clip toward the box centre (not a per-channel clamp: keeps hue)
  vec3 pc = .5 * (bmax + bmin), ec = .5 * (bmax - bmin) + 1e-4, v = hist - pc, u = abs(v / ec);
  float m = max(u.x, max(u.y, u.z));
  vec3 clipped = m > 1. ? pc + v / m : hist;
  // thin-feature lock: a lone bright/dark sample (net cord, court line) keeps its history unclipped for a while
  float thin = smoothstep(.04, .2, abs(cur.x - mean.x) / max(mean.x, .03)) * conf;
  float lock = valid && !zchg ? max(thin, aux.r * .82) : 0.;
  lock *= 1. - mot;
  hist = mix(clipped, hist, lock * .85);
  float hw = valid && !disocc ? min(aux.g, maxW / (1. + length(pr.xy * outSize) * .12)) : 0.;
  float cw = max(conf, hw > 0. ? 0. : 1.);
  // flicker reduction: weigh by inverse luma (bright speculars don't pump)
  float wc = cw / (1. + cur.x), wh = hw / (1. + hist.x);
  vec3 res = (cur * wc + hist * wh) / max(wc + wh, 1e-5);
  oCol = vec4(fromY(res), 1.);
  oAux = vec4(lock, min(hw + cw, maxW), 0., 1.);
}`;

/** AMD FidelityFX RCAS (robust contrast-adaptive sharpening), display-referred input. */
const RcasFS = `uniform sampler2D tIn; uniform float con; varying vec2 vUv;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), mx = textureSize(tIn, 0) - 1;
  vec3 b = texelFetch(tIn, clamp(p + ivec2(0, 1), ivec2(0), mx), 0).rgb, d = texelFetch(tIn, clamp(p - ivec2(1, 0), ivec2(0), mx), 0).rgb;
  vec3 e = texelFetch(tIn, p, 0).rgb, f = texelFetch(tIn, clamp(p + ivec2(1, 0), ivec2(0), mx), 0).rgb, h = texelFetch(tIn, clamp(p - ivec2(0, 1), ivec2(0), mx), 0).rgb;
  vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
  vec3 hitMin = mn4 / max(4. * mx4, 1e-4), hitMax = (1. - mx4) / min(4. * mn4 - 4., -1e-4);
  vec3 l3 = max(-hitMin, hitMax);
  float lobe = max(-.1875, min(max(l3.r, max(l3.g, l3.b)), 0.)) * con;
  gl_FragColor = vec4(clamp((lobe * (b + d + f + h) + e) / (4. * lobe + 1.), 0., 1.), 1.);
}`;

/** AMD FidelityFX EASU (FSR1 edge-adaptive spatial upsampling), 12 taps. */
const EasuFS = `uniform sampler2D tIn; uniform vec2 inSize, outSize; varying vec2 vUv;
vec3 tx(vec2 fp, int x, int y){ return texelFetch(tIn, clamp(ivec2(fp) + ivec2(x, y), ivec2(0), ivec2(inSize) - 1), 0).rgb; }
float L(vec3 c){ return c.g + .5 * (c.r + c.b); }
void setF(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE){
  float lx = max(abs(lD - lC), abs(lC - lB)), dx = lD - lB;
  dir.x += dx * w; lx = clamp(abs(dx) / max(lx, 1e-5), 0., 1.); len += lx * lx * w;
  float ly = max(abs(lE - lC), abs(lC - lA)), dy = lE - lA;
  dir.y += dy * w; ly = clamp(abs(dy) / max(ly, 1e-5), 0., 1.); len += ly * ly * w;
}
void tapF(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c){
  vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len;
  float d2 = min(dot(v, v), clp), wB = .4 * d2 - 1., wA = lob * d2 - 1.;
  wB *= wB; wA *= wA; wB = 1.5625 * wB - .5625;
  float w = wB * wA; aC += c * w; aW += w;
}
void main(){
  vec2 pp = vUv * inSize - .5, fp = floor(pp); pp -= fp;
  vec3 bC = tx(fp, 0, -1), cC = tx(fp, 1, -1), eC = tx(fp, -1, 0), fC = tx(fp, 0, 0), gC = tx(fp, 1, 0), hC = tx(fp, 2, 0);
  vec3 iC = tx(fp, -1, 1), jC = tx(fp, 0, 1), kC = tx(fp, 1, 1), lC = tx(fp, 2, 1), nC = tx(fp, 0, 2), oC = tx(fp, 1, 2);
  float bL = L(bC), cL = L(cC), eL = L(eC), fL = L(fC), gL = L(gC), hL = L(hC), iL = L(iC), jL = L(jC), kL = L(kC), lL = L(lC), nL = L(nC), oL = L(oC);
  vec2 dir = vec2(0.); float len = 0.;
  setF(dir, len, (1. - pp.x) * (1. - pp.y), bL, eL, fL, gL, jL);
  setF(dir, len, pp.x * (1. - pp.y), cL, fL, gL, hL, kL);
  setF(dir, len, (1. - pp.x) * pp.y, fL, iL, jL, kL, nL);
  setF(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);
  float dr = dot(dir, dir); bool zro = dr < 1. / 32768.;
  dir = zro ? vec2(1., 0.) : dir * inversesqrt(dr);
  len = .5 * len; len *= len;
  float st = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1. + (st - 1.) * len, 1. - .5 * len);
  float lob = .5 - .29 * len, clp = 1. / lob;
  vec3 aC = vec3(0.); float aW = 0.;
  tapF(aC, aW, vec2(0., -1.) - pp, dir, len2, lob, clp, bC); tapF(aC, aW, vec2(1., -1.) - pp, dir, len2, lob, clp, cC);
  tapF(aC, aW, vec2(-1., 1.) - pp, dir, len2, lob, clp, iC); tapF(aC, aW, vec2(0., 1.) - pp, dir, len2, lob, clp, jC);
  tapF(aC, aW, vec2(0., 0.) - pp, dir, len2, lob, clp, fC); tapF(aC, aW, vec2(-1., 0.) - pp, dir, len2, lob, clp, eC);
  tapF(aC, aW, vec2(1., 1.) - pp, dir, len2, lob, clp, kC); tapF(aC, aW, vec2(2., 1.) - pp, dir, len2, lob, clp, lC);
  tapF(aC, aW, vec2(2., 0.) - pp, dir, len2, lob, clp, hC); tapF(aC, aW, vec2(1., 0.) - pp, dir, len2, lob, clp, gC);
  tapF(aC, aW, vec2(1., 2.) - pp, dir, len2, lob, clp, oC); tapF(aC, aW, vec2(0., 2.) - pp, dir, len2, lob, clp, nC);
  vec3 mn4 = min(min(fC, gC), min(jC, kC)), mx4 = max(max(fC, gC), max(jC, kC));
  gl_FragColor = vec4(clamp(aC / aW, mn4, mx4), 1.);
}`;

const sm = (fs: string, u: Record<string, any>, g3 = false) =>
  new THREE.ShaderMaterial({ uniforms: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { value: v }])), vertexShader: VQ, fragmentShader: fs, depthTest: false, depthWrite: false, glslVersion: g3 ? THREE.GLSL3 : null });

export interface HSR {
  /** jitter the camera's projection for this frame (temporal) */
  jitter(cam: THREE.PerspectiveCamera, inW: number, inH: number): void;
  unjitter(cam: THREE.PerspectiveCamera): void;
  /** temporal, part 1 - call right after the scene pass, while its depth is intact (later full-screen passes
   *  auto-clear the buffers they render into): camera-cut check, velocity pass, per-pixel motion + depth */
  pre(depth: THREE.Texture, inW: number, inH: number, cam: THREE.PerspectiveCamera, dyn: THREE.Object3D[]): void;
  /** temporal, part 2 - after the effect chain: resolve into the history + RCAS to the screen */
  temporal(col: THREE.Texture, inW: number, inH: number): void;
  /** EASU + RCAS to the screen */
  spatial(col: THREE.Texture, inW: number, inH: number): void;
  reset(): void;
  sharp: number; // RCAS strength 0 (none) .. 1 (max)
  stats: { resets: number; frames: number; jitter: number[] };
  /** debug: the last prep texel at uv (motion x/y in uv, view depth now, expected previous depth) */
  probe(u: number, v: number): number[];
  dispose(): void;
}

export function makeHSR(R: THREE.WebGLRenderer): HSR {
  const q = new FullScreenQuad();
  const HF = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const NR = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  let hist = [new THREE.WebGLRenderTarget(1, 1, { ...HF, count: 2 }), new THREE.WebGLRenderTarget(1, 1, { ...HF, count: 2 })];
  const prep = [new THREE.WebGLRenderTarget(1, 1, NR), new THREE.WebGLRenderTarget(1, 1, NR)];
  const vel = new THREE.WebGLRenderTarget(1, 1, { ...NR, depthBuffer: true });
  const up = new THREE.WebGLRenderTarget(1, 1, HF);
  const velM = new THREE.ShaderMaterial({
    uniforms: { prevModel: { value: new THREE.Matrix4() }, curVP: { value: new THREE.Matrix4() }, prevVP: { value: new THREE.Matrix4() }, prevBones: { value: null } },
    vertexShader: VelVS,
    fragmentShader: VelFS,
    side: THREE.DoubleSide,
  });
  const prepM = sm(PrepFS, { tDepth: null, tVel: null, invVPj: new THREE.Matrix4(), curVP: new THREE.Matrix4(), prevVP: new THREE.Matrix4(), hasVel: 0 });
  const resM = sm(ResolveFS, { tCol: null, tPrep: null, tPrevPrep: null, tHist: null, tAux: null, inSize: new THREE.Vector2(), outSize: new THREE.Vector2(), jit: new THREE.Vector2(), reset: 1, prevOk: 0, maxW: 14 }, true);
  const rcasM = sm(RcasFS, { tIn: null, con: 0.5 });
  const easuM = sm(EasuFS, { tIn: null, inSize: new THREE.Vector2(), outSize: new THREE.Vector2() });
  // velocity scene: borrows the moving objects' roots each frame (children swapped in, parents untouched)
  const VS = new THREE.Scene();
  VS.overrideMaterial = velM;
  VS.matrixWorldAutoUpdate = false;
  const prevM = new WeakMap<THREE.Object3D, THREE.Matrix4>(),
    prevB = new WeakMap<THREE.Skeleton, { tex: THREE.DataTexture; arr: Float32Array }>(),
    seenO: THREE.Object3D[] = [],
    seenS: THREE.Skeleton[] = [];
  velM.onBeforeRender = (_r: any, _s: any, _c: any, _g: any, o: any) => {
    let m = prevM.get(o);
    if (!m) prevM.set(o, (m = o.matrixWorld.clone()));
    velM.uniforms.prevModel.value.copy(m);
    seenO.push(o);
    if (o.isSkinnedMesh && o.skeleton.boneTexture) {
      const sk = o.skeleton as THREE.Skeleton;
      let e = prevB.get(sk);
      if (!e) {
        const img = sk.boneTexture!.image as any,
          arr = new Float32Array(img.data);
        const tex = new THREE.DataTexture(arr, img.width, img.height, THREE.RGBAFormat, THREE.FloatType);
        tex.needsUpdate = true;
        prevB.set(sk, (e = { tex, arr }));
      }
      velM.uniforms.prevBones.value = e.tex;
      seenS.push(sk);
    }
    velM.uniformsNeedUpdate = true;
  };
  const projJ = new THREE.Matrix4(),
    proj0 = new THREE.Matrix4(),
    projI0 = new THREE.Matrix4(),
    curVP = new THREE.Matrix4(),
    prevVP = new THREE.Matrix4(),
    lastCam = new THREE.Matrix4(),
    tmp = new THREE.Vector3(),
    tmp2 = new THREE.Vector3(),
    sz = new THREE.Vector2(),
    cc = new THREE.Color();
  let idx = 0,
    jx = 0,
    jy = 0,
    cur = 0,
    doReset = true,
    prevOk = false,
    jittered = false,
    preOk = false,
    havePrev = false,
    lastIn = "";
  const fit = (rt: THREE.WebGLRenderTarget, w: number, h: number) => {
    if (rt.width !== w || rt.height !== h) {
      rt.setSize(w, h);
      return true;
    }
    return false;
  };
  const rcas = (src: THREE.Texture, target: THREE.WebGLRenderTarget | null) => {
    rcasM.uniforms.tIn.value = src;
    rcasM.uniforms.con.value = Math.pow(2, -(1 - api.sharp) * 2); // sharp 1 -> con 1 (max), 0 -> .25
    q.material = rcasM;
    R.setRenderTarget(target);
    q.render(R);
  };
  const api: HSR = {
    sharp: 0.55,
    stats: { resets: 0, frames: 0, jitter: [0, 0] },
    jitter(cam, inW, inH) {
      const ratio = (R.getDrawingBufferSize(sz).x || inW) / inW,
        n = Math.min(128, Math.max(8, Math.ceil(8 * ratio * ratio)));
      const h = HAL[idx++ % n];
      (jx = h[0]), (jy = h[1]);
      api.stats.jitter = [jx, jy];
      proj0.copy(cam.projectionMatrix);
      projI0.copy(cam.projectionMatrixInverse);
      projJ.copy(proj0);
      // sample (i + .5 + j) of the unjittered image lands on texel centre i + .5
      projJ.elements[8] += (2 * jx) / inW;
      projJ.elements[9] += (2 * jy) / inH;
      cam.projectionMatrix.copy(projJ);
      cam.projectionMatrixInverse.copy(projJ).invert();
      jittered = true;
    },
    unjitter(cam) {
      if (!jittered) return;
      cam.projectionMatrix.copy(proj0);
      cam.projectionMatrixInverse.copy(projI0);
      jittered = false;
    },
    pre(depth, inW, inH, cam, dyn) {
      const k = inW + "x" + inH;
      if (k !== lastIn) (lastIn = k), (prevOk = false);
      fit(prep[0], inW, inH);
      fit(prep[1], inW, inH);
      fit(vel, inW, inH);
      // camera cut (replay, huddle, intro, studio): the history shows another shot -> start over
      const e = cam.matrixWorld.elements,
        l = lastCam.elements;
      tmp.set(-e[8], -e[9], -e[10]);
      tmp2.set(-l[8], -l[9], -l[10]);
      if (!havePrev || Math.hypot(e[12] - l[12], e[13] - l[13], e[14] - l[14]) > 3.5 || tmp.dot(tmp2) < Math.cos(0.18)) doReset = true;
      lastCam.copy(cam.matrixWorld);
      curVP.multiplyMatrices(proj0, cam.matrixWorldInverse);
      if (!havePrev || doReset) prevVP.copy(curVP);
      const ac = R.autoClear,
        rt0 = R.getRenderTarget();
      R.getClearColor(cc);
      const ca = R.getClearAlpha();
      // 1) velocity of the moving rigs + ball (jittered projection still applied, so it lines up with the depth)
      let hasVel = 0;
      if (dyn.length) {
        VS.children = dyn;
        velM.uniforms.curVP.value.copy(curVP);
        velM.uniforms.prevVP.value.copy(prevVP);
        R.setRenderTarget(vel);
        R.setClearColor(0x000000, 0);
        R.clear(true, true, false);
        R.autoClear = false;
        seenO.length = seenS.length = 0;
        R.render(VS, cam);
        VS.children = [];
        for (const o of seenO) prevM.get(o)!.copy(o.matrixWorld);
        for (const s of seenS) {
          const en = prevB.get(s)!;
          en.arr.set(s.boneMatrices!);
          en.tex.needsUpdate = true;
        }
        hasVel = 1;
      }
      // 2) prep: per-pixel motion + depths (low res)
      const pr = prep[cur],
        pp = prep[1 - cur];
      prepM.uniforms.tDepth.value = depth;
      prepM.uniforms.tVel.value = vel.texture;
      prepM.uniforms.hasVel.value = hasVel;
      prepM.uniforms.invVPj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
      prepM.uniforms.curVP.value.copy(curVP);
      prepM.uniforms.prevVP.value.copy(prevVP);
      q.material = prepM;
      R.setRenderTarget(pr);
      q.render(R);
      prevVP.copy(curVP);
      havePrev = true;
      R.autoClear = ac;
      R.setClearColor(cc, ca);
      R.setRenderTarget(rt0);
      preOk = true;
    },
    temporal(col, inW, inH) {
      if (!preOk) return api.spatial(col, inW, inH);
      preOk = false;
      R.getDrawingBufferSize(sz);
      const W = sz.x,
        H = sz.y;
      if (fit(hist[0], W, H) || fit(hist[1], W, H)) doReset = true;
      const rt0 = R.getRenderTarget(),
        pr = prep[cur],
        pp = prep[1 - cur];
      // 3) resolve at output res into the history (MRT)
      const hNew = hist[cur],
        hOld = hist[1 - cur];
      const u = resM.uniforms;
      u.tCol.value = col;
      u.tPrep.value = pr.texture;
      u.tPrevPrep.value = pp.texture;
      u.tHist.value = hOld.textures[0];
      u.tAux.value = hOld.textures[1];
      u.inSize.value.set(inW, inH);
      u.outSize.value.set(W, H);
      u.jit.value.set(jx, jy);
      u.reset.value = doReset ? 1 : 0;
      u.prevOk.value = prevOk && !doReset ? 1 : 0;
      q.material = resM;
      R.setRenderTarget(hNew);
      q.render(R);
      // 4) RCAS to the screen
      rcas(hNew.textures[0], null);
      if (doReset) api.stats.resets++;
      api.stats.frames++;
      prevOk = true;
      doReset = false;
      cur = 1 - cur;
      R.setRenderTarget(rt0);
    },
    spatial(col, inW, inH) {
      R.getDrawingBufferSize(sz);
      fit(up, sz.x, sz.y);
      easuM.uniforms.tIn.value = col;
      easuM.uniforms.inSize.value.set(inW, inH);
      easuM.uniforms.outSize.value.set(sz.x, sz.y);
      q.material = easuM;
      R.setRenderTarget(up);
      q.render(R);
      rcas(up.texture, null);
      havePrev = false; // a later switch to temporal starts fresh
      api.stats.frames++;
    },
    reset() {
      doReset = true;
    },
    probe(u, v) {
      const rt = prep[1 - cur],
        b = new Uint16Array(4);
      R.readRenderTargetPixels(rt, Math.floor(u * rt.width), Math.floor(v * rt.height), 1, 1, b);
      return Array.from(b, (h) => THREE.DataUtils.fromHalfFloat(h));
    },
    dispose() {
      [...hist, ...prep, vel, up].forEach((r) => r.dispose());
      [velM, prepM, resM, rcasM, easuM].forEach((m) => m.dispose());
      q.dispose();
    },
  };
  return api;
}

// ---------------- dynamic resolution ----------------
/** Holds a target frame time by moving the internal scale: drops fast when frames are late, probes upward slowly
 *  while frames are on time, and remembers the scale that last failed (backs off probing it for a while). Browsers
 *  cap rAF at the display refresh, so "on time" can only mean "every refresh" - the target never exceeds it. */
export function makeDynRes() {
  let s = 1,
    good = 0,
    ceil = 1,
    ceilT = 0,
    n = 0;
  return {
    get scale() {
      return s;
    },
    set(v: number) {
      s = v;
      good = 0;
    },
    /** feed the smoothed frame interval (ms) once per frame; returns true when the scale changed */
    update(ema: number, target: number, lo: number, hi: number, now: number) {
      if (s > hi) s = hi;
      if (s < lo) s = lo;
      // badly late (> 2x the target: a crawling GPU) -> judge every 4 frames and step harder; else every 12
      const crawl = ema > target * 2;
      if (++n < (crawl ? 4 : 12)) return false;
      n = 0;
      const old = s;
      if (ema > target * 1.12) {
        good = 0;
        ceil = s;
        ceilT = now + 8000;
        s = Math.max(lo, s * Math.max(crawl ? 0.7 : 0.8, Math.min(0.95, Math.sqrt(target / ema))));
      } else if (ema < target * 1.04) {
        if (++good >= 8 && s < hi) {
          good = 0;
          const cap = now < ceilT ? ceil - 0.04 : hi;
          if (s + 0.01 < cap) s = Math.min(hi, cap, s + 0.05);
        }
      } else good = 0;
      s = Math.round(s * 100) / 100;
      return s !== old;
    },
  };
}

/** Display refresh from rAF intervals (~1 s): a low percentile, snapped to common rates. */
export function measureRefresh(done: (hz: number) => void) {
  if (typeof requestAnimationFrame === "undefined") return;
  const d: number[] = [];
  let last = 0;
  const t0 = performance.now();
  const f = (t: number) => {
    if (last) d.push(t - last);
    last = t;
    if (t - t0 < 1100 || d.length < 20) return void requestAnimationFrame(f);
    d.sort((a, b) => a - b);
    const ms = d[Math.floor(d.length * 0.2)] || 16.7,
      hz = 1000 / ms,
      R = [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
    let best = R[0];
    for (const r of R) if (Math.abs(r - hz) < Math.abs(best - hz)) best = r;
    done(Math.abs(best - hz) / hz < 0.08 ? best : Math.round(hz));
  };
  requestAnimationFrame(f);
}
