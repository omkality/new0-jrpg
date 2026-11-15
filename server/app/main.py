import hashlib
import json
import secrets
import time
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import combat
from .auth import AuthError, validate_init_data
from .config import Settings
from .db import Database, encode


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Login(Body):
    init_data: str = Field(min_length=1, max_length=16384)


class Command(Body):
    request_id: str = Field(min_length=36, max_length=36)
    expected_revision: int = Field(ge=0, le=10000)


class Action(Command):
    action: Literal["engage", "attack", "guard", "pulse"]


class SecretAnswer(Command):
    answer: str = Field(min_length=1, max_length=32)


class StageMetrics(Body):
    location: Literal["chapel", "roofs", "courtyard"]
    seconds: float = Field(ge=0, le=180, allow_inf_nan=False)
    frames: int = Field(ge=0, le=100000)
    fps: float = Field(ge=0, le=1000, allow_inf_nan=False)
    p95_ms: float = Field(ge=0, le=180000, allow_inf_nan=False)
    over_25_ms: int = Field(ge=0, le=100000)
    over_50_ms: int = Field(ge=0, le=100000)
    completed: bool
    render_scale: float = Field(ge=0.1, le=1, allow_inf_nan=False)


class DeviceReport(Body):
    protocol: Literal["device-check-1"]
    platform: str = Field(min_length=1, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    telegram_version: str = Field(max_length=24, pattern=r"^[a-zA-Z0-9_.-]*$")
    viewport_width: int = Field(ge=100, le=10000)
    viewport_height: int = Field(ge=100, le=10000)
    touch_points: int = Field(ge=0, le=100)
    controls_fit: bool
    errors: int = Field(ge=0, le=100000)
    context_losses: int = Field(ge=0, le=100000)
    interrupted: bool
    stages: list[StageMetrics] = Field(min_length=1, max_length=3)


def create_app(settings=None):
    settings = settings or Settings()
    settings.validate()
    db = Database(settings)

    @asynccontextmanager
    async def lifespan(app):
        db.initialize()
        yield

    app = FastAPI(title="new0 archive", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.db = db

    def current_user(authorization: Annotated[str | None, Header()] = None):
        if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 160:
            raise HTTPException(401, "Открой игру заново")
        digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
        with db.connect() as c:
            row = c.execute("""SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                               WHERE s.token_hash=? AND s.expires_at>?""", (digest, time.time())).fetchone()
        if not row:
            raise HTTPException(401, "Сессия закончилась. Открой игру заново")
        return dict(row)

    def identity(user):
        return {"name": user["display_name"], "is_guest": bool(user["is_guest"])}

    def session(c, user):
        now = time.time()
        c.execute("DELETE FROM sessions WHERE expires_at<?", (now,))
        token = secrets.token_urlsafe(32)
        c.execute("INSERT INTO sessions VALUES(?,?,?)", (
            hashlib.sha256(token.encode()).hexdigest(), user["id"], now + settings.session_ttl))
        return {"token": token, "user": identity(user)}

    def owned_run(c, run_id, user):
        row = c.execute("SELECT * FROM runs WHERE id=? AND user_id=?", (run_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "Прохождение не найдено")
        return dict(row)

    def view(row):
        return {"id": row["id"], "version": row["version"], "revision": row["revision"],
                "status": row["status"], "state": combat.public_state(json.loads(row["state"]))}

    def mutate(run_id, user, command, payload, transform):
        try:
            UUID(command.request_id)
        except ValueError:
            raise HTTPException(422, "Неверный идентификатор действия")
        with db.connect(write=True) as c:
            row = owned_run(c, run_id, user)
            fingerprint = encode({"payload": payload, "revision": command.expected_revision})
            previous = c.execute("SELECT * FROM commands WHERE run_id=? AND request_id=?",
                                 (run_id, command.request_id)).fetchone()
            if previous:
                if previous["payload"] != fingerprint:
                    raise HTTPException(409, "Это действие уже использовано")
                return json.loads(previous["response"])
            if row["version"] != settings.version:
                raise HTTPException(409, "Версия архива обновилась. Начни новое прохождение")
            if row["status"] != "active":
                raise HTTPException(409, "Это прохождение уже завершено")
            if time.time() - row["created_at"] > settings.run_ttl:
                raise HTTPException(409, "Прохождение устарело. Начни заново")
            if row["revision"] != command.expected_revision:
                raise HTTPException(409, "Состояние изменилось. Повтори действие")
            if time.time() - row["updated_at"] < settings.min_action_interval:
                raise HTTPException(429, "Слишком быстро. Подожди мгновение")
            try:
                state = transform(json.loads(row["state"]))
            except combat.RuleError as exc:
                raise HTTPException(400, str(exc))
            row.update(state=encode(state), revision=row["revision"] + 1, updated_at=time.time())
            c.execute("UPDATE runs SET state=?,revision=?,updated_at=? WHERE id=?",
                      (row["state"], row["revision"], row["updated_at"], run_id))
            result = view(row)
            c.execute("INSERT INTO commands VALUES(?,?,?,?)", (run_id, command.request_id, fingerprint, encode(result)))
            return result

    @app.get("/api/health")
    def health():
        with db.connect() as c:
            c.execute("SELECT 1").fetchone()
        return {"ok": True}

    @app.get("/api/config")
    def config():
        return {"version": settings.version, "title": settings.title, "allow_guest": settings.allow_guest,
                "bot_username": settings.bot_username, "shop_url": settings.shop_url, "drop_url": settings.drop_url,
                "request_timeout_ms": settings.client_timeout_ms, "bootstrap_attempts": settings.client_bootstrap_attempts,
                "competition_open": settings.competition_open, "attempt_limit": settings.attempt_limit,
                "ruleset": combat.RULESET, "rules": {"victory": 1000, "hp": 25, "heavy_guard": 40,
                "turn_cost": 30, "secret": 120, "tie": "shared_place"}}

    @app.post("/api/auth/telegram")
    def telegram_login(body: Login):
        try:
            profile = validate_init_data(body.init_data, settings.bot_id, settings.bot_token,
                                         max_age=settings.auth_max_age)
        except AuthError as exc:
            raise HTTPException(401, str(exc))
        with db.connect(write=True) as c:
            c.execute("""INSERT INTO users(telegram_id,display_name,is_guest) VALUES(?,?,0)
                         ON CONFLICT(telegram_id) DO UPDATE SET display_name=excluded.display_name""",
                      (profile["telegram_id"], profile["display_name"]))
            user = c.execute("SELECT * FROM users WHERE telegram_id=?", (profile["telegram_id"],)).fetchone()
            return session(c, dict(user))

    @app.post("/api/diagnostics")
    def diagnostic_report(body: DeviceReport, user=Depends(current_user)):
        if settings.competition_open:
            raise HTTPException(403, "Автопроверка доступна в демонстрационном режиме")
        now = time.time()
        report_id = str(uuid4())
        with db.connect(write=True) as c:
            c.execute("DELETE FROM device_reports WHERE created_at<?", (now - settings.diagnostic_ttl,))
            recent = c.execute("SELECT created_at FROM device_reports WHERE user_id=? ORDER BY created_at DESC LIMIT 1", (user["id"],)).fetchone()
            if recent and now - recent["created_at"] < 10:
                raise HTTPException(429, "Подожди немного перед повторной проверкой")
            c.execute("INSERT INTO device_reports VALUES(?,?,?,?)", (report_id, user["id"], now, encode(body.model_dump())))
            c.execute("DELETE FROM device_reports WHERE user_id=? AND id NOT IN (SELECT id FROM device_reports WHERE user_id=? ORDER BY created_at DESC LIMIT 5)", (user["id"], user["id"]))
        return {"id": report_id}

    @app.get("/api/diagnostics/{report_id}")
    def diagnostic_view(report_id: str, user=Depends(current_user)):
        with db.connect() as c:
            row = c.execute("SELECT report FROM device_reports WHERE id=? AND user_id=? AND created_at>?", (report_id, user["id"], time.time() - settings.diagnostic_ttl)).fetchone()
        if not row:
            raise HTTPException(404, "Отчёт не найден")
        return json.loads(row["report"])

    @app.post("/api/auth/guest")
    def guest_login():
        if not settings.allow_guest:
            raise HTTPException(403, "Открой игру через Telegram")
        with db.connect(write=True) as c:
            cursor = c.execute("INSERT INTO users(display_name,is_guest) VALUES('Путник',1)")
            user_id = cursor.lastrowid
            name = f"Путник {user_id:03d}"
            c.execute("UPDATE users SET display_name=? WHERE id=?", (name, user_id))
            return session(c, {"id": user_id, "display_name": name, "is_guest": 1})

    @app.get("/api/me")
    def me(user=Depends(current_user)):
        return identity(user)

    @app.post("/api/runs")
    def start_run(body: Body, user=Depends(current_user)):
        now = time.time()
        with db.connect(write=True) as c:
            completed = c.execute("SELECT COUNT(*) FROM runs WHERE user_id=? AND version=? AND status='finished'",
                                  (user["id"], settings.version)).fetchone()[0]
            if settings.attempt_limit and completed >= settings.attempt_limit:
                raise HTTPException(403, "Зачётные попытки в этой версии закончились")
            recent = c.execute("SELECT COUNT(*) FROM runs WHERE user_id=? AND created_at>?",
                               (user["id"], now - 3600)).fetchone()[0]
            if recent >= 60:
                raise HTTPException(429, "Слишком много новых прохождений. Попробуй позже")
            c.execute("UPDATE runs SET status='abandoned' WHERE user_id=? AND status='active'", (user["id"],))
            run_id = str(uuid4())
            c.execute("INSERT INTO runs(id,user_id,version,state,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                      (run_id, user["id"], settings.version, encode(combat.initial_state()), now, now - 1))
            return view(owned_run(c, run_id, user))

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str, user=Depends(current_user)):
        with db.connect() as c:
            return view(owned_run(c, run_id, user))

    @app.post("/api/runs/{run_id}/actions")
    def action(run_id: str, body: Action, user=Depends(current_user)):
        return mutate(run_id, user, body, {"action": body.action}, lambda s: combat.act(s, body.action))

    @app.get("/api/runs/{run_id}/secrets/{secret_id}")
    def get_secret(run_id: str, secret_id: str, user=Depends(current_user)):
        with db.connect() as c:
            row = owned_run(c, run_id, user)
        try:
            return combat.secret_prompt(json.loads(row["state"]), secret_id)
        except combat.RuleError as exc:
            raise HTTPException(400, str(exc))

    @app.post("/api/runs/{run_id}/secrets/{secret_id}")
    def answer_secret(run_id: str, secret_id: str, body: SecretAnswer, user=Depends(current_user)):
        return mutate(run_id, user, body, {"secret": secret_id, "answer": body.answer},
                      lambda s: combat.solve(s, secret_id, body.answer))

    @app.post("/api/runs/{run_id}/finish")
    def finish(run_id: str, body: Body, user=Depends(current_user)):
        with db.connect(write=True) as c:
            row = owned_run(c, run_id, user)
            if row["status"] == "finished":
                return view(row)
            if row["version"] != settings.version or row["status"] != "active":
                raise HTTPException(409, "Это прохождение больше не активно")
            if time.time() - row["created_at"] > settings.run_ttl:
                raise HTTPException(409, "Прохождение устарело")
            state = json.loads(row["state"])
            if state["phase"] != "won":
                raise HTTPException(400, "Сначала одолей стража")
            score = combat.total_score(state)
            c.execute("UPDATE runs SET status='finished',score=?,finished_at=? WHERE id=?",
                      (score, time.time(), run_id))
            return view(owned_run(c, run_id, user))

    @app.get("/api/versions")
    def versions(user=Depends(current_user)):
        with db.connect() as c:
            rows = c.execute("SELECT version,title,prize FROM versions ORDER BY created_at DESC,version DESC").fetchall()
        return [{**dict(r), "current": r["version"] == settings.version} for r in rows]

    @app.get("/api/leaderboard")
    def leaderboard(version: str | None = None, user=Depends(current_user)):
        version = version or settings.version
        with db.connect() as c:
            info = c.execute("SELECT * FROM versions WHERE version=?", (version,)).fetchone()
            if not info:
                raise HTTPException(404, "Версия не найдена")
            entries = db.leaderboard(c, version, user["is_guest"], user["id"])
        return {"version": version, "title": info["title"], "prize": bool(info["prize"]),
                "is_guest_board": bool(user["is_guest"]), "entries": entries,
                "tie_rule": "При равных очках место общее. Правило выдачи приза ещё не установлено."}

    return app


app = create_app()
