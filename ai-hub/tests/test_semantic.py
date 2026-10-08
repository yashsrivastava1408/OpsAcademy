"""The optional embedding ranker, tested with a stand-in model so no download is needed."""

import threading

import numpy as np
import pytest

from agents.doc_retriever import DocRetriever
from agents.embedder import Embedder

CORPUS = [
    {"id": "kill", "unit": "linux", "unit_title": "Linux", "section": "processes", "title": "Signals",
     "text": "Send SIGTERM with kill to end a running program."},
    {"id": "perm", "unit": "linux", "unit_title": "Linux", "section": "permissions", "title": "Modes",
     "text": "chmod changes who may read, write or execute a file."},
    {"id": "pod", "unit": "k8s", "unit_title": "Kubernetes", "section": "pods", "title": "Pods",
     "text": "A pod wraps one or more containers that share a network."},
]

# A toy "meaning" space: each text is placed by the concepts it mentions.
CONCEPTS = [("kill", "stuck", "froze", "sigterm", "end a running"), ("chmod", "permission", "execute", "allowed to run"), ("pod", "container")]


# Shares no word with the chunk that answers it.
QUERY = "it froze, how do I stop something that is stuck"


def toy_loader(_model_name):
    def encode(texts):
        rows = []
        for text in texts:
            lowered = text.lower()
            rows.append([float(any(word in lowered for word in group)) for group in CONCEPTS])
        return np.array(rows, dtype=np.float32)
    return encode


def semantic_retriever(loader=toy_loader, mode="on"):
    embedder = Embedder("toy-model", mode=mode, loader=loader)
    return DocRetriever(CORPUS).attach(embedder, background=False), embedder


def test_a_question_with_no_shared_words_is_found_by_meaning():
    lexical = DocRetriever(CORPUS).retrieve(QUERY)
    assert not lexical or lexical[0]["id"] != "kill", "the lexical rankers alone do not find the right chunk"

    retriever, embedder = semantic_retriever()
    assert embedder.ready and retriever.semantic
    assert retriever.retrieve(QUERY)[0]["id"] == "kill"


def test_agreement_between_meaning_and_words_ranks_a_chunk_first():
    retriever, _ = semantic_retriever()
    # "execute" appears in the permissions chunk (words) and maps to its concept (meaning).
    assert retriever.retrieve("which file is allowed to run and execute")[0]["id"] == "perm"


def test_text_about_nothing_in_the_course_still_returns_nothing():
    retriever, _ = semantic_retriever()
    assert retriever.retrieve("zzzzqqqq") == []


def test_results_keep_their_shape_and_the_unit_boost():
    retriever, _ = semantic_retriever()
    results = retriever.retrieve("container", unit_id="k8s", top_k=2)
    assert results[0]["id"] == "pod"
    assert set(results[0]) >= {"id", "unit", "title", "score"}


@pytest.mark.parametrize("mode", ["auto", "on"])
def test_a_model_that_cannot_load_leaves_lexical_retrieval_working(mode):
    def broken(_name):
        raise ImportError("No module named 'fastembed'")

    retriever, embedder = semantic_retriever(loader=broken, mode=mode)
    assert embedder.status == "unavailable" and "fastembed" in embedder.reason
    assert not retriever.semantic
    assert retriever.retrieve("chmod execute")[0]["id"] == "perm"
    assert embedder.describe() == {"status": "unavailable", "model": "toy-model", "reason": embedder.reason}


def test_a_model_that_breaks_while_answering_does_not_break_retrieval():
    calls = {"n": 0}

    def flaky(_name):
        def encode(texts):
            calls["n"] += 1
            if calls["n"] > 1:  # fine while indexing, fails on the first query
                raise RuntimeError("out of memory")
            return toy_loader(None)(texts)
        return encode

    retriever, _ = semantic_retriever(loader=flaky)
    assert retriever.retrieve("chmod execute")[0]["id"] == "perm"


def test_switched_off_never_loads_anything():
    def must_not_run(_name):
        raise AssertionError("loader was called")

    retriever, embedder = semantic_retriever(loader=must_not_run, mode="off")
    assert embedder.status == "off" and embedder.wait(0) is False
    assert not retriever.semantic
    assert embedder.describe() == {"status": "off", "model": None, "reason": None}


def test_loading_in_the_background_does_not_block_and_switches_on_when_ready():
    gate = threading.Event()

    def slow(name):
        gate.wait(5)
        return toy_loader(name)

    embedder = Embedder("toy-model", mode="auto", loader=slow)
    retriever = DocRetriever(CORPUS).attach(embedder)  # returns at once
    assert embedder.status == "loading" and not retriever.semantic
    before = retriever.retrieve(QUERY)
    assert not before or before[0]["id"] != "kill", "lexical only while the model loads"

    gate.set()
    assert embedder.wait(5) is True
    assert retriever.retrieve(QUERY)[0]["id"] == "kill"


def test_embeddings_are_unit_length():
    embedder = Embedder("toy-model", mode="on", loader=lambda _n: (lambda texts: np.array([[3.0, 4.0]] * len(texts), dtype=np.float32)))
    embedder.start(background=False)
    assert np.allclose(np.linalg.norm(embedder.embed(["a", "b"]), axis=1), 1.0)


def test_health_reports_semantic_search():
    from app import app
    assert app.test_client().get("/health").get_json()["semantic_search"]["status"] == "off"
