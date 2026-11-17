import * as THREE from "three";
import { humanHead } from "./human-head.ts";

export type AppearanceKind = "pilgrim" | "effigy" | "watcher" | "gaoler";
type Palette = {
  skin: number;
  lips: number;
  hair: number;
  iris: number;
  jaw: number;
  age: number;
};
const palettes: Record<Exclude<AppearanceKind, "gaoler">, Palette> = {
  pilgrim: {
    skin: 0xd5b6a2,
    lips: 0xa5716e,
    hair: 0x352820,
    iris: 0x645a3c,
    jaw: 0.7,
    age: 0,
  },
  effigy: {
    skin: 0xaaa48d,
    lips: 0x746966,
    hair: 0x43352d,
    iris: 0x4d5146,
    jaw: 0.77,
    age: 0.7,
  },
  watcher: {
    skin: 0x9b9d8a,
    lips: 0x68665a,
    hair: 0x37372d,
    iris: 0x55503d,
    jaw: 0.86,
    age: 1,
  },
};
const lerp = THREE.MathUtils.lerp;
export function createCharacterHead(
  kind: Exclude<AppearanceKind, "gaoler"> = "pilgrim",
) {
  const head = humanHead(kind, palettes[kind]);
  head.position.y = -0.025;
  return head;
}

function indexView(source: THREE.BufferGeometry) {
  const view = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes))
    view.setAttribute(name, attribute);
  view.morphAttributes = source.morphAttributes;
  view.morphTargetsRelative = source.morphTargetsRelative;
  view.setIndex(source.index);
  view.boundingBox = source.boundingBox;
  view.boundingSphere = source.boundingSphere;
  view.name = source.name + "_fixes1_visibility";
  return view;
}
type AppearanceState = {
  owned: THREE.BufferGeometry[];
  armoured: boolean;
  head?: THREE.Group;
  shoulders: THREE.Object3D[];
  armour?: THREE.Object3D;
  fauld?: THREE.Object3D;
  frame: number;
  matrices: THREE.Matrix4[];
  enabled: { value: number };
  strapPath: { value: THREE.Vector2[] };
  strapSurface: { value: THREE.Vector3[] };
  strapNormals: { value: THREE.Vector2[] };
};
const states = new WeakMap<THREE.Object3D, AppearanceState>();
const garmentShaders = new WeakMap<
  THREE.Material,
  {
    compile: THREE.Material["onBeforeCompile"];
    key: THREE.Material["customProgramCacheKey"];
  }
>();
function skinShader(mesh: THREE.Mesh, kind: Exclude<AppearanceKind, "gaoler">) {
  const skin = new THREE.Color(palettes[kind].skin);
  for (const material of Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material]) {
    const m = material as THREE.MeshStandardMaterial,
      previous = m.onBeforeCompile,
      key = m.customProgramCacheKey();
    m.color.set(0xc4c2b8);
    m.onBeforeCompile = (shader, renderer) => {
      previous.call(m, shader, renderer);
      shader.uniforms.new0SkinColor = { value: skin };
      shader.vertexShader =
        `attribute float fixes1Skin;\nvarying float vFixes1Skin;\n` +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFixes1Skin=fixes1Skin;",
      );
      shader.fragmentShader =
        `uniform vec3 new0SkinColor;\nvarying float vFixes1Skin;\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float originalSkinDetail=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))*3.0,0.0,1.0);
        diffuseColor.rgb=mix(diffuseColor.rgb,new0SkinColor*(.94+.1*originalSkinDetail),clamp(vFixes1Skin,0.0,1.0));`,
      );
    };
    m.customProgramCacheKey = () => key + "_fixes1_skin";
    m.needsUpdate = true;
  }
}
function updateArmourMatrices(state: AppearanceState) {
  if (state.armour) state.matrices[0].copy(state.armour.matrixWorld).invert();
  for (let i = 0; i < 2; i++)
    if (state.shoulders[i])
      state.matrices[i + 1].copy(state.shoulders[i].matrixWorld).invert();
  if (state.fauld) state.matrices[3].copy(state.fauld.matrixWorld).invert();
}
function coverageShader(mesh: THREE.Mesh, state: AppearanceState) {
  for (const material of Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material]) {
    const m = material as THREE.MeshStandardMaterial,
      previous = m.onBeforeCompile,
      key = m.customProgramCacheKey();
    m.onBeforeCompile = (shader, renderer) => {
      previous.call(m, shader, renderer);
      shader.uniforms.new0ArmourEnabled = state.enabled;
      shader.uniforms.new0ArmourMatrices = { value: state.matrices };
      shader.uniforms.new0StrapPath = state.strapPath;
      shader.uniforms.new0StrapSurface = state.strapSurface;
      shader.uniforms.new0StrapNormals = state.strapNormals;
      shader.vertexShader =
        `attribute float fixes1Coverage;\nuniform mat4 new0ArmourMatrices[4];\nvarying float vArmourCoverage;\nvarying vec3 vArmourLocal;\nvarying vec3 vCapLocalL;\nvarying vec3 vCapLocalR;\nvarying vec3 vFauldLocal;\n` +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
        vec4 coveredWorld=modelMatrix*vec4(transformed,1.0);
        vArmourCoverage=fixes1Coverage;
        vArmourLocal=(new0ArmourMatrices[0]*coveredWorld).xyz;
        vCapLocalL=(new0ArmourMatrices[1]*coveredWorld).xyz;
        vCapLocalR=(new0ArmourMatrices[2]*coveredWorld).xyz;
        vFauldLocal=(new0ArmourMatrices[3]*coveredWorld).xyz;`,
      );
      shader.fragmentShader =
        `uniform float new0ArmourEnabled;\nuniform vec2 new0StrapPath[9];uniform vec3 new0StrapSurface[21];uniform vec2 new0StrapNormals[21];\nvarying float vArmourCoverage;\nvarying vec3 vArmourLocal;\nvarying vec3 vCapLocalL;\nvarying vec3 vCapLocalR;\nvarying vec3 vFauldLocal;
        bool beneathCap(vec3 p,float side){if(dot(p,p)>.0289)return false;vec3 axis=normalize(vec3(.16*side,-.24,-.01));vec3 outer=normalize(vec3(0.,1.,0.)-axis*axis.y);float t=dot(p,axis);if(t<-.001||t>.145)return false;vec3 radial=p-axis*t;float angle=atan(dot(radial,normalize(cross(axis,outer))),dot(radial,outer));for(int layer=0;layer<3;layer++){float start=.003+float(layer)*.041;float radius=.068-.107*t+(2.-float(layer))*.001;if(t>start-.0001&&t<start+.0571&&abs(angle)<1.502&&abs(length(radial)-radius)<.0011)return true;}vec3 across=normalize(cross(axis,outer));for(int i=0;i<3;i++){float end=.060+float(i)*.041;float radius=.068-.107*end+(2.-float(i))*.001;if(abs(t-end)<.0017){for(int k=0;k<16;k++){float a0=-1.5+float(k)*3./16.,a1=-1.5+float(k+1)*3./16.;vec3 q0=axis*end+(outer*cos(a0)+across*sin(a0))*radius,q1=axis*end+(outer*cos(a1)+across*sin(a1))*radius;vec3 v=q1-q0;float u=clamp(dot(p-q0,v)/dot(v,v),0.,1.);if(distance(p,q0+v*u)<.0017)return true;}}float rivetT=.018+float(i)*.041;float rivetR=.068-.107*rivetT+(3.-float(i))*.001;vec3 middle=axis*rivetT+outer*cos(1.24)*rivetR;vec3 offset=across*sin(1.24)*rivetR;if(distance(p,middle+offset)<.0027||distance(p,middle-offset)<.0027)return true;}return false;}
        bool beneathPlate(vec3 p){if(p.y<-.0931||p.y>.2431||abs(p.x)>.195||p.z<-.163||p.z>.160)return false;float t=.5,w=.1738,top=.23;for(int i=0;i<3;i++){w=.156+.035*sin(t*3.14159265*.83);top=.195+.045*clamp(abs(p.x)/w,0.,1.);t=clamp((p.y+.090)/(top+.090),0.,1.);}w=.156+.035*sin(t*3.14159265*.83);float d=p.z<0.?.159-t*.009:.130+sin(t*3.14159265)*.016;float keel=p.z<0.?0.:.01*exp(-((p.x/w/.23)*(p.x/w/.23)))*sin(t*3.14159265);float radius=length(vec2(p.x/w,(p.z-keel)/d));return p.y>-.0931&&p.y<top+.0031&&abs(radius-1.)*min(w,d)<.0031;}
        bool beneathRim(vec3 p){if(!((p.y>.190&&p.y<.245)||(p.y>-.094&&p.y<-.086)))return false;float upper=step(0.,p.y);float w=mix(.156,.156+.035*sin(3.14159265*.83),upper);float back=mix(.159,.150,upper);float a=atan(p.x/w,p.z/(p.z<0.?back:.130));for(int i=0;i<3;i++){float s=sin(a),c=cos(a),d=c<0.?back:.130;vec3 q=vec3(w*s,mix(-.09,.195+.045*abs(s),upper),d*c);vec3 tangent=vec3(w*c,upper*.045*sign(s)*c,-d*s);vec3 second=vec3(-w*s,-upper*.045*abs(s),-d*c);a-=dot(q-p,tangent)/max(dot(tangent,tangent)+dot(q-p,second),.000001);}float s=sin(a),c=cos(a);vec3 q=vec3(w*s,mix(-.09,.195+.045*abs(s),upper),(c<0.?back:.130)*c);return distance(p,q)<.0031;}
        bool beneathFauld(vec3 p){float front=max(0.0,(p.z/.155)/max(length(p.xz/vec2(.163,.155)),.001));return p.y>-.168+.065*front&&p.y<-.077&&dot(p.xz/vec2(.172,.165),p.xz/vec2(.172,.165))<1.0;}
        float strapDistanceSquared(vec2 p,vec2 a,vec2 b){vec2 v=b-a;vec2 d=p-a-v*clamp(dot(p-a,v)/dot(v,v),0.0,1.0);return dot(d,d);}
        bool beneathStrap(vec3 p){if(abs(p.x)<.1129||abs(p.x)>.1581||p.y<.1674||p.y>.2396||p.z<-.1256||p.z>.1146)return false;vec3 q=vec3(abs(p.x),p.yz);for(int i=1;i<21;i++){vec3 a=new0StrapSurface[i-1],b=new0StrapSurface[i],v=b-a;vec2 na=new0StrapNormals[i-1],dn=new0StrapNormals[i]-na;float t=dot(q.yz-a.yz,v.yz)/dot(v.yz,v.yz),h=0.;if(t<-.2||t>1.2)continue;for(int k=0;k<2;k++){vec2 n=na+dn*t,j=v.yz+dn*h,f=a.yz+v.yz*t+n*h-q.yz;float det=j.x*n.y-j.y*n.x;t-=(f.x*n.y-f.y*n.x)/det;h-=(j.x*f.y-j.y*f.x)/det;}float margin=.0001/length(v.yz);if(t < -margin||t>1.+margin)continue;t=clamp(t,0.,1.);if(abs(q.x-a.x-v.x*t)<.0131&&abs(h)<.0026)return true;}return false;}
        bool beneathBuckle(vec3 p){if(abs(p.y-.169)>.021||abs(p.z-.116)>.0031||abs(abs(p.x)-.126)>.0161)return false;vec3 q=vec3(abs(p.x)-.126,(p.y-.169)/1.3,p.z-.116);return length(vec2(length(q.xy)-.013,q.z))<.0031;}
        bool beneathRivet(vec3 p){if(abs(abs(p.x)-.13)>.025||p.y<-.08||p.y>.175||p.z<.08||p.z>.13)return false;for(int i=0;i<3;i++){float y=i==0?-.075:(i==1?.045:.17);float t=clamp((y+.09)/(.195+.045*.72+.09),0.,1.);float w=.156+.035*sin(t*3.14159265*.83),d=.130+sin(t*3.14159265)*.016;vec3 q=vec3(abs(p.x)-.72*w,p.y-y,(p.z-sqrt(1.-.72*.72)*d-.0005)/.55);if(length(q)<.0049)return true;}return false;}
        ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if(new0ArmourEnabled>.5&&vArmourCoverage>.99&&(beneathPlate(vArmourLocal)||beneathRim(vArmourLocal)||beneathCap(vCapLocalL,-1.)||beneathCap(vCapLocalR,1.)||beneathStrap(vArmourLocal)||beneathBuckle(vArmourLocal)||beneathRivet(vArmourLocal)||beneathFauld(vFauldLocal)))discard;`,
      );
    };
    m.customProgramCacheKey = () =>
      key + "_fixes2_fitted_armour_metal_details_layer";
    m.needsUpdate = true;
  }
  const previous = mesh.onBeforeRender;
  mesh.onBeforeRender = function (
    renderer,
    scene,
    camera,
    geometry,
    material,
    group,
  ) {
    previous.call(this, renderer, scene, camera, geometry, material, group);
    if (state.armoured && state.frame !== renderer.info.render.frame) {
      updateArmourMatrices(state);
      state.frame = renderer.info.render.frame;
    }
  };
}
function fittedNeck(
  rig: THREE.Object3D,
  source: THREE.SkinnedMesh,
  kind: Exclude<AppearanceKind, "gaoler">,
  state: AppearanceState,
) {
  const skeleton = source.skeleton,
    neck = skeleton.bones.findIndex((b) => b.name === "neck"),
    head = skeleton.bones.findIndex((b) => b.name === "head"),
    chest = skeleton.bones.findIndex((b) => b.name === "chest");
  {
    const positions: number[] = [],
      indices: number[] = [],
      joints: number[] = [],
      weights: number[] = [],
      colours: number[] = [];
    const rings = 8,
      sides = 24,
      base = 1.376,
      top = 1.5;
    const c = new THREE.Color(palettes[kind].skin);
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i <= sides; i++) {
        const t = j / rings,
          a = (i / sides) * Math.PI * 2,
          y = lerp(base, top, t);
        const rx = lerp(0.049, 0.037, t),
          rz = lerp(0.044, 0.034, t);
        positions.push(
          Math.sin(a) * rx,
          y,
          Math.cos(a) * rz - lerp(0.006, 0.02, t),
        );
        const headWeight = THREE.MathUtils.smoothstep(y, 1.452, 1.5),
          chestWeight =
            (1 - THREE.MathUtils.smoothstep(y, 1.376, 1.424)) * 0.35;
        joints.push(neck, head, chest, 0);
        weights.push(1 - headWeight - chestWeight, headWeight, chestWeight, 0);
        colours.push(c.r, c.g, c.b);
        if (i < sides && j < rings) {
          const k = j * (sides + 1) + i,
            n = k + sides + 1;
          indices.push(k, k + 1, n, n, k + 1, n + 1);
        }
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colours, 3),
    );
    geometry.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(joints, 4),
    );
    geometry.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(weights, 4),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.91,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = "fixes1_neck_skin";
    mesh.frustumCulled = false;
    mesh.userData.fixes1OwnedGeometry = true;
    rig.add(mesh);
    mesh.bind(skeleton, source.bindMatrix);
    if (kind === "pilgrim") {
      geometry.setAttribute(
        "fixes1Coverage",
        new THREE.Float32BufferAttribute(
          new Float32Array(positions.length / 3).fill(1),
          1,
        ),
      );
      coverageShader(mesh, state);
    }
  }
  const shirt = rig.getObjectByName(
    kind === "watcher" ? "new0_v8_fitted_observer" : "new0_v8_fitted_linen",
  ) as THREE.SkinnedMesh | undefined;
  if (!shirt?.geometry.index) return;
  const sg = shirt.geometry,
    sp = sg.getAttribute("position"),
    sn = sg.getAttribute("normal"),
    suv = sg.getAttribute("uv"),
    sj = sg.getAttribute("skinIndex"),
    sw = sg.getAttribute("skinWeight"),
    edges = new Map<string, { a: number; b: number; count: number }>();
  // UV seams duplicate vertex records. They are not physical openings and must
  // not sprout extra collar panels. Weld only this boundary analysis by bind
  // position, while leaving every protected source attribute unchanged.
  const welded = new Map<string, number>(),
    canonical: number[] = [];
  for (let i = 0; i < sp.count; i++) {
    const key = [sp.getX(i), sp.getY(i), sp.getZ(i)]
      .map((v) => v.toFixed(5))
      .join(",");
    const existing = welded.get(key);
    if (existing === undefined) {
      welded.set(key, i);
      canonical.push(i);
    } else canonical.push(existing);
  }
  for (let i = 0; i < sg.index!.count; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = canonical[sg.index!.getX(i + k)],
        b = canonical[sg.index!.getX(i + ((k + 1) % 3))],
        key = Math.min(a, b) + "," + Math.max(a, b),
        edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  const nearNeck = (v: number) =>
    sp.getY(v) > 1.32 &&
    Math.abs(sp.getX(v)) < 0.18 &&
    Math.abs(sp.getZ(v) + 0.015) < 0.185;
  let boundary = [...edges.values()].filter(
    (e) => e.count === 1 && nearNeck(e.a) && nearNeck(e.b),
  );
  // The source has small internal cutouts near its old lapels. Follow the
  // largest physical neck opening, rather than stretching every cutout into a
  // second overlapping cone at the throat.
  const adjacent = new Map<number, number[]>();
  for (const e of boundary) {
    adjacent.set(e.a, [...(adjacent.get(e.a) ?? []), e.b]);
    adjacent.set(e.b, [...(adjacent.get(e.b) ?? []), e.a]);
  }
  let outer: number[] = [],
    outerArea = 0;
  for (const edge of boundary) {
    const queue = [edge.b],
      previous = new Map<number, number>([[edge.b, -1]]);
    for (let k = 0; k < queue.length && !previous.has(edge.a); k++)
      for (const next of adjacent.get(queue[k]) ?? []) {
        if ((queue[k] === edge.b && next === edge.a) || previous.has(next))
          continue;
        previous.set(next, queue[k]);
        queue.push(next);
      }
    if (!previous.has(edge.a)) continue;
    const loop = [edge.a];
    for (let at = edge.a; at !== edge.b;) {
      at = previous.get(at)!;
      loop.push(at);
    }
    let area = 0;
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k],
        b = loop[(k + 1) % loop.length];
      area += sp.getX(a) * sp.getZ(b) - sp.getX(b) * sp.getZ(a);
    }
    if (Math.abs(area) > outerArea) {
      outerArea = Math.abs(area);
      outer = loop;
    }
  }
  const outerEdges = new Set(
    outer.map((v, i) => {
      const b = outer[(i + 1) % outer.length];
      return Math.min(v, b) + "," + Math.max(v, b);
    }),
  );
  boundary = boundary.filter((e) =>
    outerEdges.has(Math.min(e.a, e.b) + "," + Math.max(e.a, e.b)),
  );
  const vertices = [...new Set(boundary.flatMap((e) => [e.a, e.b]))],
    remap = new Map(vertices.map((v, i) => [v, i])),
    count = vertices.length,
    rings = 4;
  if (!count) return;
  const positions: number[] = [],
    indices: number[] = [],
    joints: number[] = [],
    weights: number[] = [],
    uv: number[] = [];
  for (let ring = 0; ring <= rings; ring++)
    for (const vertex of vertices) {
      const t = ring / rings,
        x = sp.getX(vertex),
        y = sp.getY(vertex),
        z = sp.getZ(vertex),
        a = Math.atan2(x, z + 0.015);
      const px = lerp(x, Math.sin(a) * 0.048, t),
        py = lerp(y, 1.435, t),
        pz = lerp(z, Math.cos(a) * 0.044 - 0.015, t);
      positions.push(px, py, pz);
      uv.push(
        lerp(suv ? suv.getX(vertex) : x * 7, Math.sin(a) * 0.048 * 7, t),
        lerp(suv ? suv.getY(vertex) : y * 7, 1.435 * 7, t),
      );
      const influence = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const joint = sj.getComponent(vertex, k);
        influence.set(
          joint,
          (influence.get(joint) ?? 0) + sw.getComponent(vertex, k) * (1 - t),
        );
      }
      influence.set(neck, (influence.get(neck) ?? 0) + t);
      const chosen = [...influence].sort((a, b) => b[1] - a[1]).slice(0, 4),
        sum = chosen.reduce((n, p) => n + p[1], 0);
      for (let k = 0; k < 4; k++) {
        joints.push(chosen[k]?.[0] ?? 0);
        weights.push((chosen[k]?.[1] ?? 0) / sum);
      }
    }
  for (let ring = 0; ring < rings; ring++)
    for (const edge of boundary) {
      const a = ring * count + remap.get(edge.a)!,
        b = ring * count + remap.get(edge.b)!,
        ua = a + count,
        ub = b + count;
      indices.push(b, a, ub, ub, a, ua);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(joints, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(weights, 4),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (sn) {
    const normal = geometry.getAttribute("normal"),
      v = new THREE.Vector3(),
      n = new THREE.Vector3();
    for (let ring = 0; ring <= rings; ring++)
      for (let i = 0; i < count; i++) {
        const at = ring * count + i,
          t = ring / rings;
        v.fromBufferAttribute(normal, at);
        n.fromBufferAttribute(sn, vertices[i]);
        v.lerp(n, 1 - THREE.MathUtils.smoothstep(t, 0, 0.6)).normalize();
        normal.setXYZ(at, v.x, v.y, v.z);
      }
  }
  const shirtMaterial = shirt.material as THREE.MeshStandardMaterial,
    material = shirtMaterial.clone(),
    baseShader = garmentShaders.get(shirtMaterial);
  if (baseShader) {
    material.onBeforeCompile = baseShader.compile;
    material.customProgramCacheKey = baseShader.key;
  }
  material.side = THREE.DoubleSide;
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "fixes1_fitted_collar";
  mesh.frustumCulled = false;
  mesh.userData.fixes1OwnedGeometry = true;
  mesh.userData.fixes1SeamSourceIndices = vertices;
  mesh.userData.fixes1SeamBoundaryEdges = boundary.map((e) => [e.a, e.b]);
  rig.add(mesh);
  mesh.bind(skeleton, source.bindMatrix);
  if (kind === "pilgrim") {
    geometry.setAttribute(
      "fixes1Coverage",
      new THREE.Float32BufferAttribute(
        new Float32Array(positions.length / 3).fill(1),
        1,
      ),
    );
    coverageShader(mesh, state);
  }
}
export function applyCharacterAppearance(
  rig: THREE.Object3D,
  kind: AppearanceKind,
) {
  if (states.has(rig) || kind === "gaoler") return;
  const state: AppearanceState = {
    owned: [],
    armoured: false,
    shoulders: [],
    frame: -1,
    matrices: Array.from({ length: 4 }, () => new THREE.Matrix4()),
    enabled: { value: 0 },
    strapPath: { value: Array.from({ length: 9 }, () => new THREE.Vector2()) },
    strapSurface: {
      value: Array.from({ length: 21 }, () => new THREE.Vector3()),
    },
    strapNormals: {
      value: Array.from({ length: 21 }, () => new THREE.Vector2()),
    },
  };
  let sourceBody: THREE.SkinnedMesh | undefined;
  rig.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (
      /^original_(porcelain_mask|eye_cavity_|mask_mouth)/.test(o.name) ||
      /new0_v7_(rounded_cloth_hood|compact_face_veil|soft_collar)/.test(o.name)
    )
      o.visible = false;
    const body =
      o instanceof THREE.SkinnedMesh &&
      (o.name === "body" ||
        (o.geometry.getAttribute("skinIndex") && o.name.startsWith("tripo_")));
    const shirt = /new0_v8_fitted_(linen|observer|trousers)/.test(o.name);
    if (!body && !shirt) return;
    const source = o.geometry,
      geometry = indexView(source),
      position = source.getAttribute("position"),
      index = source.index;
    if (!index) return;
    const skinIndex = source.getAttribute("skinIndex"),
      skinWeight = source.getAttribute("skinWeight");
    const bones = (o as THREE.SkinnedMesh).skeleton.bones;
    const plain: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      let x = 0,
        y = 0,
        z = 0;
      for (const vertex of vertices) {
        x += position.getX(vertex) / 3;
        y += position.getY(vertex) / 3;
        z += position.getZ(vertex) / 3;
      }
      // Patch's original jaw/nose are neck-weighted and extend well below the
      // old mask. Remove that complete volume to the existing collar seam.
      if (body && y > 1.382 && Math.abs(x) < 0.128 && z > -0.15 && z < 0.195)
        continue;
      if (shirt && y > 1.388 && Math.abs(x) < 0.145 && z > -0.16 && z < 0.2)
        continue;
      plain.push(...vertices);
    }
    geometry.setIndex(plain);
    o.geometry = geometry;
    o.userData.fixes1OwnedGeometry = true;
    state.owned.push(geometry);
    if (shirt)
      for (const material of Array.isArray(o.material)
        ? o.material
        : [o.material])
        garmentShaders.set(material, {
          compile: material.onBeforeCompile,
          key: material.customProgramCacheKey,
        });
    if (body) {
      sourceBody = o as THREE.SkinnedMesh;
      const mask = new Float32Array(position.count);
      for (let i = 0; i < position.count; i++) {
        let hand = 0,
          neck = 0;
        for (let k = 0; k < 4; k++) {
          const name = bones[skinIndex.getComponent(i, k)]?.name ?? "",
            weight = skinWeight.getComponent(i, k);
          if (/^(hand|forearm)_/.test(name)) hand += weight;
          if (name === "head" || name === "neck") neck += weight;
        }
        mask[i] = Math.max(
          THREE.MathUtils.smoothstep(hand, 0.15, 0.45),
          position.getY(i) > 1.3
            ? THREE.MathUtils.smoothstep(neck, 0.15, 0.45)
            : 0,
        );
      }
      geometry.setAttribute("fixes1Skin", new THREE.BufferAttribute(mask, 1));
      skinShader(o, kind);
      o.userData.fixes1HeadTrianglesRemoved = (index.count - plain.length) / 3;
    }
    if (kind === "pilgrim") {
      const mask = new Float32Array(position.count);
      for (let i = 0; i < position.count; i++) {
        let distal = 0;
        for (let k = 0; k < 4; k++)
          if (
            /^(forearm|hand)_/.test(
              bones[skinIndex.getComponent(i, k)]?.name ?? "",
            )
          )
            distal += skinWeight.getComponent(i, k);
        mask[i] =
          position.getY(i) > 0.78 &&
          position.getY(i) < 1.48 &&
          Math.abs(position.getX(i)) < 0.36 &&
          distal < 0.2
            ? 1
            : 0;
      }
      geometry.setAttribute(
        "fixes1Coverage",
        new THREE.BufferAttribute(mask, 1),
      );
      coverageShader(o, state);
    }
  });
  if (sourceBody) fittedNeck(rig, sourceBody, kind, state);
  const head = rig.getObjectByName("head");
  if (head) {
    state.head = createCharacterHead(kind);
    rig.add(state.head);
    rig.updateWorldMatrix(true, true);
    head.attach(state.head);
  }
  states.set(rig, state);
}
export function registerArmourShoulders(
  rig: THREE.Object3D,
  shoulders: THREE.Object3D[],
  armour?: THREE.Object3D,
  fauld?: THREE.Object3D,
) {
  const state = states.get(rig);
  if (state) {
    state.shoulders = shoulders;
    state.armour = armour;
    state.fauld = fauld;
  }
  if (state && armour?.userData.fixes1StrapPath)
    for (let i = 0; i < 9; i++)
      state.strapPath.value[i].copy(armour.userData.fixes1StrapPath[i]);
  if (state && armour?.userData.fixes2StrapSurface)
    for (let i = 0; i < 21; i++)
      state.strapSurface.value[i].copy(armour.userData.fixes2StrapSurface[i]);
  if (state && armour?.userData.fixes2StrapNormals)
    for (let i = 0; i < 21; i++)
      state.strapNormals.value[i].copy(armour.userData.fixes2StrapNormals[i]);
}
export function setArmourCoverage(rig: THREE.Object3D, equipped: boolean) {
  const state = states.get(rig);
  if (!state) return;
  state.armoured = equipped;
  state.enabled.value = equipped ? 1 : 0;
  for (const shoulder of state.shoulders) shoulder.visible = equipped;
  if (state.fauld) state.fauld.visible = equipped;
}
// The rolled rim rises towards the shoulders, so a vertical y margin does not
// describe its round section. Match the actual 3 mm rim using the nearest
// point on its curved centreline, including only a 0.1 mm sampling tolerance.
function beneathArmourRim(p: THREE.Vector3) {
  if (!((p.y > 0.19 && p.y < 0.245) || (p.y > -0.094 && p.y < -0.086)))
    return false;
  const upper = p.y > 0 ? 1 : 0,
    width = upper ? 0.156 + 0.035 * Math.sin(Math.PI * 0.83) : 0.156;
  const back = upper ? 0.15 : 0.159;
  let angle = Math.atan2(p.x / width, p.z / (p.z < 0 ? back : 0.13));
  for (let i = 0; i < 3; i++) {
    const s = Math.sin(angle),
      c = Math.cos(angle),
      d = c < 0 ? back : 0.13;
    const x = width * s - p.x,
      y = (upper ? 0.195 + 0.045 * Math.abs(s) : -0.09) - p.y,
      z = d * c - p.z;
    const tx = width * c,
      ty = upper * 0.045 * Math.sign(s) * c,
      tz = -d * s;
    const denominator =
      tx * tx +
      ty * ty +
      tz * tz -
      x * width * s -
      y * upper * 0.045 * Math.abs(s) -
      z * d * c;
    angle -= (x * tx + y * ty + z * tz) / Math.max(denominator, 0.000001);
  }
  const s = Math.sin(angle),
    c = Math.cos(angle);
  return (
    Math.hypot(
      width * s - p.x,
      (upper ? 0.195 + 0.045 * Math.abs(s) : -0.09) - p.y,
      (c < 0 ? back : 0.13) * c - p.z,
    ) < 0.0031
  );
}
// Same coverage rule as the material, exposed for the offline layer test.
export function armourCoverageAt(rig: THREE.Object3D, point: THREE.Vector3) {
  const state = states.get(rig);
  if (!state?.armoured || !state.armour) return false;
  updateArmourMatrices(state);
  const p = point.clone().applyMatrix4(state.matrices[0]);
  let t = 0.5,
    width = 0.1738,
    top = 0.23;
  for (let i = 0; i < 3; i++) {
    width = 0.156 + 0.035 * Math.sin(t * Math.PI * 0.83);
    top = 0.195 + 0.045 * THREE.MathUtils.clamp(Math.abs(p.x) / width, 0, 1);
    t = THREE.MathUtils.clamp((p.y + 0.09) / (top + 0.09), 0, 1);
  }
  width = 0.156 + 0.035 * Math.sin(t * Math.PI * 0.83);
  const depth =
      p.z < 0 ? 0.159 - t * 0.009 : 0.13 + Math.sin(t * Math.PI) * 0.016,
    keel =
      p.z < 0
        ? 0
        : 0.01 * Math.exp(-((p.x / width / 0.23) ** 2)) * Math.sin(t * Math.PI),
    radius = Math.hypot(p.x / width, (p.z - keel) / depth);
  if (
    p.y > -0.0931 &&
    p.y < top + 0.0031 &&
    Math.abs(radius - 1) * Math.min(width, depth) < 0.0031
  )
    return true;
  if (beneathArmourRim(p)) return true;
  // The buckle torus is actual solid hardware, distinct from the curved
  // leather strap and breastplate. Match its existing 1.3 vertical scale.
  if (
    Math.hypot(
      Math.hypot(Math.abs(p.x) - 0.126, (p.y - 0.169) / 1.3) - 0.013,
      p.z - 0.116,
    ) < 0.0031
  )
    return true;
  for (const y of [-0.075, 0.045, 0.17]) {
    const t = THREE.MathUtils.clamp(
        (y + 0.09) / (0.195 + 0.045 * 0.72 + 0.09),
        0,
        1,
      ),
      w = 0.156 + 0.035 * Math.sin(t * Math.PI * 0.83),
      d = 0.13 + Math.sin(t * Math.PI) * 0.016;
    if (
      Math.hypot(
        Math.abs(p.x) - 0.72 * w,
        p.y - y,
        (p.z - Math.sqrt(1 - 0.72 ** 2) * d - 0.0005) / 0.55,
      ) < 0.0049
    )
      return true;
  }
  if (
    Math.abs(p.x) > 0.1129 &&
    Math.abs(p.x) < 0.1581 &&
    p.y > 0.1674 &&
    p.y < 0.2396 &&
    p.z > -0.1256 &&
    p.z < 0.1146
  ) {
    for (let i = 1; i < 21; i++) {
      const a = state.strapSurface.value[i - 1],
        b = state.strapSurface.value[i],
        na = state.strapNormals.value[i - 1],
        nb = state.strapNormals.value[i],
        dy = b.y - a.y,
        dz = b.z - a.z,
        dny = nb.x - na.x,
        dnz = nb.y - na.y;
      let u = ((p.y - a.y) * dy + (p.z - a.z) * dz) / (dy * dy + dz * dz),
        h = 0;
      if (u < -0.2 || u > 1.2) continue;
      for (let k = 0; k < 2; k++) {
        const ny = na.x + dny * u,
          nz = na.y + dnz * u,
          jy = dy + dny * h,
          jz = dz + dnz * h,
          fy = a.y + dy * u + ny * h - p.y,
          fz = a.z + dz * u + nz * h - p.z,
          det = jy * nz - jz * ny;
        u -= (fy * nz - fz * ny) / det;
        h -= (jy * fz - jz * fy) / det;
      }
      const margin = 0.0001 / Math.hypot(dy, dz);
      if (u < -margin || u > 1 + margin) continue;
      u = THREE.MathUtils.clamp(u, 0, 1);
      if (
        Math.abs(Math.abs(p.x) - a.x - (b.x - a.x) * u) < 0.0131 &&
        Math.abs(h) < 0.0026
      )
        return true;
    }
  }
  for (let i = 1; i < 3; i++) {
    p.copy(point).applyMatrix4(state.matrices[i]);
    if (p.lengthSq() > 0.0289) continue;
    const axis = new THREE.Vector3(
      0.16 * (i === 1 ? -1 : 1),
      -0.24,
      -0.01,
    ).normalize();
    const outer = new THREE.Vector3(0, 1, 0)
      .addScaledVector(axis, -axis.y)
      .normalize();
    const along = p.dot(axis);
    if (along < -0.001 || along > 0.145) continue;
    const radial = p.clone().addScaledVector(axis, -along);
    const capAngle = Math.atan2(
      radial.dot(new THREE.Vector3().crossVectors(axis, outer).normalize()),
      radial.dot(outer),
    );
    for (let layer = 0; layer < 3; layer++) {
      const start = 0.003 + layer * 0.041,
        capRadius = 0.068 - 0.107 * along + (2 - layer) * 0.001;
      if (
        along > start - 0.0001 &&
        along < start + 0.0571 &&
        Math.abs(capAngle) < 1.502 &&
        Math.abs(radial.length() - capRadius) < 0.0011
      )
        return true;
    }
    const across = new THREE.Vector3().crossVectors(axis, outer).normalize();
    for (let layer = 0; layer < 3; layer++) {
      const end = 0.06 + layer * 0.041,
        radius = 0.068 - 0.107 * end + (2 - layer) * 0.001;
      if (Math.abs(along - end) < 0.0017)
        for (let k = 0; k < 16; k++) {
          const a0 = -1.5 + (k * 3) / 16,
            a1 = -1.5 + ((k + 1) * 3) / 16,
            q0 = axis
              .clone()
              .multiplyScalar(end)
              .addScaledVector(outer, Math.cos(a0) * radius)
              .addScaledVector(across, Math.sin(a0) * radius),
            q1 = axis
              .clone()
              .multiplyScalar(end)
              .addScaledVector(outer, Math.cos(a1) * radius)
              .addScaledVector(across, Math.sin(a1) * radius),
            v = q1.sub(q0),
            u = THREE.MathUtils.clamp(
              p.clone().sub(q0).dot(v) / v.lengthSq(),
              0,
              1,
            );
          if (p.distanceTo(q0.addScaledVector(v, u)) < 0.0017) return true;
        }
      const rivetT = 0.018 + layer * 0.041,
        rivetR = 0.068 - 0.107 * rivetT + (3 - layer) * 0.001;
      for (const angle of [-1.24, 1.24]) {
        const rivet = axis
          .clone()
          .multiplyScalar(rivetT)
          .addScaledVector(outer, Math.cos(angle) * rivetR)
          .addScaledVector(across, Math.sin(angle) * rivetR);
        if (p.distanceTo(rivet) < 0.0027) return true;
      }
    }
  }
  if (state.fauld) {
    p.copy(point).applyMatrix4(state.matrices[3]);
    const front = Math.max(
      0,
      p.z / 0.155 / Math.max(Math.hypot(p.x / 0.163, p.z / 0.155), 0.001),
    );
    if (
      p.y > -0.168 + 0.065 * front &&
      p.y < -0.077 &&
      (p.x / 0.172) ** 2 + (p.z / 0.165) ** 2 < 1
    )
      return true;
  }
  return false;
}
export function disposeCharacterAppearance(rig: THREE.Object3D) {
  const state = states.get(rig);
  if (!state) return;
  const geometries = new Set(state.owned);
  rig.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.fixes1OwnedGeometry)
      geometries.add(o.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
  state.head?.traverse((o) => {
    if (o instanceof THREE.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
  });
  states.delete(rig);
}
