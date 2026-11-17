import base64
import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app.auth import AuthError, validate_init_data

TOKEN = "100000:test-only-secret-not-a-real-bot-token"
NOW = 1800000000


def signed(user_id=42, now=NOW, **extras):
    data = {"auth_date": str(now), "user": json.dumps({"id": user_id, "first_name": "Путник"}, ensure_ascii=False), **extras}
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.digest(b"WebAppData", TOKEN.encode(), "sha256")
    data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(data)


def test_valid_hmac_and_unicode():
    assert validate_init_data(signed(),100000,TOKEN,now=NOW) == {"telegram_id":42,"display_name":"Путник"}


def test_tampering_with_user_does_not_authenticate():
    raw = signed().replace("%3A+42", "%3A+43")
    assert raw != signed()
    with pytest.raises(AuthError): validate_init_data(raw,100000,TOKEN,now=NOW)


@pytest.mark.parametrize("raw", ["user={}", "auth_date=bad&user=x&hash=x", "=broken", "a="*10000])
def test_malformed_data(raw):
    with pytest.raises(AuthError): validate_init_data(raw,100000,TOKEN,now=NOW)


def test_duplicate_fields_are_rejected():
    with pytest.raises(AuthError): validate_init_data(signed()+"&auth_date=1800000000",100000,TOKEN,now=NOW)


@pytest.mark.parametrize("date", [NOW-901,NOW+31])
def test_expired_or_future_authorization(date):
    with pytest.raises(AuthError): validate_init_data(signed(now=date),100000,TOKEN,now=NOW)


def test_wrong_bot_token_is_rejected():
    with pytest.raises(AuthError): validate_init_data(signed(),100000,"another-token",now=NOW)


def test_ed25519_verification_and_binding_to_bot_id():
    # RFC8032 test seed, not a Telegram or production secret.
    private = Ed25519PrivateKey.from_private_bytes(bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"))
    public = private.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
    fields = {"auth_date":str(NOW),"user":json.dumps({"id":42,"first_name":"Тест"})}
    data = "100000:WebAppData\n"+"\n".join(f"{k}={v}" for k,v in sorted(fields.items()))
    fields["signature"] = base64.urlsafe_b64encode(private.sign(data.encode())).decode().rstrip("=")
    raw = urlencode(fields)
    assert validate_init_data(raw,100000,now=NOW,public_key=public)["telegram_id"] == 42
    with pytest.raises(AuthError): validate_init_data(raw,100001,now=NOW,public_key=public)
    fields["user"] = json.dumps({"id":43,"first_name":"Тест"})
    with pytest.raises(AuthError): validate_init_data(urlencode(fields),100000,now=NOW,public_key=public)


def test_bad_signature_does_not_fall_back_to_hmac():
    with pytest.raises(AuthError): validate_init_data(signed(signature="bad"),100000,TOKEN,now=NOW)


def test_missing_signature_needs_token():
    with pytest.raises(AuthError): validate_init_data(signed(),100000,now=NOW)
