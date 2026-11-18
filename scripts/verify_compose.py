"""Exercise non-default internal ports and legacy HTTP smoke in a disposable project."""

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from uuid import uuid4

from preview import ROOT, local_settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-port", default="18001")
    parser.add_argument("--web-port", default="18080")
    args = parser.parse_args()
    for port in (args.api_port, args.web_port):
        if not port.isdigit() or not 1024 <= int(port) <= 65535:
            parser.error("Test container ports must be numbers in 1024..65535")
    project = "new0-configcheck-" + uuid4().hex[:10]
    values = {
        **local_settings(),
        "API_PORT": args.api_port,
        "WEB_PORT": args.web_port,
        "WEB_PUBLISH_PORT": "0",
        "SMOKE_PUBLISH_PORT": "0",
        "BIND_ADDRESS": "127.0.0.1",
        "TELEGRAM_BOT_TOKEN": "",
        "TELEGRAM_BOT_ID": "0",
        "MIN_ACTION_INTERVAL_SECONDS": "0.2",
    }
    command = [
        "docker",
        "compose",
        "--project-name",
        project,
        "-f",
        str(ROOT / "compose.yaml"),
        "-f",
        str(ROOT / "tests/compose.smoke.yaml"),
    ]

    def run(*parts, capture=False):
        return subprocess.run(
            command + list(parts), cwd=ROOT, env=values, check=True, capture_output=capture, text=True
        )

    try:
        run("up", "-d", "--no-build", "--wait")
        binding = run("port", "web", args.web_port, capture=True).stdout.strip()
        base = "http://" + binding
        with urllib.request.urlopen(base + "/api/health", timeout=10) as response:
            assert json.load(response)["ok"] is True
        with urllib.request.urlopen(base + "/", timeout=10) as response:
            assert "<html" in response.read().decode()
        for path, cache_control, status in [
            ("/", "no-cache", 200),
            ("/api/health", "no-store", 200),
            ("/api/me", "no-store", 401),
            ("/assets/knight/knight.glb", "max-age=86400", 200),
        ]:
            try:
                result = urllib.request.urlopen(base + path, timeout=10)
            except urllib.error.HTTPError as exc:
                result = exc
            with result:
                assert result.status == status, path
                assert result.headers["X-Content-Type-Options"] == "nosniff", path
                assert result.headers["Referrer-Policy"] == "strict-origin-when-cross-origin", path
                assert result.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()", path
                assert result.headers["Cache-Control"] == cache_control, path
        for service in ["api", "web"]:
            container = run("ps", "-q", service, capture=True).stdout.strip()
            health = subprocess.check_output(
                ["docker", "inspect", "--format", "{{json .Config.Healthcheck.Test}}", container], text=True
            )
            assert "wget" in health and "python" not in health.lower(), health
        subprocess.run([sys.executable, str(ROOT / "scripts/smoke_api.py"), "--base", base], cwd=ROOT, check=True)
        print(
            f"Configured-port verification passed: API={args.api_port}, web={args.web_port}, ephemeral host port, wget healthchecks"
        )
    finally:
        # The name is generated here and cannot refer to either persisted game project.
        assert project.startswith("new0-configcheck-") and len(project) == 27
        run("down", "-v")


if __name__ == "__main__":
    main()
