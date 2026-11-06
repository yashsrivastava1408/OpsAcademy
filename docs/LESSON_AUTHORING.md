# Writing a lesson

A unit's theory lives in `server/data/units/<unit>/learn.json`. Every lesson has the same shape, and
`server/tests/lessons.test.js` fails if one does not. The shape exists for the reader: a student who opens any unit should
know within ten seconds why it matters, what they will be able to do, and where each part ends.

## Shape

```jsonc
{
  "overview": {
    "why": "2-4 sentences: where this shows up in real work and in interviews, in plain words.",
    "prerequisites": ["What to know first (link to other units by name)."],
    "outcomes": ["3-6 things the learner can DO after it, starting with a verb."],
    "placementTip": "One concrete tip for interviews or placements."
  },
  "sections": [
    {
      "id": "kebab-case-unique-id",
      "title": "What is X?",
      "content": [ /* blocks, below */ ],
      "keyPoints": ["2-4 short takeaways, shown in a box at the end of the section."],
      "quiz": { "question": "...", "options": ["a", "b", "c", "d"], "correctIndex": 1, "explanation": "Why it is right." }
    }
  ],
  "cheatsheet": { "title": "Linux cheat sheet", "rows": [["command or term", "what it does"]] }
}
```

- 4 or more sections, each ending in `keyPoints` and a one-question `quiz` (the server checks the answer).
- 8 or more cheat-sheet rows: the commands or ideas a student will want next to them.

## Blocks

| `type` | Fields | Use it for |
| :--- | :--- | :--- |
| `text` | `value` | A paragraph. `**bold**` and `` `code` `` work. |
| `heading` | `value`, `level` (3 or 4) | A sub-heading inside a section. |
| `list` | `items[]`, `ordered` | Steps or points. |
| `table` | `header[]`, `rows[][]` | Comparisons. Every row has as many cells as the header. |
| `code` | `value`, `title` | A command or file. The learner can copy it. |
| `callout` | `style` (`info`, `tip`, `warning`), `value` | Something to notice. |
| `mermaid` | `value`, `title` | A diagram that shows how parts connect. |
| `diagram` | `value`, `title` | A plain-text diagram. |
| `markdown` | `value` | Markdown text, for pasting existing notes. Prefer structured blocks in new work. |

## Writing for students

- Start with the problem the thing solves, then the thing. Say what breaks without it.
- One idea per paragraph. Short sentences. Explain a term the first time it appears.
- Show a real command or file, then say what each part does. Name the common mistake.
- Use an interview or workplace situation to show why it matters ("a disk is full, what do you do?").
- Do not state numbers you cannot source. If a figure is marketing, leave it out.
- Keep quiz answers short and the wrong options believable.

## After editing

```bash
cd server && npx jest tests/lessons.test.js     # the shape
cd server && npm run labs:validate               # lab steps still make sense
cd ai-hub && python scripts/build_corpus.py      # refresh the mentor's knowledge base (CI fails if stale)
```
