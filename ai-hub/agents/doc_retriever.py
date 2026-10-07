"""
Agent 2: Knowledge Retriever

Hybrid lexical retrieval over the course's own content (learn sections and
flashcards, built by scripts/build_corpus.py). Two rankers run on every
query and are merged with reciprocal rank fusion:

  - BM25 over word tokens: strong on exact terms like `kubectl` or `chmod`
  - TF-IDF cosine over character n-grams: tolerant of typos and word forms

Chunks from the unit the student is working in get a small boost. There is
no embedding model or vector database here; evals/run_eval.py measures how
well this does on labelled questions.
"""

import json
import math
from collections import Counter
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

from agents.text import tokenize

CORPUS_PATH = Path(__file__).resolve().parent.parent / "data" / "corpus.json"

BM25_K1 = 1.5
BM25_B = 0.75
RRF_K = 60
CANDIDATES = 30
# Added to a chunk's fused score when it belongs to the student's current unit:
# worth about as much as ranking first in one of the two rankers.
UNIT_BOOST = 1.0 / (RRF_K + 1)


class DocRetriever:
    def __init__(self, corpus: list = None):
        self.docs = corpus if corpus is not None else self.load_corpus()
        texts = [self.searchable(doc) for doc in self.docs]

        # BM25 index
        self.doc_tokens = [tokenize(text) for text in texts]
        self.doc_freqs = [Counter(tokens) for tokens in self.doc_tokens]
        self.avg_len = sum(len(t) for t in self.doc_tokens) / max(1, len(self.docs))
        document_frequency = Counter(term for tokens in self.doc_tokens for term in set(tokens))
        total = len(self.docs)
        self.idf = {term: math.log(1 + (total - df + 0.5) / (df + 0.5)) for term, df in document_frequency.items()}

        # Character n-gram TF-IDF index
        self.vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=1)
        self.matrix = self.vectorizer.fit_transform(texts) if texts else None

    @staticmethod
    def load_corpus() -> list:
        if not CORPUS_PATH.exists():
            return []
        return json.loads(CORPUS_PATH.read_text())

    @staticmethod
    def searchable(doc: dict) -> str:
        # The title is repeated so a match on it outweighs a passing mention in the body.
        return f"{doc.get('title', '')}. {doc.get('title', '')}. {doc.get('unit_title', '')}. {doc.get('text', '')}"

    def bm25_scores(self, query: str) -> list:
        terms = tokenize(query)
        scores = [0.0] * len(self.docs)
        for index, freqs in enumerate(self.doc_freqs):
            length = len(self.doc_tokens[index])
            for term in terms:
                tf = freqs.get(term)
                if not tf:
                    continue
                norm = tf + BM25_K1 * (1 - BM25_B + BM25_B * length / self.avg_len)
                scores[index] += self.idf.get(term, 0.0) * tf * (BM25_K1 + 1) / norm
        return scores

    def tfidf_scores(self, query: str) -> list:
        if self.matrix is None:
            return []
        return linear_kernel(self.vectorizer.transform([query]), self.matrix)[0].tolist()

    @staticmethod
    def ranked(scores: list) -> list:
        """Indexes of the best-scoring documents, ignoring ones that did not match at all."""
        order = sorted((i for i, s in enumerate(scores) if s > 0), key=lambda i: scores[i], reverse=True)
        return order[:CANDIDATES]

    def retrieve(self, query: str, unit_id: str = None, top_k: int = 3) -> list:
        """
        @returns up to top_k chunks, best first, each with its fused `score`.
                 Empty when nothing in the corpus matches the query.
        """
        if not self.docs or not query or not query.strip():
            return []

        fused = Counter()
        for scores in (self.bm25_scores(query), self.tfidf_scores(query)):
            for rank, index in enumerate(self.ranked(scores)):
                fused[index] += 1.0 / (RRF_K + rank + 1)

        if unit_id:
            for index in fused:
                if self.docs[index]["unit"] == unit_id:
                    fused[index] += UNIT_BOOST

        results = []
        for index, score in fused.most_common(top_k):
            results.append({**self.docs[index], "score": round(score, 5)})
        return results


retriever = DocRetriever()
