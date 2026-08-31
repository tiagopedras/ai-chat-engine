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
   `opts.inlineTools` (tool calls as visible pills), `opts.thinkingGlyphs`
   (the CLI's cycling asterisk), and markdown parity (ordered lists,
   `__bold__`). See the README's "Several open at once, and windowed mode"
   and "Permission prompts" sections. Verified in a real Chromium session
   (multi-instance isolation, drag/resize math, the permission round trip,
   the FLIP animation settling correctly, `aic-chatting`'s open-count fix so
   one window closing doesn't strip it while another is still open) — not
   just read over.

   Known gaps, called out rather than silently skipped: renaming a
   conversation by double-clicking its title (`SessionModal.tsx` has this,
   `chat.js` doesn't yet), and `SessionModal`'s five typed transcript entry
   kinds (`user`/`assistant`/`tool`/`result`/`error`) vs this module's
   ask-and-reply turns — `inlineTools` gets most of the visible effect
   without that deeper data-model change.

2. **The Node engine (`session.ts`, `sessionPool.ts`, `chatEngine.ts`,
   `describeTool.ts`, `auth.ts`, `liveness.ts`, and the card/chat types) —
   not started.** This is the bigger half: ~1,600 lines to port out of
   `ai_board`, geometry stripped from the card shape, persistence turned
   into a `CardStore` interface the host implements rather than a file
   format this package owns, `@anthropic-ai/claude-agent-sdk` as a peer
   dependency, no `electron` import. Exported as a `/node` subpath
   (`@tiagopedras/ai-chat-engine/node`) once it exists. Also still open:
   whether `engine.py` (CLI-based) and this Node engine (Agent-SDK-based)
   stay two peer implementations of one contract or whether one becomes the
   reference — `engine.py` has no equivalent of the SDK's `canUseTool` hook,
   so it can't drive permission prompts the way the Node engine will.

`ai_board` (`ai-board-00`'s session) is building its side — the multi-window
grid, peek mode, and depth ordering — against the `interface/` contract
above, and is holding off on removing `SessionModal.tsx` until this
package's window covers what it needs.
