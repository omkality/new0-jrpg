import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from test_auth import TOKEN, signed


@pytest.fixture
def settings(tmp_path):
    return Settings(database_path=str(tmp_path/"test.sqlite3"),bot_id=100000,bot_token=TOKEN,
                    version="test-001",allow_guest=True,competition_open=False,min_action_interval=0)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c: yield c


def login(c,user_id=42):
    r=c.post("/api/auth/telegram",json={"init_data":signed(user_id,now=int(time.time()))})
    assert r.status_code==200,r.text
    return {"Authorization":"Bearer "+r.json()["token"]}


def device_payload():
    return {"protocol":"device-check-1", "platform":"ios", "telegram_version":"9.2",
            "viewport_width":390, "viewport_height":844, "touch_points":5,
            "controls_fit":True, "errors":0, "context_losses":0, "interrupted":False,
            "stages":[{"location":"chapel", "seconds":14.0, "frames":840, "fps":60.0,
                       "p95_ms":16.7, "over_25_ms":0, "over_50_ms":0, "completed":True, "render_scale":1.0}]}


def test_device_reports_require_identity_and_are_owner_only(client):
    assert client.post('/api/diagnostics',json=device_payload()).status_code==401
    h=login(client)
    result=client.post('/api/diagnostics',headers=h,json=device_payload())
    assert result.status_code==200
    report_id=result.json()['id']
    assert client.get('/api/diagnostics/'+report_id,headers=h).json()==device_payload()
    assert client.get('/api/diagnostics/'+report_id,headers=login(client,43)).status_code==404
    assert client.post('/api/diagnostics',headers=h,json=device_payload()).status_code==429
    with client.app.state.db.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM runs').fetchone()[0]==0


def test_device_reports_reject_unbounded_fields_and_expire(client,settings):
    h=login(client)
    bad={**device_payload(), 'score':999999}
    assert client.post('/api/diagnostics',headers=h,json=bad).status_code==422
    bad={**device_payload(), 'platform':'x'*100}
    assert client.post('/api/diagnostics',headers=h,json=bad).status_code==422
    r=client.post('/api/diagnostics',headers=h,json=device_payload())
    report_id=r.json()['id']
    with client.app.state.db.connect(write=True) as c:
        c.execute('UPDATE device_reports SET created_at=?',(time.time()-settings.diagnostic_ttl-1,))
    assert client.get('/api/diagnostics/'+report_id,headers=h).status_code==404


def test_links_and_bot_are_runtime_configuration(client,settings):
    with TestClient(create_app(replace(settings,shop_url='https://example.org/shop',drop_url='https://example.org/drop',bot_username='other_bot'))) as c:
        config=c.get('/api/config').json()
        assert config['shop_url']=='https://example.org/shop'
        assert config['drop_url']=='https://example.org/drop'
        assert config['bot_username']=='other_bot'


def new_run(c,headers):
    r=c.post("/api/runs",json={},headers=headers)
    assert r.status_code==200,r.text
    return r.json()


def action(c,h,run,kind,**extras):
    body={"action":kind,"expected_revision":run["revision"],"request_id":str(uuid4()),**extras}
    return c.post(f'/api/runs/{run["id"]}/actions',json=body,headers=h)


def solve(c,h,run,secret,answer):
    r=c.post(f'/api/runs/{run["id"]}/secrets/{secret}',headers=h,json={"answer":answer,"expected_revision":run["revision"],"request_id":str(uuid4())})
    assert r.status_code==200,r.text
    return r.json()


def win(c,h,run):
    for kind in ("engage","attack","guard","pulse","attack","guard","pulse"):
        r=action(c,h,run,kind)
        assert r.status_code==200,r.text
        run=r.json()
    assert run["state"]["phase"]=="won"
    return run


def finish(c,h,run):
    return c.post(f'/api/runs/{run["id"]}/finish',headers=h,json={})


def test_identity_is_derived_from_verified_telegram_data(client):
    h=login(client)
    assert client.get('/api/me',headers=h).json()=={"name":"Путник","is_guest":False}
    assert client.post('/api/auth/telegram',json={"init_data":"user={\"id\":42}"}).status_code==401
    assert client.get('/api/me').status_code==401


def test_forbidden_fields_and_forged_scores_are_rejected(client):
    h=login(client); run=new_run(client,h)
    assert action(client,h,run,'attack',score=999999).status_code==422
    assert client.post(f'/api/runs/{run["id"]}/finish',headers=h,json={"score":999999}).status_code==422
    assert finish(client,h,run).status_code==400
    assert action(client,h,run,'pulse').status_code==400
    assert client.get(f'/api/runs/{run["id"]}',headers=h).json()['state']['score']==0


def test_other_account_cannot_read_play_or_finish_run(client):
    h=login(client,42); other=login(client,43); run=new_run(client,h)
    assert client.get(f'/api/runs/{run["id"]}',headers=other).status_code==404
    assert action(client,other,run,'engage').status_code==404
    assert finish(client,other,run).status_code==404


def test_retries_are_idempotent_and_stale_turns_are_rejected(client):
    h=login(client); run=new_run(client,h)
    body={"action":"engage","expected_revision":0,"request_id":str(uuid4())}
    endpoint=f'/api/runs/{run["id"]}/actions'
    first=client.post(endpoint,headers=h,json=body)
    assert first.status_code==200
    assert client.post(endpoint,headers=h,json=body).json()==first.json()
    assert action(client,h,run,'attack').status_code==409
    body['action']='attack'
    assert client.post(endpoint,headers=h,json=body).status_code==409


def test_two_parallel_actions_cannot_spend_same_turn(client):
    h=login(client); run=new_run(client,h)
    run=action(client,h,run,'engage').json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:action(client,h,run,'attack').status_code,range(2)))
    assert sorted(results)==[200,409]


def test_cannot_use_unearned_ability(client):
    h=login(client); run=action(client,h,new_run(client,h),'engage').json()
    assert action(client,h,run,'pulse').status_code==400
    state=client.get(f'/api/runs/{run["id"]}',headers=h).json()['state']
    assert state['enemy_hp']==32 and state['hp']==24


def test_secret_answers_are_checked_and_awarded_once(client):
    h=login(client); run=new_run(client,h)
    path=f'/api/runs/{run["id"]}/secrets/inscription'
    assert 'answer' not in client.get(path,headers=h).json()
    assert client.post(path,headers=h,json={"answer":"wrong","expected_revision":0,"request_id":str(uuid4())}).status_code==400
    assert client.get(f'/api/runs/{run["id"]}/secrets/echo',headers=h).status_code==400
    run=solve(client,h,run,'inscription','zero')
    assert run['state']['score']==120
    assert client.post(path,headers=h,json={"answer":"zero","expected_revision":run['revision'],"request_id":str(uuid4())}).status_code==400


def test_whole_run_score_and_best_per_account(client):
    h=login(client); run=new_run(client,h)
    run=solve(client,h,run,'inscription','zero')
    run=win(client,h,run)
    run=solve(client,h,run,'echo','signal')
    result=finish(client,h,run)
    assert result.status_code==200
    assert result.json()['state']['score']==1440
    assert finish(client,h,run).json()==result.json()
    assert action(client,h,result.json(),'attack').status_code==409
    second=win(client,h,new_run(client,h))
    assert finish(client,h,second).status_code==200
    entries=client.get('/api/leaderboard',headers=h).json()['entries']
    assert len(entries)==1 and entries[0]['score']==1440 and entries[0]['is_me']


def test_ties_share_place_and_never_expose_telegram_id(client):
    for account in (42,43):
        h=login(client,account)
        assert finish(client,h,win(client,h,new_run(client,h))).status_code==200
    board=client.get('/api/leaderboard',headers=h).json()
    assert [e['rank'] for e in board['entries']]==[1,1]
    assert all('telegram_id' not in e and 'user_id' not in e for e in board['entries'])


def test_guest_board_cannot_pollute_telegram_board(client):
    guest=client.post('/api/auth/guest').json()
    gh={"Authorization":"Bearer "+guest['token']}
    finish(client,gh,win(client,gh,new_run(client,gh)))
    assert len(client.get('/api/leaderboard',headers=gh).json()['entries'])==1
    real=login(client)
    assert client.get('/api/leaderboard',headers=real).json()['entries']==[]


def test_new_run_invalidates_previous_one(client):
    h=login(client); previous=new_run(client,h); new_run(client,h)
    assert action(client,h,previous,'engage').status_code==409


def test_closed_guest_mode_and_competition_guard(settings):
    with TestClient(create_app(replace(settings,allow_guest=False))) as c:
        assert c.post('/api/auth/guest').status_code==403
    with pytest.raises(RuntimeError,match='ALLOW_GUEST'):
        create_app(replace(settings,competition_open=True))


def test_leaderboard_versions_are_isolated(settings):
    with TestClient(create_app(settings)) as first:
        h=login(first); finish(first,h,win(first,h,new_run(first,h)))
    with TestClient(create_app(replace(settings,version='test-002'))) as second:
        h=login(second)
        assert second.get('/api/leaderboard',headers=h).json()['entries']==[]
        assert len(second.get('/api/leaderboard?version=test-001',headers=h).json()['entries'])==1
        assert len(second.get('/api/versions',headers=h).json())==2


def test_rules_change_requires_new_version(settings):
    with TestClient(create_app(settings)): pass
    with pytest.raises(RuntimeError,match='Rules changed'):
        with TestClient(create_app(replace(settings,attempt_limit=3))): pass


def test_configured_attempt_limit(settings):
    with TestClient(create_app(replace(settings,attempt_limit=1))) as c:
        h=login(c); finish(c,h,win(c,h,new_run(c,h)))
        assert c.post('/api/runs',headers=h,json={}).status_code==403


def test_expired_sessions_are_rejected(client):
    h=login(client)
    with client.app.state.db.connect(write=True) as c: c.execute('UPDATE sessions SET expires_at=0')
    assert client.get('/api/me',headers=h).status_code==401


def test_continuous_device_report_accepts_bounded_nullable_resources(client):
    h = login(client)
    body = device_payload()
    body["protocol"] = "device-check-2"
    resources = {"geometries": 140, "textures": 60, "programs": 18, "models": 13, "js_heap_mb": None}
    body["stages"] = [{**body["stages"][0], "location": area, "resources": resources}
                      for area in ["forest", "roofs", "chapel", "crypt"]]
    bad = {**body, "stages": body["stages"] + body["stages"][:1]}
    assert client.post("/api/diagnostics", headers=h, json=bad).status_code == 422
    bad = {**body, "stages": [{**body["stages"][0], "resources": {**resources, "textures": 10001}}]}
    assert client.post("/api/diagnostics", headers=h, json=bad).status_code == 422
    response = client.post("/api/diagnostics", headers=h, json=body)
    assert response.status_code == 200
    assert client.get("/api/diagnostics/" + response.json()["id"], headers=h).json() == body
