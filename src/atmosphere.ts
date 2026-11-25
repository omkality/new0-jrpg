import * as T from "three";
import type { StaticLightField } from "./static-light";

export class Atmosphere {
  private materials = new WeakSet<T.Material>();
  readonly time = { value: 0 };
  readonly grain = { value: 0.022 };
  readonly veil = { value: 0.075 };
  private field: StaticLightField;
  private readonly winter: boolean;
  constructor(field: StaticLightField, winter = false) {
    this.field = field;
    this.winter = winter;
  }
  apply(root: T.Object3D) {
    root.traverse((o) => {
      if (!(o instanceof T.Mesh || o instanceof T.Sprite)) return;
      for (const material of Array.isArray(o.material)
        ? o.material
        : [o.material]) {
        if (this.materials.has(material)) continue;
        this.materials.add(material);
        const prior = material.onBeforeCompile;
        const key = material.customProgramCacheKey();
        const lit = material instanceof T.MeshStandardMaterial;
        material.onBeforeCompile = (
          shader: Parameters<T.Material["onBeforeCompile"]>[0],
          renderer: T.WebGLRenderer,
        ) => {
          prior.call(material, shader, renderer);
          Object.assign(shader.uniforms, {
            uAirTime: this.time,
            uAirGrain: this.grain,
            uAirVeil: this.veil,
          });
          shader.fragmentShader =
            "uniform float uAirTime; uniform float uAirGrain; uniform float uAirVeil;\n" +
            shader.fragmentShader;
          // Fog and fine grain share the 3D draw, with no fullscreen CSS blend.
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <fog_fragment>",
            `
            #ifdef USE_FOG
              #ifdef FOG_EXP2
                float airFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
              #else
                float airFog = smoothstep(fogNear, fogFar, vFogDepth);
              #endif
              ${
                this.winter
                  ? `float luma = dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722));
              float ember = smoothstep(.14,.48,gl_FragColor.r-gl_FragColor.b);
              gl_FragColor.rgb = mix(mix(vec3(luma),gl_FragColor.rgb,.57)*vec3(.80,.90,1.04),gl_FragColor.rgb,ember*.8);`
                  : ""
              }
              airFog = uAirVeil + (1.0 - uAirVeil) * airFog;
              gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, airFog);
            #endif
            float airNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy + floor(uAirTime * 8.0) * vec2(29.0,47.0), vec2(0.06711056,0.00583715))));
            gl_FragColor.rgb += (airNoise - 0.5) * uAirGrain;
          `,
          );
          if (lit) {
            Object.assign(shader.uniforms, {
              uLocalLight: { value: this.field.texture },
              uLightMin: { value: this.field.min },
              uLightSize: { value: this.field.size },
            });
            shader.vertexShader =
              "uniform highp sampler3D uLocalLight; uniform vec3 uLightMin; uniform vec3 uLightSize; varying vec3 vLocalLight;\n" +
              shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
              "#include <project_vertex>",
              `
              #include <project_vertex>
              vec4 airWorld = vec4(transformed, 1.0);
              #ifdef USE_INSTANCING
                airWorld = instanceMatrix * airWorld;
              #endif
              airWorld = modelMatrix * airWorld;
              vec3 lightUVW = (airWorld.xyz - uLightMin) / uLightSize;
              float lightEdge = (1.0 - smoothstep(0.48, 0.5, abs(lightUVW.x - 0.5))) * (1.0 - smoothstep(0.48, 0.5, abs(lightUVW.z - 0.5)));
              vLocalLight = texture(uLocalLight, lightUVW).rgb * 3.0 * lightEdge;
            `,
            );
            shader.fragmentShader =
              "varying vec3 vLocalLight;\n" + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
              "#include <emissivemap_fragment>",
              "#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vLocalLight;",
            );
          }
        };
        material.customProgramCacheKey = () =>
          key +
          (this.winter ? "/procession-winter" : "/fixes3-static-light-air-1");
        material.needsUpdate = true;
      }
    });
  }
}
