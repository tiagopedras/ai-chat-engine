# ai_chat

Lets any local, single-user tool give a thing it tracks — a task, a ticket, a
note — its own list of Claude Code conversations, each running against the
local CLI and answering in a modal over the host's own page. Pulled out of
`to-dos`'s board, which is still the reference integration.

One piece is required, the rest is optional and a host takes only what it
needs:

- **`interface/chat.js` + `interface/chat.css`** — required. The modal
  itself, plus the "chats on this thing" list a host embeds in its own page.
  Vanilla JS, one global (`window.AIChat`), no build step, no dependency.
  Import this file itself, or point a `<script src>` at it — never copy its
  contents in, or a fix made here stops reaching whichever host has the
  copy.
- **`engine.py`** — optional. Spawns `claude`, streams its `stream-json`
  output, and keeps an index of which sessions belong to which owner. No web
  framework. Only a Python host needs this file at all.
- **`http_glue.py`** — optional, and only meaningful alongside `engine.py`.
  Wires an `Engine` into a `http.server`-style request handler. A host that
  already runs its own small server can read this file for the shape rather
  than importing it, and reimplement the same five routes in whatever
  language and framework it actually uses.

`chat.js` doesn't know or care which of those a host picked. It makes
exactly five calls — `status`, `sessions`, `transcript`, `run`, `forget` —
and by default sends each one over `fetch` to the HTTP contract below, which
is what `engine.py` + `http_glue.py` answer. A host with no HTTP between its
page and Claude at all — an Electron renderer talking over IPC, say — skips
both Python files, passes `transport` to `AIChat.create()` instead, and
implements those same five calls however it actually reaches Claude. See the
`opts.transport` doc comment above `makeDefaultTransport` in `chat.js` for
the exact shape each method must return. Only the methods a transport
supplies override the fetch-based default, so overriding just `run` (the one
that actually needs a live process behind it) and leaving `status`,
`sessions`, `transcript` and `forget` on plain HTTP is a valid middle ground
too.

## Installing it as a package

This repo is also `@tiagopedras/ai-chat-engine` on GitHub Packages — the
`interface/` files stay exactly the vanilla JS/CSS they always were, this
just gives a host a version to pin instead of a file to copy.

```
# in the installing repo's .npmrc
@tiagopedras:registry=https://npm.pkg.github.com
```

```
npm install @tiagopedras/ai-chat-engine
```

```html
<link rel="stylesheet" href="node_modules/@tiagopedras/ai-chat-engine/interface/chat.css">
<script src="node_modules/@tiagopedras/ai-chat-engine/interface/chat.js"></script>
```

or, from a bundler, `import '@tiagopedras/ai-chat-engine/chat.js'` (sets
`window.AIChat`) and `import '@tiagopedras/ai-chat-engine/chat.css'`.
`engine.py` and `http_glue.py` are still copy-in reference code, not part of
the npm package — see the wiring section below.

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

## Wiring it into a host with no HTTP (a custom transport)

Skip `engine.py` and `http_glue.py` entirely and answer the same five calls
directly in JS. Nothing here changes because of *how* a transport method
reaches Claude — an Electron preload bridge, a WebSocket, anything — only
that it returns what's documented above `makeDefaultTransport` in `chat.js`.

```js
const chat = AIChat.create({
  transport: {
    status: () => window.myBridge.chatStatus(),
    sessions: () => window.myBridge.chatSessions(),
    transcript: (sessionId, cwd) => window.myBridge.chatTranscript(sessionId, cwd),
    forget: (owner, session) => window.myBridge.chatForget(owner, session),
    // `run` is the one that has to stream: an async generator yielding one
    // stream-json line (as a string) at a time, same as a fetch reader would.
    async *run(payload, signal) {
      for await (const line of window.myBridge.chatRun(payload, signal)) yield line;
    }
  }
});
```

`window.myBridge` there is whatever the host already exposes across its own
process boundary — for an Electron app that's a `contextBridge` API backed
by `ipcMain` handlers, wrapping whatever the host already uses to run Claude
rather than spawning a second `claude` process next to it.

## Wiring it into a page

```html
<link rel="stylesheet" href="/ai-chat/chat.css">
<script src="/ai-chat/chat.js"></script>
<script>
  const chat = AIChat.create({
    ownerLabel: id => lookUpSomeTitleFor(id),   // shown under the modal's title
    onSessionsChanged: () => { /* re-render whatever list you show */ },
    // Fires the instant a message is sent — before the run starts, let alone
    // replies — so a host can react to "this conversation just began"
    // without waiting on a reply. `session` is empty on a brand new
    // conversation's first message, set on every send after that.
    onSend: ({ owner, key, session, ask, mode }) => {
      // if (!session) startSomethingElseAlongsideThisChat(owner, ask)
    },
    // desktopLink: false,   // drop the "Open in Claude" button — a host
                              // that's already a Claude client itself, say
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

## Making it look like the host, not like `to-dos`

`chat.css` ships vanilla — the neutral palette `to-dos` happens to use — and
every value a host is likely to want its own version of is a `--aic-*`
custom property on `:root`, so restyling it is an override, never a fork.
Two groups:

```css
:root {
  /* colour */
  --aic-bg: #fff; --aic-panel: #fff; --aic-ink: #111; --aic-ink-soft: #555;
  --aic-ink-faint: #999; --aic-line: #ddd; --aic-line-soft: #eee;
  --aic-accent: #7c3aed; --aic-accent-ink: #fff;
  --aic-red: #c00; --aic-amber: #a60; --aic-chip: #f2f2f2;

  /* shape and type */
  --aic-font: ui-sans-serif, system-ui, sans-serif;
  --aic-radius: 20px;      /* the modal itself */
  --aic-radius-sm: 8px;    /* input, rows, chips */
  --aic-radius-xs: 6px;    /* buttons, icons */
  --aic-modal-w: min(640px, calc(100vw - 32px));
  --aic-modal-h: min(80vh, 800px);
  --aic-gap: 10px;
  --aic-pad: 16px;
}
```

Set these on the page's own `:root`, or on whatever element the widget's
markup ends up under — `chat.css`'s own defaults only apply where nothing
more specific wins, same as any other CSS. Nothing else in the file needs
touching, and there is no build step to run after changing them.

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
on by default), two conversations running at once, and the `transport`
option — added for a non-HTTP host but not yet wired into one end to end.
