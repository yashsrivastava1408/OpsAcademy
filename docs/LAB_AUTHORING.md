# Writing a unit

A unit is a folder under `server/data/units/`. Adding or changing one needs no code changes: the gateway loads every folder at startup.

```
server/data/units/my-unit/
  unit.json        required   title, level, objectives
  learn.json                  theory sections with optional quizzes
  practice.json               the lab: steps and their checks
  prepare.json                flashcards and interview questions
  casestudy.json              optional long-form case study
```

The folder name is the unit's ID. Use lowercase letters, digits and hyphens.

After editing, run:

```bash
cd server
npm run labs:validate            # structure: must report 0 errors
npm run labs:audit               # behaviour: runs every check in an empty Docker sandbox
cd ../ai-hub
python scripts/build_corpus.py   # refresh the mentor's knowledge base
```

CI runs the validator and fails if the knowledge base is stale.

## unit.json

```json
{
  "id": "my-unit",
  "title": "My Unit",
  "description": "One or two sentences shown on the dashboard card.",
  "difficulty": "beginner",
  "duration": "45 min",
  "category": "Linux",
  "objectives": ["What the learner will be able to do"]
}
```

`id` must equal the folder name. `difficulty` is `beginner`, `intermediate` or `advanced`.

## practice.json

```json
{
  "steps": [
    {
      "step": 1,
      "title": "Create a Project Structure",
      "description": "One paragraph on what this step is about and why.",
      "tasks": [
        "Create a directory called `webapp` in your home directory",
        "Inside `webapp`, create subdirectories: `src` and `public`"
      ],
      "verification": {
        "command": "test -d /home/student/webapp/src && test -d /home/student/webapp/public && echo PASS || echo FAIL",
        "expectedOutput": "PASS",
        "check": "exact"
      }
    }
  ]
}
```

Steps are numbered 1, 2, 3 in order.

**Tasks** are shown to the student. Put commands, file names and tool names in backticks: they are rendered as code, the mentor uses them to work out which tools the step expects, and the abuse scanner is tested against every one of them.

**Verification** runs inside the student's sandbox when they press Verify. It is never sent to the browser.

| `check` | Passes when |
|---|---|
| `exact` | trimmed stdout equals `expectedOutput` |
| `contains` | stdout contains `expectedOutput` |
| `exitCode` | the command exits 0 |

### Writing a good check

- **It must fail on an empty sandbox.** `npm run labs:audit` lists checks that pass before any work is done; those verify nothing.
- **Check the end state, not the keystrokes.** Test that the file exists and has the right content or permissions, so any correct approach passes.
- **Use absolute paths under `/home/student`.** In PTY mode they are mapped to the session's own folder.
- **Use `test -d`, `test -f`, `test -x` and `grep -q ... <file>` for paths.** The mentor reads these to tell a student exactly which files are missing. It never reveals the patterns you grep for.
- **Finish within 10 seconds.** Longer checks are cut off and count as failed.
- **Only use tools that are in the sandbox image** (`sandbox-image/Dockerfile`). The audit lists steps that need something missing. Sandboxes have no network by default.

## learn.json

```json
{
  "sections": [
    {
      "id": "permissions",
      "title": "File Permissions",
      "content": [
        { "type": "text", "value": "Every file has an owner, a group and..." },
        { "type": "code", "language": "bash", "value": "chmod 755 deploy.sh" }
      ],
      "quiz": {
        "question": "What does chmod 755 grant the group?",
        "options": ["Nothing", "Read only", "Read and execute", "Everything"],
        "correctIndex": 2,
        "explanation": "5 is read (4) plus execute (1)."
      }
    }
  ]
}
```

Section IDs must be unique within the unit. `content` may also be a single Markdown-style string. A correct quiz answer is checked on the server and earns XP once.

## prepare.json

```json
{
  "flashcards": [
    { "id": "fc-1", "front": "What does the pipe symbol do?", "back": "Sends stdout of the left command to stdin of the right." }
  ],
  "interviewQuestions": [
    {
      "id": "iq-1",
      "question": "A server's disk is 95% full. Walk me through it.",
      "difficulty": "intermediate",
      "modelAnswer": "1. `df -h` to find the full partition...",
      "keyPoints": ["df -h for partition overview", "du -sh for directory sizes", "Log rotation as prevention"]
    }
  ]
}
```

IDs must be unique within the unit: flashcard review schedules and interview scores are stored against them, so do not renumber existing ones.

`keyPoints` are the rubric for the mock interview. An answer covers a point when it contains the command quoted in it, names its technical terms, or shares at least half of its meaningful words. Write points as short, concrete phrases that a good answer would naturally contain. Without `keyPoints`, the steps of `modelAnswer` are used instead, which is rougher.

## Older layouts

Five units were written before this format settled. The loader still accepts `modules` for `sections`, `questions` for `interviewQuestions`, and `question`/`answer` flashcards, and `labs:validate --verbose` lists them as warnings. Use the names above for new content.
