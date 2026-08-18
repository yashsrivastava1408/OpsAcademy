import os

class AIMentor:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY") or os.getenv("GEMINI_API_KEY")

    def generate_tiered_hints(self, query: str, assessment: dict, docs: list) -> dict:
        doc_context = " ".join(docs)
        issue = assessment.get("detected_issue")
        q_lower = query.lower()

        # Default Socratic hints
        tier1 = "💡 **Tier 1 (Nudge):** Focus on the core system concept behind this step."
        tier2 = "🔍 **Tier 2 (Diagnostic):** Check your current working environment state before running file modifications."
        tier3 = f"🛠 **Tier 3 (Syntax Guidance):** {docs[0] if docs else 'Break down command arguments step-by-step.'}"

        if issue == "PERMISSION_DENIED":
            tier1 = "💡 **Tier 1 (Nudge):** Linux uses Owner, Group, and Other permission bits to control file execution."
            tier2 = "🔍 **Tier 2 (Diagnostic):** Inspect file permission bits by typing `ls -la` in your terminal."
            tier3 = "🛠 **Tier 3 (Syntax Guidance):** Grant execute permissions using `chmod +x <filename>`."
        elif issue == "PATH_NOT_FOUND":
            tier1 = "💡 **Tier 1 (Nudge):** Linux commands resolve file paths relative to your current working directory."
            tier2 = "🔍 **Tier 2 (Diagnostic):** Confirm your current location with `pwd` and view files using `ls`."
            tier3 = "🛠 **Tier 3 (Syntax Guidance):** Use `mkdir -p <dir>` to build missing directory trees."
        elif "docker" in q_lower or "container" in q_lower:
            tier1 = "💡 **Tier 1 (Nudge):** Remember container lifecycle mechanics — containers share host kernel resources."
            tier2 = "🔍 **Tier 2 (Diagnostic):** Check active containers with `docker ps` or all containers with `docker ps -a`."
            tier3 = "🛠 **Tier 3 (Syntax Guidance):** Run container in detached mode: `docker run -d -p 8080:80 nginx`."
        elif "git" in q_lower or "branch" in q_lower:
            tier1 = "💡 **Tier 1 (Nudge):** Git tracks working tree state and branch HEAD pointers."
            tier2 = "🔍 **Tier 2 (Diagnostic):** Check active uncommitted changes with `git status`."
            tier3 = "🛠 **Tier 3 (Syntax Guidance):** Switch branches: `git checkout -b <branch-name>`."
        elif "k8s" in q_lower or "pod" in q_lower or "kubectl" in q_lower:
            tier1 = "💡 **Tier 1 (Nudge):** Pods are ephemeral; inspect event logs when status shows CrashLoopBackOff."
            tier2 = "🔍 **Tier 2 (Diagnostic):** Read pod lifecycle events using `kubectl describe pod <pod-name>`."
            tier3 = "🛠 **Tier 3 (Syntax Guidance):** Fetch container stdout logs using `kubectl logs <pod-name>`."

        combined_hint = f"{tier1}\n\n{tier2}\n\n{tier3}"

        return {
            "tier1_nudge": tier1,
            "tier2_diagnostic": tier2,
            "tier3_syntax": tier3,
            "combined_hint": combined_hint,
        }

    def generate_hint(self, query: str, assessment: dict, docs: list) -> str:
        tiered = self.generate_tiered_hints(query, assessment, docs)
        return tiered["combined_hint"]

mentor = AIMentor()
