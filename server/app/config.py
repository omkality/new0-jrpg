import os
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class Settings:
    database_path: str = os.getenv("DATABASE_PATH", "./work/game.sqlite3")
    bot_id: int = int(os.getenv("TELEGRAM_BOT_ID", "0"))
    bot_username: str = os.getenv("TELEGRAM_BOT_USERNAME", "")
    bot_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    version: str = os.getenv("LEADERBOARD_VERSION", "prototype-001")
    title: str = os.getenv("LEADERBOARD_TITLE", "Тестовый архив 001")
    competition_open: bool = os.getenv("COMPETITION_OPEN", "false").lower() == "true"
    attempt_limit: int = int(os.getenv("ATTEMPT_LIMIT", "0"))
    allow_guest: bool = os.getenv("ALLOW_GUEST", "false").lower() == "true"
    shop_url: str = os.getenv("SHOP_URL", "https://new0.shop/")
    drop_url: str = os.getenv("DROP_URL", "https://new0.shop/")
    auth_max_age: int = int(os.getenv("AUTH_MAX_AGE_SECONDS", "900"))
    session_ttl: int = int(os.getenv("SESSION_TTL_SECONDS", "86400"))
    run_ttl: int = int(os.getenv("RUN_TTL_SECONDS", "7200"))
    min_action_interval: float = float(os.getenv("MIN_ACTION_INTERVAL_SECONDS", "0.2"))
    diagnostic_ttl: int = int(os.getenv("DIAGNOSTIC_TTL_SECONDS", "86400"))
    client_timeout_ms: int = int(os.getenv("CLIENT_REQUEST_TIMEOUT_MS", "30000"))
    client_bootstrap_attempts: int = int(os.getenv("CLIENT_BOOTSTRAP_ATTEMPTS", "3"))

    def validate(self):
        if self.competition_open and self.allow_guest:
            raise RuntimeError("Prize mode requires ALLOW_GUEST=false")
        if not self.version or len(self.version) > 64:
            raise RuntimeError("LEADERBOARD_VERSION must contain 1..64 characters")
        if self.attempt_limit < 0:
            raise RuntimeError("ATTEMPT_LIMIT cannot be negative")
        if self.bot_token and self.bot_token.partition(":")[0] != str(self.bot_id):
            raise RuntimeError("Bot token and TELEGRAM_BOT_ID do not match")
        for value in (self.shop_url, self.drop_url):
            url = urlparse(value)
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise RuntimeError("SHOP_URL and DROP_URL must be HTTPS URLs without credentials")
        if (
            min(self.auth_max_age, self.session_ttl, self.run_ttl, self.diagnostic_ttl) <= 0
            or self.min_action_interval < 0
        ):
            raise RuntimeError("Session/auth/run lifetimes must be positive, action interval non-negative")
        if not 1000 <= self.client_timeout_ms <= 120000 or not 1 <= self.client_bootstrap_attempts <= 3:
            raise RuntimeError("Client request timeout must be 1000..120000 ms and bootstrap attempts 1..3")
