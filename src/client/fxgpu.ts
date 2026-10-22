// WebGPU post-processing (three r186 RenderPipeline + TSL nodes): scene pass (MSAA) -> bloom -> color grade ->
// replay depth of field -> ACES + sRGB -> FXAA. Same Fx interface as the WebGL chain in fx3d.ts.
// HSR (H2K Super Resolution) on WebGPU: temporal = a low-res scene pass with MRT velocity -> three's TAAU node
// (jittered Halton samples, velocity reprojection, variance clipping) -> bloom/grade at output res -> RCAS sharpen;
// spatial = the whole chain at low res in an RTT -> FSR1 (EASU + RCAS).
import * as THREE from "three";
import { RenderPipeline, HalfFloatType } from "three/webgpu";
import { pass, uniform, vec3, vec4, float, uv, dot, mix, pow, max, luminance, renderOutput, mrt, output, velocity, rtt } from "three/tsl";
import { taau } from "three/examples/jsm/tsl/display/TAAUNode.js";
import { fsr1 } from "three/examples/jsm/tsl/display/FSR1Node.js";
import { sharpen } from "three/examples/jsm/tsl/display/SharpenNode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { dof } from "three/examples/jsm/tsl/display/DepthOfFieldNode.js";
import { fxaa } from "three/examples/jsm/tsl/display/FXAANode.js";
import type { Fx } from "./fx3d";

export function makeFxGPU(R: any, S: THREE.Scene, cam: THREE.PerspectiveCamera): Fx {
  const pipe = new RenderPipeline(R);
  pipe.outputColorTransform = false; // we tone-map ourselves so FXAA runs on the display image
  const sp: any = pass(S, cam, { samples: 4 } as any);
  const col: any = sp.getTextureNode("output"),
    viewZ = sp.getViewZNode();
  const bStr = uniform(0.2),
    sat = uniform(1.08),
    con = uniform(1.06),
    vig = uniform(0.22),
    tint = uniform(new THREE.Color(1, 1, 1)),
    gradeOn = uniform(1),
    focus = uniform(15);
  const bl: any = bloom(col, 0.2, 0.35, 3.2);
  bl.strength = bStr;
  const graded = (c: any) => {
    const x = c.rgb,
      l = luminance(x),
      s1 = mix(vec3(l), x, sat),
      c1 = pow(max(s1, vec3(1e-4)).div(0.18), vec3(con)).mul(0.18),
      d = uv().sub(0.5),
      g = c1.mul(tint).mul(float(1).sub(vig.mul(dot(d, d)).mul(2.2)));
    return vec4(mix(x, g, gradeOn), c.a);
  };
  const base = col.add(bl),
    plain = fxaa(renderOutput(graded(base))),
    withDof = fxaa(renderOutput(graded(dof(base, viewZ, focus, 4, 1.4))));
  // HSR temporal: no MSAA (the jitter is the AA), velocity in a second target
  const sharp = uniform(0.6);
  const tp: any = pass(S, cam, { samples: 0 } as any);
  tp.setMRT(mrt({ output, velocity }));
  const tCol: any = tp.getTextureNode("output"),
    tz: any = tp.getTextureNode("depth"),
    tv: any = tp.getTextureNode("velocity");
  const ta: any = taau(tCol, tz, tv, cam);
  const tBase = ta.add(bloom(ta, 0.2, 0.35, 3.2)),
    tPlain = sharpen(renderOutput(graded(tBase)), sharp),
    tDof = sharpen(renderOutput(graded(dof(tBase, tp.getViewZNode(), focus, 4, 1.4))), sharp);
  // HSR spatial: the graded, tone-mapped frame at low res -> FSR1
  const sp2: any = pass(S, cam, { samples: 4 } as any);
  const c2: any = sp2.getTextureNode("output");
  const low: any = rtt(renderOutput(graded(c2.add(bloom(c2, 0.2, 0.35, 3.2)))), null, null, { type: HalfFloatType });
  const sPlain = fsr1(low, sharp);
  pipe.outputNode = plain;
  let on = true,
    dofOn = false,
    hm = 0,
    hs = 1,
    cur: any = plain;
  const lastCam = new THREE.Matrix4();
  const st: any = { mode: 0, scale: 1, w: 0, h: 0, ow: 0, oh: 0, core: null };
  const pick = () => {
    const want = !on && !hm ? plain : hm === 1 ? (dofOn ? tDof : tPlain) : hm === 2 ? sPlain : dofOn ? withDof : plain;
    if (want !== cur) {
      cur = want;
      pipe.outputNode = want;
      pipe.needsUpdate = true;
    }
  };
  const v2 = new THREE.Vector2();
  return {
    dyn: [],
    hsr: st,
    render() {
      if (!on && !hm) return void R.render(S, cam);
      if (hm === 1) {
        // camera cut: re-seed TAAU's history (it restarts whenever its history size differs from the output)
        const e = cam.matrixWorld.elements,
          l = lastCam.elements;
        if (Math.hypot(e[12] - l[12], e[13] - l[13], e[14] - l[14]) > 3.5 || e[8] * l[8] + e[9] * l[9] + e[10] * l[10] < Math.cos(0.18)) ta._historyRenderTarget.setSize(1, 1);
        lastCam.copy(cam.matrixWorld);
      }
      pipe.render();
      R.getDrawingBufferSize(v2);
      st.ow = v2.x;
      st.oh = v2.y;
      st.w = hm ? Math.floor(v2.x * hs) : v2.x;
      st.h = hm ? Math.floor(v2.y * hs) : v2.y;
    },
    setLevel(ql, enabled) {
      on = enabled && ql > 0;
      bStr.value = ql >= 1 ? (ql >= 2 ? 0.2 : 0.14) : 0;
      gradeOn.value = on ? gradeOn.value : 0;
      pick();
    },
    setHSR(mode, scale) {
      hm = mode;
      hs = mode ? scale : 1;
      st.mode = mode;
      st.scale = hs;
      tp.setResolutionScale(hs);
      sp2.setResolutionScale(hs);
      low.setResolutionScale(hs);
      pick();
    },
    setMotion() {
      // camera motion blur is WebGL-only (kept off on WebGPU)
    },
    setGrade(onG, t) {
      gradeOn.value = onG ? 1 : 0;
      if (t) tint.value.copy(t);
    },
    setDof(f) {
      const want = on && f > 0;
      if (f > 0) focus.value = f;
      if (want !== dofOn) {
        dofOn = want;
        pick();
      }
    },
  };
}
