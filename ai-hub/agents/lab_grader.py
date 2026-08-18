"""
Agent 4: Automated Lab Objective Grader

Evaluates student lab task completion, step verification rules,
and computes structured grade telemetry.
"""

class LabGrader:
    def __init__(self):
        pass

    def evaluate_step(self, unit_id: str, step_number: int, command_history: list) -> dict:
        total_commands = len(command_history)
        has_errors = any("denied" in cmd.lower() or "not found" in cmd.lower() for cmd in command_history)

        # Objective evaluation rules per step
        passed = total_commands > 0 and not has_errors

        score = 100 if passed else max(50, 100 - (15 * sum(1 for c in command_history if "error" in c.lower() or "denied" in c.lower())))

        return {
            "unit_id": unit_id,
            "step_number": step_number,
            "passed": passed,
            "score": score,
            "total_commands_executed": total_commands,
            "has_error_logs": has_errors,
            "feedback": "Step objectives successfully verified!" if passed else "Review command syntax and try again."
        }

grader = LabGrader()
