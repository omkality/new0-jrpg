# Animated knight by Patch

## Source and permissions

- Author/publisher: **Patch**
- Author's asset page: https://patch.gg/create/toolbox/assets/anymove:knight
- Author's animation pipeline and source project: https://github.com/patch-gg/anymove
- Source GLB: https://assets.patchusercontent.com/sha256/5b9423de432bd50be3e8dde47c969043af3b7d654bb045d4e7820015f8fb1ff3/knight.glb
- License: **CC0 1.0 Universal**, https://creativecommons.org/publicdomain/zero/1.0/
- License text: `License.txt`, obtained from the official Creative Commons site.
- Provenance: **AI-generated mesh and motion**, disclosed by Patch on the author page. A mesh made with an image-to-3D pipeline and animations captured with Patch's anymove process. This is not an asset extracted from a commercial game.
- Checked: 2026-11-15.

Patch explicitly dedicates this model and its motion to CC0 on the author page. The source GLB itself contains the same CC0 dedication in `asset.copyright` and the structured SPDX identifier `CC0-1.0` in `asset.extras.license`. The pipeline repository's software is Apache-2.0, which is separate from this asset's CC0 dedication.

Attribution is not required under CC0. For provenance, an optional credit is:

> Animated knight in plate armour by Patch, made with anymove. AI-generated mesh and motion. CC0 1.0 Universal. https://patch.gg/create/toolbox/assets/anymove:knight

## Prepared runtime file

`knight.glb` is an optimized derivative of the original. The complete unmodified download remains in `work/assets-v3/patch-knight.glb`.

- Geometry simplified with glTF Transform/meshoptimizer from **59,281 to 21,333 triangles**.
- Prepared geometry: **16,605 vertices**, one mesh primitive, one material, one skin with 22 joints.
- Original size **9,711,192 bytes**, prepared size with the three additional prototype clips **2,341,892 bytes**.
- Three embedded JPEG maps reduced from 4096 to **1024 × 1024**: base color, tangent-space normal, and metallic/roughness map.
- Skin joints, joint indices, vertex weights, and all nine source animation clips retained. Three original prototype clips have been added as described below.
- No special geometry decoder extension is required for this prepared file.
- One mesh draw call per actor for each rendering pass, before additional shadow/depth passes.

The optimization script and reports are in `work/assets-v3/tools/prepare-knight.mjs` and `work/assets-v3/knight-prepared-report.json`.

## Scale, orientation and joints

The model is **Y-up**, with its feet at Y = 0. Original default-pose bounds are X `-0.662633..0.662633`, Y `0..1.850000`, Z `-0.191589..0.191589` in metres. Width in the rest pose is 1.325 m, height 1.850 m, depth 0.383 m. The root-motion locomotion advances along **+Z**.

Exact joint names:

```text
pelvis
spine1
spine2
chest
clavicle_L
upperarm_L
forearm_L
hand_L
clavicle_R
upperarm_R
forearm_R
hand_R
neck
head
thigh_L
shin_L
foot_L
toe_L
thigh_R
shin_R
foot_R
toe_R
```

The named hand joints can be used as attachment sockets. The source includes no weapon or shield.

## Animation evidence and limitations

Each clip has 66 channels affecting the 22 joints. The source describes seven actions and supplies two additional root-motion variants, for nine GLTF clips in total.

| Clip | Duration seconds | Translation |
| --- | ---: | --- |
| `Idle` | 4.0000 | Loop returns to its first pelvis position |
| `Walk` | 2.7083 | In-place, first and last pelvis positions identical |
| `Walk_Root` | 2.7083 | Root motion: about 2.90 m forward along +Z |
| `Run` | 1.6667 | In-place, first and last pelvis positions identical |
| `Run_Root` | 1.6667 | Root motion: about 4.88 m forward along +Z |
| `Attack` | 4.5833 | Small local movement, no continuous travel |
| `Hit` | 4.6250 | Local recoil, no continuous travel |
| `Jump` | 4.9167 | Local jump, pelvis rises by about 0.44 m from initial position |
| `Kick` | 4.4167 | Small local movement, no continuous travel |

Use `Walk` and `Run` when gameplay code moves the actor. The root-motion clips should not be used concurrently with additional movement unless the application explicitly extracts root motion.

There is **no sword-specific clip, dodge, roll, or death animation in the original source asset**. `Attack` remains the source's unarmed attack. The runtime derivative now includes the three separately authored clips below, which are not motion capture supplied by Patch.

The author's pipeline notes that generated motion can have mild foot sliding and that runs can resemble fast walks. This prepared file was structurally inspected, and the author's static preview was visually reviewed. The actual combat and locomotion should also be inspected in the application.

## Original prototype animation clips

The runtime derivative includes `SwordAttack` (0.65 seconds), `Quickstep` (0.52 seconds), and `Death` (1.60 seconds). These are original skeletal keyframes authored for the new0 prototype in this workspace, based on the source rig's anatomical axes and the first `Idle` pose. No third-party motion was downloaded for these clips and no source animation is merely renamed to imply a missing action.

The authoring script is `work/assets-v3/tools/author-knight-clips.mjs`. It constructs world-axis joint rotations, computes local quaternions through each parent's transform, uses two-bone arm/leg IK for the action poses, and writes bone translation and quaternion tracks. Each new clip has 44 channels on the 22 joints. **No scale animation is added.** Quaternion signs are made continuous and the curves are sampled at approximately 60 Hz.

- **SwordAttack:** guard preparation, pelvis/chest windup, raised right arm, a fast diagonal slash, follow-through, recovery. The hand is aimed using an orthonormal palm frame instead of replacing the entire character's rotation. The blade is expected along the hand's local **-Z** axis.
- **Quickstep:** bent-knee weight shift and torso lean with a guarded hand position. It is in place. The game must translate the actor during the dodge interval. This is a quickstep, not a somersault.
- **Death:** recoil, buckling knees, and a forward/side collapse. The pelvis descends from about 0.946 m to about 0.275 m. Weighted skinned vertices are checked against the floor and sampled death poses are raised only as needed to avoid sinking through it. The final frame remains the corpse pose. Play this clip with `LoopOnce` and `clampWhenFinished = true`; do not fade back to idle after completion.

These clips are an animation blockout, not professional motion capture. Hand contact, impact timing, transitions, and silhouette require visual verification in the actual application.

### Weapon attachment convention

Attach the weapon to `hand_R`, with a provisional grip offset of local **(0, 0.06, 0)**. In the source rig, local **+Y** follows the wrist toward the fingers. The custom attack assumes the blade extends along local **-Z**, and the crossguard runs along local **X**. For a weapon authored along +Y, a child rotation of **X = -π/2** maps the blade to -Z. The attachment is an approximation because the source has no finger joints or weapon grip animation.
