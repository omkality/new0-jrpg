# fixes2 character and armour provenance

The replacement head mesh is derived from MakeHuman Community core mesh data and adult macro targets. MakeHuman code is not bundled or imported.

Official source repository: https://github.com/makehumancommunity/makehuman
Pinned revision: 1f508f6083b2f823dab15de924b3bde72e08d77c (v1.3.0)
Data license: CC0 1.0 Universal, reproduced in LICENSE.MAKEHUMAN.md.
MakeHuman's license distinction between code and core assets is documented at https://www.makehumancommunity.org/about/license.html and https://static.makehumancommunity.org/oldsite/faq/what_changed_regarding_the_license_in_2020.html.

The imported data consists of base.obj, caucasian/asian adult female/male macrodetail targets and official CC0 nose, cheek, chin, lip and jaw-expression targets. Exact pinned file paths and SHA-256 digests are recorded in head-provenance.json. Character forms use a blend of those adult targets. They do not depict a real person.

Modifications: extracted rigid head and upper neck, metre-scale fitting, mesh simplification to 2600 face triangles per variant, preserved smooth normals, compacted female lower face, softened nose/cheeks, matched lower neck to the existing game rig, closed the heroine jaw with a small inverse native mouth-opening expression, added original eye geometry, vertex colours and conforming bob/short hair. The same existing head bone animates this rigid replacement. Source body geometry, skeleton bind poses and animation clips are not changed by this asset work.

Reproduce mesh extraction from the repository root with:

    node scripts/assets/author-head-fixes2.mjs

That script fetches pinned official data into work/fixes2/appearance only when absent, then creates src/human-head-data.json. Original runtime hair, eyes, colouring and fitting are in src/human-head.ts and src/character-appearance.ts.

The steel cuirass, three overlapping upper-arm lames per shoulder, leather straps, rolled edges, rivets, brushed albedo and roughness/metalness finish map are original procedural game assets. These objects use historical construction as a visual reference, not copied game content or downloaded museum photographs.

Primary visual references:
- Cleveland Museum of Art, Gothic Breastplate and Taces, North Italy, c.1475–1500: https://www.clevelandart.org/art/1919.63
- Cleveland Museum of Art, Gothic Breastplate, South Germany or Austria, late15th century: https://www.clevelandart.org/art/1916.1720
- Fitzwilliam Museum, Pauldrons HEN.M.4D-1933, overlapping lames with leather lining bands and rivets: https://data.fitzmuseum.cam.ac.uk/id/object/17728

No paid assets, game rips or third-party texture photographs were used.
