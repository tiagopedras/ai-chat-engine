# ai_chat

Lets any local, single-user tool give a thing it tracks — a task, a ticket, a
note, a card on a canvas — its own list of Claude Code conversations,
answering in a modal (or a window it places itself) over the host's own
page. Pulled out of `to-dos`'s board, which is still the reference
integration for the modal; `ai_canvas` is the reference integration for the
Node engine.

One piece is required, the rest is optional and a host takes only what it
needs:

- **`interface/chat.js` + `interface/chat.css`** — required. The modal
  itself, plus the "chats on this thing" list a host embeds in its own page.
  Vanilla JS, one global (`window.AIChat`), no build step, no dependency.
  Import this file itself, or point a `<script src>` at it — never copy its
  contents in, or a fix made here stops reaching whichever host has the
  copy.
- **`interface/cards.js`** — optional, and the companion to the file above.
  `chat.js` draws one conversation; this draws none, and holds instead the
  arithmetic a host needs to lay several of them out on a canvas: where a
  card sits, which group it belongs to, the box around a group and how that
  box refuses to be smaller than what is in it. Pure functions over plain
  objects, no DOM and no Node built-ins, so the same file serves an Electron
  main process reasoning about a canvas it never draws and a browser page
  drawing one it never persists. Named ESM exports, plus one global
  (`window.AICards`) for a host loading it with a script tag. `cards.d.ts`
  beside it types the lot. It stores nothing: a host keeps its own file and
  this module never learns its shape, the same boundary the Node engine
  draws.
- **`engine.py`** — optional. Spawns `claude`, streams its `stream-json`
  output, and keeps an index of which sessions belong to which owner. No web
  framework. Only a Python host needs this file at all.
- **`http_glue.py`** — optional, and only meaningful alongside `engine.py`.
  Wires an `Engine` into a `http.server`-style request handler. A host that
  already runs its own small server can read this file for the shape rather
  than importing it, and reimplement the same five routes in whatever
  language and framework it actually uses.
- **`node/` (`@tiagopedras/ai-chat-engine/node`)** — optional, and this
  package's other engine: a TypeScript session-tracking layer built on the
  Claude Agent SDK, for a Node host that wants a live, stateful card per
  session — permission prompts included — rather than one CLI process per
  prompt. See "The Node engine" below. Only a Node host needs this at all,
  and only one that wants more than `chat.js`'s modal by itself gives it.

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

Neither mode asks a per-tool question — `ask` refuses the tools outright,
`work` never refuses at all. A backend that drives the Claude Agent SDK
directly (rather than spawning the `claude` CLI, as `engine.py` does) can
offer a third answer, a supervised mode where each tool call waits on a
person: see "Permission prompts" below. `engine.py` does not implement this
today — the CLI has no equivalent of the SDK's `canUseTool` hook to drive it
from — so this is real for an SDK-backed engine and not yet for the one in
this repo.

## Permission prompts

Optional, and only worth wiring if a host's backend actually asks a per-tool
question (see the note above). When a run is waiting on one, its transport
sends one more synthetic line on the same NDJSON stream `run()` already
returns:

```json
{"type": "board_permission", "requestId": "...", "toolName": "Bash",
 "title": "Claude wants to run a command", "description": "rm -rf build/",
 "canAlwaysAllow": true}
```

The modal shows it as a banner between the header and the transcript —
Allow (primary), Always allow only when `canAlwaysAllow` is true, Deny — and
disables the composer the same way a running turn already does. A click
calls `transport.answerPermission(requestId, decision)`, `decision` being
`'allow'`, `'allow_always'` or `'deny'`. The banner is cleared the moment the
run's next event arrives, whether or not it was this click that resolved
it — a rule the SDK itself applied, or a different client entirely,
clears it exactly the same way.

`answerPermission` is the one call in the transport contract that is
genuinely optional: a transport that never defines it is a silent no-op
(the banner would simply never appear, since nothing would ever send a
`board_permission` line to begin with), not a thrown error. On the default
HTTP transport it activates only if `opts.endpoints.permission` is set —
there is no default path, because `http_glue.py`'s reference server has no
route to answer it yet.

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
| `/claude/transcript.json` | GET | `?session=<id>&cwd=<cwd>` | `{turns: [...], toobig, path}` — each turn `{ask, reply, tools}` plus `parts`: the same content in the order it actually happened, read in preference to `reply`/`tools` when present |
| `/claude/forget` | POST | `{owner, session}` | `{ok}` |
| `/claude` | POST | `{prompt, mode, session, owner, title}` | `application/x-ndjson`, streamed: the CLI's own `stream-json` lines, plus a synthetic `{"type":"board_start",...}` first and a synthetic `{"type":"board_error",...}` if the run ends with no `result` line |
| *(none by default)* | POST | `{requestId, decision}` | optional — see "Permission prompts" above. Point `opts.endpoints.permission` at whatever route your backend answers this on; `http_glue.py` doesn't define one. |

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

## Several open at once, and windowed mode

Every `AIChat.create()` call is a fully independent instance — its own DOM,
its own state — so a host that wants several chats open simultaneously (one
per card on a canvas, say) just calls `create()` once per window rather than
sharing one. Nothing about the plain modal above changes for a host that
never does this.

`opts.windowed: true` swaps the fixed, centred, scrim-backed modal for a
window a host places and moves itself: draggable by its header, resizable
from any edge or corner, and grown out of a card's own on-screen rectangle
via a FLIP animation rather than appearing over it — the same technique
`claude-chat-interface-findings.md`'s host apps use, so the thing you
clicked and the thing you get read as the same object. What it does *not*
do is decide where it sits: this module stays deliberately incurious about
*why* a rect changed, so a multi-window grid, a "peek" mode, and one shared
depth order across windows and whatever else is on the host's canvas all
stay the host's own code, never this file's.

```js
const win = AIChat.create({
  windowed: true,
  scrim: false,           // several windows open at once want no per-window dimmer;
                           // defaults to false when windowed, true otherwise
  onRectLive: rect => { /* every live change, mid-drag included */ },
  onRectChange: rect => { /* a drag or resize just committed — save it */ },
  onFocus: () => { /* bring this one to the front of your own z-order */ }
});

win.growFrom(cardEl.getBoundingClientRect());   // before the open call that follows
win.openSession(ownerId, ownerKey, sessionId);

win.setRect(savedRectOrGridCell);   // a rect this window did not choose — applied
                                     // as-is, never clamped, and never while a local
                                     // drag is in progress
win.setZIndex(920);
win.setActive(isTopWindow);         // only the active instance's Escape closes it
```

Two richer-transcript options pair naturally with windowed mode, since both
are about a full work session rather than a short read-only answer, but
either works standalone:

- `opts.inlineTools: true` — replaces the collapsed trace with the whole
  turn, in the order it happened: text as markdown prose (the same styling
  a plain reply gets), a row of pills wherever one or more tool calls fall
  in that order. Chronological for a live run, since `handleRunEvent` builds
  it as events actually arrive; a replayed transcript is chronological too
  once its transport sends the `parts` field described under "The HTTP
  contract" above, and falls back to an approximation (tools, then the
  text) against one that doesn't.
- `opts.thinkingGlyphs: true` — the CLI's own cycling asterisk
  (`· ✢ ✳ ∗ ✻ ✽ ✻ ∗ ✳ ✢`) instead of the plain spinning ring, in the same
  spot in the status line.

What's still `SessionModal`-only and hasn't moved here: renaming a
conversation by double-clicking its title. `inlineTools` covers what its
five typed entry kinds actually render as (a bubble, markdown prose, a
pill, red text) — the one open question was ordering, not styling, and that
gap is closed for a live run.

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

## The Node engine (`@tiagopedras/ai-chat-engine/node`)

Everything above is `engine.py`'s world: one CLI process per run, `ask` and
`work` as the only two modes, nothing that tracks a card's state between
runs. `node/` is a second, TypeScript engine that drives the
`@anthropic-ai/claude-agent-sdk` directly instead — a long-lived session per
card rather than one CLI process per prompt, permission prompts a person
can actually answer, and a `SessionCard` that stays current as the session
runs rather than being replayed after the fact. It answers a different,
larger question than `engine.py` does, not a faster version of the same one
— see "Two engines, one contract" below for where they overlap and where
they don't.

Ported out of `ai_canvas`, which drove this split: it wanted to fold its own
card-tracking and chat backend into this package rather than keep
reinventing them per host. Stripped out along the way, per the boundary
that split agreed on — a host's own business, not a session's:

- **Geometry.** No `x`/`y`/`width`/`height`/`z` anywhere in a `SessionCard`.
  A host positions its own cards; this engine only says what state one is
  in.
- **Projects, grouping, view state.** Sections, canvas layout, which view a
  host is in — none of it exists here. A host that wants to group cards
  keeps its own mapping, keyed by the card's identity (see "Two identities,
  resolved once" below).
- **A file format.** Persistence is two small interfaces a host implements,
  not a store this package owns — see "The two store ports" below.

### Installing it

```
npm install @tiagopedras/ai-chat-engine
```

```ts
import { SessionPool, ChatEngine, type SessionCard } from '@tiagopedras/ai-chat-engine/node'
```

`@anthropic-ai/claude-agent-sdk` is a peer dependency (`^0.3`) — a host
installs its own copy rather than getting one bundled, the same reasoning
`react-dom` is a peer of a component library rather than a dependency of
one. Node 18+, matching the SDK's own requirement.

### `SessionPool` — the card-tracking half

One instance per host, holding every session it's tracking, live or
parked. The public surface, grouped by what it does:

```ts
new SessionPool(events: PoolEvents, store: CardStore)

await pool.load()                                  // restores parked cards, checks auth
pool.list(): SessionCard[]                          // every card, live and parked
pool.create(input: CreateSessionInput): SessionCard
await pool.resume(input: ResumeSessionInput): SessionCard
await pool.wake(id): SessionCard | null             // starts a parked card's process
await pool.pastSessions(): PastSession[]            // sessions on disk, not yet tracked

pool.sendPrompt(id, prompt)
pool.answerPermission(id, requestId, decision)
await pool.interrupt(id)
await pool.close(id)
await pool.closeAll()
pool.rename(id, title)
pool.transcript(id): TranscriptEntry[]

pool.setOpenCards(ids)                              // clears `unread` on the ones open
pool.authState(): AuthState
await pool.refreshAuth(): AuthState
pool.executablePath(): string | undefined           // pass straight to ChatEngine, see below
```

`PoolEvents` is `{onCards(cards), onTranscript({id, entries}), onAuth(state)}`
— a host wires these to however it repaints (an Electron `webContents.send`,
a WebSocket, whatever). Everything moves through these three callbacks
rather than a return value, because a session's own state changes on its
own schedule, not on the host's.

What every host had to build itself in `ai_canvas` and now doesn't:
throttled event batching (a card that's `needs_you` or `error` flushes
immediately; anything else coalesces every 120ms so a dozen live sessions
don't repaint faster than anything can usefully draw), orphan detection
(a parked card whose transcript has been deleted says so rather than
silently failing to wake), and liveness detection (resuming a session
something else is already driving forks it instead of two processes
fighting over one transcript file).

### `ChatEngine` — the same modal, a Node backend

Answers `interface/chat.js`'s five-call contract (plus the optional sixth)
the same way `engine.py` + `http_glue.py` do, but by calling the Agent SDK
directly rather than spawning a `claude` process — useful for a host that
already depends on the SDK for `SessionPool` and would rather not run two
different ways of talking to Claude side by side.

```ts
const engine = new ChatEngine(chatStore, () => pool.authState().status === 'authenticated', {
  resolveOwnerCwd: owner => lookUpAFolderFor(owner),   // only called for a brand-new chat
  executablePath: () => pool.executablePath(),
  onLine: (runId, line) => /* write `line` to whatever this runId's stream is */,
  onEnd: (runId) => /* that stream is done */
})

engine.status()
engine.sessions()
await engine.transcript(sessionId, cwd)
engine.forget(owner, session)
engine.startRun(payload): { runId }
engine.stopRun(runId)
```

Same `ask`-only limit `engine.py` has today — there's no config path to turn
`work` on yet in either engine.

### The two store ports

Persistence is two small interfaces rather than a format this package
owns — a host answers each however it already saves things (`ai_canvas`'s
own `board.json`, adapted, in its case).

```ts
interface CardStore {
  cards(): StoredCard[]                                    // enough to restore parked cards
  put(card: StoredCard): void
  patch(sessionId: string, patch: Partial<StoredCard>): void
  rekey(from: string, to: string): void                     // temporary id -> real SDK session id
  remove(sessionId: string): void
}

interface ChatStore {                                       // mirrors engine.py's SessionStore
  chats(): Record<string, ChatSessionMeta[]>
  recordChat(owner, sessionId, title, mode, cwd): void
  touchChat(owner, sessionId): void
  forgetChat(owner, sessionId): void
}
```

`StoredCard` is `{sessionId, cwd, title, forkedFrom, updatedAt,
lastMessageAt}` — no geometry, no window rect, no project membership. A
host keeps those in its own store, keyed by the same `sessionId`, on
whatever schedule it likes; `SessionPool` never needs to know they exist.
One class can implement both interfaces if a host's store already answers
both; `SessionPool` and `ChatEngine` never assume they're the same object.

### Two identities, resolved once

A card carries two ids: `id`, assigned the moment it's created, and
`sessionId`, the SDK's own, null until the session initialises. Both are
on every `SessionCard` this engine emits, on purpose — a host mapping cards
onto its own grouping needs whichever one its own records were filed
under, and that can be either one depending on when the filing happened.
`ai_canvas` learned this the expensive way: project membership was
re-derived from the card's `id` alone in four different places, and a
session assigned to a project *after* it already had a `sessionId` fell
through every one of them. Resolve `card.sessionId ?? card.id` once, in one
place, and pass the resolved value down — not once per component that
happens to need it.

### Two engines, one contract

`engine.py` and this one both answer `interface/chat.js`'s five-call
contract, by different routes — a spawned CLI process versus the Agent SDK
directly — and for now that's deliberate: peers, not one reference
implementation with the other as a stopgap. The gap between them is real
though. `engine.py` has no equivalent of the SDK's `canUseTool` hook, so it
cannot drive the permission-prompt banner `interface/chat.js`'s `board_permission`
line depends on — that capability only exists on this side of the split.
Whether that gap closes by extending `engine.py`, or by `engine.py` staying
the simple, dependency-free option and this engine the fuller one, is still
open.

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

The Node engine (`node/`) is ported and type-checks and builds clean, and
its pieces are individually verified — `describeTool`, `unwrapSlashCommand`,
`checkAuth` against a real installed CLI (a real authenticated response
came back), `SessionPool`/`ChatEngine` constructing and wiring correctly
against fake store implementations. Not yet exercised: a real session
actually spawned through `SessionPool.create()` end to end, and `ai_canvas`
adopting it as its own main-process layer, which is the integration that
will actually prove the `CardStore`/`ChatStore` ports are the right shape.
