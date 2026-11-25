# new0 game development

## Start here for new gameplay

- The owner brief of November 22, 2026 sets the next direction. Read
  [the portrait slice](docs/PORTRAIT_SLICE.md) for the first task, its acceptance
  cases and the six video references. The old realtime prototype is the baseline.
- Keep Danya's clips and the official PRISON OF HUSKS gallery together as the
  visual brief. Compare actual portrait gameplay with the timecodes and images in
  [the art notes](docs/REFERENCES.md) when choosing landmarks, light and framing.
- Build for a portrait-only Telegram Mini App. Exploration leads into a dialogue
  window where the player taps a turn command. The first choices are attack, item
  and skill. Give the world a deliberate pixel grid and keep Cyrillic UI legible.
  Danya will compose the music after reviewing a playable demo.
- In the portrait chapter, use the rear three-quarter camera above the pilgrim.
  Keep both fighters' heads, hands and planted feet in the portrait frame during
  strikes and replies. Dialogue portraits and item close-ups have separate cameras.
  Check the forest and the grille with both weapons at 320×568 and 430×932.
- The singer's oath, the toll, the grave and the votive are independent choices.
  Verify the path with two duels and both discoveries, and the peaceful path with
  both NPCs alive, through ordinary touch controls. Beyond the bell, visit the
  same tablet before and after turning the mirror and check both choices at the book.
  Turn outcomes have one
  authority in `src/chapter/encounter.ts`. Keep observed damage, sound and reactions
  on the animated contact frame and let the player read before the next command.
  Inspect new stairs, raised floors and arches in both directions in the live
  camera. Check the rendered masonry against the walkable surface in the
  environment asset validator. Keep deliberate windows and doorways open.
- A fresh contributor can play `?chapter=forest` and start with **«Устройство играбельной версии»** in the brief.
  Its preview must work for a real Telegram player. The guest review panel and
  autoplay remain useful for development of the existing showcase.

## Repository workflow

- Work in this checkout. Development is on `dev`, with focused task branches and PRs into `dev`.
  `master` holds tested milestones. Never force-push or deploy automatically.
- Track concrete open work in GitHub Issues with `priority:P0`, `priority:P1`, or `priority:P2`.
  Finish the current slice before starting new mechanics. Avoid duplicate issues.

## Existing world and realtime showcase

- The existing realtime showcase is a connected Three.js route through forest,
  gate court, cathedral/gallery and crypt, mobile-first Telegram play, casual combat,
  keys/coins, one held weapon with swap/drop, hollow chests and a mimic, a visible
  armour upgrade, hidden consumable healing potions without HP regeneration, Compose.
  The current public demo exposes one autoplay button. Keep developer review tools
  guest-only and off the normal Mini App screen.
  The following animation, input and capture contracts apply to that showcase.
- The visual target for exploration is a gloomy PS1-inspired, human-scale 3D world with a third-person
  camera behind the hero. Avoid an overhead/isometric view and cartoon proportions.
- Cloth must follow the body surface and skin weights. Rigid metal plates are separate.
  Use weapon-specific stances and closed hand grips, with anatomical wrist limits.
  Validate the final posed sleeves as well as the torso, including both support hands.
- All visible text uses the local Ebbe Black face, including canvas HUD. Keep its OFL
  notice and test Cyrillic coverage and small-screen readability. Use SVG for action icons.
- Latest art direction: gray-white mist, pale air and readable cool midtones around
  dark natural materials. Do not bleach all locations white. Keep an actual forest
  with soil and foliage, and a darker brick castle lit locally by textured torches
  and bright window shafts. Humanoids have modeled faces, not blank white masks.
  Fitted cloth and curved rigid armour remain distinct layers.
- Walls, doors, stairs and visible supports must describe the same traversable world.
  Locked rooms cannot be bypassed from a flank or rear stair. Key names match their doors.
  Taking damage interrupts chest inspection and drinking. Torches burn at every distance.
- One, two and three consecutive attacks use distinct clips. Block cannot cancel an
  active chain or recovery. Preserve varied dodge/hit reactions and grounded death.
  Full rolls have planted compression and landing. Choose a skinned front/back/side
  fall from the last impact direction, never ragdoll. Do not restore floor attack cones
  or broad solid sword ribbons. Autoplay explores, collects and fights via normal input.
- Keep gameplay timings aligned with public/assets/motion/fixes1-contract.json.
  The older contract.json protects retained baseline clips and their phase mapping. Linked attacks
  continue at the authored follow-through timestamps instead of resetting to Guard.
- Player documentation describes phone/touch controls only.
- README badges show only technologies actually used and useful, verifiable project
  statuses. Do not add zero-value counters, empty download/star statistics, broken
  badges or unverified release claims. Keep the badge row small and relevant.
- When dependencies, runtime versions or workflows change, update the badges through
  scripts/update_badges.py. Versions come from project files, never manual guesses.
  Run scripts/update_badges.py --check before committing. CI checks the same rule.
- The on-device autocheck runs at normal wall-clock speed, records RAF intervals including
  long frames and interruptions, and stores bounded owner-only demo reports. Never use
  these client-reported diagnostics as competition scores or evidence of input security.
- The long autoplay walks continuously across all four areas without resetting HP,
  equipment or position. Short review scenarios include victory and genuine player defeat.
  Never inject a win, damage or teleport into the input driver. Do not add a full inventory.
- Allocate shared models, textures, geometry and pooled props once. Restarts must reuse
  resources. Dispose mixers, skeletons, GL resources and capture URLs on teardown.
  Validate garment contact curves and real held-weapon geometry with the asset checks.
- Iterate on the playable demo first. Provide a short real gameplay GIF/video with a
  focused visual/interaction change, then incorporate feedback before adding more systems.
- Never refit posed clothing BVHs or search candidate arm poses in the rendering loop.
  Keep actor-space skeletal transitions continuous, including interruptions, healing,
  enemy evasions and weapon release. Corpses retain physical footprints.
- Target at least 60 FPS on phones. Never hard-cap touch rendering at 30 FPS.
  Measure actual frame times. Do not present viewport resizing as a physical-phone benchmark.
- Keep stone, floor and character silhouettes readable. Retro art comes from materials,
  lighting, fog and proportions, not crushed blacks or primitive rigid-part characters.
  Use skinned locomotion, smooth transitions and a grounded death pose without shrinking.
- Capture actual gameplay at 60 FPS with the on-demand WebCodecs recorder, then prefer
  RTX 4070 Ti SUPER H.264 NVENC for export. Capture advances simulation once per
  accepted frame and respects encoder backpressure. Do not treat this as a realtime
  FPS benchmark or hide dropped frames by merely relabelling a video as 60 FPS.

## Shared data, delivery and checks

- Keep all prize-relevant rules and score calculation on the Python API. Validate Telegram
  initData before trusting identity. Never accept a client-supplied user ID, score, HP or win flag.
- The existing realtime slice is local and non-competitive. Its API traffic covers
  identity and device diagnostics. Local combat produces no leaderboard submissions.
  Server validation of real-time play and a new ruleset/version must precede prize results.
- Guest runs are for local testing only and must never mix with Telegram results.
  Prize mode defaults to closed. Attempt limits and tie resolution still require owner decisions.
- A ruleset or attempt policy change requires a new leaderboard version. Preserve old results.
- Do not commit bot tokens, initData, sessions, `.env`, databases, private logs, or `work/`.
  Only public bot IDs belong in examples. Bot token handling is API-side only.
- Keep runtime assets local and retain their source and license. Do not use game-ripped assets.
- Public asset URLs include a build-time content hash. Preserve it after replacing models.
- Operational ports, bot identity, links and TTLs are runtime configuration. Healthchecks
  use wget, with the same configurable port as the service. Keep preview projects explicit
  and isolated even when COMPOSE_PROJECT_NAME is set. Preserve all persisted player data.
- Before completion or a code commit, run `npm run build` and the relevant Dockerized tests.
  Verify the actual browser flow after UI changes. State limits of device/Telegram verification.
- Use isolated temporary databases for automated tests. Do not wipe persisted game data.
- Keep README, CHANGELOG and owner documentation in Russian. Commit subjects use English.
- Record new ideas as issues with acceptance criteria and blockers. Do not introduce a larger
  architecture or extra services without a concrete need in the current game.

- Install the pinned pre-commit environment from requirements-dev.txt and run all hooks
  before a commit. Python uses Ruff lint + Ruff format, without Black. Web text uses
  the locked Prettier. Preserve the generated/third-party asset formatting exclusions.
