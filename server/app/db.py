import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .combat import RULESET


class Database:
    def __init__(self, settings):
        self.settings = settings
        Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self, write=False):
        connection = sqlite3.connect(self.settings.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        with self.connect() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY, telegram_id INTEGER UNIQUE,
                    display_name TEXT NOT NULL, is_guest INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
                    expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS versions (
                    version TEXT PRIMARY KEY, title TEXT NOT NULL, ruleset TEXT NOT NULL,
                    prize INTEGER NOT NULL, attempt_limit INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
                    version TEXT NOT NULL REFERENCES versions(version),
                    state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active', score INTEGER,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL, finished_at REAL
                );
                CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, version, status);
                CREATE INDEX IF NOT EXISTS runs_board ON runs(version, status, score DESC);
                CREATE TABLE IF NOT EXISTS commands (
                    run_id TEXT NOT NULL REFERENCES runs(id), request_id TEXT NOT NULL,
                    payload TEXT NOT NULL, response TEXT NOT NULL,
                    PRIMARY KEY(run_id, request_id)
                );
            """)
        s = self.settings
        with self.connect(write=True) as c:
            existing = c.execute("SELECT * FROM versions WHERE version=?", (s.version,)).fetchone()
            if existing and (existing["ruleset"], existing["prize"], existing["attempt_limit"]) != (
                RULESET, int(s.competition_open), s.attempt_limit
            ):
                raise RuntimeError("Rules changed: choose a new LEADERBOARD_VERSION")
            c.execute("INSERT OR IGNORE INTO versions(version,title,ruleset,prize,attempt_limit) VALUES(?,?,?,?,?)",
                      (s.version, s.title, RULESET, int(s.competition_open), s.attempt_limit))

    @staticmethod
    def leaderboard(c, version, guest, user_id):
        rows = c.execute("""
            WITH best AS (
                SELECT r.*, u.display_name,
                       ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.score DESC, r.finished_at, r.id) AS best_n
                FROM runs r JOIN users u ON r.user_id=u.id
                WHERE r.version=? AND r.status='finished' AND u.is_guest=?
            ), places AS (
                SELECT user_id, display_name, score, finished_at,
                       RANK() OVER (ORDER BY score DESC) AS place
                FROM best WHERE best_n=1
            ) SELECT * FROM places ORDER BY score DESC, finished_at, user_id LIMIT 50
        """, (version, int(guest))).fetchall()
        entries = [{"rank": r["place"], "name": r["display_name"], "score": r["score"],
                    "is_me": r["user_id"] == user_id} for r in rows]
        return entries


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
