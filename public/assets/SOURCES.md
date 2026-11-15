# Asset sources

## Current scene

The current scene uses [Goblinatron PSX Dungeon textures](dungeon/SOURCES.md), CC BY 4.0.
The room geometry, cloth texture, humanoid figures and their animations are original
prototype code. The Kenney files below are retained from the first iteration and are
not loaded by the current scene.

## Kenney Graveyard Kit 5.0

The files in `kenney/` are an unmodified subset of Kenney's Graveyard Kit 5.0, downloaded from the official asset page on 2026-11-15.

- Author: Kenney
- Official source: https://kenney.nl/assets/graveyard-kit
- License: Creative Commons Zero 1.0 Universal (CC0)
- License reference: https://creativecommons.org/publicdomain/zero/1.0/
- Original license text from the archive: `kenney/License.txt`
- Commercial use is explicitly permitted in the included license. Attribution is appreciated but is not required.

No PRISON OF HUSKS assets are included.

### Included files

All GLB files reference the shared external texture `Textures/colormap.png`. Keep that path relative to the models.

| File | Purpose | Size in bytes |
| --- | --- | ---: |
| `kenney/character-keeper.glb` | Player prototype | 250200 |
| `kenney/character-skeleton.glb` | Enemy prototype | 202796 |
| `kenney/altar-stone.glb` | Stone altar decoration | 17164 |
| `kenney/candle-multiple.glb` | Candle decoration | 17304 |
| `kenney/column-large.glb` | Column decoration | 37540 |
| `kenney/crypt-door.glb` | Animated door | 16168 |
| `kenney/urn-round.glb` | Urn decoration | 23712 |
| `kenney/bench.glb` | Bench decoration | 15952 |
| `kenney/Textures/colormap.png` | Shared palette texture | 10965 |

### Character animation clips

Both characters contain these named clips:

```text
static
idle
walk
sprint
jump
fall
crouch
sit
drive
die
pick-up
emote-yes
emote-no
holding-right
holding-left
holding-both
holding-right-shoot
holding-left-shoot
holding-both-shoot
attack-melee-right
attack-melee-left
attack-kick-right
attack-kick-left
interact-right
interact-left
wheelchair-sit
wheelchair-look-left
wheelchair-look-right
wheelchair-move-forward
wheelchair-move-back
wheelchair-move-left
wheelchair-move-right
```

Useful clip durations: `idle` 1.333 s, `walk` 0.667 s, `sprint` 0.500 s, `attack-melee-right` 0.417 s, `attack-kick-right` 0.533 s, `die` 0.333 s. The `crypt-door` clips are `open` (1 s), `close` (1 s), and `open-and-close` (2 s).

### Approximate original model dimensions

Dimensions below are bounding boxes in the original default pose, calculated from position accessor bounds and the GLTF node transforms. Animation can change the extent. The characters use animated rigid body parts rather than a skinned mesh.

| Model | Width X | Height Y | Depth Z |
| --- | ---: | ---: | ---: |
| `character-keeper` | 0.811 | 0.862 | 0.537 |
| `character-skeleton` | 0.761 | 0.700 | 0.316 |
| `altar-stone` | 1.040 | 0.488 | 0.653 |
| `candle-multiple` | 0.255 | 0.200 | 0.267 |
| `column-large` | 0.390 | 1.130 | 0.390 |
| `crypt-door` | 0.330 | 0.738 | 0.125 |
| `urn-round` | 0.264 | 0.384 | 0.264 |
| `bench` | 0.807 | 0.526 | 0.455 |

Normalize scale and ground alignment using the loaded object's bounding box. Set nearest-neighbor texture filtering in the renderer if desired for the visual style.
