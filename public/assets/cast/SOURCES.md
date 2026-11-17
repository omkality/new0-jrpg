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

## Historical v7 prepared derivatives

| File           |   Bytes | Triangles | Vertices | Materials | Mesh primitives |
| -------------- | ------: | --------: | -------: | --------: | --------------: |
| `prisoner.glb` | 1395008 |     16257 |    13371 |         5 |               8 |
| `gaoler.glb`   | 1338752 |     18730 |    12522 |         1 |               1 |
| `watcher.glb`  | 1399548 |     16050 |    13465 |         2 |               5 |

Every file contains one skin and the same 22 joint names as the earlier knight. Source PBR images were resized to **1024x1024**. The added cloth uses an original **64x64** woven-noise image. Images are embedded. No special geometry decoder is required.

### Masked prisoner

The unarmoured woman source was adapted with original skinned geometry authored here: a linen tunic, compact cloth hood with a separate soft collar, and an aged oval mask with dark cavities. The current v7 tunic uses continuous anatomical weights. The hood and mask follow the head joint. Source body vertex colours were muted and trainers darkened. This is a new garment-and-mask silhouette, not a recolour of the knight.

### Gaoler

The ogre source supplies a broad, heavy, slightly hunched silhouette with a loincloth. Geometry and embedded textures were optimized. Native height is approximately **2.80 m**, so actor scale and collision dimensions should be set appropriately by the application.

### Veiled watcher

This uses the same exact rig/rest pose as the prisoner, with separate original geometry: a wider shoulder contour, a below-knee flared mantle, cloth hood, and folded face veil. Lower cloth weights blend pelvis and thigh influences. The current v7 face veil shares its entire edge with the hood opening. This is not a material-only recolour. The robe is skinned geometry rather than cloth simulation; extreme crouching and combat need intersection checks.

## Native clips

Use `Walk` and `Run` for movement driven by game code. The additional `_Root` variants contain forward root motion.

| Family             |    Idle |    Walk |     Run | Other source clips                                    |
| ------------------ | ------: | ------: | ------: | ----------------------------------------------------- |
| Prisoner / watcher | 2.792 s | 2.208 s | 1.500 s | `Kick` 4.875 s                                        |
| Gaoler             | 2.083 s | 1.833 s | 1.000 s | `Attack` 4.000 s, `Hit` 2.542 s, `GroundSlam` 3.917 s |

Forward +Z displacement for `Walk_Root` / `Run_Root`: prisoner and watcher approximately **2.103 m / 3.679 m**, gaoler **1.499 m / 2.717 m**. In-place versions return to their initial pelvis translation.

## Retarget compatibility

The 22 joint names and hierarchy match the knight, but rest transforms differ. Local rest rotation differences reach **20.36 degrees** for the prisoner and **23.20 degrees** for the gaoler. Translation tracks need target-rest rebasing and rotation tracks need rest-pose correction. Directly copying knight rotations is not a verified retarget. Prisoner and watcher can share one retarget profile because their rig data is identical.

Exact source/target joint translations and quaternions: `work/assets-v4/rest-compatibility.json`. Geometry and native-clip reports: `work/assets-v4/cast-prepared-report.json` and `cast-verification.json`.

## Preparation and verification

Script: `work/assets-v3/tools/prepare-cast-v4.mjs`. Simplification uses glTF Transform/meshoptimizer. Added garments, masks, veil and cloth texture are original scripted geometry made with AI-assisted code in this workspace. No claim of human hand modelling is made.

The shared source topknot was retained inside the original body primitive and protruded from the head cloth. It has now been removed from both prisoner and watcher rather than enlarging their head coverings. The targeted operation removed 917 rear upper-head hair triangles and compacted 471 unused body vertices from each model. The visible front face, separate mask/garment geometry, materials, textures, node hierarchy, 22-bone rest transforms, inverse-bind matrices and animation accessor data are preserved. The gaoler file was not changed.

Portable reproducible fix, requiring only Node.js: `node scripts/assets/remove-hidden-hair.mjs`. Regression check: `node scripts/assets/remove-hidden-hair.mjs --check`. It is also invoked by the original preparation pipeline so regenerating these derivatives does not restore the hidden hair. The machine-independent helper contains no runtime geometry/image dependencies. The operation and preservation evidence are recorded in `work/assets-v4/hair-fix-report.json`; before-fix GLB backups are in the same working directory.

Source previews were visually inspected and saved as `work/assets-v4/woman.webp` and `ogre.webp`. Derivative viewer: `work/assets-v4/preview.html`, served by `serve-preview.mjs` in the same directory. Structure, licenses, skin references, counts and native clips were inspected. All three enemy profiles were subsequently reviewed in the running game, including their different silhouettes. The full combat capture was inspected for the gaoler. Extreme garment intersections and the final animation quality still need further visual polish.

## v7 garment geometry and skin repair

The side-view walking screenshot exposed defects in the original scripted clothing.
The original tunic/robe had 66 geometric boundary edges, with one surface and no
thickness or armholes. The old prisoner headwrap had 58 boundary edges, including
an uncapped side slit. Nearest-body-vertex weight transfer had assigned arm/head
influences to the torso cloth and shin/foot/toe influences to the observer robe.
Consequently adjacent cloth regions followed unrelated limbs during movement.

Portable corrective helper: `scripts/assets/fix-garment-v7.mjs`. Dependencies are
the versions pinned in `scripts/assets/package.json`. All paths are relative to
the script. The correction is local asset processing and adds no runtime service.

```powershell
node scripts/assets/fix-garment-v7.mjs --apply
node scripts/assets/fix-garment-v7.mjs --check --poses --floor
node scripts/assets/fix-garment-v7.mjs --check --poses --verify-floor
```

Apply this helper after running the earlier source preparation pipeline. An
already repaired v7 asset is left unchanged. Structural regression hashes are
embedded in the helper, so the checks work in a fresh checkout without `work/`.
The first application saves ignored local before-files. When those are present,
`--rebuild --apply --candidate` regenerates a comparison candidate from the old
geometry without replacing the public assets. This was byte-identical to the
final public GLBs.

The replacement geometry is original new0 work under the same CC0 asset context:

- The tunic/robe, collar, hood and veil are closed cloth shells, with 7–9 mm
  thickness, inner walls and edge strips. All their geometric boundary and
  non-manifold edge counts are zero. The intentional sleeveless armholes have
  physical rims. Hem offsets are periodic, avoiding a mismatched cylinder seam.
- Torso cloth uses smooth pelvis/spine/chest/neck/clavicle weights. Lower cloth
  blends pelvis and thighs. Head, arm, shin, foot and toe influences are excluded
  from the tunic/robe. The collar follows neck/chest and overlaps the head cloth.
- The hood is compact and closed at the back. The prisoner's original mask is
  seated 30 mm closer to the head and the cloth opening overlaps its perimeter.
  The watcher veil's edge is coincident with the hood edge with identical head
  weights. That seam stayed closed in every tested deformation.
- Permanently concealed source triangles were removed beneath the head covering,
  torso cloth and covered legs, avoiding competition between body and fabric.
  This removed 4592 additional body triangles for prisoner and 5151 for watcher.
  All existing body vertex records, including skin weights, remain byte-identical.
- All 22 bone names, hierarchy, local rest TRS, skeleton reference, inverse-bind
  matrices, native animation channel arrays and embedded images remain unchanged.
  Public motion GLBs and the approved attack arrays were not modified.

Structural checks and actual skin evaluation cover Idle, Walk, Run and all 16
combat clips at 60 Hz, **1322 samples per model**. Static before/after posed-skin
studies cover Walk/Run, Guard, Attack1/2/3 and backward/lateral roll phases.
Head/shoulder/hip/knee crops are in `work/assets-v7/garment/*-hood-side-knee.png`.
These use actual skinned geometry with simple diagnostic lighting, not a game
screenshot or a physical-device benchmark. Engine materials, camera, blend
transitions and remaining hand/weapon or extreme cloth self-intersections still
require real gameplay review. There is no cloth simulation or self-collision.

### Baked floor offsets

`floor-v7.json` is a 14,495-byte table for the final prisoner and watcher meshes.
It contains 19 clips per profile, 1322 scalar samples each, with each final model's
SHA256 binding. Samples are computed from the actual indexed weighted skin:
`yOffset = max(0, 0.008 - minimumWeightedY)`, rounded upward to a micrometre.
Props and attached weapons are excluded. Every sampled corrected surface remains
at least 8 mm above the reference plane, verified independently against the
exported table and deformed vertices.

The schema is `profiles[character].clips[clip] = {duration, offsets}` with global
`sampleRate: 60`. Sample time is `min(duration, i/60)`. The final interval may be
shorter than 1/60 s and should be interpolated using its actual duration. Values
are nonnegative model-space metres. Runtime must account for any visual scale
and smooth clip transitions. The table avoids per-frame vertex skinning for
ground alignment. It does not alter animations, gameplay position or scoring.

Historical v7 geometry hashes:

- prisoner: `a1686e17a95b740b8971ec59ad3b7c7677a9079c29405a8869476d385a507964`
- watcher: `09b25785f3808a8849a52590ea1d364656b24fbe5a5a0abd62bcb35467fcab74`

The watcher mantle was shortened after a deformation check found that the earlier
floor-length edge would require a 344 mm height correction in a prone death.
The current hem rests approximately 445 mm above the bind floor, slightly below
the source knee, with a periodic worn edge. The lower cloth follows pelvis and
thighs with at most 75 percent thigh influence. Source calf triangles were
restored from the before-file when shortening the garment. The upper garment
was also fitted closer to the torso to reduce hand/fabric overlap while running.
On the final mesh, maximum floor offsets are 105.410 mm for DeathFront,
92.534 mm for DeathSide, 27.618 mm for DeathBack and 92.783 mm for legacy Death.
The source motion and approved attacks remain unchanged. The corresponding
static corpse study is `work/assets-v7/garment/watcher-deaths-shortrobe.png`.


## Текущее состояние v8.2 / облегающая ткань и закрытые кисти

Актуальные публичные GLB подготовлены `scripts/assets/fit-cast-v8.mjs`.
Длинные широкие оболочки v7 заменены рубахой с рукавами и штанами.
Их вершины повторяют поверхность исходного тела с отступом 11 мм и 7 мм,
используют его же индексы костей и веса. Капюшоны, воротник, маска и вуаль
сохранены. Отдельной симуляции ткани нет.

Восстановленные индексы исходного тела находятся в
`scripts/assets/seeds/woman-body-indices.u16`. Это записи индексов производной
CC0-модели Patch после удаления скрытого пучка волос. Они нужны, чтобы под
новой более короткой одеждой не оставались отверстия. Сами базовые записи
вершин тела, 22 кости, rest TRS, inverse-bind matrices, исходные анимации и
встроенные изображения сохраняют защищённые хэши. Боевые GLB не менялись.

У исходных моделей нет костей пальцев. Две additive morph-цели `new0GripR`
и `new0GripL` закрывают исходную геометрию пальцев вокруг рукояти. Открытая
кисть сохранена как нулевое значение morph. Новые жёсткие примитивы вместо
рук не используются. Изменения нормалей ограничены изменёнными пальцами.

Повторный запуск подготовки не накапливает старые оболочки и morph-аксессоры.
Очистка касается только неиспользуемых Accessor/Buffer, защищённые данные
проверяются до записи и после экспорта. Происхождение и лицензия исходных
моделей остаются CC0, указаны выше.

```powershell
node scripts/assets/fit-cast-v8.mjs --apply --floor
npm --prefix scripts/assets run check
```

`floor-v7.json` сохраняет имя URL для загрузчика. В актуальной таблице есть
prisoner, watcher и gaoler. Контакт с полом пересчитан по новой геометрии.
Для падений корректировка может быть отрицательной, чтобы тело после удаления
длинной одежды не зависало над полом. Остальные клипы используют положительное
поднятие при необходимости. Эти значения не меняют игровую координату и HP.

`GearPose` ограничивает руки после смешивания анимаций и сохраняет длины
плеча и предплечья. Хват меча, тяжёлый замах секирой и выпад копьём различаются.
Проверка пересечения выполняется по уже изменённой позе ткани, включая рукава.
У носильщика дополнительно проверяется поверхность тела вне зоны хвата.
Рендер и проверка используют общие положения рукоятей и одинаковые модели оружия.
Предмет остаётся прикреплён к кисти. Тест проверяет сторону несущей руки,
сгиб запястья, расстояние опорной кисти до древка, одежду, пол и направление лезвия.
У врагов проверяются движения, которые действительно использует их текущий AI.
Исходные перекаты сохраняются в ассетах, но AI врагов их не вызывает.

Светлая ткань и камень выбеливаются при рендере, исходные PNG сохранены.
Референсы PRISON OF HUSKS не входят в поставляемые игровые ассеты.
