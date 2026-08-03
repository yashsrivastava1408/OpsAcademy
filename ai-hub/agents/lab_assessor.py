class LabAssessor:
    def __init__(self):
        pass

    def assess(self, unit_id: str, step_number: int, user_query: str, command_history: list) -> dict:
        recent_cmd = command_history[-1] if command_history else ""
        
        assessment = {
            "unit_id": unit_id,
            "step_number": step_number,
            "recent_command": recent_cmd,
            "status": "in_progress",
            "context_summary": f"Student is working on Step {step_number} of {unit_id}."
        }

        # Check for common mistakes based on command history
        if "permission denied" in recent_cmd.lower():
            assessment["detected_issue"] = "PERMISSION_DENIED"
            assessment["suggestion"] = "Remember to check file permissions with 'ls -la' or use 'chmod +x'."
        elif "command not found" in recent_cmd.lower():
            assessment["detected_issue"] = "TYPO_OR_PATH"
            assessment["suggestion"] = "Check the command spelling or verify if the package/binary is installed."
        elif "no such file or directory" in recent_cmd.lower():
            assessment["detected_issue"] = "PATH_NOT_FOUND"
            assessment["suggestion"] = "Use 'pwd' to check your current working directory and 'ls' to see existing files."
        else:
            assessment["detected_issue"] = None
            assessment["suggestion"] = "Proceeding with task execution."

        return assessment

assessor = LabAssessor()
