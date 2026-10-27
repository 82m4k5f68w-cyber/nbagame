// Post-processing chain for the 3D arena: MSAA render (linear HDR) -> N8AO ambient occlusion (Balanced: half res,
// High/Ultra: full res; reads the scene pass's own depth texture) -> replay/cutscene DOF -> bloom -> camera motion blur ->
// broadcast color grade (look presets, warmth, film grain, vignette) -> OutputPass (ACES tone mapping + sRGB) -> SMAA.
// three r153+ only tone-maps the final output.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { N8AOPass } from "n8ao";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { makeHSR, type HSR } from "./hsr";

/** Texture LOD bias for the big textured surfaces (court, street, jersey prints) while temporal HSR renders below
 *  output resolution: sharper mips that the jittered history resolves (patched into their map sampling). */
export const HSRBIAS = { value: 0 };
export function mipBias(m: THREE.Material) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh: any, r: any) => {
    prev && prev.call(m, sh, r);
    sh.uniforms.hsrBias = HSRBIAS;
    sh.fragmentShader = "uniform float hsrBias;\n" + sh.fragmentShader.replace("#include <map_fragment>", THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture2D( map, vMapUv, hsrBias )"));
  };
  const k0 = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => k0() + "+bias";
  m.needsUpdate = true;
}

/** The scene pass, remembering which composer buffer holds this frame's depth (HSR temporal reads it). */
class ScenePass extends RenderPass {
  last: THREE.WebGLRenderTarget | null = null;
  /** runs right after the scene is drawn (HSR temporal reads the depth here: later passes auto-clear it) */
  after: ((rt: THREE.WebGLRenderTarget) => void) | null = null;
  render(r: THREE.WebGLRenderer, w: THREE.WebGLRenderTarget, rb: THREE.WebGLRenderTarget, dt?: number, mask?: boolean) {
    this.last = rb;
    super.render(r, w, rb, dt as any, mask as any);
    if (this.after) this.after(rb);
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
  uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Color(1, 1, 1) }, sat: { value: 1.1 }, con: { value: 1.07 }, vig: { value: 0.2 }, warm: { value: 0.15 }, grain: { value: 0.012 }, seed: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 tint; uniform float sat, con, vig, warm, grain, seed; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    vec3 x = c.rgb;
    float l = dot(x, vec3(0.2126, 0.7152, 0.0722));
    // saturation that spares skin-bright highlights a little (broadcast look: saturated mids, clean whites)
    x = mix(vec3(l), x, mix(sat, 1.0, smoothstep(2.0, 6.0, l)));
    // contrast around linear mid-grey (0.18), applied in log space so blacks don't crush
    x = 0.18 * pow(max(x, vec3(1e-4)) / 0.18, vec3(con));
    // split toning: warm highlights / cool shadows (ACES-friendly: scene-linear, before the tone curve)
    float h = smoothstep(0.05, 1.2, l);
    x *= mix(vec3(1.0 - 0.03 * warm, 1.0, 1.0 + 0.05 * warm), vec3(1.0 + 0.05 * warm, 1.0 + 0.01 * warm, 1.0 - 0.06 * warm), h);
    x *= tint;
    vec2 d = vUv - 0.5;
    x *= 1.0 - vig * dot(d, d) * 2.2;
    // film grain: luma-weighted (fades in the highlights), animated
    float n = fract(sin(dot(vUv * 913.7 + seed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    x += x * n * grain * (1.0 - smoothstep(0.5, 3.0, l));
    gl_FragColor = vec4(x, c.a);
  }`,
};

export interface Fx {
  setGrade(on: boolean, tint?: THREE.Color): void;
  /** look: saturation, contrast, vignette, warmth (view.ts GRADES), film grain amount */
  setLook(sat: number, con: number, vig: number, warm: number, grain: number): void;
  /** Replay depth of field: focus distance (world ft) on the subject; off when focus <= 0. */
  setDof(focus: number): void;
  render(dt: number): void;
  /** ao: 0 off, 1 half-res N8AO, 2 full-res N8AO */
  setLevel(ql: number, on: boolean, w: number, h: number, ao?: number): void;
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
  // N8AO: the three-EffectComposer pass with autoRenderBeauty off - its "beauty" is our scene pass's buffer (MSAA
  // resolved, with the depth texture both composer buffers carry while AO is on), so the scene is drawn once.
  // World-space radius in feet: contact darkening under players, in the stands, under the rim.
  const ao: any = new N8AOPass(S, cam, W, H);
  const aoOwn = ao.beautyRenderTarget;
  ao.autoDetectTransparency = false;
  Object.assign(ao.configuration, { autoRenderBeauty: false, transparencyAware: false, accumulate: false, aoRadius: 2.2, distanceFalloff: 0.6, intensity: 2.2, aoSamples: 12, denoiseSamples: 6, denoiseRadius: 10, gammaCorrection: false, halfRes: true, depthAwareUpsampling: true, color: new THREE.Color(0x0a0705) });
  ao.enabled = false;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.22, 0.4, 3.2); // HDR input: only real highlights (lit floor ~2.5)
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
  for (const p of (C.passes as any[]).filter((p) => p !== ao))
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
  /** temporal wants no MSAA (jitter is the AA) and a readable depth; native / spatial keep 4x MSAA (+ a resolved
   *  depth texture while AO is on) */
  let aoL = 0;
  const targets = (temporal: boolean) => {
    const want = !temporal && R.capabilities.isWebGL2,
      dep = temporal || aoL > 0;
    if (msaa === want && !!C.renderTarget1.depthTexture === dep) return;
    msaa = want;
    for (const t of bufs()) {
      t.dispose();
      t.samples = want ? 4 : 0;
      t.depthTexture = dep ? new THREE.DepthTexture(t.width, t.height) : null;
    }
  };
  const sizes = () => {
    const pr = R.getPixelRatio() * (hm ? hs : 1);
    C.setPixelRatio(pr);
    C.setSize(lw, lh);
    ao.beautyRenderTarget = aoOwn; // (its setSize resizes the beauty target: never ours)
    ao.setSize(Math.floor(lw * pr), Math.floor(lh * pr));
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
      gr.uniforms.seed.value = (gr.uniforms.seed.value + 0.137) % 97;
      // AO reads this frame's scene depth (the buffer the scene pass drew into)
      if (ao.enabled) {
        const hook = rp.after;
        rp.after = (rt) => {
          ao.beautyRenderTarget = rt;
          if (hook) hook(rt);
        };
      }
      if (!hm) {
        try {
          if (on) C.render();
          else R.render(S, cam);
        } finally {
          rp.after = null;
        }
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
        if (hm === 1) {
          core.jitter(cam, w, h);
          const c = core,
            hook = rp.after;
          rp.after = (rt) => {
            if (hook) hook(rt);
            c.pre(rt.depthTexture!, w, h, cam, fx.dyn);
          };
        }
        C.render();
        const col = C.readBuffer.texture;
        if (hm === 1) core.temporal(col, w, h);
        else core.spatial(col, w, h);
      } finally {
        rp.after = null;
        core.unjitter(cam);
        [ao.enabled, dof.enabled, bloom.enabled, mb.enabled, gr.enabled, aa.enabled] = keep;
      }
    },
    setLevel(ql, enabled, w, h, aoOn = 0) {
      on = enabled && ql > 0;
      aoL = on ? aoOn : 0;
      ao.enabled = aoL > 0;
      ao.configuration.halfRes = aoL < 2;
      ao.configuration.aoSamples = ql >= 3 ? 16 : aoL >= 2 ? 12 : 8;
      targets(hm === 1);
      bloom.enabled = ql >= 1;
      bloom.strength = ql >= 3 ? 0.26 : ql >= 2 ? 0.22 : 0.15;
      bloom.radius = ql >= 3 ? 0.5 : 0.4;
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
      // sharper texture mips below output res (temporal only: the jitter resolves the extra detail)
      HSRBIAS.value = mode === 1 ? Math.max(-1.25, Math.log2(hs) * 0.85) : 0;
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
    setLook(sat, con, vig, warm, grain) {
      const u = gr.uniforms;
      u.sat.value = sat;
      u.con.value = con;
      u.vig.value = vig;
      u.warm.value = warm;
      u.grain.value = grain;
    },
    setMotion(vx, vy, amt) {
      mb.uniforms.vel.value.set(vx, vy);
      mb.uniforms.amt.value = amt;
      mb.enabled = amt > 0.001;
    },
  };
  return fx;
}
