# Combat animation variants for new0

These animation-only GLB files combine original new0 combat poses with selected
ready-made **CC0 Quaternius Universal Animation Library Standard** motion.
The current revision is **v3**. Attack/Hit/Guard/BlockHit remain the original v2
FK/IK curves, including the continuous three-hit chain and standalone recoveries.
The four dodges adapt Quaternius `Roll`, and DeathBack adapts `Death01`.
DeathFront/DeathSide are original directional adaptations of the preserved new0
Death. No animation extracted from a commercial game is used.

## Quaternius source and license

Official source: https://quaternius.itch.io/universal-animation-library

Official pack page: https://quaternius.com/packs/universalanimationlibrary.html

Downloaded the author's free **Universal Animation Library Standard** archive,
using `Unreal-Godot/UAL1_Standard.glb` without root motion. Its included license is
**CC0 1.0 Universal**, retained verbatim in `QUATERNIUS-LICENSE.txt`.
The original Roll lasts 1.4666667 s and includes full torso inversion and limb
articulation. Death01 lasts 2.40 s and falls backward. A lossless animation-only
selection of A_TPose, Idle_Loop, Roll and Death01 is versioned in
`scripts/assets/seeds/quaternius-ual1-roll-death.glb` for offline rebuilding.

new0 adaptations: world-space Idle-reference retargeting onto the 22-bone rig,
retiming, Guard entry/recovery, reverse-time backward roll, lateral roll-plane
turns, an attached-sword wrist basis and actual weighted-skin ground alignment.
The four dodges are directional derivatives of one source roll, rather than four
independent captures. Fingers and the source mesh are not included at runtime.

Also evaluated the official CC0 KayKit Adventures Mage directional dodges from
https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
and the author's animation page https://kaylousberg.itch.io/kaykit-character-animations.
Those sampled dodges keep the torso upright and were not selected. No KayKit
animation or geometry is shipped by this motion task.

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

| File                  | Destination rig                                                      |
| --------------------- | -------------------------------------------------------------------- |
| `combat.glb`          | Source knight rig                                                    |
| `prisoner-combat.glb` | `cast/prisoner.glb` and `cast/watcher.glb`, which share the same rig |
| `gaoler-combat.glb`   | `cast/gaoler.glb`                                                    |

The character-specific files already contain asset-time retargeting. They should
be played directly on the matching character, without retargeting them again.
All sixteen clips are retained in each file.

Retargeting uses each character's native Idle as the reference and world-space
rotation deltas. Grounded combat uses arm/leg endpoint IK with destination limb
lengths. Full-body rolls/falls use FK instead of standing-reference endpoint IK,
which would otherwise pull limbs toward an upright pose during inversion.
The right-hand grip basis is reconstructed for the blade convention below.
Ground alignment is checked against the actual weighted skin of the destination
mesh for every exported sample. Dodges blend to the already baked target Guard at
both endpoints. These numerical checks do not replace visual review in the game.

| Clip         | Duration | Motion                                                                        |
| ------------ | -------: | ----------------------------------------------------------------------------- |
| Attack1      |   0.74 s | Hip-led diagonal cut with anticipation, sharp contact and standalone recovery |
| Attack2      |   0.70 s | Reverse cut beginning in Attack1 follow-through, opposite torso rotation      |
| Attack3      |   1.00 s | Overhead finisher beginning in Attack2 follow-through, longer recovery        |
| DodgeLeft    |   0.82 s | CC0 full-body roll with the roll plane turned left                            |
| DodgeRight   |   0.82 s | Opposite lateral full-body roll                                               |
| DodgeBack    |   0.82 s | Reverse-time articulated roll, knees retain their anatomical bend             |
| DodgeForward |   0.82 s | Retimed CC0 forward roll with compression and recovery                        |
| HitFront     |   0.40 s | Backward torso recoil and regaining balance                                   |
| HitLeft      |   0.42 s | Side-dependent shoulder, torso and hip recoil                                 |
| HitRight     |   0.46 s | Opposite side recoil with a longer recovery                                   |
| Guard        |   0.80 s | Raised defensive sword posture with small breathing motion                    |
| BlockHit     |   0.32 s | Short defensive recoil while retaining the guard                              |
| Death        |   1.60 s | Previously authored collapse, normal scale and held ground pose               |
| DeathFront   |   1.75 s | Forward fall onto stomach after an impact from behind                         |
| DeathBack    |   1.85 s | CC0 backward fall after an impact to the chest, held final pose               |
| DeathSide    |   1.70 s | Side collapse with a relaxed side-lying hold                                  |

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
The agreed controller window is compression 0–0.14 s, horizontal travel
0.14–0.65 s and stationary landing/recovery 0.65–0.82 s. The contract records
the controller's 2.25 m travel distance. No net horizontal locomotion displacement
is baked, small local pelvis excursions remain within the articulated pose.

The authored targets are solved with IK at the 60 Hz export grid and at exact
contact/link landmarks. Ground alignment keeps the working poses approximately
12 mm above the floor. The previously authored Death tracks are copied unchanged
from the versioned seeds, including the source rig's approximately 3.6 mm initial
rest-pose intersection. The prepared prisoner/gaoler profiles remain above ground.
Retargeting to another mesh changes limb lengths and surface bounds, so the
resulting silhouette, grip and ground contact must be reviewed in the game.
The validation also checks actual torso inversion, Guard endpoint skin seams,
settled death holds and the floor clearance of a 0.9 m attached blade. All v2
Attack1/2/3 and Death channel arrays are hash-checked against preserved baselines.
Static posed-skin studies were inspected, including a corrected DeathSide hold.
These checks do not establish the quality of real-time playback or physical-phone
performance. Final camera, blending, weapon/body clearance and motion cadence
require engine playback and on-device review.

Reproducible authoring code and pinned development dependencies are versioned in
`scripts/assets/`. Its README documents the commands, reference assets, Death
seeds and numerical checks. Reports are written to `work/asset-authoring/`.


## fixes1, separate runtime clips

The retained combat GLB and contract.json above are unchanged baselines.
Current gameplay chooses clips and semantic timings from fixes1-contract.json.
SwordAttack1/2/3 derive from Quaternius Universal Animation Library 2 Standard,
Sword_Regular_A/B/C and A/B recoveries, under CC0:
https://quaternius.com/packs/universalanimationlibrary2.html
https://quaternius.itch.io/universal-animation-library-2
The same CC0 notice is retained in QUATERNIUS-LICENSE.txt.

WeaponStepForward/Back/Left/Right are original directional, crouched adaptations
of UAL1 Walk_Loop. Neither free library contains a dedicated spear attack or
these evasions. Spear grips and thrust goals are original runtime IK, not a
claimed downloaded spear motion. No paid pack or PRISON OF HUSKS asset is bundled.

prisoner-fixes1.glb serves prisoner and watcher, gaoler-fixes1.glb serves the
heavy rig. fixes1-floor.json contains signed contact offsets at semantic times.
The source clock and separate legacy phase maps are in fixes1-contract.json.
Rebuild with scripts/assets/retarget-ual2-fixes1.mjs after obtaining the official
CC0 UAL1/UAL2 source files at its documented work paths. The generator rejects
changes to the protected baseline combat files. Runtime continuity and geometry
are verified separately after the native animation blend and weapon controller.
