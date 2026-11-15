# Distinct character silhouettes for the new0 prototype

## Author sources and license

The source bodies and supplied animation clips were downloaded from their author on 2026-11-15:

- **Patch woman**: https://patch.gg/create/toolbox/assets/anymove:woman
- Original GLB: https://assets.patchusercontent.com/sha256/43e90e29c49f22bc8cdfb3484014788e1de9e6883f5a1a64265204ff3473dc64/woman.glb
- **Patch ogre**: https://patch.gg/create/toolbox/assets/anymove:ogre
- Original GLB: https://assets.patchusercontent.com/sha256/ee14ef4d5f4872fc1bb5d8e390cb8c00bed425a61b2f11056cff76eeb797ee99/ogre.glb

Both assets are expressly dedicated to **CC0 1.0 Universal** on their author pages and in the GLB `asset.copyright` and `asset.extras.license`. Commercial use and adaptation are permitted. Attribution is not required. The source bodies and motions are **AI-generated**, as disclosed by Patch. These are not assets extracted from a commercial game.

- Pipeline: https://github.com/patch-gg/anymove
- Asset license: https://creativecommons.org/publicdomain/zero/1.0/
- Local full official license text: `License.txt`

The anymove software repository is Apache-2.0. This is separate from Patch's CC0 dedication of these model assets. Original downloads and saved author pages remain in `work/assets-v4/`.

## Prepared derivatives

| File | Bytes | Triangles | Vertices | Materials | Mesh primitives |
| --- | ---: | ---: | ---: | ---: | ---: |
| `prisoner.glb` | 1289664 | 17093 | 11437 | 5 | 7 |
| `gaoler.glb` | 1338752 | 18730 | 12522 | 1 | 1 |
| `watcher.glb` | 1267704 | 16537 | 11097 | 2 | 4 |

Every file contains one skin and the same 22 joint names as the earlier knight. Source PBR images were resized to **1024x1024**. The added cloth uses an original **64x64** woven-noise image. Images are embedded. No special geometry decoder is required.

### Masked prisoner

The unarmoured woman source was adapted with original skinned geometry authored here: an irregular linen tunic, dark cloth headwrap, and an aged oval mask with dark cavities. Tunic weights are transferred from the source body. The headwrap and mask follow the head joint. Source body vertex colours were muted and trainers darkened. This is a new garment-and-mask silhouette, not a recolour of the knight.

### Gaoler

The ogre source supplies a broad, heavy, slightly hunched silhouette with a loincloth. Geometry and embedded textures were optimized. Native height is approximately **2.80 m**, so actor scale and collision dimensions should be set appropriately by the application.

### Veiled watcher

This uses the same exact rig/rest pose as the prisoner, with separate original geometry: a wider shoulder contour, floor-length flared robe, large cowl, and folded face veil. Lower cloth weights blend pelvis and leg influences. This is not a material-only recolour. The robe is skinned geometry rather than cloth simulation; extreme crouching and combat need intersection checks.

## Native clips

Use `Walk` and `Run` for movement driven by game code. The additional `_Root` variants contain forward root motion.

| Family | Idle | Walk | Run | Other source clips |
| --- | ---: | ---: | ---: | --- |
| Prisoner / watcher | 2.792 s | 2.208 s | 1.500 s | `Kick` 4.875 s |
| Gaoler | 2.083 s | 1.833 s | 1.000 s | `Attack` 4.000 s, `Hit` 2.542 s, `GroundSlam` 3.917 s |

Forward +Z displacement for `Walk_Root` / `Run_Root`: prisoner and watcher approximately **2.103 m / 3.679 m**, gaoler **1.499 m / 2.717 m**. In-place versions return to their initial pelvis translation.

## Retarget compatibility

The 22 joint names and hierarchy match the knight, but rest transforms differ. Local rest rotation differences reach **20.36 degrees** for the prisoner and **23.20 degrees** for the gaoler. Translation tracks need target-rest rebasing and rotation tracks need rest-pose correction. Directly copying knight rotations is not a verified retarget. Prisoner and watcher can share one retarget profile because their rig data is identical.

Exact source/target joint translations and quaternions: `work/assets-v4/rest-compatibility.json`. Geometry and native-clip reports: `work/assets-v4/cast-prepared-report.json` and `cast-verification.json`.

## Preparation and verification

Script: `work/assets-v3/tools/prepare-cast-v4.mjs`. Simplification uses glTF Transform/meshoptimizer. Added garments, masks, veil and cloth texture are original scripted geometry made with AI-assisted code in this workspace. No claim of human hand modelling is made.

The shared source topknot was retained inside the original body primitive and protruded from the head cloth. It has now been removed from both prisoner and watcher rather than enlarging their head coverings. The targeted operation removed 917 rear upper-head hair triangles and compacted 471 unused body vertices from each model. The visible front face, separate mask/garment geometry, materials, textures, node hierarchy, 22-bone rest transforms, inverse-bind matrices and animation accessor data are preserved. The gaoler file was not changed.

Portable reproducible fix, requiring only Node.js: `node scripts/assets/remove-hidden-hair.mjs`. Regression check: `node scripts/assets/remove-hidden-hair.mjs --check`. It is also invoked by the original preparation pipeline so regenerating these derivatives does not restore the hidden hair. The machine-independent helper contains no runtime geometry/image dependencies. The operation and preservation evidence are recorded in `work/assets-v4/hair-fix-report.json`; before-fix GLB backups are in the same working directory.

Source previews were visually inspected and saved as `work/assets-v4/woman.webp` and `ogre.webp`. Derivative viewer: `work/assets-v4/preview.html`, served by `serve-preview.mjs` in the same directory. Structure, licenses, skin references, counts and native clips were inspected. All three enemy profiles were subsequently reviewed in the running game, including their different silhouettes. The full combat capture was inspected for the gaoler. Extreme garment intersections and the final animation quality still need further visual polish.
