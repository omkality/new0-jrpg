import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_path: str = os.getenv("DATABASE_PATH", "./work/game.sqlite3")
    bot_id: int = int(os.getenv("TELEGRAM_BOT_ID", "9210184678"))
    bot_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    version: str = os.getenv("LEADERBOARD_VERSION", "prototype-001")
    title: str = os.getenv("LEADERBOARD_TITLE", "Тестовый архив 001")
    competition_open: bool = os.getenv("COMPETITION_OPEN", "false").lower() == "true"
    attempt_limit: int = int(os.getenv("ATTEMPT_LIMIT", "0"))
    allow_guest: bool = os.getenv("ALLOW_GUEST", "false").lower() == "true"
    auth_max_age: int = 900
    session_ttl: int = 86400
    run_ttl: int = 7200
    min_action_interval: float = 0.2

    def validate(self):
        if self.competition_open and self.allow_guest:
            raise RuntimeError("Prize mode requires ALLOW_GUEST=false")
        if not self.version or len(self.version) > 64:
            raise RuntimeError("LEADERBOARD_VERSION must contain 1..64 characters")
        if self.attempt_limit < 0:
            raise RuntimeError("ATTEMPT_LIMIT cannot be negative")
        if self.bot_token and self.bot_token.partition(":")[0] != str(self.bot_id):
            raise RuntimeError("Bot token and TELEGRAM_BOT_ID do not match")
