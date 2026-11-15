"""Validate signed Telegram initData. Never log initData or bot credentials."""
import base64
import hashlib
import hmac
import json
import time
import unicodedata
from urllib.parse import parse_qsl

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

TELEGRAM_PUBLIC_KEY = bytes.fromhex(
    "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d"
)


class AuthError(ValueError):
    pass


def validate_init_data(raw: str, bot_id: int, bot_token: str = "", *,
                       now: float | None = None, max_age: int = 900,
                       public_key: bytes = TELEGRAM_PUBLIC_KEY) -> dict:
    if not raw or len(raw) > 16384:
        raise AuthError("Некорректные данные Telegram")
    try:
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True,
                          max_num_fields=30)
        data = dict(pairs)
        if len(data) != len(pairs):
            raise AuthError("Повторяющиеся поля Telegram")
        auth_date = int(data["auth_date"])
        current = now if now is not None else time.time()
        if auth_date > current + 30 or current - auth_date > max_age:
            raise AuthError("Сессия Telegram устарела. Откройте игру заново")
        if data.get("signature"):
            # Official third-party verification is bound to this bot ID.
            check = f"{bot_id}:WebAppData\n" + "\n".join(
                f"{k}={v}" for k, v in sorted(data.items())
                if k not in {"hash", "signature"}
            )
            encoded = data["signature"]
            signature = base64.b64decode(encoded + "=" * (-len(encoded) % 4),
                                         altchars=b"-_", validate=True)
            Ed25519PublicKey.from_public_bytes(public_key).verify(signature, check.encode())
        else:
            if not bot_token:
                raise AuthError("Обновите Telegram или обратитесь к организатору")
            check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()) if k != "hash")
            key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
            expected = hmac.new(key, check.encode(), hashlib.sha256).hexdigest()
            received = data.get("hash", "")
            if len(received) != 64 or not hmac.compare_digest(expected, received):
                raise AuthError("Подпись Telegram не подтверждена")
        user = json.loads(data["user"])
        if (type(user.get("id")) is not int or not 0 < user["id"] < 2**53
                or user.get("is_bot", False) is not False):
            raise AuthError("Некорректный аккаунт Telegram")
        first_name = user.get("first_name")
        if not isinstance(first_name, str) or not first_name.strip():
            raise AuthError("Нет имени аккаунта Telegram")
        name = "".join(c for c in first_name if not unicodedata.category(c).startswith("C"))
        return {"telegram_id": user["id"], "display_name": name.strip()[:40] or "Путник"}
    except AuthError:
        raise
    except (ValueError, KeyError, TypeError, AttributeError, InvalidSignature) as exc:
        raise AuthError("Подпись Telegram не подтверждена") from exc
