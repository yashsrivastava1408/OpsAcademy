"""Small text helpers shared by the agents."""

import re

STOPWORDS = frozenset(
    "a an and are as at be but by can do does for from has have how i if in into is it its "
    "my of on or so that the their then there these this to up use used using was we what "
    "when where which while who why will with you your not no than them they our out over "
    "also any all each more most other some such only own same too very just should would".split()
)

TOKEN = re.compile(r"[a-z0-9][a-z0-9_+./-]*")


def stem(token: str) -> str:
    """Trim common English endings so 'volumes'/'volume' and 'mounted'/'mount' match."""
    if len(token) > 4 and token.endswith("ies"):
        return token[:-3] + "y"
    if len(token) > 4 and token.endswith(("sses", "shes", "ches", "xes", "zes")):
        return token[:-2]
    if len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    for suffix in ("ing", "ed"):
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)]
    return token


def tokenize(text: str, keep_stopwords: bool = False) -> list:
    tokens = [t.strip("./-") for t in TOKEN.findall(text.lower())]
    return [stem(t) for t in tokens if t and (keep_stopwords or t not in STOPWORDS)]


def backticked(text: str) -> list:
    """Snippets written in `backticks`."""
    return [s.strip() for s in re.findall(r"`([^`]+)`", text) if s.strip()]


def edit_distance(a: str, b: str, limit: int = 2) -> int:
    """Damerau-Levenshtein distance (a swap of neighbours counts as one edit), capped at limit + 1."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    rows = [list(range(len(b) + 1))]
    for i, ca in enumerate(a, 1):
        row = [i]
        for j, cb in enumerate(b, 1):
            cost = min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + (ca != cb))
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cost = min(cost, rows[i - 2][j - 2] + 1)
            row.append(cost)
        rows.append(row)
    return rows[-1][-1]
