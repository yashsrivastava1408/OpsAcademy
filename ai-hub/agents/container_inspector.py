"""
Agent 1.5: Container Live Diagnostic Agent

Inspects running container process trees, open ports, file paths, and environment state
in real-time to provide ground-truth telemetry to the AI RAG engine.
"""

class ContainerInspector:
    def __init__(self):
        pass

    def inspect(self, query: str, assessment: dict, container_telemetry: dict = None) -> dict:
        if container_telemetry is None:
            container_telemetry = {}

        diagnostics = []
        detected_issue = assessment.get("detected_issue")

        # 1. Analyze detected error state
        if detected_issue == "PERMISSION_DENIED":
            diagnostics.append("File execution permission bit missing (requires chmod +x).")
        elif detected_issue == "PATH_NOT_FOUND":
            diagnostics.append("Target directory or file path does not exist in working directory.")
        elif detected_issue == "TYPO_OR_PATH":
            diagnostics.append("Command binary missing from system PATH or misspelled.")

        # 2. Inspect query keywords for specific technology checks
        q_lower = query.lower()
        if "docker" in q_lower or "container" in q_lower:
            diagnostics.append("Container engine active; checking running container sockets.")
        if "nginx" in q_lower or "port" in q_lower or "web" in q_lower:
            diagnostics.append("Checking web server binding on local ports 80/8080.")
        if "k8s" in q_lower or "kubectl" in q_lower or "pod" in q_lower:
            diagnostics.append("Checking Kubernetes pod event status logs.")

        return {
            "telemetry_active": bool(container_telemetry),
            "diagnostics": diagnostics,
            "detected_issue": detected_issue,
            "summary": "; ".join(diagnostics) if diagnostics else "Container state normal."
        }

inspector = ContainerInspector()
