"""
Agent 4: Interview Answer Scorer

Scores a written answer against the question's rubric (its key points) and
its model answer. The score is deterministic and explainable: the student is
told exactly which points they covered and which they missed.

  70%  share of key points covered
  20%  overall similarity to the model answer
  10%  substance (enough words to be a real answer)

When a question has no key points, the steps of the model answer stand in
for them.
"""

import re

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

from agents.text import backticked, tokenize

POINT_COVERAGE_THRESHOLD = 0.5
SIMILARITY_FULL_MARKS = 0.45
SUBSTANCE_WORDS = 60
MAX_DERIVED_POINTS = 6
WEIGHTS = {"points": 0.7, "similarity": 0.2, "substance": 0.1}


def derive_points(model_answer: str) -> list:
    """Turn a model answer into rubric points: its numbered steps, else its sentences."""
    steps = [s.strip() for s in re.split(r"(?:^|\n)\s*(?:\d+[.)]|[-*])\s+", model_answer) if s.strip()]
    if len(steps) < 2:
        steps = [s.strip() for s in re.split(r"(?<=[.!?])\s+", model_answer) if len(s.split()) >= 4]
    return steps[:MAX_DERIVED_POINTS]


# Names an interviewer listens for: flags, API calls, dotted or CamelCase identifiers.
TECHNICAL_TERM = re.compile(r"(?<![\w-])-{1,2}[A-Za-z][\w-]*|[A-Za-z]+[_.][A-Za-z_.]+\w|\b[a-z]+[A-Z]\w*|\b[A-Z][a-z]+[A-Z]\w*")


def technical_terms(point: str) -> list:
    return [t.lower() for t in TECHNICAL_TERM.findall(point)]


def point_coverage(point: str, answer_tokens: set, answer_text: str) -> float:
    """How much of one rubric point the answer contains, 0 to 1."""
    normalised = re.sub(r"\s+", " ", answer_text.lower())

    # A command quoted in the point counts in full if the student wrote it.
    for snippet in backticked(point):
        if re.sub(r"\s+", " ", snippet.lower()) in normalised:
            return 1.0

    # So does naming every technical term the point is built around.
    terms = technical_terms(point)
    if terms and all(term in normalised for term in terms):
        return 1.0

    tokens = set(tokenize(point))
    if not tokens:
        return 0.0
    return len(tokens & answer_tokens) / len(tokens)


def similarity(answer: str, model_answer: str) -> float:
    if not answer.strip() or not model_answer.strip():
        return 0.0
    try:
        matrix = TfidfVectorizer(tokenizer=tokenize, token_pattern=None).fit_transform([model_answer, answer])
    except ValueError:  # nothing but stopwords
        return 0.0
    return float(linear_kernel(matrix[0], matrix[1])[0][0])


class InterviewScorer:
    def score(self, question: str, answer: str, key_points: list = None, model_answer: str = "") -> dict:
        answer = (answer or "").strip()
        points = [p for p in (key_points or []) if isinstance(p, str) and p.strip()]
        derived = not points
        if derived:
            points = derive_points(model_answer or "")

        answer_tokens = set(tokenize(answer))
        covered, missed = [], []
        for point in points:
            (covered if point_coverage(point, answer_tokens, answer) >= POINT_COVERAGE_THRESHOLD else missed).append(point)

        point_score = len(covered) / len(points) if points else 0.0
        similarity_score = min(1.0, similarity(answer, model_answer or "") / SIMILARITY_FULL_MARKS)
        substance_score = min(1.0, len(answer.split()) / SUBSTANCE_WORDS)

        if points:
            total = (WEIGHTS["points"] * point_score + WEIGHTS["similarity"] * similarity_score
                     + WEIGHTS["substance"] * substance_score)
        else:
            # No rubric at all: similarity is the only evidence.
            total = 0.8 * similarity_score + 0.2 * substance_score

        score = round(total * 100)
        return {
            "score": score,
            "covered": covered,
            "missed": missed,
            "breakdown": {
                "keyPoints": round(point_score * 100),
                "similarity": round(similarity_score * 100),
                "substance": round(substance_score * 100),
            },
            "rubricDerived": derived,
            "feedback": self.feedback(score, covered, missed),
            "source": "rules",
        }

    @staticmethod
    def feedback(score: int, covered: list, missed: list) -> str:
        if score >= 85:
            opening = "Strong answer."
        elif score >= 70:
            opening = "Good answer with a few gaps."
        elif score >= 40:
            opening = "You have part of it."
        else:
            opening = "This misses most of what an interviewer listens for."

        total = len(covered) + len(missed)
        detail = f" You covered {len(covered)} of {total} key points." if total else ""
        advice = f" Next time, also mention: {missed[0]}." if missed else ""
        return opening + detail + advice


scorer = InterviewScorer()
