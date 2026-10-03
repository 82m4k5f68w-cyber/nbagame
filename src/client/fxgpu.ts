// WebGPU post-processing (three r186 RenderPipeline + TSL nodes): scene pass (MSAA) -> bloom -> color grade ->
// replay depth of field -> ACES + sRGB -> FXAA. Same Fx interface as the WebGL chain in fx3d.ts.
import * as THREE from "three";
import { RenderPipeline } from "three/webgpu";
import { pass, uniform, vec3, vec4, float, uv, dot, mix, pow, max, luminance, renderOutput } from "three/tsl";
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
  pipe.outputNode = plain;
  let on = true,
    dofOn = false;
  return {
    render() {
      if (on) pipe.render();
      else R.render(S, cam);
    },
    setLevel(ql, enabled) {
      on = enabled && ql > 0;
      bStr.value = ql >= 1 ? (ql >= 2 ? 0.2 : 0.14) : 0;
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
        pipe.outputNode = want ? withDof : plain;
        pipe.needsUpdate = true;
      }
    },
  };
}
