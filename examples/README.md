# examples/

`notes_demo.py` is a second, unrelated app on top of `ai_chat` — three
hardcoded notes, each able to carry its own Claude chat thread. It exists to
prove the module actually works somewhere other than `to-dos`, not to be a
real notes app: no editing, no deleting, nothing saved except which chat key
belongs to which note and the sessions themselves.

Run it:

```
python3 examples/notes_demo.py
```

Opens `http://127.0.0.1:8766/notes.html`. It reads `engine.py` and
`http_glue.py` straight from the parent folder, the same way `to-dos` does,
and serves `interface/chat.js` + `chat.css` live rather than copying them in.

Two things it does differently from `to-dos`, both deliberately, to prove
they're actually configurable and not hardcoded assumptions baked into the
module:

- **A different guard header** — `X-Notes-Demo: 1` instead of `X-Board: 1`,
  passed to both `ChatEndpoints(engine, guard_header=..., guard_value=...)`
  and `AIChat.create({guardHeader: {...}})`.
- **A different owner shape** — a note's id rather than a task's, with the
  chat key stored in `data/notes.json` rather than a `chat:` tag on a
  markdown line. `ai_chat` never sees either; it only ever sees the key.

`data/` here is this demo's own state (`claude.json`, `sessions.json`,
`notes.json`) and is gitignored, same as `to-dos/data/`.
