from agents.abuse_scanner import scanner
from agents.lab_assessor import assessor
from agents.doc_retriever import retriever
from agents.mentor import mentor

def run_agent_pipeline(user_query: str, unit_id: str = "general", step_number: int = 1, command_history: list = None) -> dict:
    if command_history is None:
        command_history = []

    # Step 1: Agent 0 (Anti-Abuse Scan)
    abuse_check = scanner.scan(user_query)
    if not abuse_check["safe"]:
        return {
            "success": False,
            "blocked": True,
            "threat_type": abuse_check.get("threat_type"),
            "message": f"🚫 Security Warning: {abuse_check['reason']}",
            "hint": "Please refrain from executing high-risk system modification scripts."
        }

    # Step 2: Agent 1 (Lab Assessment)
    assessment = assessor.assess(unit_id, step_number, user_query, command_history)

    # Step 3: Agent 2 (Doc Retrieval RAG)
    retrieved_docs = retriever.retrieve(user_query)

    # Step 4: Agent 3 (AI Mentor Hint Synthesis)
    hint_text = mentor.generate_hint(user_query, assessment, retrieved_docs)

    return {
        "success": True,
        "blocked": False,
        "assessment": assessment,
        "retrieved_docs_count": len(retrieved_docs),
        "hint": hint_text
    }
