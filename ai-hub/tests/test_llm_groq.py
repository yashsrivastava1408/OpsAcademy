import json

import pytest
import requests

import agents.llm as llm_module
from agents.llm_groq import GroqClient, LLMStreamError


class FakeResponse:
    def __init__(self, status=200, body=None, lines=()):
        self.status_code = status
        self._body = body
        self._lines = lines

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body

    def iter_lines(self, decode_unicode=False):
        return iter(self._lines)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeSession:
    def __init__(self, response=None, error=None):
        self.response, self.error, self.calls = response, error, []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise self.error
        return self.response


def reply(text, finish="stop"):
    return FakeResponse(body={"choices": [{"message": {"content": text}, "finish_reason": finish}]})


def client(response=None, error=None):
    session = FakeSession(response, error)
    return GroqClient("gsk-test", model="m", session=session), session


def event(piece=None, finish=None):
    return "data: " + json.dumps({"choices": [{"delta": {"content": piece} if piece else {}, "finish_reason": finish}]})


def test_complete_sends_the_expected_request():
    groq, session = client(reply("  Check the folder.  "))
    assert groq.complete("system text", "user text") == "Check the folder."
    url, kwargs = session.calls[0]
    assert url.endswith("/chat/completions")
    assert kwargs["headers"]["Authorization"] == "Bearer gsk-test"
    assert kwargs["json"]["model"] == "m"
    assert kwargs["json"]["messages"] == [
        {"role": "system", "content": "system text"},
        {"role": "user", "content": "user text"},
    ]


def test_no_key_means_unavailable_and_no_request():
    session = FakeSession(reply("x"))
    groq = GroqClient("", session=session)
    assert groq.available is False
    assert groq.complete("s", "u") is None
    assert groq.complete_json("s", "u", {}) is None
    assert session.calls == []
    with pytest.raises(LLMStreamError):
        list(groq.stream("s", "u"))


@pytest.mark.parametrize("finish", ["length", "content_filter", None])
def test_unfinished_answers_are_discarded(finish):
    assert client(reply("partial", finish))[0].complete("s", "u") is None


@pytest.mark.parametrize("response", [
    FakeResponse(status=429), FakeResponse(status=500), FakeResponse(body=None), FakeResponse(body={"choices": []}),
])
def test_api_errors_and_unreadable_replies_give_none(response):
    assert client(response)[0].complete("s", "u") is None


@pytest.mark.parametrize("error", [requests.Timeout(), requests.ConnectionError()])
def test_network_failures_give_none(error):
    assert client(error=error)[0].complete("s", "u") is None


def test_empty_text_gives_none():
    assert client(reply("  "))[0].complete("s", "u") is None


def test_complete_json_asks_for_json_and_parses_it():
    groq, session = client(reply('{"score": 80}'))
    assert groq.complete_json("judge", "answer", {"type": "object"}) == {"score": 80}
    payload = session.calls[0][1]["json"]
    assert payload["response_format"] == {"type": "json_object"}
    assert '"type": "object"' in payload["messages"][0]["content"]


@pytest.mark.parametrize("text", ["not json", "[1, 2]", '"text"'])
def test_complete_json_rejects_anything_but_an_object(text):
    assert client(reply(text))[0].complete_json("s", "u", {}) is None


def test_stream_yields_pieces_and_finishes():
    groq, _ = client(FakeResponse(lines=[event("Check "), "", event("the folder"), event(finish="stop"), "data: [DONE]"]))
    assert "".join(groq.stream("s", "u")) == "Check the folder"


@pytest.mark.parametrize("lines", [
    [event("partial"), event(finish="length"), "data: [DONE]"],
    [event("partial")],
    [event("partial"), "data: {broken"],
])
def test_stream_raises_when_the_answer_is_not_whole(lines):
    groq, _ = client(FakeResponse(lines=lines))
    with pytest.raises(LLMStreamError):
        list(groq.stream("s", "u"))


def test_stream_raises_on_http_error_and_network_error():
    with pytest.raises(LLMStreamError):
        list(client(FakeResponse(status=429))[0].stream("s", "u"))
    with pytest.raises(LLMStreamError):
        list(client(error=requests.ConnectionError())[0].stream("s", "u"))


@pytest.mark.parametrize("env, provider, expected", [
    ({"GROQ_API_KEY": "gsk"}, "auto", GroqClient),
    ({"ANTHROPIC_API_KEY": "sk", "GROQ_API_KEY": "gsk"}, "auto", llm_module.LLMClient),
    ({"ANTHROPIC_API_KEY": "sk", "GROQ_API_KEY": "gsk"}, "groq", GroqClient),
    ({"GROQ_API_KEY": "gsk"}, "anthropic", llm_module.LLMClient),
])
def test_provider_choice(monkeypatch, env, provider, expected):
    for key in ("GROQ_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(llm_module.config, "LLM_PROVIDER", provider)
    monkeypatch.setattr(llm_module.config, "LLM_ENABLED", "auto")
    assert isinstance(llm_module.build_default(), expected)


def test_llm_off_wins_over_a_groq_key(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk")
    monkeypatch.setattr(llm_module.config, "LLM_ENABLED", "off")
    assert llm_module.build_default().available is False


def test_claude_model_name_is_not_sent_to_groq(monkeypatch):
    import importlib

    import config

    monkeypatch.setenv("LLM_MODEL", "claude-opus-5-5")
    assert importlib.reload(config).GROQ_MODEL == "openai/gpt-oss-120b"
    monkeypatch.setenv("LLM_MODEL", "llama-3.1-8b-instant")
    assert importlib.reload(config).GROQ_MODEL == "llama-3.1-8b-instant"
    monkeypatch.delenv("LLM_MODEL")
    importlib.reload(config)
