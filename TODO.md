# To do

Ideas and unfinished work for this project, separate from `README.md`.

## New ideas, not started

**Timestamp in the modal's top bar.** Show when the chat was started, at the
top of the modal, alongside the rest of the header.

**A proper one-sentence summary for the card.** `SessionCard.summary` today
is just Claude Code's own auto-generated session summary, refreshed after
each turn — not written for the purpose. Fetch a real single-sentence
"what's happening in this session" summary on its own cheap cadence (once in
a while, not every turn) instead. Belongs in the session-tracking half of
the Node engine once that's ported over from `ai_board` (see the "ai_board
split" section below) — it's card-state logic, not something `interface/`
draws.

**Group a run of tool pills into one card.** Moved over from `ai_board`'s
own list — a constraint on `opts.inlineTools`, really, not a separate
feature: a dozen tool calls in a row currently draw a dozen separate pills,
which is right for two or three and a wall of near-identical rows past
that. A run of consecutive tool entries should collapse into one card:
collapsed shows only the most recent command, one line, with a way to open
it and see the full run. Worth doing while `flowHTML`/`pillsHTML` are
fresh (see `interface/chat.js`).

**A permission-mode switcher inside the chat window.** Also moved from
`ai_board`. A way to change Claude Code's mode — auto, accept edits, plan,
and the rest — from inside an open session, not only at launch. Straddles
both halves of the split: the control belongs in the shared chat window
(`interface/`), the plumbing in the session engine. Cheapest once the Node
engine port below has actually landed, since the plumbing is that engine's.

**Pull out shared code as a private GitHub package.** Any code here reused by
other builds (deployed on Vercel, so no local `file:` symlink trick) should
move into its own repo and get published as a private package on GitHub
Packages, then installed as a normal dependency here and in the other
projects that need it.

`package.json` now exists in this repo (`@tiagopedras/ai-chat-engine`,
`publishConfig` pointed at `npm.pkg.github.com`) — `interface/chat.js` and
`chat.css` are the package; `engine.py`/`http_glue.py` stay copy-in
reference code, per the README. Pushed to
`github.com/tiagopedras/ai-chat-engine` (private repo, personal account).

**Still open: `npm publish`.** Nothing is installable yet — needs
`npm publish` from this repo (with a GitHub token that has `write:packages`)
to actually put a version on `npm.pkg.github.com`, then `to-dos` and the
other host swapped over from copying the `interface/` files to installing
the package.

## ai_board split — `interface/` half done, Node engine still to come

`ai_board` is folding its card-tracking and chat backend into this package
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
   was actually session-tracking out of `ai_board`'s original — every
   project/section/geometry method (`createProject`, `groupCards`,
   `arrange`, `moveProject`, `folders`, `move`, `windowRect`, `view`, …) is
   gone, since that's board work and stays with `ai_board`. See the
   README's "The Node engine" section for the full API and the two store
   interfaces.

   Type-checks and builds clean (`npm run build`). Verified at runtime:
   `describeTool`, `unwrapSlashCommand`, `detectLiveSessions` against fake
   inputs, `checkAuth` against the real installed CLI on this machine (a
   real authenticated response came back), and `SessionPool`/`ChatEngine`
   constructing and wiring correctly against fake store implementations.
   Not yet exercised: an actual session spawned end to end through
   `SessionPool.create()` — that costs a real Agent SDK run, which wasn't
   spent without asking — and `ai_board` actually adopting this as its own
   main-process layer, the integration that will really prove the store
   ports are shaped right.

   Still open, unchanged: whether `engine.py` (CLI-based) and this Node
   engine (Agent-SDK-based) stay two peer implementations of one contract
   or whether one becomes the reference — `engine.py` has no equivalent of
   the SDK's `canUseTool` hook, so it can't drive permission prompts the
   way this engine does.

`ai_board` (`ai-board-00`'s session) is building its side — the multi-window
grid, peek mode, and depth ordering — against the `interface/` contract
above, and is holding off on removing `SessionModal.tsx` until this
package's window covers what it needs.
