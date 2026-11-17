"""Temporary Docker/HTTPS preview. Uses an explicit project to isolate its data."""

import argparse
import os
import re
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def local_settings():
    values = {}
    for path in (ROOT / ".env.example", ROOT / ".env"):
        if path.exists():
            for line in path.read_text(encoding="utf-8-sig").splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    values[k.strip()] = v.strip().strip('"').strip("'")
    return {**values, **os.environ}


def main():
    parser = argparse.ArgumentParser(description="Временная HTTPS-демка и автопроверка устройств")
    parser.add_argument("action", choices=["start", "status", "url", "bind", "report", "stop"])
    args = parser.parse_args()
    values = local_settings()
    project = values.get("PREVIEW_PROJECT_NAME", "new0-preview")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
        parser.error("PREVIEW_PROJECT_NAME must be a Docker Compose project name")
    if project == values.get("COMPOSE_PROJECT_NAME", "new0-game"):
        parser.error("Preview and main Compose projects must have different names")
    command = [
        "docker",
        "compose",
        "--project-name",
        project,
        "-f",
        str(ROOT / "compose.yaml"),
        "-f",
        str(ROOT / "compose.preview.yaml"),
        "--profile",
        "preview",
    ]

    def run(*parts, capture=False):
        return subprocess.run(
            command + list(parts), cwd=ROOT, env=values, check=True, text=True, capture_output=capture
        )

    if args.action == "start":
        run("up", "-d", "--build", "--wait")
        print("HTTPS-адрес: python scripts/preview.py url")
    elif args.action == "status":
        run("ps")
    elif args.action == "stop":
        run("down")  # Persist the isolated volume and device reports.
    elif args.action == "report":
        run("exec", "-T", "api", "python", "-m", "app.device_report")
    else:
        logs = run("logs", "--no-log-prefix", "tunnel", capture=True)
        urls = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", logs.stdout + logs.stderr)
        if not urls:
            raise SystemExit("Туннель ещё не сообщил HTTPS-адрес. Проверь status и повтори url.")
        url = urls[-1]
        with urllib.request.urlopen(url + "/api/health", timeout=20) as response:
            if response.status != 200:
                raise SystemExit("HTTPS-проверка не прошла")
        if args.action == "url":
            print(url)
        else:
            with urllib.request.urlopen(url, timeout=20) as response:
                html = response.read().decode("utf-8")
            bundle = re.search(r'src="/assets/index-([a-zA-Z0-9_-]+)\.js"', html)
            if not bundle:
                raise SystemExit("Не удалось определить текущую клиентскую сборку")
            launch_url = url + "/?check=1&v=" + bundle.group(1)
            run("exec", "-T", "api", "python", "-m", "app.configure_bot", "--url", launch_url)
            print("Проверенная HTTPS-демка: " + url)
            path = ROOT / ".env"
            if path.exists():
                lines = path.read_text(encoding="utf-8-sig").splitlines()
                lines = [f"PUBLIC_APP_URL={url}" if line.startswith("PUBLIC_APP_URL=") else line for line in lines]
                if not any(line.startswith("PUBLIC_APP_URL=") for line in lines):
                    lines.append(f"PUBLIC_APP_URL={url}")
                path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
