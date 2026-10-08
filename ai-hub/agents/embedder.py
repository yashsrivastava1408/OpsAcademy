"""
Optional sentence-embedding model for the knowledge retriever.

The lexical rankers find a chunk only when the question shares words with
it. An embedding model also matches by meaning ("stop a program that is
stuck" finds the section on killing processes). It is optional because it
costs memory and a one-off model download:

  SEMANTIC_SEARCH=auto  use it if the `fastembed` package is installed (default)
  SEMANTIC_SEARCH=on    the same, and log loudly if it cannot be loaded
  SEMANTIC_SEARCH=off   never load it

The model is loaded in a background thread, so the hub starts at once and
answers from the lexical rankers until the model is ready. Any failure
(package missing, no network for the first download, not enough memory)
leaves the hub on lexical retrieval; nothing else depends on this module.
"""

import logging
import threading

import numpy as np

import config

logger = logging.getLogger(__name__)

EMBED_BATCH_SIZE = 16


def load_fastembed(model_name: str):
    """@returns a function mapping a list of texts to a 2-D float array."""
    from fastembed import TextEmbedding  # imported here: the package is optional

    model = TextEmbedding(model_name, cache_dir=config.MODEL_CACHE_DIR or None)
    # Small batches: the whole corpus in one batch made the runtime reserve
    # over 2 GB while indexing. Sixteen at a time keeps the peak a few hundred MB.
    return lambda texts: np.array(list(model.embed(list(texts), batch_size=EMBED_BATCH_SIZE)), dtype=np.float32)


class Embedder:
    def __init__(self, model_name: str = None, mode: str = None, loader=load_fastembed):
        self.model_name = model_name or config.SEMANTIC_MODEL
        self.mode = (mode or config.SEMANTIC_SEARCH).lower()
        self.loader = loader
        self.status = "off" if self.mode == "off" else "idle"  # off | idle | loading | ready | unavailable
        self.reason = None
        self._encode = None
        self._done = threading.Event()
        if self.status == "off":
            self._done.set()

    @property
    def ready(self) -> bool:
        return self.status == "ready"

    def start(self, after_load=None, background: bool = True):
        """Load the model (once). `after_load` runs in the same thread before the embedder reports ready."""
        if self.status != "idle":
            return
        self.status = "loading"

        def load():
            try:
                self._encode = self.loader(self.model_name)
                if after_load:
                    after_load(self)
                self.status = "ready"
                logger.info("semantic search ready (%s)", self.model_name)
            except Exception as err:  # optional feature: never take the hub down
                self._encode = None
                self.status = "unavailable"
                self.reason = "%s: %s" % (type(err).__name__, str(err)[:200])
                log = logger.warning if self.mode == "on" else logger.info
                log("semantic search not available, using lexical retrieval only (%s)", self.reason)
            finally:
                self._done.set()

        if background:
            threading.Thread(target=load, name="embedder-load", daemon=True).start()
        else:
            load()

    def wait(self, timeout: float = None) -> bool:
        """Block until loading has finished one way or the other. @returns True if the model is ready."""
        self._done.wait(timeout)
        return self.ready

    def embed(self, texts) -> np.ndarray:
        """Unit-length vectors, one row per text."""
        vectors = self._encode(texts)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors / np.maximum(norms, 1e-9)

    def describe(self) -> dict:
        return {"status": self.status, "model": self.model_name if self.status != "off" else None, "reason": self.reason}


embedder = Embedder()
