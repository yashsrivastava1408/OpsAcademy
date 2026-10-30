"""
Groq backend for the mentor (OpenAI-compatible chat completions API).

Same contract as the Claude client in llm.py: `complete`, `complete_json` and
`stream` return None or raise LLMStreamError when the model did not give a
whole answer, and the caller then answers from rules instead.
"""

import json
import logging

import requests

import config

logger = logging.getLogger(__name__)

CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_TOKENS = 1500


class LLMStreamError(Exception):
    """The model could not finish a streamed answer (unavailable, cut off or refused)."""


class GroqClient:
    def __init__(self, api_key, model=None, session=None, url=CHAT_URL):
        self._api_key = api_key
        self.model = model or config.GROQ_MODEL
        self._session = session or requests.Session()
        self._url = url

    @property
    def available(self) -> bool:
        return bool(self._api_key)

    def _payload(self, system, user, **extra):
        return {
            "model": self.model,
            "max_tokens": MAX_TOKENS,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            **extra,
        }

    def _post(self, payload, stream=False):
        # The gateway is waiting on this request, so there is no retry.
        return self._session.post(
            self._url,
            json=payload,
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=config.LLM_TIMEOUT_SECONDS,
            stream=stream,
        )

    def _finished_text(self, payload, fallback):
        """The text of a finished answer, or None (the reason is logged)."""
        if not self.available:
            return None
        try:
            response = self._post(payload)
        except requests.RequestException as err:
            logger.warning("LLM unreachable or timed out (%s); using %s", type(err).__name__, fallback)
            return None
        if response.status_code != 200:
            logger.warning("LLM API error %s; using %s", response.status_code, fallback)
            return None
        try:
            choice = response.json()["choices"][0]
            finish, text = choice.get("finish_reason"), choice["message"].get("content")
        except (ValueError, KeyError, IndexError, TypeError):
            logger.warning("LLM sent an unreadable reply; using %s", fallback)
            return None
        if finish != "stop":
            # length, content_filter, ...: not a complete answer to show a student.
            logger.warning("LLM stopped with %s; using %s", finish, fallback)
            return None
        return (text or "").strip() or None

    def complete(self, system: str, user: str):
        """@returns the model's text, or None if the LLM is unavailable or did not answer."""
        return self._finished_text(self._payload(system, user), "rule-based hint")

    def complete_json(self, system: str, user: str, schema: dict):
        """
        Ask for a JSON object. Groq models do not all support strict schemas, so
        the schema goes into the prompt and the reply is checked by the caller.
        @returns the parsed object, or None if the LLM is unavailable, did not finish or sent something unusable.
        """
        system = f"{system}\n\nReply with one JSON object only, matching this JSON schema:\n{json.dumps(schema)}"
        payload = self._payload(system, user, response_format={"type": "json_object"})
        text = self._finished_text(payload, "the rule-based result")
        if text is None:
            return None
        try:
            data = json.loads(text)
        except ValueError:
            logger.warning("LLM answer was not valid JSON; using the rule-based result")
            return None
        return data if isinstance(data, dict) else None

    def stream(self, system: str, user: str):
        """
        Yield the model's answer piece by piece as it is written.

        Raises LLMStreamError if the LLM is unavailable, fails part-way, or
        stops for any reason other than finishing its answer. The caller must
        then discard what it received and answer from rules instead.
        """
        if not self.available:
            raise LLMStreamError("LLM unavailable")

        finish = None
        try:
            response = self._post(self._payload(system, user, stream=True), stream=True)
            if response.status_code != 200:
                raise LLMStreamError(f"HTTP {response.status_code}")
            with response:
                for raw in response.iter_lines(decode_unicode=True):
                    if not raw or not raw.startswith("data:"):
                        continue
                    data = raw[5:].strip()
                    if data == "[DONE]":
                        break
                    choice = json.loads(data)["choices"][0]
                    piece = (choice.get("delta") or {}).get("content")
                    if piece:
                        yield piece
                    finish = choice.get("finish_reason") or finish
        except LLMStreamError:
            raise
        except Exception as err:  # connection lost, timeout, malformed event
            logger.warning("LLM stream failed (%s); using rule-based hint", type(err).__name__)
            raise LLMStreamError(type(err).__name__) from err

        if finish != "stop":
            logger.warning("LLM stream stopped with %s; using rule-based hint", finish)
            raise LLMStreamError(str(finish))
