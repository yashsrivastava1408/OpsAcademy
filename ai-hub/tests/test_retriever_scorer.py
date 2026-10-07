import pytest

from agents.doc_retriever import DocRetriever, retriever
from agents.interview_scorer import derive_points, scorer, technical_terms


# ── retriever ────────────────────────────────────────────────

def test_corpus_is_built_from_every_unit():
    assert len(retriever.docs) > 200
    assert len({doc["unit"] for doc in retriever.docs}) == 19


@pytest.mark.parametrize("query,unit", [
    ("how do I make a script executable with chmod", "linux-basics"),
    ("resolve a merge conflict", "git-basics"),
    ("multi-stage Dockerfile to shrink the image", "docker-basics"),
    ("what is a kubernetes pod", "kubernetes-basics"),
    ("terraform remote state locking", "terraform-iac"),
    ("CAP theorem", "system-design-scalability"),
])
def test_finds_the_right_unit_without_being_told(query, unit):
    assert retriever.retrieve(query, top_k=3)[0]["unit"] == unit


def test_tolerates_typos_through_character_ngrams():
    assert retriever.retrieve("kubernets depoyment replicas", top_k=3)[0]["unit"] == "kubernetes-basics"


def test_results_are_ordered_and_capped():
    results = retriever.retrieve("docker container image", top_k=5)
    assert len(results) == 5
    assert [r["score"] for r in results] == sorted((r["score"] for r in results), reverse=True)
    assert len({r["id"] for r in results}) == 5


@pytest.mark.parametrize("query", ["", "   ", None])
def test_empty_query_returns_nothing(query):
    assert retriever.retrieve(query) == []


def test_the_current_unit_is_preferred_when_content_overlaps():
    # "secrets" are covered in several units.
    query = "how should secrets be stored"
    for unit in ("kubernetes-basics", "cicd-pipelines"):
        assert retriever.retrieve(query, unit_id=unit, top_k=1)[0]["unit"] == unit


def test_unit_boost_does_not_invent_matches():
    results = retriever.retrieve("CrashLoopBackOff", unit_id="git-basics", top_k=3)
    assert all("git-basics" != r["unit"] for r in results[:1])


def test_small_custom_corpus():
    custom = DocRetriever([
        {"id": "a", "unit": "u1", "unit_title": "One", "section": "s", "title": "Apples", "text": "Apples are red fruit."},
        {"id": "b", "unit": "u2", "unit_title": "Two", "section": "s", "title": "Boats", "text": "Boats float on water."},
    ])
    assert [r["id"] for r in custom.retrieve("red apples")] == ["a"]
    assert custom.retrieve("zzzzqqqq") == []
    assert DocRetriever([]).retrieve("anything") == []


# ── interview scorer ─────────────────────────────────────────

QUESTION = "A production server's disk is 95% full. How do you diagnose and fix it?"
KEY_POINTS = ["df -h for partition overview", "du -sh for directory sizes", "find -size for large files", "Log rotation as prevention"]
MODEL = ("1. Check overall disk usage with `df -h` to see which partition is full.\n"
         "2. Find the largest directories with `du -sh /* | sort -rh | head`.\n"
         "3. Find big individual files: `find /var -size +100M -type f`.\n"
         "4. Clean up: rotate logs with logrotate and clear old archives.\n"
         "5. Prevention: set up log rotation and disk usage alerts.")


def test_model_answer_scores_high():
    result = scorer.score(QUESTION, MODEL, KEY_POINTS, MODEL)
    assert result["score"] >= 90
    assert result["missed"] == []
    assert result["rubricDerived"] is False


def test_partial_answer_names_what_was_missed():
    answer = "I would run df -h to see which partition is full, then use du -sh on the big directories to find what is using the space."
    result = scorer.score(QUESTION, answer, KEY_POINTS, MODEL)
    assert result["covered"] == KEY_POINTS[:2]
    assert result["missed"] == KEY_POINTS[2:]
    assert 30 <= result["score"] <= 75
    assert KEY_POINTS[2] in result["feedback"]
    assert "2 of 4" in result["feedback"]


def test_vague_answer_scores_low():
    answer = "I would look at the server and figure out the problem, then fix whatever is wrong and tell my manager about it afterwards."
    result = scorer.score(QUESTION, answer, KEY_POINTS, MODEL)
    assert result["score"] < 25
    assert result["covered"] == []


def test_keyword_stuffing_without_substance_does_not_reach_full_marks():
    result = scorer.score(QUESTION, "df -h du -sh find -size log rotation", KEY_POINTS, MODEL)
    assert result["breakdown"]["substance"] < 20
    assert result["score"] < 90


def test_more_coverage_never_scores_lower():
    answers = [
        "I would investigate.",
        "I would run df -h to check the partitions.",
        "I would run df -h to check the partitions and du -sh to size the directories.",
        "I would run df -h to check the partitions, du -sh to size directories, find -size for large files, and set up log rotation as prevention.",
    ]
    scores = [scorer.score(QUESTION, a, KEY_POINTS, MODEL)["score"] for a in answers]
    assert scores == sorted(scores)
    assert scores[-1] > scores[0] + 50


def test_rubric_is_derived_from_the_model_answer_when_missing():
    result = scorer.score(QUESTION, MODEL, [], MODEL)
    assert result["rubricDerived"] is True
    assert len(result["covered"]) == 5
    assert result["score"] >= 90
    assert scorer.score(QUESTION, "No idea, sorry, I have never seen this before in my life.", [], MODEL)["score"] < 20


def test_derive_points_falls_back_to_sentences():
    points = derive_points("We keep state in a remote backend. Locking stops two people applying at once. Short.")
    assert points == ["We keep state in a remote backend.", "Locking stops two people applying at once."]
    assert len(derive_points("\n".join(f"{i}. step number {i} here" for i in range(1, 12)))) == 6


def test_technical_terms_are_recognised():
    assert technical_terms("describe_addresses API call") == ["describe_addresses"]
    assert technical_terms("collections.Counter for counting") == ["collections.counter"]
    assert technical_terms("Checking AssociationId existence") == ["associationid"]
    assert technical_terms("curl -sf flag for quiet error checking") == ["-sf"]
    assert technical_terms("Groups for team access control") == []


def test_naming_the_technical_term_covers_the_point():
    answer = "I call describe_addresses and release anything that has no association, since unattached addresses cost money every hour."
    result = scorer.score("How do you find unused elastic IPs?", answer, ["describe_addresses API call", "release_address execution"], "")
    assert result["covered"] == ["describe_addresses API call"]


@pytest.mark.parametrize("answer", ["", "   ", None])
def test_empty_answer_scores_zero(answer):
    assert scorer.score(QUESTION, answer, KEY_POINTS, MODEL)["score"] == 0


def test_no_rubric_and_no_model_answer_does_not_crash():
    result = scorer.score(QUESTION, "Some answer that is reasonably long but has nothing to compare against.", None, "")
    assert result["covered"] == [] and result["missed"] == []
    assert 0 <= result["score"] <= 20


def test_junk_key_points_are_ignored():
    result = scorer.score(QUESTION, MODEL, [None, 3, "", "df -h for partition overview"], MODEL)
    assert result["covered"] == ["df -h for partition overview"]
