import os
from dotenv import load_dotenv

load_dotenv()

# 5005 locally (macOS uses port 5000 for AirPlay Receiver); containers set PORT=5000.
PORT = int(os.getenv("PORT", 5005))
ENV = os.getenv("FLASK_ENV", "development")

# Shared secret the gateway sends as `x-internal-token`. When set, every
# endpoint except /health requires it, so the hub can sit on a public host
# without being an open API.
INTERNAL_TOKEN = os.getenv("AI_HUB_TOKEN", "")

# Optional LLM mentor. Without credentials the hub answers from its rules
# and retrieval alone, which is also the fallback when the LLM call fails.
LLM_ENABLED = os.getenv("LLM_ENABLED", "auto").lower()  # auto | on | off
LLM_MODEL = os.getenv("LLM_MODEL", "claude-opus-5-5")
LLM_EFFORT = os.getenv("LLM_EFFORT", "low")
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "12"))

HINT_CACHE_SIZE = int(os.getenv("HINT_CACHE_SIZE", "512"))
HINT_CACHE_TTL_SECONDS = int(os.getenv("HINT_CACHE_TTL_SECONDS", "900"))
