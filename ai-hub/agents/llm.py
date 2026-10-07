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


llm = LLMClient()
