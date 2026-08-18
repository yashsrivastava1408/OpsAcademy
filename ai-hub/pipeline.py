"""
OpsAcademy Multi-Agent RAG Orchestration Pipeline

Connects all 6 cooperative agents:
1. Agent 0: Anti-Abuse Firewall (Regex + Isolation Forest ML + De-obfuscation)
2. Agent 1: Lab Assessor (Error Context Analyzer)
3. Agent 1.5: Container Live Inspector (Ground-truth telemetry)
4. Agent 2: TF-IDF Vector RAG Knowledge Retriever
5. Agent 3: Socratic AI Mentor (3-Tiered Progressive Hint Synthesizer)
6. Agent 4: Automated Lab Objective Grader
"""

from agents.abuse_scanner import scanner
from agents.lab_assessor import assessor
from agents.container_inspector import inspector
from agents.doc_retriever import retriever
from agents.mentor import mentor
from agents.lab_grader import grader

def run_agent_pipeline(user_query: str, unit_id: str = "general", step_number: int = 1, command_history: list = None, container_telemetry: dict = None) -> dict:
    if command_history is None:
        command_history = []

    # Agent 0: Security Scan & De-obfuscation
    abuse_check = scanner.scan(user_query)
    if not abuse_check["safe"]:
        return {
            "success": False,
            "blocked": True,
            "threat_type": abuse_check.get("threat_type"),
            "message": f"🚫 Security Warning: {abuse_check['reason']}",
            "hint": "Please refrain from executing high-risk system modification scripts."
        }

    # Agent 1: Lab Assessment
    assessment = assessor.assess(unit_id, step_number, user_query, command_history)

    # Agent 1.5: Container Diagnostics
    container_diagnostics = inspector.inspect(user_query, assessment, container_telemetry)

    # Agent 2: Vector RAG Knowledge Retrieval
    retrieved_docs = retriever.retrieve(user_query)

    # Agent 3: Tiered Socratic Hinting
    tiered_hints = mentor.generate_tiered_hints(user_query, assessment, retrieved_docs)

    # Agent 4: Automated Step Grading
    grade_report = grader.evaluate_step(unit_id, step_number, command_history)

    return {
        "success": True,
        "blocked": False,
        "assessment": assessment,
        "diagnostics": container_diagnostics,
        "grade_report": grade_report,
        "retrieved_docs_count": len(retrieved_docs),
        "hint": tiered_hints["combined_hint"],
        "tiered_hints": tiered_hints,
    }
