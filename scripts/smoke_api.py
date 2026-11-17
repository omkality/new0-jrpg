"""Run against an isolated local Compose project, never a prize/player database."""

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="Loopback URL of the isolated smoke Compose project")
    args = parser.parse_args()
    base = urllib.parse.urlparse(args.base)
    if (
        base.scheme != "http"
        or base.hostname not in {"localhost", "127.0.0.1", "::1"}
        or base.username
        or base.password
        or base.path not in {"", "/"}
        or base.query
        or base.fragment
    ):
        parser.error("Smoke test is limited to an isolated loopback HTTP URL")
    args.base = args.base.rstrip("/")
    token = ""

    def call(path, body=None, expected=200):
        request = urllib.request.Request(
            args.base + "/api" + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                status = response.status
                result = json.load(response)
        except urllib.error.HTTPError as error:
            status = error.code
            result = json.load(error)
        assert status == expected, (path, status, result)
        return result

    assert call("/config")["version"] == "smoke-001", "Refusing to test a non-smoke database"
    call("/auth/telegram", {"init_data": 'user={"id":123}'}, 401)
    token = call("/auth/guest", {})["token"]
    run = call("/runs", {})
    call(f"/runs/{run['id']}/finish", {}, 400)

    def command(path, fields):
        nonlocal run
        time.sleep(0.3)
        run = call(path, {**fields, "expected_revision": run["revision"], "request_id": str(uuid4())})

    root = f"/runs/{run['id']}"
    command(root + "/secrets/inscription", {"answer": "zero"})
    for action in ["engage", "attack", "guard", "pulse", "attack", "guard", "pulse"]:
        command(root + "/actions", {"action": action})
    command(root + "/secrets/echo", {"answer": "signal"})
    call(root + "/finish", {"score": 999999}, 422)
    result = call(root + "/finish", {})
    assert result["state"]["score"] == 1440 and result["status"] == "finished"
    board = call("/leaderboard")
    assert board["is_guest_board"] and board["entries"][0]["score"] == 1440
    assert len(call("/versions")) == 1
    print(
        "Isolated HTTP smoke passed: guest auth, rejected Telegram forgery, two secrets, full fight, finish, versioned board, score=1440"
    )


if __name__ == "__main__":
    main()
