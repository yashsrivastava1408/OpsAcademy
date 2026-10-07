import hmac
import logging

from flask import Flask, jsonify, request

import config
from agents.abuse_scanner import scanner
from agents.interview_scorer import scorer
from agents.llm import llm
from agents.mentor import MAX_TIER
from agents.doc_retriever import retriever
from pipeline import hint_cache, run_agent_pipeline

MAX_BODY_BYTES = 256 * 1024
PUBLIC_PATHS = {"/health"}


def as_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

    @app.before_request
    def require_internal_token():
        # The hub is called by the gateway, never by browsers. With a token
        # configured, anything else that reaches it is turned away.
        if not config.INTERNAL_TOKEN or request.path in PUBLIC_PATHS:
            return None
        supplied = request.headers.get("x-internal-token", "")
        if not hmac.compare_digest(supplied.encode(), config.INTERNAL_TOKEN.encode()):
            return jsonify({"success": False, "error": "Forbidden"}), 403
        return None

    @app.errorhandler(404)
    def not_found(_err):
        return jsonify({"success": False, "error": "Not found"}), 404

    @app.errorhandler(413)
    def too_large(_err):
        return jsonify({"success": False, "error": "Request body too large"}), 413

    @app.errorhandler(Exception)
    def unexpected(err):
        app.logger.exception("request failed: %s", err)
        return jsonify({"success": False, "error": "Internal Server Error"}), 500

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({
            "status": "ok",
            "service": "opsacademy-ai-hub",
            "agents": ["abuse_scanner", "lab_assessor", "container_inspector", "doc_retriever", "ai_mentor", "interview_scorer"],
            "knowledge_base_chunks": len(retriever.docs),
            "llm": {"enabled": llm.available, "model": config.LLM_MODEL if llm.available else None},
            "hint_cache": {"size": len(hint_cache.items), "hits": hint_cache.hits, "misses": hint_cache.misses},
        })

    @app.route("/api/agent/scan", methods=["POST"])
    def scan_command():
        data = request.get_json(silent=True) or {}
        command = data.get("command", "")
        if not isinstance(command, str):
            return jsonify({"success": False, "error": "command must be a string"}), 400
        return jsonify({"success": True, "data": scanner.scan(command)})

    @app.route("/api/agent/hint", methods=["POST"])
    def get_hint():
        data = request.get_json(silent=True) or {}
        query = data.get("query", "")
        if not isinstance(query, str) or not query.strip():
            return jsonify({"success": False, "error": "query is required"}), 400

        history = data.get("commandHistory") or []
        step = data.get("step")
        telemetry = data.get("containerTelemetry")

        result = run_agent_pipeline(
            query,
            unit_id=str(data.get("unitId") or "general"),
            step_number=as_int(data.get("stepNumber"), 1),
            command_history=[c for c in history if isinstance(c, str)] if isinstance(history, list) else [],
            container_telemetry=telemetry if isinstance(telemetry, dict) else None,
            step=step if isinstance(step, dict) and step.get("title") else None,
            tier=max(1, min(MAX_TIER, as_int(data.get("tier"), 1))),
        )
        return jsonify({"success": True, "data": result})

    @app.route("/api/agent/interview/score", methods=["POST"])
    def score_interview():
        data = request.get_json(silent=True) or {}
        answer = data.get("answer", "")
        if not isinstance(answer, str) or not answer.strip():
            return jsonify({"success": False, "error": "answer is required"}), 400

        key_points = data.get("keyPoints")
        report = scorer.score(
            str(data.get("question") or ""),
            answer,
            key_points=key_points if isinstance(key_points, list) else [],
            model_answer=str(data.get("modelAnswer") or ""),
        )
        return jsonify({"success": True, "data": report})

    return app


app = create_app()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    # Development server only. In containers the hub runs under gunicorn (see Dockerfile).
    app.run(host="0.0.0.0", port=config.PORT, debug=False)
