# new0 game development

- Work in this checkout. Development is on `dev`, with focused task branches and PRs into `dev`.
  `master` holds tested milestones. Never force-push or deploy automatically.
- Track concrete open work in GitHub Issues with `priority:P0`, `priority:P1`, or `priority:P2`.
  Finish the current slice before starting new mechanics. Avoid duplicate issues.
- Current scope is a one-week prototype: a connected Three.js route through forest,
  gate court, cathedral/gallery and crypt, mobile-first Telegram play, casual combat,
  keys/coins, one held weapon with swap/drop, hollow chests and a mimic, a visible
  armour upgrade, hidden consumable healing potions without HP regeneration, Compose.
  The current public demo exposes one autoplay button. Keep developer review tools
  guest-only and off the normal Mini App screen.
  The user explicitly rejected turn-based combat and action-selection menus.
- The visual target is a gloomy PS1-inspired, human-scale 3D world with a third-person
  camera behind the hero. Avoid an overhead/isometric view and cartoon proportions.
- Latest art direction: gloomy pale stone and cloth, readable cool midtones, localized shimmering light
  through dark depth fog, subtle monochrome grain and clean UI. Avoid uniform bright
  lighting. Use varied cloth/mask/monster silhouettes instead of an all-armoured cast.
- Walls, doors, stairs and visible supports must describe the same traversable world.
  Locked rooms cannot be bypassed from a flank or rear stair. Key names match their doors.
  Taking damage interrupts chest inspection and drinking. Torches burn at every distance.
- One, two and three consecutive attacks use distinct clips. Block cannot cancel an
  active chain or recovery. Preserve varied dodge/hit reactions and grounded death.
  Full rolls have planted compression and landing. Choose a skinned front/back/side
  fall from the last impact direction, never ragdoll. Do not restore floor attack cones
  or broad solid sword ribbons. Autoplay explores, collects and fights via normal input.
- Keep gameplay timings aligned with public/assets/motion/contract.json. Linked attacks
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
- Target at least 60 FPS on phones. Never hard-cap touch rendering at 30 FPS.
  Measure actual frame times. Do not present viewport resizing as a physical-phone benchmark.
- Keep stone, floor and character silhouettes readable. Retro art comes from materials,
  lighting, fog and proportions, not crushed blacks or primitive rigid-part characters.
  Use skinned locomotion, smooth transitions and a grounded death pose without shrinking.
- Capture actual gameplay at 60 FPS with the on-demand WebCodecs recorder, then prefer
  RTX 4070 Ti SUPER H.264 NVENC for export. Capture advances simulation once per
  accepted frame and respects encoder backpressure. Do not treat this as a realtime
  FPS benchmark or hide dropped frames by merely relabelling a video as 60 FPS.
- Keep all prize-relevant rules and score calculation on the Python API. Validate Telegram
  initData before trusting identity. Never accept a client-supplied user ID, score, HP or win flag.
- The current real-time vertical slice is local and non-competitive. It uses the existing API
  only for identity, never submits local combat to the legacy turn-based leaderboard.
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
