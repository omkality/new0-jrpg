"""Keep technology badges in sync with actual pinned project dependencies."""
import argparse
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]


def badges():
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    requirements = (ROOT / 'server/requirements.txt').read_text()
    fastapi = re.search(r'^fastapi==([^\s]+)', requirements, re.M).group(1)
    python = re.search(r'FROM python:([0-9]+\.[0-9]+)', (ROOT / 'server/Dockerfile').read_text()).group(1)
    remote = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=ROOT, text=True).strip()
    match = re.search(r'github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$', remote)
    if not match:
        raise SystemExit('GitHub origin is required for the real Actions status badge')
    repo = match.group(1)
    base = 'https://github.com/' + repo
    lines = [f'[![Проверки]({base}/actions/workflows/checks.yml/badge.svg?branch=dev)]({base}/actions/workflows/checks.yml)']
    technologies = [
        ('TypeScript', package['devDependencies']['typescript'], '3178C6', 'typescript', 'https://www.typescriptlang.org/'),
        ('Three.js', package['dependencies']['three'], '5F7467', 'threedotjs', 'https://threejs.org/'),
        ('Vite', package['devDependencies']['vite'], '646CFF', 'vite', 'https://vite.dev/'),
        ('Python', python, '3776AB', 'python', 'https://www.python.org/'),
        ('FastAPI', fastapi, '009688', 'fastapi', 'https://fastapi.tiangolo.com/'),
        ('Docker', 'Compose', '2496ED', 'docker', 'https://docs.docker.com/compose/'),
        ('Telegram', 'Mini App', '26A5E4', 'telegram', 'https://core.telegram.org/bots/webapps'),
    ]
    for label, version, color, logo, url in technologies:
        image = f'https://img.shields.io/badge/{quote(label)}-{quote(version)}-{color}?logo={logo}&logoColor=white'
        lines.append(f'[![{label} {version}]({image})]({url})')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'README.md'
    text = path.read_text(encoding='utf-8')
    pattern = r'<!-- technologies:start -->.*?<!-- technologies:end -->'
    block = '<!-- technologies:start -->\n' + badges() + '\n<!-- technologies:end -->'
    updated, count = re.subn(pattern, lambda _: block, text, flags=re.S)
    if count != 1:
        raise SystemExit('Exactly one technologies block is required')
    if args.check:
        if text != updated:
            raise SystemExit('Technology badges are stale. Run python scripts/update_badges.py')
        print('Technology badges match project files')
    else:
        path.write_text(updated, encoding='utf-8')
        print('Technology badges updated from project files')


if __name__ == '__main__':
    main()
