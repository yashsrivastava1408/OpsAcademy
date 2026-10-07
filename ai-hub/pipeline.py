"""
OpsAcademy mentor pipeline

One hint request flows through the agents in order:

  0. Abuse scanner      - refuses to help run a blocked command
  1. Lab assessor       - what the student typed vs what the step expects
  1.5 Container inspector - what the step needs vs what is in their sandbox
  2. Knowledge retriever  - relevant course notes
  3. Mentor               - one hint at the requested tier (rules or LLM)

Results are cached briefly, keyed on everything the hint depends on, so a
student re-asking the same thing does not cost a second LLM call.
"""

import hashlib
import json
import re
import time
from collections import OrderedDict

import config
from agents.abuse_scanner import scanner
from agents.container_inspector import inspector
from agents.doc_retriever import retriever
from agents.lab_assessor import assessor
from agents.mentor import mentor

# Someone asking *about* a dangerous command gets an explanation, not a block.
ASKING_ABOUT = re.compile(r"\?|\b(why|what|how|explain|dangerous|mean|means|does|safe)\b", re.IGNORECASE)


class TTLCache:
    def __init__(self, max_size: int, ttl_seconds: float, clock=time.monotonic):
        self.max_size = max_size
        self.ttl = ttl_seconds
        self.clock = clock
        self.items = OrderedDict()
        self.hits = 0
        self.misses = 0

    def get(self, key):
        entry = self.items.get(key)
        if entry is None or entry[0] < self.clock():
            self.items.pop(key, None)
            self.misses += 1
            return None
        self.items.move_to_end(key)
        self.hits += 1
        return entry[1]

    def set(self, key, value):
        self.items[key] = (self.clock() + self.ttl, value)
        self.items.move_to_end(key)
        while len(self.items) > self.max_size:
            self.items.popitem(last=False)


hint_cache = TTLCache(config.HINT_CACHE_SIZE, config.HINT_CACHE_TTL_SECONDS)


def cache_key(query, unit_id, step_number, tier, step, command_history, container_telemetry) -> str:
    payload = json.dumps(
        [" ".join(query.lower().split()), unit_id, step_number, tier, step, command_history, container_telemetry],
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def run_agent_pipeline(
    user_query: str,
    unit_id: str = "general",
    step_number: int = 1,
    command_history: list = None,
    container_telemetry: dict = None,
    step: dict = None,
    tier: int = 1,
    mentor_agent=None,
    cache: TTLCache = None,
) -> dict:
    command_history = command_history or []
    mentor_agent = mentor_agent or mentor
    cache = hint_cache if cache is None else cache

    # Agent 0: refuse to help execute a blocked command
    hit = scanner.match_rule(user_query or "")
    if hit and not ASKING_ABOUT.search(user_query):
        return {
            "blocked": True,
            "threat_type": hit[0],
            "message": "That command is blocked in the sandbox, so I can't help run it. Ask me why it is dangerous if you want to understand it.",
        }

    key = cache_key(user_query, unit_id, step_number, tier, step, command_history, container_telemetry)
    cached = cache.get(key)
    if cached is not None:
        return {**cached, "cached": True}

    # Agent 1: what the student has done
    assessment = assessor.assess(unit_id, step_number, user_query, command_history, step)

    # Agent 1.5: what is in their sandbox
    diagnostics = inspector.inspect(step, container_telemetry)

    # Agent 2: course notes. The step title sharpens a vague question like "it fails".
    search_query = f"{user_query} {step['title']}" if step else user_query
    docs = retriever.retrieve(search_query, unit_id=unit_id, top_k=3)

    # Agent 3: the hint
    result = mentor_agent.generate_hint(tier, user_query, step, assessment, diagnostics, docs, command_history)

    response = {
        "blocked": False,
        "hint": result["hint"],
        "tier": result["tier"],
        "source": result["source"],
        "cached": False,
        "assessment": {
            "detected_issue": assessment["detected_issue"],
            "typo": assessment["typo"],
            "unused_tools": assessment["unused_tools"],
        },
        "diagnostics": diagnostics,
        "retrieved": [{"id": d["id"], "title": d["title"], "unit": d["unit"], "score": d["score"]} for d in docs],
    }
    cache.set(key, response)
    return response
