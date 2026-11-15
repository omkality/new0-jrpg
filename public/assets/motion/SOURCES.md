# Combat animation variants for new0

These animation-only GLB clips were authored for this prototype using bone poses,
world-axis forward kinematics, two-bone arm/leg inverse kinematics, planted-foot
targets, smooth interpolation and weighted skinned-surface floor checks.
They contain no external motion capture or animation extracted from another game.

The source rig and reference Idle pose come from the CC0 Patch knight:
https://patch.gg/create/toolbox/assets/anymove:knight

Original rig and mesh provenance, including Patch's disclosed AI-generated mesh
and base motion, is recorded in `../knight/SOURCES.md`. The original asset license
is CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/

The prepared file `combat.glb` contains **animation and named joint nodes only**,
no mesh, skin, image, texture or material. No scale channels are animated.
`source-rest.json` records the source bind/rest transforms, the Idle reference,
joint hierarchy, source height and weapon convention for retargeting.

## Character-specific prepared motion

| File | Destination rig |
| --- | --- |
| `combat.glb` | Source knight rig |
| `prisoner-combat.glb` | `cast/prisoner.glb` and `cast/watcher.glb`, which share the same rig |
| `gaoler-combat.glb` | `cast/gaoler.glb` |

The character-specific files already contain asset-time retargeting. They should
be played directly on the matching character, without retargeting them again.
All thirteen clips are retained in each file.

Retargeting uses each character's native Idle as the reference, world-space
rotation deltas, and arm/leg endpoint IK with that character's own limb lengths.
The right-hand grip basis is reconstructed for the blade convention below.
Ground alignment is checked against the actual weighted skin of the destination
mesh for every exported sample. For working poses the largest ground correction
was under 19 mm on the prisoner and 7 mm on the gaoler. The collapse requires
larger corrections, up to approximately 103 mm and 207 mm respectively, because
the destination silhouettes differ. These numerical checks do not replace visual
review in the application.

| Clip | Duration | Motion |
| --- | ---: | --- |
| Attack1 | 0.58 s | Prepared diagonal cut from the right, hip/chest rotation, forward transfer |
| Attack2 | 0.55 s | Reverse backhand cut, opposite hip/chest rotation and follow-through |
| Attack3 | 0.85 s | Longer overhead preparation, committed finishing cut and recovery |
| DodgeLeft | 0.52 s | Lateral crouch and weight shift to the left |
| DodgeRight | 0.52 s | Opposite lateral crouch and weight shift |
| DodgeBack | 0.52 s | Compact retreat with bent knees and protected torso |
| DodgeForward | 0.52 s | Lower forward drive with staggered legs and protected arms |
| HitFront | 0.40 s | Backward torso recoil and regaining balance |
| HitLeft | 0.42 s | Side-dependent shoulder, torso and hip recoil |
| HitRight | 0.46 s | Opposite side recoil with a longer recovery |
| Guard | 0.80 s | Raised defensive sword posture with small breathing motion |
| BlockHit | 0.32 s | Short defensive recoil while retaining the guard |
| Death | 1.60 s | Previously authored collapse, normal scale and held ground pose |

Suggested active contact times are **0.235 s**, **0.220 s** and **0.340 s** for
Attack1, Attack2 and Attack3. Gameplay decides hit windows, stamina and combo
lockouts. The animation file does not impose or bypass gameplay rules.

Weapon attachment: `hand_R`, local grip `(0, 0.06, 0)`, blade along local `-Z`,
crossguard along local `X`. A sword built along local `+Y` must rotate `X = -PI/2`.
The dodge animations are in-place. Movement belongs to the game controller.

Structural checks sample the original weighted skin at 60 Hz and raise the pelvis
if needed to keep the deformed surface approximately 12 mm above the floor.
Retargeting to another mesh changes limb lengths and surface bounds, so the
resulting silhouette, grip and ground contact must be reviewed in the game.
These are authored prototype motion variants and still require visual polish.

Reproducible authoring files are retained in the local work folder:
`work/assets-v3/tools/author-combat-variants.mjs`, `combat-variants-body.mjs` and
`work/assets-v3/combat-variants-report.json`. Character-specific preparation uses
`work/assets-v3/tools/retarget-combat-cast.mjs`; its report is
`work/assets-v3/cast-combat-retarget-report.json`.
