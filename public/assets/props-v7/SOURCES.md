# Props v7: provenance and integration

Prepared for the new0 browser prototype on 2026-11-15. All third-party source assets below are CC0 1.0 and permit commercial use, modification and redistribution. The upstream CC0 legal text is included as `CC0-1.0.txt`. Poly Haven's site content, previews and logos are not included.

## Verified author sources

| Source | Author | Author's asset page | License | Used in |
| --- | --- | --- | --- | --- |
| Treasure Chest | Rico Cilliers | [Poly Haven Treasure Chest](https://polyhaven.com/a/treasure_chest) | [Poly Haven CC0 license](https://polyhaven.com/license) | `chest.glb`, `mimic.glb` |
| Rough Wood | Rob Tuytel | [Poly Haven Rough Wood](https://polyhaven.com/a/rough_wood) | CC0 1.0 | Original wooden weapon handles and door |
| Rusty Metal 02 | Rob Tuytel | [Poly Haven Rusty Metal 02](https://polyhaven.com/a/rusty_metal_02) | CC0 1.0 | Original weapon, door, key and coin materials |

Direct source downloads are resolved from the official [chest files API](https://api.polyhaven.com/files/treasure_chest), [wood files API](https://api.polyhaven.com/files/rough_wood) and [metal files API](https://api.polyhaven.com/files/rusty_metal_02). Author metadata is retained in `work/props-v7/*-info.json` by the fetch script. The source chest's `files_hash` was `0ae2580ba667a1c67340426abc76f7665306406e` when fetched. Wood was `2d89c64601e620069e9caaf3ede0d7494d430138`. Metal was `2595fd56a6313da94557337a298aff4b162e7704`.

The official source model is [treasure_chest_1k.gltf](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/treasure_chest/treasure_chest_1k.gltf). Its relative `.bin` and image resources are fetched using the API include map. The supplemental diffuse maps are [rough_wood_diff_1k.jpg](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rough_wood/rough_wood_diff_1k.jpg) and [rusty_metal_02_diff_1k.jpg](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rusty_metal_02/rusty_metal_02_diff_1k.jpg).

Attribution is not a CC0 requirement. Optional credit: “Treasure Chest by Rico Cilliers, Rough Wood and Rusty Metal 02 by Rob Tuytel, via Poly Haven (CC0).” No attribution needs to be displayed to unlock or use the game.

## Derivatives and original additions

The chest shell is the textured Poly Haven model, simplified from the original 103,330 triangles while retaining its hollow body, separate lid, handles and latch. Its source textures are resized to 512 px. The latch is attached to the lid and new `Open` and `Close` animation clips rotate the original hinge.

The mimic uses the same shell and has original curved fang geometry on both jaws, separate upper and lower gum rings, a fleshy floor, and a three-joint tongue. `Reveal` and `Bite` are original object animations. It is not a humanoid rig. The tongue has a folded default pose to fit inside the closed shell. During reveal the tongue lifts above the rim before unrolling, and the lower teeth rise from their concealed position. Closing retracts them before the lid shuts.

Weapons, door, key, coin engravings, lining and mimic anatomy were modelled in the project's reproducible authoring script. Weapon geometry has a shaped cutting edge, cross-section, guards or sockets, wrapped grips, and a separate silhouette for sword, bearded axe and leaf-blade spear. The door has an arched empty frame, seven separate planks, iron straps, rivets, knocker, latch and hinge pivot. Added wood and metal surfaces use the CC0 photographs above. Cloth, flesh and bone maps are original deterministic 128 px procedural textures. These original additions do not introduce other third-party attribution requirements.

No PRISON OF HUSKS, Souls, Amnesia, Silent Hill or other commercial game files were used. No AI-generated imagery, Sketchfab downloads, game rips, external runtime URLs or paid asset dependencies are embedded in these GLBs.

## Runtime contract

`contract.json` is the authoritative machine-readable integration contract. The common coordinate system is metres, +Y up, +Z front.

* Chest `ChestRoot` is centred on the floor. Its closed extent is approximately 0.959 m wide, 0.618 m tall and 0.522 m deep. The body is a genuinely hollow shell. `ChestLid` already has its hinge transform at `[0, 0.420501679, -0.257107705]`. Set its **local** X rotation from 0 to -1.75 radians, or play `Open` once and clamp the final frame. `Close` is the reverse clip.
* `Loot` contains a shallow maroon lining and nine loose gold coins. **`LootAnchor` is empty**, at `[0.24, 0.09, -0.02]`. Runtime should attach the actual item weapon to it. For the display use XYZ Euler `[PI/2, 0, PI/2]`, scales `sword: 0.55`, `axe: 0.60`, `spear: 0.36`, with an additional local offset `spear: [-0.045, 0, 0]`. Sword and axe offsets are zero. These placements have been checked against the usable cavity bounds, x +/-0.40 m and z +/-0.20 m. Display scale is intentionally smaller than equipped scale so the weapon fits inside.
* All weapon roots are `WeaponRoot`. Empty `Grip` is at origin. The handle axis and blade direction are +Y. A child of the existing right-hand attachment uses Euler `[-PI/2, 0, 0]`. Full equipped lengths at scale 1 are sword 1.349 m, axe 1.079 m and spear 2.035 m.
* Mimic root is `ChestRoot`, front +Z. Its lid is the same `ChestLid`. `UpperTeeth` follows the lid, `LowerTeeth` stays on the body. `TongueRoot -> TongueMid -> TongueTip` are articulated object nodes. `Reveal` lasts 1.0 s and `Bite` 0.72 s. `Open` and `Close` last 1.1 s. Use the supplied clips to unfold the tongue with the lid. Moving only the lid leaves the tongue in its default folded pose. Body lunges belong to the runtime controller.
* Door root is `DoorRoot`. Its `DoorPivot` is `[-0.56, 0, 0]`. Local Y rotates from 0 to -1.55 radians. Open/Close clips last 1.2 s. Outer size is about 1.426 x 2.316 x 0.244 m. The leaf width is 1.10 m. The frame has a real hole and remains stationary when the door opens.
* Standalone key root is `KeyRoot` and coin pile root is `CoinPile`.

Keep the application interaction state separately from animation state. Replaying `Open` resets the lid and should not be used for the second interaction that takes the displayed weapon.

Visual inspection in the separate Three.js viewer confirmed that the chest has a deep cavity. Its front wall naturally hides floor-level contents from a shallow side view. For the loot inspection stage use a close view looking down at approximately 60 degrees or more, then return to the exploration camera. The weapons remain inside the chest, and do not float above the rim to compensate for a low camera.

## Prepared files and cost

| File | Bytes | Triangles | Materials | Primitives |
| --- | ---: | ---: | ---: | ---: |
| chest.glb | 1,184,116 | 24,016 | 3 | 7 |
| mimic.glb | 1,329,912 | 27,884 | 5 | 15 |
| weapon-sword.glb | 148,540 | 2,314 | 3 | 3 |
| weapon-axe.glb | 224,920 | 2,736 | 4 | 4 |
| weapon-spear.glb | 203,944 | 2,714 | 4 | 4 |
| key.glb | 65,580 | 468 | 2 | 2 |
| coins.glb | 353,148 | 8,544 | 1 | 1 |
| door.glb | 246,472 | 2,772 | 4 | 10 |

All images are embedded, at most 512 px. There are no Draco, Meshopt or KTX runtime decoder requirements. A primitive generally requires one draw call per render pass. Reuse loaded geometry/textures across chest instances. Avoid rendering distant contents or multiple large standalone coin piles on a phone.

## Rebuild and validation

Run from the project root with Node.js and npm:

```text
npm ci --prefix scripts/assets
node scripts/assets/props-v7-fetch.mjs
node scripts/assets/props-v7-prepare.mjs
node scripts/assets/props-v7-validate.mjs
```

Downloads and unoptimized sources stay in ignored `work/props-v7`. The asset tool package is isolated from the game's runtime dependencies. The existing tracked `contract.json` supplies semantic integration names and dimensions, then the scripts update measured output information.

Validation loads every written GLB, checks finite geometry and accessor/index consistency, animation samples, embedded image sizes and the 3 MB file limit. It casts five downward rays inside each chest body to confirm the cavity reaches its floor, checks the lid opens upwards, checks the empty loot anchor and mimic anatomy, checks all three display weapons fit the usable cavity, and checks the opened door leaf clears a ray through the doorway centre. It samples every mimic clip at 120 Hz and checks tongue vertices crossing the front wall slab stay above its rim. The measured minimum crossing height is 0.4609 m, above the 0.395 m rim threshold. Reports are `work/props-v7/prepared-report.json` and `work/props-v7/validation-report.json`. These structural checks supplement visual review in the actual game's lighting and camera.
