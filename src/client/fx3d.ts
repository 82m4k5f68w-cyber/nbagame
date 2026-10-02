// Post-processing chain for the 3D arena: MSAA render -> SSAO (High) -> bloom -> camera motion blur -> gamma.
// ACES tone mapping happens in the material shaders (r149 applies it in render targets too).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader.js";

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

export interface Fx {
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.22, 0.35, 0.92);
  const mb = new ShaderPass(MotionBlurShader as any);
  const gm = new ShaderPass(GammaCorrectionShader);
  C.addPass(rp);
  C.addPass(ao);
  C.addPass(bloom);
  C.addPass(mb);
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
      bloom.strength = ql >= 2 ? 0.22 : 0.16;
      C.setPixelRatio(R.getPixelRatio());
      C.setSize(w, h);
      ao.setSize(Math.round(w * R.getPixelRatio() * 0.5), Math.round(h * R.getPixelRatio() * 0.5));
    },
    setMotion(vx, vy, amt) {
      mb.uniforms.vel.value.set(vx, vy);
      mb.uniforms.amt.value = amt;
      mb.enabled = amt > 0.001;
    },
  };
}
