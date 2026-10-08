"""
Optional LLM backend for the mentor (Claude, via the Anthropic SDK).

Enabled when credentials are available and LLM_ENABLED is not "off". Every
caller must be ready for `complete` to return None: that is how a missing
key, a timeout, an API error or a refusal all surface, and the caller then
answers from rules instead.
"""

import logging
import os

import config

logger = logging.getLogger(__name__)

try:
    import anthropic
except ImportError:  # the SDK is an optional dependency
    anthropic = None


class LLMStreamError(Exception):
    """The model could not finish a streamed answer (unavailable, cut off or refused)."""


class LLMClient:
    def __init__(self, client=None):
        self._client = client
        self._resolved = client is not None

    @property
    def client(self):
        if not self._resolved:
            self._resolved = True
            self._client = self._build()
        return self._client

    @staticmethod
    def _build():
        if config.LLM_ENABLED == "off" or anthropic is None:
            return None
        has_credentials = os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")
        if config.LLM_ENABLED == "auto" and not has_credentials:
            return None
        # One retry at most: the gateway is waiting on this request.
        return anthropic.Anthropic(timeout=config.LLM_TIMEOUT_SECONDS, max_retries=1)

    @property
    def available(self) -> bool:
        return self.client is not None

    def complete(self, system: str, user: str):
        """@returns the model's text, or None if the LLM is unavailable or did not answer."""
        if not self.available:
            return None

        try:
            response = self.client.messages.create(
                model=config.LLM_MODEL,
                max_tokens=16000,
                output_config={"effort": config.LLM_EFFORT},
                system=system,
                messages=[{"role": "user", "content": user}],
            )
        except anthropic.RateLimitError:
            logger.warning("LLM rate limited; using rule-based hint")
            return None
        except anthropic.APIStatusError as err:
            logger.warning("LLM API error %s; using rule-based hint", err.status_code)
            return None
        except anthropic.APIConnectionError:
            logger.warning("LLM unreachable or timed out; using rule-based hint")
            return None

        if response.stop_reason != "end_turn":
            # refusal, max_tokens, ...: not a complete answer to show a student.
            logger.warning("LLM stopped with %s; using rule-based hint", response.stop_reason)
            return None

        text = "".join(block.text for block in response.content if block.type == "text").strip()
        return text or None

    def stream(self, system: str, user: str):
        """
        Yield the model's answer piece by piece as it is written.

        Raises LLMStreamError if the LLM is unavailable, fails part-way, or
        stops for any reason other than finishing its answer. The caller must
        then discard what it received and answer from rules instead.
        """
        if not self.available:
            raise LLMStreamError("LLM unavailable")

        try:
            with self.client.messages.stream(
                model=config.LLM_MODEL,
                max_tokens=16000,
                output_config={"effort": config.LLM_EFFORT},
                system=system,
                messages=[{"role": "user", "content": user}],
            ) as stream:
                for text in stream.text_stream:
                    if text:
                        yield text
                final = stream.get_final_message()
        except LLMStreamError:
            raise
        except Exception as err:  # rate limit, API error, connection lost, timeout
            logger.warning("LLM stream failed (%s); using rule-based hint", type(err).__name__)
            raise LLMStreamError(type(err).__name__) from err

        if final.stop_reason != "end_turn":
            # refusal, max_tokens, ...: not a complete answer to show a student.
            logger.warning("LLM stream stopped with %s; using rule-based hint", final.stop_reason)
            raise LLMStreamError(str(final.stop_reason))


llm = LLMClient()
