import os
import requests

class AIMentor:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY") or os.getenv("GEMINI_API_KEY")

    def generate_hint(self, query: str, assessment: dict, docs: list) -> str:
        # Fallback intelligent rule-based synthesis if no cloud API key is present
        doc_context = " ".join(docs)
        issue = assessment.get("detected_issue")

        if issue == "PERMISSION_DENIED":
            return (
                "💡 **Hint:** It looks like you ran into a permission barrier!\n\n"
                "Linux uses permissions (Read, Write, Execute) to protect files. "
                "Try checking the file's current permissions with `ls -la`. If you need to make it executable, use `chmod +x <filename>`."
            )
        elif issue == "PATH_NOT_FOUND":
            return (
                "💡 **Hint:** Linux couldn't find the file or folder you specified.\n\n"
                "First, confirm where you are right now by typing `pwd`. Then run `ls` to see what files exist in your current directory before using relative paths."
            )
        elif "docker" in query.lower() or "container" in query.lower():
            return (
                "💡 **Docker Hint:** Remember the container lifecycle!\n\n"
                f"{doc_context}\n\n"
                "Try checking running containers with `docker ps` or list all containers with `docker ps -a`."
            )
        elif "git" in query.lower() or "branch" in query.lower():
            return (
                "💡 **Git Hint:** Think about your current branch state.\n\n"
                f"{doc_context}\n\n"
                "Run `git status` to see uncommitted changes or `git branch` to check which branch you're currently on."
            )
        elif "k8s" in query.lower() or "pod" in query.lower() or "kubectl" in query.lower():
            return (
                "💡 **Kubernetes Hint:** Debugging Pods in 3 steps:\n\n"
                "1. `kubectl get pods` to check pod status\n"
                "2. `kubectl describe pod <name>` to read event logs\n"
                "3. `kubectl logs <name>` to view container stdout errors."
            )
        else:
            return (
                f"💡 **OpsAcademy Mentor:** Great effort!\n\n"
                f"Here is a key concept to keep in mind: {docs[0] if docs else 'Break down the command step-by-step.'}\n\n"
                "Try running `ls` or checking the step instructions if you feel stuck!"
            )

mentor = AIMentor()
