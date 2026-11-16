import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { StaticLightField } from "../src/static-light.ts";
import { Atmosphere } from "../src/atmosphere.ts";

test("all static sources share one bounded immutable light volume", () => {
  const field = new StaticLightField(
    [
      { x: -4, y: 2, z: -12, power: 84, range: 9.5 },
      { x: 5, y: 4, z: -54, power: 64, range: 8 },
    ],
    [],
  );
  const image = field.texture.image;
  assert.deepEqual([image.width, image.height, image.depth], [25, 15, 125]);
  assert.equal(image.data.byteLength, 187500);
  const sample = (x, y, z) => {
    const i =
      ((Math.round(z + 110) * 15 + Math.round(y + 1)) * 25 +
        Math.round(x + 12)) *
      4;
    return image.data[i] + image.data[i + 1] + image.data[i + 2];
  };
  assert.ok(sample(-4, 2, -12) > sample(-4, 2, -5));
  assert.ok(sample(5, 4, -54) > sample(5, 4, -48));
  const version = field.texture.version,
    copy = image.data.slice();
  const air = new Atmosphere(field),
    material = new T.MeshStandardMaterial(),
    mesh = new T.Mesh(new T.BoxGeometry(), material),
    scene = new T.Scene();
  scene.add(mesh);
  let priorCalled = 0;
  material.onBeforeCompile = () => priorCalled++;
  air.apply(scene);
  air.apply(scene);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.equal(priorCalled, 1);
  assert.ok(shader.vertexShader.includes("texture(uLocalLight"));
  assert.ok(
    shader.fragmentShader.includes(
      "totalEmissiveRadiance += diffuseColor.rgb * vLocalLight",
    ),
  );
  for (let i = 0; i < 600; i++) air.time.value = i / 60;
  assert.equal(field.texture.version, version);
  assert.deepEqual(image.data, copy);
  field.dispose();
  mesh.geometry.dispose();
  material.dispose();
});
