# ai_chat

Lets any local, single-user tool give a thing it tracks — a task, a ticket, a
note — its own list of Claude Code conversations, each running against the
local CLI and answering in a modal over the host's own page. Pulled out of
`to-dos`'s board, which is still the reference integration.

Two halves, and a host uses only the ones it needs:

- **`engine.py`** — spawns `claude`, streams its `stream-json` output, and
  keeps an index of which sessions belong to which owner. No web framework.
  Python hosts import it directly.
- **`http_glue.py`** — wires an `Engine` into a `http.server`-style request
  handler. Optional: any host that already runs its own small server can
  read this file instead of importing it, and reimplement the same five
  routes in whatever language and framework it actually uses.
- **`interface/chat.js` + `interface/chat.css`** — the modal itself, plus the
  "chats on this thing" list a host embeds in its own page. Vanilla JS, one
  global (`window.AIChat`), no build step, no dependency. Works with any
  backend that answers the HTTP contract below — it doesn't have to be
  `engine.py`.

`claude-chat-interface-findings.md`, beside this README, is a teardown of
claude.ai's own chat interface. The modal's design follows it: attribution by
asymmetry rather than avatars, one slot that holds either the send button or
the stop button but never both, a status line whose words are the progress
rather than a spinner. Read it before changing how the modal looks or behaves.

## Why nothing here stores a transcript

Claude Code already writes every session to
`~/.claude/projects/<cwd-slug>/<session-id>.jsonl`. That file is what the CLI
resumes from with `--resume` and what Claude Desktop imports via
`claude://resume?session=`. Keeping a second copy would only go stale the
moment a conversation was carried on anywhere else, so this module never
does — `transcript_read()` in `engine.py` reads that file back, and a
conversation continued in the terminal or in Desktop comes back complete.

What *is* kept, in a small JSON file the host points `Engine` at, is an index:
which session ids sit under which **owner key** — a short id the host mints
once per group of conversations (a task's `chat:xxxxxx` tag, in `to-dos`).
That file is the only state this module owns.

## Modes

`ask`, the default: Bash, Edit, Write, NotebookEdit and Task are removed from
the run outright, not just disallowed — they never appear in Claude's tool
list, so there is nothing to be talked into using. It can read the host's
working directory and answer; it cannot change anything.

`work`: does the job in full, permissions bypassed. `engine.Engine.config()`
only turns this on if the host's own config file says so — a mode that edits
files across disk should be switched on deliberately, not shipped on.

## The HTTP contract

Whatever serves these routes, `interface/chat.js` expects exactly this
shape. Route paths are configurable per instance (`AIChat.create({endpoints:
{...}})` on the JS side, whatever the host's router does on the server
side) — these are the defaults, and what `to-dos` uses them as.

Every POST must carry a guard header (default `X-Board: 1`, also
configurable) or be refused. A page on another origin can still POST to
`127.0.0.1` — that's what CSRF is — but a header a plain HTML form cannot set
forces a preflight the host doesn't answer, so the request never leaves the
page that tried it.

| Route | Method | Body / query | Returns |
|---|---|---|---|
| `/claude.json` | GET | — | `{available, work, cwd, home, model, timeout, config}` |
| `/claude/sessions.json` | GET | — | `{chats: {ownerKey: [{id, title, started, updated, mode, cwd}, ...]}}` |
| `/claude/transcript.json` | GET | `?session=<id>&cwd=<cwd>` | `{turns: [...], toobig, path}` |
| `/claude/forget` | POST | `{owner, session}` | `{ok}` |
| `/claude` | POST | `{prompt, mode, session, owner, title}` | `application/x-ndjson`, streamed: the CLI's own `stream-json` lines, plus a synthetic `{"type":"board_start",...}` first and a synthetic `{"type":"board_error",...}` if the run ends with no `result` line |

`owner` in the POST bodies is the owner key the session should be filed
under — pass `''` for a run that doesn't belong to anything.

## Wiring it into a Python host (`http.server`)

```python
import sys, os
sys.path.insert(0, os.path.expanduser("~/Code/ai_chat"))
from engine import Engine
from http_glue import ChatEndpoints

engine = Engine(
    default_cwd=ROOT,                              # where a run's cwd defaults to
    config_path=os.path.join(ROOT, "data/claude.json"),
    sessions_path=os.path.join(ROOT, "data/sessions.json"),
)
chat = ChatEndpoints(engine)

# in do_GET:
if path == "/claude.json": return self._json(200, chat.status())
if path == "/claude/sessions.json": return self._json(200, chat.sessions())
if path == "/claude/transcript.json":
    got, err = chat.transcript(session_id, cwd)
    return self._json(404, err) if err else self._json(200, got)

# in do_POST:
if path == "/claude":
    if not chat.guard_ok(self): return self._json(403, {"error": "not from the host"})
    err = chat.stream(self, payload)          # writes the streaming response itself
    if err: return self._json(err[0], err[1]) # only if it never started
if path == "/claude/forget":
    if not chat.guard_ok(self): return self._json(403, {"error": "not from the host"})
    got, err = chat.forget(payload.get("owner"), payload.get("session"))
    return self._json(400, err) if err else self._json(200, got)
```

Serve `interface/chat.js` and `interface/chat.css` as static files under
whatever prefix the host likes (`to-dos` uses `/ai-chat/...`, reading
straight from this folder rather than copying it in).

## Wiring it into a page

```html
<link rel="stylesheet" href="/ai-chat/chat.css">
<script src="/ai-chat/chat.js"></script>
<script>
  const chat = AIChat.create({
    ownerLabel: id => lookUpSomeTitleFor(id),   // shown under the modal's title
    onSessionsChanged: () => { /* re-render whatever list you show */ },
  });
  chat.loadStatus();   // call once; no-ops quietly if there's no CLI behind the host

  // Wherever you draw the thing that owns the conversations:
  el.innerHTML += chat.renderSection({ ownerId: id, ownerKey: thing.chatKey, label: 'Chats' });

  // Starting one:
  const key = thing.chatKey || chat.newOwnerKey();
  thing.chatKey = key;               // your job to persist this, however you persist anything
  chat.openNew(id, key, 'optional seed text');
</script>
```

`chat.available()` is false — and `renderSection()` returns `''` — until
`loadStatus()` has confirmed a CLI is actually behind the host. Everything
degrades to "no button" rather than an error: no CLI on PATH, a host too old
to know the routes, a static file server with nothing behind it at all.

## Status

Two integrations exist. `to-dos`'s board, on the `claude-from-the-card`
branch, is the real one — a task's `chat:` tag, its own state object, its
own drawer. `examples/notes_demo.py` is a second, deliberately unrelated app
built to prove the module actually works somewhere else: a different guard
header, a different owner shape, no task board at all. Both were verified
end to end — status, sessions, a live streamed run filed under its owner
key, transcript replay, forget, and the guard header rejecting an
unheadered POST.

Not yet exercised: work mode through a real UI (no host currently turns it
on by default), and two conversations running at once.
