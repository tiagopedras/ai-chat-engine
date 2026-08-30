# To do

Ideas and unfinished work for this project, separate from `README.md`.

## New ideas, not started

**Timestamp in the modal's top bar.** Show when the chat was started, at the
top of the modal, alongside the rest of the header.

**Pull out shared code as a private GitHub package.** Any code here reused by
other builds (deployed on Vercel, so no local `file:` symlink trick) should
move into its own repo and get published as a private package on GitHub
Packages, then installed as a normal dependency here and in the other
projects that need it.

`package.json` now exists in this repo (`@tiagopedras/ai-chat-engine`,
`publishConfig` pointed at `npm.pkg.github.com`) — `interface/chat.js` and
`chat.css` are the package; `engine.py`/`http_glue.py` stay copy-in
reference code, per the README. Not yet published: needs a `git init` /
push to `github.com/tiagopedras/ai-chat-engine` and `npm publish` to go
live, then `to-dos` and the other host swapped over from copying the files
to installing the package.
