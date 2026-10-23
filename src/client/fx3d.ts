// Post-processing chain for the 3D arena: MSAA render (linear HDR) -> SSAO (High) -> bloom -> camera motion blur ->
// color grade -> OutputPass (ACES tone mapping + sRGB). three r153+ only tone-maps the final output.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { makeHSR, type HSR } from "./hsr";

/** The scene pass, remembering which composer buffer holds this frame's depth (HSR temporal reads it). */
class ScenePass extends RenderPass {
  last: THREE.WebGLRenderTarget | null = null;
  render(r: THREE.WebGLRenderer, w: THREE.WebGLRenderTarget, rb: THREE.WebGLRenderTarget, dt?: number, mask?: boolean) {
    this.last = rb;
    super.render(r, w, rb, dt as any, mask as any);
  }
}

/** Directional blur along the screen-space camera motion, scaled by how fast the action is. */
const MotionBlurShader = {
  uniforms: { tDiffuse: { value: null }, vel: { value: new THREE.Vector2() }, amt: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 vel; uniform float amt; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    if (amt < 0.001) { gl_FragColor = c; return; }
    vec2 v = vel * amt;
    vec4 s = c; float n = 1.0;
    for (int i = 1; i <= 7; i++) { float t = float(i) / 7.0 - 0.5; s += texture2D(tDiffuse, vUv + v * t); n += 1.0; }
    gl_FragColor = s / n;
  }`,
};

/** Broadcast color grade (on the tone-mapped image, before gamma): filmic contrast, a touch of saturation, a subtle
 *  per-arena tint from the home team's color, and a soft vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Color(1, 1, 1) }, sat: { value: 1.08 }, con: { value: 1.06 }, vig: { value: 0.22 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 tint; uniform float sat, con, vig; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    vec3 x = c.rgb;
    float l = dot(x, vec3(0.2126, 0.7152, 0.0722));
    x = mix(vec3(l), x, sat);
    // contrast around linear mid-grey (0.18), applied in log space so blacks don't crush
    x = 0.18 * pow(max(x, vec3(1e-4)) / 0.18, vec3(con));
    x *= tint;
    vec2 d = vUv - 0.5;
    x *= 1.0 - vig * dot(d, d) * 2.2;
    gl_FragColor = vec4(x, c.a);
  }`,
};

export interface Fx {
  setGrade(on: boolean, tint?: THREE.Color): void;
  /** Replay depth of field: focus distance (world ft) on the subject; off when focus <= 0. */
  setDof(focus: number): void;
  render(dt: number): void;
  setLevel(ql: number, on: boolean, w: number, h: number, ao?: boolean): void;
  setMotion(vx: number, vy: number, amt: number): void;
  /** H2K Super Resolution: mode 0 native, 1 temporal, 2 spatial; scale = internal / output resolution */
  setHSR(mode: number, scale: number): void;
  /** moving objects (rig roots, ball) for the HSR velocity pass */
  dyn: THREE.Object3D[];
  hsr: { mode: number; scale: number; w: number; h: number; ow: number; oh: number; core: HSR | null };
}

export function makeFx(R: THREE.WebGLRenderer, S: THREE.Scene, cam: THREE.PerspectiveCamera, W: number, H: number): Fx {
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: R.capabilities.isWebGL2 ? 4 : 0 });
  const C = new EffectComposer(R, rt);
  const rp = new ScenePass(S, cam);
  const ao = new SSAOPass(S, cam, W, H);
  ao.kernelRadius = 0.45;
  ao.minDistance = 0.0006;
  ao.maxDistance = 0.04;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.22, 0.35, 3.2); // HDR input: only real highlights (lit floor ~2.5)
  const mb = new ShaderPass(MotionBlurShader as any);
  const gr = new ShaderPass(GradeShader as any);
  const gm = new OutputPass(); // tone mapping (ACES) + sRGB, once, at the end
  const dof = new BokehPass(S, cam, { focus: 15, aperture: 0.0035, maxblur: 0.009 });
  dof.enabled = false;
  // SMAA after the output transform: cleans the edges MSAA misses when the resolution is scaled down
  const aa = new SMAAPass();
  aa.enabled = false;
  C.addPass(rp);
  C.addPass(ao);
  C.addPass(dof);
  C.addPass(bloom);
  C.addPass(mb);
  C.addPass(gr);
  C.addPass(gm);
  C.addPass(aa);
  // full-screen passes must never write depth (HSR temporal reads the scene pass's depth after the chain ran)
  for (const p of C.passes as any[])
    for (const k of Object.keys(p)) {
      const m = p[k];
      if (m && m.isMaterial) (m.depthTest = false), (m.depthWrite = false);
      if (m && m.material && m.material.isMaterial) (m.material.depthTest = false), (m.material.depthWrite = false);
    }
  let on = true,
    lw = W,
    lh = H,
    hm = 0,
    hs = 1,
    core: HSR | null = null,
    msaa = true;
  const st: any = { mode: 0, scale: 1, w: 0, h: 0, ow: 0, oh: 0, core: null };
  const bufs = () => [C.renderTarget1, C.renderTarget2];
  /** temporal wants no MSAA (jitter is the AA) and a readable depth; native / spatial keep 4x MSAA */
  const targets = (temporal: boolean) => {
    const want = !temporal && R.capabilities.isWebGL2;
    if (msaa === want && !!C.renderTarget1.depthTexture === temporal) return;
    msaa = want;
    for (const t of bufs()) {
      t.dispose();
      t.samples = want ? 4 : 0;
      t.depthTexture = temporal ? new THREE.DepthTexture(t.width, t.height) : null;
    }
  };
  const sizes = () => {
    const pr = R.getPixelRatio() * (hm ? hs : 1);
    C.setPixelRatio(pr);
    C.setSize(lw, lh);
    ao.setSize(Math.round(lw * pr * 0.5), Math.round(lh * pr * 0.5));
    st.w = Math.floor(C.renderTarget1.width); // the composer keeps w x pixelRatio unrounded; GL truncates
    st.h = Math.floor(C.renderTarget1.height);
    const v = R.getDrawingBufferSize(new THREE.Vector2());
    st.ow = v.x;
    st.oh = v.y;
  };
  const fx: Fx = {
    dyn: [],
    hsr: st,
    render(dt) {
      void dt;
      if (!hm) {
        if (on) C.render();
        else R.render(S, cam);
        return;
      }
      if (!core) core = st.core = makeHSR(R);
      // HSR: the whole chain runs at the internal resolution into a buffer, then upscales to the screen
      const keep = [ao.enabled, dof.enabled, bloom.enabled, mb.enabled, gr.enabled, aa.enabled];
      if (!on) ao.enabled = dof.enabled = bloom.enabled = mb.enabled = gr.enabled = aa.enabled = false;
      if (hm === 1) aa.enabled = false;
      C.renderToScreen = false;
      const w = Math.floor(C.renderTarget1.width),
        h = Math.floor(C.renderTarget1.height);
      try {
        if (hm === 1) core.jitter(cam, w, h);
        C.render();
        const col = C.readBuffer.texture;
        if (hm === 1) core.temporal(col, (rp.last || C.renderTarget1).depthTexture!, w, h, cam, S, fx.dyn);
        else core.spatial(col, w, h);
      } finally {
        core.unjitter(cam);
        [ao.enabled, dof.enabled, bloom.enabled, mb.enabled, gr.enabled, aa.enabled] = keep;
      }
    },
    setLevel(ql, enabled, w, h, aoOn = false) {
      on = enabled && ql > 0;
      ao.enabled = aoOn;
      bloom.enabled = ql >= 1;
      bloom.strength = ql >= 2 ? 0.2 : 0.14;
      lw = w;
      lh = h;
      sizes();
      aa.enabled = R.getPixelRatio() * (hm ? hs : 1) < 1.3; // low-res tiers: post AA on top of MSAA
    },
    setHSR(mode, scale) {
      const was = hm;
      hm = mode;
      hs = mode ? scale : 1;
      st.mode = mode;
      st.scale = hs;
      targets(mode === 1);
      if (!mode) C.renderToScreen = true;
      sizes();
      aa.enabled = R.getPixelRatio() * hs < 1.3;
      if (core && mode !== was) core.reset();
    },
    setDof(focus) {
      dof.enabled = on && focus > 0;
      if (focus > 0) (dof.uniforms as any).focus.value = focus;
    },
    setGrade(onG, tint) {
      gr.enabled = onG;
      if (tint) gr.uniforms.tint.value.copy(tint);
    },
    setMotion(vx, vy, amt) {
      mb.uniforms.vel.value.set(vx, vy);
      mb.uniforms.amt.value = amt;
      mb.enabled = amt > 0.001;
    },
  };
  return fx;
}
