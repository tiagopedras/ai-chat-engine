# ai_chat_engine improvements

The standing list of what is still wrong with this app and what should be built
next. It holds the state of the tool, not the work.

Read it before diagnosing anything here. If a problem is already written down,
what is wanted is progress on the fix, not another report of the symptom. When
something lands or something new turns up, edit this file rather than only saying
so in chat.

Split below into Small — a sitting change, no new data model or view — and Big —
needs a decision, a new tag, or a new piece of the app before it can be built.

## Small

## Big

- **`cards.js` has no tests of its own.** It went in on 4 Sep 2026 with the
  layout arithmetic lifted out of ai_canvas, and it is covered only indirectly:
  ai_canvas's suite exercises it through a real canvas, and to-dos'
  `kanban/test_canvas.mjs` through a real board. That is fine while those are
  the only two hosts and thin for something meant to be a building block —
  every function in it is pure, plain objects in and plain objects out, which
  is exactly the shape that needs no browser and no host to test. A small
  `test/cards.mjs` running on plain node would cover `arrangeRow`'s ordering,
  `containBox`'s floor and its empty cases, `nextZ` across a Map and an array,
  and `resolveMembers` finding a card by either of its two identities.

- **A way to test this package on its own.** Every change to `chat.js` so far
  has been checked by driving it from a host: running ai_canvas, opening a
  card, clicking through the window. That makes improving the widget depend on
  a consuming app being in a working state, and it spends real Agent SDK turns
  to look at a button.

  What is missing is a harness inside this repo. A plain HTML page that loads
  `interface/chat.js` and `chat.css` straight off disk and drives them through
  a scripted transport, with canned stream-json lines instead of a backend: no
  CLI, nothing to spend, nothing to install. Enough scripts to reach every
  branch the window has, since each is a place a bug can hide: a plain reply,
  tool calls inline, a run that stops on a permission request, one that fails
  mid-run, one slow enough to watch the thinking indicator. Then buttons for
  what a host drives from outside, which is the half no host exercises
  deliberately: `setHeader`, `setRect`, `setZIndex`, `setActive`, opening a
  second instance, `destroy`, and a count of `.aic-wrap` in the document.

  That last one is the case for building it. The leak `destroy()` fixed in
  0.4.0 was found through a failing assertion in ai_canvas about a project
  name, three steps removed from the cause. A count in a harness would have
  shown it on the second click.

  `examples/notes_demo.py` is not this. It proves the module works in a second
  host, which is a different question, and it goes through `engine.py` and the
  real CLI.

  This is separate from getting a change *into* a host, which is already
  solved: `npm pack` here, then `npm install --no-save <tarball>` there. Worth
  writing into the README, since it is not obvious, and since `--no-save`
  means a later plain `npm install` in the host silently removes it again.

- **Enter in the chat input sends the message.** Right now only Cmd+Enter
  submits; plain Enter should trigger send too (Shift+Enter for a newline).

- **Theme the chat window to the host's own CSS.** `chat.css` today ships one
  fixed look. A host should be able to make the window match its own design
  system — colours, fonts, radii — rather than standing out as a foreign
  widget.

- **Closing animation should shrink back toward the card.** Opening already
  does a FLIP grow from the card's own rect; closing doesn't mirror it — the
  window doesn't animate back down to where the card is, so it reads as
  closing in place rather than returning to its source.

- **Timestamp in the modal's top bar.** Show when the chat was started, at the
  top of the modal, alongside the rest of the header.

- **A proper one-sentence summary for the card.** `SessionCard.summary` today
  is just Claude Code's own auto-generated session summary, refreshed after
  each turn — not written for the purpose. Fetch a real single-sentence
  "what's happening in this session" summary on its own cheap cadence (once in
  a while, not every turn) instead. Belongs in the session-tracking half of
  the Node engine once that's ported over from `ai_canvas` (see the "ai_canvas
  split" section below) — it's card-state logic, not something `interface/`
  draws.

- **Group a run of tool pills into one card.** Moved over from `ai_canvas`'s
  own list — a constraint on `opts.inlineTools`, really, not a separate
  feature: a dozen tool calls in a row currently draw a dozen separate pills,
  which is right for two or three and a wall of near-identical rows past
  that. A run of consecutive tool entries should collapse into one card:
  collapsed shows only the most recent command, one line, with a way to open
  it and see the full run. Worth doing while `flowHTML`/`pillsHTML` are
  fresh (see `interface/chat.js`).

- **A permission-mode switcher inside the chat window.** Also moved from
  `ai_canvas`. A way to change Claude Code's mode — auto, accept edits, plan,
  and the rest — from inside an open session, not only at launch. Straddles
  both halves of the split: the control belongs in the shared chat window
  (`interface/`), the plumbing in the session engine. Cheapest once the Node
  engine port below has actually landed, since the plumbing is that engine's.

- **Pull out shared code as a private GitHub package.** Any code here reused by
  other builds (deployed on Vercel, so no local `file:` symlink trick) should
  move into its own repo and get published as a private package on GitHub
  Packages, then installed as a normal dependency here and in the other
  projects that need it.

  `package.json` now exists in this repo (`@tiagopedras/ai-chat-engine`,
  `publishConfig` pointed at `npm.pkg.github.com`) — `interface/chat.js` and
  `chat.css` are the package; `engine.py`/`http_glue.py` stay copy-in
  reference code, per the README. Pushed to
  `github.com/tiagopedras/ai-chat-engine` (private repo, personal account).

- **Still open: `npm publish`.** Nothing is installable yet — needs
  `npm publish` from this repo (with a GitHub token that has `write:packages`)
  to actually put a version on `npm.pkg.github.com`, then `to-dos` and the
  other host swapped over from copying the `interface/` files to installing
  the package.

## ai_canvas split — `interface/` half done, Node engine still to come

`ai_canvas` is folding its card-tracking and chat backend into this package
(agreed with Tiago, coordinated with `ai-board-00` across sessions on
2026-08-31). Two halves:

1. **The shared chat window (`interface/chat.js`/`chat.css`) — done, this
   session.** `opts.windowed` (drag, resize, FLIP grow/shrink from a card's
   own rect, host-driven `setRect`/`setZIndex`/`setActive`, never deciding
   its own position or depth), multi-instance support (each `create()` call
   is independent — several can be open at once), a permission-prompt
   banner (`board_permission` line + `transport.answerPermission`),
   `opts.inlineTools` (the full turn in chronological order — text as
   markdown prose, tool calls as pills, in the order they actually
   happened, for a live run), `opts.thinkingGlyphs` (the CLI's cycling
   asterisk), and markdown parity (ordered lists, `__bold__`). See the
   README's "Several open at once, and windowed mode" and "Permission
   prompts" sections. Verified in a real Chromium session — multi-instance
   isolation, drag/resize math, the permission round trip, the FLIP
   animation settling correctly, `aic-chatting`'s open-count fix so one
   window closing doesn't strip it while another is still open, and the
   flow ordering itself (text → tool → tool → text, in that exact order,
   confirmed against the rendered DOM) — not just read over.

   `ai-board-00` flagged that the five typed transcript kinds
   (`user`/`assistant`/`tool`/`result`/`error`) aren't a nice-to-have —
   each renders differently and that *is* the transcript's content, so a
   first pass that only pill-ified tool calls without fixing the ordering
   would have blocked adoption. `inlineTools` now covers all of it: a
   bubble, markdown prose, a pill row, red text, in the order they
   happened. One real gap left: renaming a conversation by double-clicking
   its title (`SessionModal.tsx` has this, `chat.js` doesn't yet) — minor
   by comparison, still open.

   Ordering for a *replayed* transcript was still an approximation until
   `ai-board-00` fixed `chatEngine.ts`'s `ChatTurn` shape (`parts:
   {type,text|name+input}[]`, in original block order, alongside the
   unchanged `reply`/`tools` so nothing that reads only those breaks) and
   flagged that `engine.py` had the identical gap. Both now send `parts`;
   `chat.js`'s `loadTranscript` reads it when present, non-empty, and falls
   back to the old tools-then-text guess otherwise. Verified both paths
   render correctly in the same Chromium session.

2. **The Node engine — ported, this session.** `node/src/{session,
   sessionPool,chatEngine,describeTool,slashCommand,auth,liveness,types}.ts`,
   exported as `@tiagopedras/ai-chat-engine/node`. Geometry and project
   membership stripped from `SessionCard`/`CreateSessionInput`/
   `ResumeSessionInput` per the split; persistence is now `CardStore` and
   `ChatStore`, two small interfaces a host implements rather than a file
   format this package owns; `@anthropic-ai/claude-agent-sdk` is a peer
   dependency; no `electron` import anywhere. `SessionPool` kept only what
   was actually session-tracking out of `ai_canvas`'s original — every
   project/section/geometry method (`createProject`, `groupCards`,
   `arrange`, `moveProject`, `folders`, `move`, `windowRect`, `view`, …) is
   gone, since that's board work and stays with `ai_canvas`. See the
   README's "The Node engine" section for the full API and the two store
   interfaces.

   Type-checks and builds clean (`npm run build`). Verified at runtime:
   `describeTool`, `unwrapSlashCommand`, `detectLiveSessions` against fake
   inputs, `checkAuth` against the real installed CLI on this machine (a
   real authenticated response came back), and `SessionPool`/`ChatEngine`
   constructing and wiring correctly against fake store implementations.
   Not yet exercised: an actual session spawned end to end through
   `SessionPool.create()` — that costs a real Agent SDK run, which wasn't
   spent without asking — and `ai_canvas` actually adopting this as its own
   main-process layer, the integration that will really prove the store
   ports are shaped right.

   Still open, unchanged: whether `engine.py` (CLI-based) and this Node
   engine (Agent-SDK-based) stay two peer implementations of one contract
   or whether one becomes the reference — `engine.py` has no equivalent of
   the SDK's `canUseTool` hook, so it can't drive permission prompts the
   way this engine does.

`ai_canvas` (`ai-board-00`'s session) is building its side — the multi-window
grid, peek mode, and depth ordering — against the `interface/` contract
above, and is holding off on removing `SessionModal.tsx` until this
package's window covers what it needs.
