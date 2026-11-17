"""Read local demo diagnostics without exposing Telegram identities or sessions."""

import argparse
import json
import time

from .config import Settings
from .db import Database


def main():
    parser = argparse.ArgumentParser(description="Показать локальный отчёт автопроверки")
    parser.add_argument("--id", help="Идентификатор отчёта. Без него выбирается последний")
    args = parser.parse_args()
    settings = Settings()
    with Database(settings).connect() as c:
        query = "SELECT id, created_at, report FROM device_reports WHERE created_at>?"
        params = [time.time() - settings.diagnostic_ttl]
        if args.id:
            query += " AND id=?"
            params.append(args.id)
        row = c.execute(query + " ORDER BY created_at DESC LIMIT 1", params).fetchone()
    if not row:
        print("Свежих отчётов пока нет")
        return
    print(
        json.dumps(
            {"id": row["id"], "created_at": row["created_at"], **json.loads(row["report"])},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
