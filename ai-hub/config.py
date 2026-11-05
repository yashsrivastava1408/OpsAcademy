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
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "auto").lower()  # auto | anthropic | groq
LLM_MODEL = os.getenv("LLM_MODEL", "claude-opus-5-5")
# A Claude model name left in LLM_MODEL must not be sent to Groq.
_explicit_model = os.getenv("LLM_MODEL", "")
GROQ_MODEL = _explicit_model if _explicit_model and not _explicit_model.startswith("claude") else "openai/gpt-oss-120b"
LLM_EFFORT = os.getenv("LLM_EFFORT", "low")
# Hints and interview scoring have different quality/cost needs, so each job has its own model
# and output cap. LLM_MODEL, when set, applies to both (back-compat); HINT_MODEL / INTERVIEW_MODEL win.
HINT_MODEL = os.getenv("HINT_MODEL") or _explicit_model or "claude-haiku-5-5"
INTERVIEW_MODEL = os.getenv("INTERVIEW_MODEL") or _explicit_model or "claude-sonnet-5-5"
HINT_MAX_TOKENS = int(os.getenv("HINT_MAX_TOKENS", "2000"))  # a hint is under ~90 words
INTERVIEW_MAX_TOKENS = int(os.getenv("INTERVIEW_MAX_TOKENS", "4000"))
# Keep this below the gateway's AI_HUB_TIMEOUT_MS (default 10000) so the gateway never gives up
# while the hub is still waiting on the model.
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "8"))

HINT_CACHE_SIZE = int(os.getenv("HINT_CACHE_SIZE", "512"))
HINT_CACHE_TTL_SECONDS = int(os.getenv("HINT_CACHE_TTL_SECONDS", "900"))

# Optional sentence-embedding model for retrieval (needs requirements-semantic.txt).
SEMANTIC_SEARCH = os.getenv("SEMANTIC_SEARCH", "auto").lower()  # auto | on | off
SEMANTIC_MODEL = os.getenv("SEMANTIC_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
# Where the model files are kept between starts. The first start downloads about 90 MB into it.
MODEL_CACHE_DIR = os.getenv("MODEL_CACHE_DIR", os.path.join(os.path.expanduser("~"), ".cache", "opsacademy-models"))
