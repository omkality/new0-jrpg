import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

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
    skin: 0xc5ab9a,
    lips: 0x916863,
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
const gaussian = (a: number, b: number, width: number) =>
  Math.exp(-(((a - b) / width) ** 2));
const colour = (hex: number) => new THREE.Color(hex);

function paint(
  geometry: THREE.BufferGeometry,
  paintVertex: (p: THREE.Vector3) => THREE.Color,
) {
  const position = geometry.getAttribute("position"),
    colours = new Float32Array(position.count * 3);
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++)
    paintVertex(point.fromBufferAttribute(position, i)).toArray(colours, i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.deleteAttribute("uv");
  return geometry;
}
function solid(geometry: THREE.BufferGeometry, hex: number) {
  const c = colour(hex);
  return paint(geometry, () => c);
}
function tube(
  points: THREE.Vector3[],
  radius: number,
  hex: number,
  segments = 8,
) {
  return solid(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      segments,
      radius,
      5,
      false,
    ),
    hex,
  );
}

// This is an original model, authored in the same metre-scale bind space as
// the licensed body. The source head, rig, skin attributes and clips stay intact.
export function createCharacterHead(
  kind: Exclude<AppearanceKind, "gaoler"> = "pilgrim",
) {
  const palette = palettes[kind],
    hero = kind === "pilgrim";
  const parts: THREE.BufferGeometry[] = [],
    group = new THREE.Group();
  group.name = `fixes1_${kind}_face`;
  const rx = hero ? 0.083 : kind === "effigy" ? 0.079 : 0.087;
  const cy = 1.591,
    ry = hero ? 0.115 : 0.119,
    rz = 0.085;
  const skin = colour(palette.skin),
    lip = colour(palette.lips),
    shade = colour(0x5e5a50);
  const frontSurface = (x: number, y: number) => {
    let sy = (y - cy) / ry;
    if (sy < -0.75) sy = -0.75 + (sy + 0.75) / 0.35;
    const jaw = lerp(
      palette.jaw,
      1,
      THREE.MathUtils.smoothstep(sy, -0.92, -0.1),
    );
    const sz = Math.sqrt(Math.max(0, 1 - sy * sy - (x / (rx * jaw)) ** 2));
    const cheeks =
      (gaussian(x, -0.045, 0.025) + gaussian(x, 0.045, 0.025)) *
      gaussian(y, 1.583, 0.029) *
      0.009;
    const sockets =
      (gaussian(x, -0.032, 0.019) + gaussian(x, 0.032, 0.019)) *
      gaussian(y, 1.614, 0.014) *
      -0.006;
    const bridge =
      gaussian(x, 0, 0.011) * gaussian(y, 1.601, 0.033) * (hero ? 0.01 : 0.014);
    const tip =
      gaussian(x, 0, 0.014) *
      gaussian(y, 1.579, 0.012) *
      (hero ? 0.017 : 0.022);
    const lips = gaussian(x, 0, 0.027) * gaussian(y, 1.543, 0.01) * 0.009;
    const chin = gaussian(x, 0, 0.029) * gaussian(y, 1.513, 0.018) * 0.007;
    const brow =
      (gaussian(x, -0.033, 0.024) + gaussian(x, 0.033, 0.024)) *
      gaussian(y, 1.634, 0.011) *
      (0.003 + 0.004 * palette.age);
    return (
      sz * rz -
      0.003 +
      (cheeks + sockets + bridge + tip + lips + chin + brow) *
        Math.min(1, sz * 4)
    );
  };
  const face = new THREE.SphereGeometry(1, 48, 32);
  const p = face.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const sx = p.getX(i),
      sy = p.getY(i),
      sz = p.getZ(i);
    const jaw = lerp(
      palette.jaw,
      1,
      THREE.MathUtils.smoothstep(sy, -0.92, -0.1),
    );
    const chin = sy < -0.75 ? -0.75 + (sy + 0.75) * 0.35 : sy;
    const x = sx * rx * jaw,
      y = cy + chin * ry;
    let z = sz * rz - 0.003;
    if (sz > 0) {
      z = frontSurface(x, y);
    }
    p.setXYZ(i, x, y, z);
  }
  face.computeVertexNormals();
  parts.push(
    paint(face, (v) => {
      const c = skin.clone();
      const front = THREE.MathUtils.smoothstep(v.z, 0.015, 0.07);
      const blush =
        (gaussian(v.x, -0.048, 0.025) + gaussian(v.x, 0.048, 0.025)) *
        gaussian(v.y, 1.577, 0.028) *
        front;
      c.lerp(lip, blush * (hero ? 0.18 : 0.05));
      const underEye =
        (gaussian(v.x, -0.032, 0.022) + gaussian(v.x, 0.032, 0.022)) *
        gaussian(v.y, 1.605, 0.008) *
        front;
      c.lerp(shade, underEye * (0.12 + palette.age * 0.22));
      const side =
        0.96 + 0.04 * Math.sin(v.y * 270 + v.x * 139) * Math.sin(v.z * 331);
      return c.multiplyScalar(side);
    }),
  );

  for (const side of [-1, 1]) {
    const eyeX = side * 0.032,
      eyeY = 1.614;
    const positions: number[] = [],
      colours: number[] = [],
      indices: number[] = [];
    const nx = 20,
      ny = 6,
      white = colour(hero ? 0xb8b3a6 : 0xa3a18e),
      iris = colour(palette.iris),
      pupil = colour(0x171b18);
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const u = (i / nx) * 2 - 1,
          v = (j / ny) * 2 - 1;
        const x = eyeX + u * 0.0143;
        const y = eyeY + v * 0.0047 * (1 - u * u) + side * u * 0.0012;
        const z =
          frontSurface(x, y) + 0.0018 + 0.0024 * (1 - u * u) * (1 - v * v);
        positions.push(x, y, z);
        const distance = Math.hypot(u * 0.0143, (y - eyeY) * 0.93);
        const c = distance < 0.0025 ? pupil : distance < 0.0053 ? iris : white;
        colours.push(c.r, c.g, c.b);
        if (i < nx && j < ny) {
          const a = j * (nx + 1) + i,
            b = a + nx + 1;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    const eye = new THREE.BufferGeometry();
    eye.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    eye.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    eye.setIndex(indices);
    eye.computeVertexNormals();
    parts.push(eye);
    const lid: THREE.Vector3[] = [],
      lower: THREE.Vector3[] = [],
      brow: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = (i / 10) * 2 - 1;
      const x = eyeX + u * 0.0146,
        upperY = eyeY + 0.0051 * (1 - u * u) + side * u * 0.0012,
        lowerY = eyeY - 0.0045 * (1 - u * u) + side * u * 0.0012;
      lid.push(new THREE.Vector3(x, upperY, frontSurface(x, upperY) + 0.0026));
      lower.push(new THREE.Vector3(x, lowerY, frontSurface(x, lowerY) + 0.002));
      const bx = eyeX + u * 0.019,
        by = 1.634 + 0.003 * (1 - u * u) + side * u * 0.002;
      brow.push(new THREE.Vector3(bx, by, frontSurface(bx, by) + 0.0012));
    }
    parts.push(
      tube(lid, hero ? 0.00065 : 0.0009, hero ? 0x4b3930 : 0x514f41, 12),
    );
    parts.push(tube(lower, 0.00065, palette.skin, 12));
    parts.push(tube(brow, hero ? 0.0015 : 0.002, palette.hair, 10));
    // Nostrils are recessed small openings, not a round bead attached to a face.
    const nostril = new THREE.SphereGeometry(1, 8, 5);
    nostril.scale(0.0031, 0.0015, 0.0012);
    nostril.translate(
      side * 0.0076,
      1.574,
      frontSurface(side * 0.0076, 1.574) + 0.0005,
    );
    parts.push(solid(nostril, 0x6b574b));
    const ear = new THREE.SphereGeometry(1, 10, 8);
    ear.scale(0.0108, 0.022, 0.011);
    ear.translate(side * 0.081, 1.583, -0.003);
    parts.push(solid(ear, palette.skin));
  }
  // Separate volumetric closed lips, with a cupid's bow and a narrow seam.
  for (const upper of [true, false]) {
    const positions: number[] = [],
      indices: number[] = [];
    for (let row = 0; row <= 4; row++)
      for (let i = 0; i <= 20; i++) {
        const u = (i / 20) * 2 - 1,
          width = Math.max(0, 1 - u * u),
          v = row / 4;
        const cupid = 0.0015 * gaussian(Math.abs(u), 0.32, 0.23);
        const y =
          1.542 +
          (upper ? 1 : -1) * v * (upper ? 0.0032 + cupid : 0.0036) * width;
        const x = u * (hero ? 0.021 : 0.023),
          z =
            frontSurface(x, y) +
            0.0007 +
            0.0035 * width * Math.sin(v * Math.PI * 0.78);
        positions.push(x, y, z);
        if (i < 20 && row < 4) {
          const a = row * 21 + i,
            b = a + 21;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    const mouth = new THREE.BufferGeometry();
    mouth.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    mouth.setIndex(indices);
    mouth.computeVertexNormals();
    parts.push(solid(mouth, palette.lips));
  }
  parts.push(
    tube(
      [-0.019, 0, 0.019].map(
        (x) => new THREE.Vector3(x, 1.542, frontSurface(x, 1.542) + 0.0015),
      ),
      0.0006,
      0x624e49,
      12,
    ),
  );

  const hair = new THREE.BufferGeometry(),
    hp: number[] = [],
    hi: number[] = [];
  const rings = 12,
    sides = 48;
  for (let j = 0; j <= rings; j++)
    for (let i = 0; i <= sides; i++) {
      const theta = (i / sides) * Math.PI * 2,
        u = j / rings;
      const wrapped = Math.atan2(Math.sin(theta), Math.cos(theta));
      const front = Math.cos(theta);
      const fringe = hero ? 0.022 * gaussian(wrapped, -0.37, 0.42) : 0.008;
      const lowerHair = hero
        ? 1.501 + 0.004 * Math.cos(theta * 7)
        : 1.544 + 0.015 * Math.cos(theta * 3);
      const bottom = lerp(
        lowerHair,
        1.669 - fringe,
        THREE.MathUtils.smoothstep(front, 0.35, 0.86),
      );
      const y = lerp(1.716, bottom, Math.pow(u, 1.22));
      const crownHeight = (Math.max(1.591, y) - 1.591) / 0.125;
      const radius = Math.sqrt(Math.max(0, 1 - crownHeight * crownHeight));
      const wave = 1 + 0.018 * Math.cos(theta * 7 + u * 5);
      hp.push(
        Math.sin(theta) * (rx + 0.011) * radius * wave,
        y,
        Math.cos(theta) * (front > 0 ? 0.091 : 0.107) * radius * wave - 0.006,
      );
      if (i < sides && j < rings) {
        const a = j * (sides + 1) + i,
          b = a + sides + 1;
        hi.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  hair.setAttribute("position", new THREE.Float32BufferAttribute(hp, 3));
  hair.setIndex(hi);
  hair.computeVertexNormals();
  const hairColour = colour(palette.hair);
  parts.push(
    paint(hair, (v) =>
      hairColour
        .clone()
        .multiplyScalar(
          0.89 + (0.12 * (1 + Math.sin(v.x * 127 + v.z * 61))) / 2,
        ),
    ),
  );
  // A few independently shaped locks break the cap silhouette at the cheeks.
  for (const side of [-1, 1])
    for (let strand = 0; strand < 3; strand++) {
      const theta = side * (0.76 + strand * 0.12),
        x = Math.sin(theta) * (rx + 0.012),
        z = Math.cos(theta) * 0.09 - 0.004;
      parts.push(
        tube(
          [
            new THREE.Vector3(x * 0.92, 1.672, z * 0.75),
            new THREE.Vector3(x * 1.04, 1.591, z),
            new THREE.Vector3(
              x * 0.91,
              hero ? 1.504 + strand * 0.005 : 1.55,
              z * 0.79,
            ),
          ],
          0.006 - strand * 0.0008,
          palette.hair,
          10,
        ),
      );
    }
  if (!hero) {
    const scar = [
      [-0.05, 1.633],
      [-0.04, 1.607],
      [-0.029, 1.584],
    ].map(([x, y]) => new THREE.Vector3(x, y, frontSurface(x, y) + 0.0008));
    parts.push(
      tube(scar, 0.0009, kind === "watcher" ? 0x685b50 : 0x826d61, 12),
    );
    for (const y of [1.65, 1.656])
      parts.push(
        tube(
          [-0.029, 0, 0.029].map(
            (x) => new THREE.Vector3(x, y, frontSurface(x, y) + 0.0007),
          ),
          0.00055,
          0x777969,
          10,
        ),
      );
  }
  // All facial components share one draw call and smooth physical lighting.
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.91,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "fixes1_sculpted_head";
  mesh.userData.fixes1OwnedGeometry = true;
  group.add(mesh);
  const mouthMarker = new THREE.Object3D();
  mouthMarker.name = "fixes1_mouth";
  mouthMarker.position.set(0, 1.542, frontSurface(0, 1.542) + 0.003);
  group.add(mouthMarker);
  return group;
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
        `uniform float new0ArmourEnabled;\nuniform vec2 new0StrapPath[9];\nvarying float vArmourCoverage;\nvarying vec3 vArmourLocal;\nvarying vec3 vCapLocalL;\nvarying vec3 vCapLocalR;\nvarying vec3 vFauldLocal;
        bool beneathCap(vec3 p){return p.y>-.009&&p.y<.071&&dot(p.xz/vec2(.109,.119),p.xz/vec2(.109,.119))<1.0;}
        bool beneathPlate(vec3 p){float top=.195+.045*clamp(abs(p.x)/.2005,0.0,1.0);float t=clamp((p.y+.090)/(top+.090),0.0,1.0);float w=.176+.048*sin(t*3.14159265*.83);return abs(p.x)<w+.009&&p.y>-.098&&p.y<top+.009&&p.z>-.194&&p.z<.204;}
        bool beneathFauld(vec3 p){float front=max(0.0,(p.z/.155)/max(length(p.xz/vec2(.184,.155)),.001));return p.y>-.168+.065*front&&p.y<-.077&&dot(p.xz/vec2(.195,.165),p.xz/vec2(.195,.165))<1.0;}
        float strapDistanceSquared(vec2 p,vec2 a,vec2 b){vec2 v=b-a;vec2 d=p-a-v*clamp(dot(p-a,v)/dot(v,v),0.0,1.0);return dot(d,d);}
        bool beneathStrap(vec3 p){if(abs(abs(p.x)-.172)>.022||p.y<.17||p.y>.28||p.z<-.17||p.z>.145)return false;for(int i=1;i<9;i++){if(strapDistanceSquared(p.yz,new0StrapPath[i-1],new0StrapPath[i])<.000036)return true;}return false;}
        ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if(new0ArmourEnabled>.5&&vArmourCoverage>.99&&(beneathPlate(vArmourLocal)||beneathCap(vCapLocalL)||beneathCap(vCapLocalR)||beneathStrap(vArmourLocal)||beneathFauld(vFauldLocal)))discard;`,
      );
    };
    m.customProgramCacheKey = () => key + "_fixes1_armour_layer";
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
      top = 1.525;
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
        const headWeight = THREE.MathUtils.smoothstep(y, 1.474, 1.525),
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
    for (let at = edge.a; at !== edge.b; ) {
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
}
export function setArmourCoverage(rig: THREE.Object3D, equipped: boolean) {
  const state = states.get(rig);
  if (!state) return;
  state.armoured = equipped;
  state.enabled.value = equipped ? 1 : 0;
  for (const shoulder of state.shoulders) shoulder.visible = equipped;
  if (state.fauld) state.fauld.visible = equipped;
}
// Same coverage rule as the material, exposed for the offline layer test.
export function armourCoverageAt(rig: THREE.Object3D, point: THREE.Vector3) {
  const state = states.get(rig);
  if (!state?.armoured || !state.armour) return false;
  updateArmourMatrices(state);
  const p = point.clone().applyMatrix4(state.matrices[0]),
    top = 0.195 + 0.045 * THREE.MathUtils.clamp(Math.abs(p.x) / 0.2005, 0, 1),
    t = THREE.MathUtils.clamp((p.y + 0.09) / (top + 0.09), 0, 1);
  const width = 0.176 + 0.048 * Math.sin(t * Math.PI * 0.83);
  if (
    Math.abs(p.x) < width + 0.009 &&
    p.y > -0.098 &&
    p.y < top + 0.009 &&
    p.z > -0.194 &&
    p.z < 0.204
  )
    return true;
  if (Math.abs(Math.abs(p.x) - 0.172) < 0.022) {
    for (let i = 1; i < 9; i++) {
      const a = state.strapPath.value[i - 1],
        b = state.strapPath.value[i],
        dy = b.x - a.x,
        dz = b.y - a.y,
        u = THREE.MathUtils.clamp(
          ((p.y - a.x) * dy + (p.z - a.y) * dz) / (dy * dy + dz * dz),
          0,
          1,
        );
      if (Math.hypot(p.y - a.x - dy * u, p.z - a.y - dz * u) < 0.006)
        return true;
    }
  }
  for (let i = 1; i < 3; i++) {
    p.copy(point).applyMatrix4(state.matrices[i]);
    if (
      p.y > -0.009 &&
      p.y < 0.071 &&
      (p.x / 0.109) ** 2 + (p.z / 0.119) ** 2 < 1
    )
      return true;
  }
  if (state.fauld) {
    p.copy(point).applyMatrix4(state.matrices[3]);
    const front = Math.max(
      0,
      p.z / 0.155 / Math.max(Math.hypot(p.x / 0.184, p.z / 0.155), 0.001),
    );
    if (
      p.y > -0.168 + 0.065 * front &&
      p.y < -0.077 &&
      (p.x / 0.195) ** 2 + (p.z / 0.165) ** 2 < 1
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
