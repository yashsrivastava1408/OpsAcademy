import pytest

import config
from app import create_app
from pipeline import hint_cache


@pytest.fixture
def client():
    hint_cache.items.clear()
    return create_app().test_client()


@pytest.fixture
def token(monkeypatch):
    monkeypatch.setattr(config, "INTERNAL_TOKEN", "shared-secret")
    return {"x-internal-token": "shared-secret"}


STEP = {
    "title": "Create a Project Structure",
    "description": "Build a directory structure using mkdir and touch.",
    "tasks": ["Create a directory called `webapp`", "Create files: `src/index.js`"],
    "verificationCommand": "test -d /home/student/webapp && test -f /home/student/webapp/src/index.js && echo PASS || echo FAIL",
}


def test_health_reports_agents_and_knowledge_base(client):
    body = client.get("/health").get_json()
    assert body["status"] == "ok"
    assert "interview_scorer" in body["agents"] and "lab_grader" not in body["agents"]
    assert body["knowledge_base_chunks"] > 200
    assert body["llm"] == {"enabled": False, "model": None}


def test_hint_endpoint_returns_a_grounded_hint(client):
    response = client.post("/api/agent/hint", json={
        "query": "verify fails", "unitId": "linux-basics", "stepNumber": 2, "tier": 2, "step": STEP,
        "commandHistory": ["mkdir webapp"],
        "containerTelemetry": {"fileTree": [{"path": "webapp", "type": "directory"}], "ports": []},
    })
    data = response.get_json()["data"]
    assert response.status_code == 200
    assert data["tier"] == 2 and data["source"] == "rules" and data["blocked"] is False
    assert "webapp/src/index.js" in data["hint"]
    assert data["diagnostics"]["missing"] == ["webapp/src/index.js"]
    assert STEP["verificationCommand"] not in response.get_data(as_text=True)


@pytest.mark.parametrize("body", [{}, {"query": ""}, {"query": "   "}, {"query": 5}, {"query": ["a"]}])
def test_hint_requires_a_question(client, body):
    assert client.post("/api/agent/hint", json=body).status_code == 400


def test_hint_tolerates_malformed_optional_fields(client):
    response = client.post("/api/agent/hint", json={
        "query": "help", "tier": "lots", "stepNumber": "two", "step": "not a dict",
        "commandHistory": "ls", "containerTelemetry": [1, 2],
    })
    assert response.status_code == 200
    assert response.get_json()["data"]["tier"] == 1


def test_hint_tier_is_clamped(client):
    assert client.post("/api/agent/hint", json={"query": "help", "tier": 50}).get_json()["data"]["tier"] == 3
    assert client.post("/api/agent/hint", json={"query": "help me", "tier": -1}).get_json()["data"]["tier"] == 1


def test_non_json_body_is_a_400_not_a_crash(client):
    response = client.post("/api/agent/hint", data="not json", content_type="text/plain")
    assert response.status_code == 400


def test_scan_endpoint(client):
    assert client.post("/api/agent/scan", json={"command": "ls -la"}).get_json()["data"]["safe"] is True
    blocked = client.post("/api/agent/scan", json={"command": "rm -rf /"}).get_json()["data"]
    assert blocked["safe"] is False and blocked["threat_type"] == "root_delete"
    assert client.post("/api/agent/scan", json={"command": ["rm"]}).status_code == 400


def test_interview_score_endpoint(client):
    response = client.post("/api/agent/interview/score", json={
        "question": "How do you check disk usage?",
        "answer": "I run df -h to see the partitions and then du -sh to find the large directories.",
        "keyPoints": ["df -h for partition overview", "du -sh for directory sizes"],
        "modelAnswer": "Use `df -h` then `du -sh`.",
    })
    data = response.get_json()["data"]
    assert data["covered"] == ["df -h for partition overview", "du -sh for directory sizes"]
    assert data["score"] >= 70
    assert client.post("/api/agent/interview/score", json={"answer": ""}).status_code == 400


def test_removed_grade_endpoint_is_gone(client):
    assert client.post("/api/agent/grade", json={}).status_code == 404


def test_oversized_body_is_rejected(client):
    response = client.post("/api/agent/hint", json={"query": "x" * (300 * 1024)})
    assert response.status_code == 413


def test_with_a_token_configured_every_endpoint_but_health_needs_it(client, token):
    assert client.get("/health").status_code == 200
    for path in ("/api/agent/hint", "/api/agent/scan", "/api/agent/interview/score"):
        assert client.post(path, json={"query": "help"}).status_code == 403
        assert client.post(path, json={"query": "help"}, headers={"x-internal-token": "wrong"}).status_code == 403
    assert client.post("/api/agent/scan", json={"command": "ls"}, headers=token).status_code == 200


def test_without_a_token_configured_the_hub_is_open(client, monkeypatch):
    monkeypatch.setattr(config, "INTERNAL_TOKEN", "")
    assert client.post("/api/agent/scan", json={"command": "ls"}).status_code == 200


def test_unexpected_errors_do_not_leak_internals(client, monkeypatch):
    import app as app_module

    def boom(*_args, **_kwargs):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(app_module, "run_agent_pipeline", boom)
    failing = app_module.create_app()
    failing.config["PROPAGATE_EXCEPTIONS"] = False
    response = failing.test_client().post("/api/agent/hint", json={"query": "help"})
    assert response.status_code == 500
    assert response.get_json() == {"success": False, "error": "Internal Server Error"}


def test_debug_mode_is_off():
    assert create_app().debug is False


def test_hint_stream_sends_one_json_event_per_line(client):
    body = {"query": "verify keeps failing", "unitId": "linux-basics", "stepNumber": 2, "tier": 1,
            "step": {"title": "Create a Project Structure", "description": "d", "tasks": ["Create `webapp`"]}}
    res = client.post("/api/agent/hint/stream", json=body)
    assert res.status_code == 200
    assert res.mimetype == "application/x-ndjson"
    assert "no-transform" in res.headers["Cache-Control"]

    import json as json_module
    events = [json_module.loads(line) for line in res.get_data(as_text=True).splitlines()]
    assert [e["type"] for e in events] == ["delta", "done"]
    assert events[0]["text"] == events[1]["data"]["hint"]

    plain = client.post("/api/agent/hint", json={**body, "query": "verify keeps failing again"}).get_json()["data"]
    assert set(events[1]["data"]) == set(plain)


def test_hint_stream_requires_a_question(client):
    assert client.post("/api/agent/hint/stream", json={"query": "  "}).status_code == 400


def test_hint_stream_reports_a_failure_in_the_stream(client, monkeypatch):
    import app as app_module

    def broken(*args, **kwargs):
        yield {"type": "delta", "text": "partial"}
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(app_module, "stream_agent_pipeline", broken)
    text = client.post("/api/agent/hint/stream", json={"query": "help"}).get_data(as_text=True)
    assert text.splitlines()[-1] == '{"type": "error"}'
    assert "secret internal detail" not in text
