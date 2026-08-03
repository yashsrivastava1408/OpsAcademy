from flask import Flask, request, jsonify
from flask_cors import CORS
import config
from pipeline import run_agent_pipeline
from agents.abuse_scanner import scanner

app = Flask(__name__)
CORS(app)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "opsacademy-ai-hub",
        "port": config.PORT,
        "agents": ["abuse_scanner", "lab_assessor", "doc_retriever", "ai_mentor"]
    })

@app.route("/api/agent/scan", methods=["POST"])
def scan_command():
    data = request.get_json() or {}
    command = data.get("command", "")
    result = scanner.scan(command)
    return jsonify({"success": True, "data": result})

@app.route("/api/agent/hint", methods=["POST"])
def get_hint():
    data = request.get_json() or {}
    query = data.get("query", "")
    unit_id = data.get("unitId", "general")
    step_number = data.get("stepNumber", 1)
    command_history = data.get("commandHistory", [])

    result = run_agent_pipeline(query, unit_id, step_number, command_history)
    return jsonify({"success": True, "data": result})

if __name__ == "__main__":
    print(f"🚀 OpsAcademy AI Agent Hub starting on port {config.PORT}...")
    app.run(host="0.0.0.0", port=config.PORT, debug=True)
