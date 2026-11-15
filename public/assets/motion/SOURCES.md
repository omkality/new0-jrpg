# Combat animation variants for new0

These animation-only GLB clips were authored for this prototype using bone poses,
world-axis forward kinematics, two-bone arm/leg inverse kinematics, planted-foot
targets, smooth interpolation and weighted skinned-surface floor checks.
They contain no external motion capture or animation extracted from another game.
The current authoring revision is **v2**, with a continuous three-hit target curve,
per-sample IK and separate standalone recovery branches.

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
| Attack1 | 0.74 s | Hip-led diagonal cut with anticipation, sharp contact and standalone recovery |
| Attack2 | 0.70 s | Reverse cut beginning in Attack1 follow-through, opposite torso rotation |
| Attack3 | 1.00 s | Overhead finisher beginning in Attack2 follow-through, longer recovery |
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

Active contact times are **0.300 s**, **0.270 s** and **0.420 s** for Attack1,
Attack2 and Attack3. Combo transition times are **0.520 s** from Attack1 to
Attack2, and **0.510 s** from Attack2 to Attack3. Attack2(0) matches Attack1(.52),
and Attack3(0) matches Attack2(.51). These boundaries retain moving follow-through
instead of resetting to Guard. Standalone recovery continues to the full duration.
The exact contract is also stored in `contract.json`. Gameplay decides input
windows, stamina, hit detection and block lockouts.

Weapon attachment: `hand_R`, local grip `(0, 0.06, 0)`, blade along local `-Z`,
crossguard along local `X`. A sword built along local `+Y` must rotate `X = -PI/2`.
The dodge animations are in-place. Movement belongs to the game controller.

The authored targets are solved with IK at the 60 Hz export grid and at exact
contact/link landmarks. Ground alignment keeps the working poses approximately
12 mm above the floor. The previously authored Death tracks are copied unchanged
from the versioned seeds, including the source rig's approximately 3.6 mm initial
rest-pose intersection. The prepared prisoner/gaoler profiles remain above ground.
Retargeting to another mesh changes limb lengths and surface bounds, so the
resulting silhouette, grip and ground contact must be reviewed in the game.
These are authored prototype motion variants and still require visual polish.

Reproducible authoring code and pinned development dependencies are versioned in
`scripts/assets/`. Its README documents the commands, reference assets, Death
seeds and numerical checks. Reports are written to `work/asset-authoring/`.
