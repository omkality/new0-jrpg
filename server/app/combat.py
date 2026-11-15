"""Authoritative prototype rules. A rules change requires a new leaderboard version."""
RULESET = "archive-001"
MAX_HP = 24
ENEMY_HP = 32
INTENTS = ("strike", "heavy", "recover", "strike", "heavy", "recover")
SECRETS = {
    "inscription": {
        "title": "Надпись без имени", "text": "До первого шага. После последнего. Какое число остаётся?",
        "options": [{"id": "zero", "text": "Ноль"}, {"id": "one", "text": "Один"}, {"id": "three", "text": "Три"}],
        "answer": "zero", "points": 120,
    },
    "echo": {
        "title": "Тихое эхо", "text": "Страж замолчал. Прислушайся: что связывает этот зал с выходом?",
        "options": [{"id": "gold", "text": "Золото"}, {"id": "signal", "text": "Сигнал"}, {"id": "dust", "text": "Пыль"}],
        "answer": "signal", "points": 120,
    },
}


class RuleError(ValueError):
    pass


def initial_state():
    return {"phase": "explore", "hp": MAX_HP, "enemy_hp": ENEMY_HP, "charge": 0,
            "turn": 0, "guards": 0, "damage_taken": 0, "secrets": [],
            "battle_score": 0, "log": "Найди стража у северной арки."}


def intent(state):
    return INTENTS[state["turn"] % len(INTENTS)]


def total_score(state):
    return state["battle_score"] + sum(SECRETS[s]["points"] for s in state["secrets"])


def public_state(state):
    return {**state, "intent": intent(state), "max_hp": MAX_HP,
            "enemy_max_hp": ENEMY_HP, "score": total_score(state),
            "secret_total": len(SECRETS)}


def act(state, action):
    s = {**state, "secrets": list(state["secrets"])}
    if action == "engage":
        if s["phase"] != "explore":
            raise RuleError("Сражение уже началось")
        s["phase"] = "combat"
        s["log"] = "Страж преградил путь. Следи за его намерением."
        return s
    if s["phase"] != "combat":
        raise RuleError("Сейчас нельзя выполнить боевое действие")
    if action == "pulse" and s["charge"] < 2:
        raise RuleError("Для импульса нужны два заряда")
    damage = 4 if action == "attack" else 12 if action == "pulse" else 0
    s["enemy_hp"] = max(0, s["enemy_hp"] - damage)
    s["charge"] = s["charge"] - 2 if action == "pulse" else min(2, s["charge"] + 1)
    if s["enemy_hp"] == 0:
        s["turn"] += 1
        s["phase"] = "won"
        s["battle_score"] = max(0, 1000 + s["hp"] * 25 + s["guards"] * 40 - s["turn"] * 30)
        s["log"] = "Страж рассыпался в пыль. Арка открыта."
        return s
    enemy_intent = intent(s)
    incoming = 9 if enemy_intent == "heavy" else 4 if enemy_intent == "strike" else 0
    if action == "guard":
        if enemy_intent == "heavy":
            s["guards"] += 1
        incoming = 2 if incoming == 9 else 1 if incoming else 0
    s["hp"] = max(0, s["hp"] - incoming)
    s["damage_taken"] += incoming
    s["turn"] += 1
    if s["hp"] == 0:
        s["phase"] = "lost"
        s["log"] = "Сигнал погас. Можно попробовать снова."
    elif enemy_intent == "recover":
        s["log"] = "Страж восстанавливается. Ты перехватываешь инициативу."
    elif action == "guard":
        s["log"] = f"Ты выдержал удар. Потеряно {incoming} здоровья."
    else:
        s["log"] = f"Твой урон: {damage}. Ответ стража: {incoming}."
    return s


def secret_prompt(state, secret_id):
    if secret_id not in SECRETS:
        raise RuleError("Здесь ничего нет")
    if secret_id == "echo" and state["phase"] != "won":
        raise RuleError("Голос стража заглушает эхо. Вернись после боя")
    return {k: v for k, v in SECRETS[secret_id].items() if k != "answer"}


def solve(state, secret_id, answer):
    secret_prompt(state, secret_id)
    if secret_id in state["secrets"]:
        raise RuleError("Этот знак уже найден")
    if answer != SECRETS[secret_id]["answer"]:
        raise RuleError("Надпись остаётся тёмной. Попробуй другой ответ")
    s = {**state, "secrets": [*state["secrets"], secret_id]}
    s["log"] = "Знакомый мотив. Ты восстановил фрагмент сигнала."
    return s
