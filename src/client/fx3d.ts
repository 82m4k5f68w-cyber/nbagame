// Post-processing chain for the 3D arena: MSAA render (linear HDR) -> SSAO (High) -> bloom -> camera motion blur ->
// color grade -> OutputPass (ACES tone mapping + sRGB). three r153+ only tone-maps the final output.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

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
  render(dt: number): void;
  setLevel(ql: number, on: boolean, w: number, h: number, ao?: boolean): void;
  setMotion(vx: number, vy: number, amt: number): void;
}

export function makeFx(R: THREE.WebGLRenderer, S: THREE.Scene, cam: THREE.PerspectiveCamera, W: number, H: number): Fx {
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: R.capabilities.isWebGL2 ? 4 : 0 });
  const C = new EffectComposer(R, rt);
  const rp = new RenderPass(S, cam);
  const ao = new SSAOPass(S, cam, W, H);
  ao.kernelRadius = 0.45;
  ao.minDistance = 0.0006;
  ao.maxDistance = 0.04;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.22, 0.35, 3.2); // HDR input: only real highlights (lit floor ~2.5)
  const mb = new ShaderPass(MotionBlurShader as any);
  const gr = new ShaderPass(GradeShader as any);
  const gm = new OutputPass(); // tone mapping (ACES) + sRGB, once, at the end
  C.addPass(rp);
  C.addPass(ao);
  C.addPass(bloom);
  C.addPass(mb);
  C.addPass(gr);
  C.addPass(gm);
  let on = true;
  return {
    render(dt) {
      void dt;
      if (on) C.render();
      else R.render(S, cam);
    },
    setLevel(ql, enabled, w, h, aoOn = false) {
      on = enabled && ql > 0;
      ao.enabled = aoOn;
      bloom.enabled = ql >= 1;
      bloom.strength = ql >= 2 ? 0.2 : 0.14;
      C.setPixelRatio(R.getPixelRatio());
      C.setSize(w, h);
      ao.setSize(Math.round(w * R.getPixelRatio() * 0.5), Math.round(h * R.getPixelRatio() * 0.5));
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
}
