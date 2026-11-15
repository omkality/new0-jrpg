# new0 game development

- Work in this checkout. Development is on `dev`, with focused task branches and PRs into `dev`.
  `master` holds tested milestones. Never force-push or deploy automatically.
- Track concrete open work in GitHub Issues with `priority:P0`, `priority:P1`, or `priority:P2`.
  Finish the current slice before starting new mechanics. Avoid duplicate issues.
- Current scope is a one-week prototype: one Three.js room, desktop/touch movement,
  one turn-based fight, two secrets, Telegram identity, versioned leaderboards, Docker Compose.
- Keep all prize-relevant rules and score calculation on the Python API. Validate Telegram
  initData before trusting identity. Never accept a client-supplied user ID, score, HP or win flag.
- Guest runs are for local testing only and must never mix with Telegram results.
  Prize mode defaults to closed. Attempt limits and tie resolution still require owner decisions.
- A ruleset or attempt policy change requires a new leaderboard version. Preserve old results.
- Do not commit bot tokens, initData, sessions, `.env`, databases, private logs, or `work/`.
  Only public bot IDs belong in examples. Bot token handling is API-side only.
- Keep runtime assets local and retain their source and license. Do not use game-ripped assets.
- Before completion or a code commit, run `npm run build` and the relevant Dockerized tests.
  Verify the actual browser flow after UI changes. State limits of device/Telegram verification.
- Use isolated temporary databases for automated tests. Do not wipe persisted game data.
- Keep README, CHANGELOG and owner documentation in Russian. Commit subjects use English.
- Record new ideas as issues with acceptance criteria and blockers. Do not introduce a larger
  architecture or extra services without a concrete need in the current game.
