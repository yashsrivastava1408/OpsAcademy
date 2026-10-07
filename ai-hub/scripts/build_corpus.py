"""
Build the AI hub's knowledge base from the course content.

Reads server/data/units and writes:
  data/corpus.json    - learn sections and flashcards, chunked for retrieval
  data/commands.json  - every command the labs teach (benign baseline for the
                        anomaly model)

Run from the repo root or ai-hub/:  python scripts/build_corpus.py
Re-run whenever unit content changes; CI fails if the output is stale.
"""

import json
import re
import sys
from pathlib import Path

HUB_DIR = Path(__file__).resolve().parent.parent
UNITS_DIR = HUB_DIR.parent / "server" / "data" / "units"
DATA_DIR = HUB_DIR / "data"

CHUNK_WORDS = 110
SKIP_KEYS = {"id", "type", "language", "correctIndex", "unitId"}


def strings_in(node):
    """Yield every human-readable string inside a JSON value."""
    if isinstance(node, str):
        if node.strip():
            yield node.strip()
    elif isinstance(node, list):
        for item in node:
            yield from strings_in(item)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key not in SKIP_KEYS:
                yield from strings_in(value)


def chunk_text(text, size=CHUNK_WORDS):
    """Split on paragraph boundaries into chunks of roughly `size` words."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n|\n(?=[-*#\d])", text) if p.strip()]
    chunks, current, count = [], [], 0
    for paragraph in paragraphs:
        words = len(paragraph.split())
        if current and count + words > size:
            chunks.append("\n".join(current))
            current, count = [], 0
        current.append(paragraph)
        count += words
    if current:
        chunks.append("\n".join(current))
    return chunks


def build_corpus():
    corpus = []
    for unit_dir in sorted(p for p in UNITS_DIR.iterdir() if (p / "unit.json").exists()):
        unit_id = unit_dir.name
        meta = json.loads((unit_dir / "unit.json").read_text())

        learn_path = unit_dir / "learn.json"
        if learn_path.exists():
            learn = json.loads(learn_path.read_text())
            for section in learn.get("sections") or learn.get("modules") or []:
                body = "\n\n".join(strings_in(section.get("content")))
                for index, chunk in enumerate(chunk_text(body)):
                    corpus.append({
                        "id": f"{unit_id}/{section['id']}/{index}",
                        "unit": unit_id,
                        "unit_title": meta["title"],
                        "section": section["id"],
                        "title": section.get("title", ""),
                        "kind": "learn",
                        "text": chunk,
                    })

        prepare_path = unit_dir / "prepare.json"
        if prepare_path.exists():
            prepare = json.loads(prepare_path.read_text())
            # Cards are authored as front/back or question/answer.
            for index, card in enumerate(prepare.get("flashcards", [])):
                corpus.append({
                    "id": f"{unit_id}/flashcard/{card.get('id', index + 1)}",
                    "unit": unit_id,
                    "unit_title": meta["title"],
                    "section": "flashcards",
                    "title": card.get("front") or card["question"],
                    "kind": "flashcard",
                    "text": card.get("back") or card["answer"],
                })
    return corpus


def build_commands():
    """Commands quoted in backticks in lab tasks: what normal student input looks like."""
    commands = set()
    for practice_path in sorted(UNITS_DIR.glob("*/practice.json")):
        practice = json.loads(practice_path.read_text())
        for step in practice.get("steps", []):
            for text in [step.get("description", ""), *step.get("tasks", [])]:
                for snippet in re.findall(r"`([^`]+)`", text):
                    snippet = snippet.strip()
                    # Keep things that are run: they start like a program
                    # name or path, not like prose, YAML or a heading.
                    if re.match(r"[a-z./~][\w./~+-]*(\s|$)", snippet):
                        commands.add(snippet)
    return sorted(commands)


def render(value):
    return json.dumps(value, indent=1, ensure_ascii=False) + "\n"


def main():
    outputs = {
        DATA_DIR / "corpus.json": render(build_corpus()),
        DATA_DIR / "commands.json": render(build_commands()),
    }

    if "--check" in sys.argv:
        stale = [path.name for path, content in outputs.items() if not path.exists() or path.read_text() != content]
        if stale:
            print(f"Stale: {', '.join(stale)}. Run: python scripts/build_corpus.py")
            return 1
        print("Knowledge base is up to date.")
        return 0

    DATA_DIR.mkdir(exist_ok=True)
    for path, content in outputs.items():
        path.write_text(content)
        print(f"Wrote {path.relative_to(HUB_DIR)} ({len(json.loads(content))} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
