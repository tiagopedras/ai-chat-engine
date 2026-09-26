"""Wires an `Engine` into a `http.server`-style request handler.

This is the reference glue for a Python host. It is not a server on its own —
it has no `do_GET`/`do_POST` of its own — it is a small set of methods a
host's existing `BaseHTTPRequestHandler` subclass calls into, because most
small local tools (this one included) already have one of those and gain
nothing from a second HTTP stack sitting next to it.

A host wires nine routes and one guard header. Route names are the host's own
choice; these are only the ones this repo's apps happen to use:

    GET  /claude.json              -> endpoints.status()
    GET  /claude/sessions.json     -> endpoints.sessions()
    GET  /claude/transcript.json   -> endpoints.transcript(session, cwd)
    GET  /claude/attachable.json   -> endpoints.attachable(query)
    POST /claude/forget            -> endpoints.forget(owner, session)
    POST /claude/assign            -> endpoints.assign(owner, session, to)
    POST /claude/note              -> endpoints.note(owner, session, prompt)
    POST /claude/attach            -> endpoints.attach(owner, session, cwd, title)
    POST /claude                   -> endpoints.stream(handler, payload)

Every POST is refused unless the request carries the guard header (default
`X-Board: 1`). Any page in any tab can POST to 127.0.0.1 — that is what CSRF
is — but a header a form cannot set forces a preflight the host does not
answer, so the request never leaves the page that tried it. It costs one
header and it closes the hole; see `endpoints.guard_ok(handler)`.
"""

import json
import re

from engine import MAX_PROMPT, MAX_TITLE, OWNER_KEY, SESSION_ID, RunLimitError, transcript_read


class ChatEndpoints:
    def __init__(self, engine, guard_header="X-Board", guard_value="1"):
        self.engine = engine
        self.guard_header = guard_header
        self.guard_value = guard_value

    def guard_ok(self, handler):
        return handler.headers.get(self.guard_header) == self.guard_value

    # ---- GETs, each returns a plain dict the host JSON-encodes ----

    def status(self):
        return self.engine.status()

    def sessions(self):
        return {"chats": self.engine.sessions.read()}

    def transcript(self, session_id, cwd):
        """Returns (dict, None) on success, or (None, error_dict) — the host
        turns a bad id into a 400 and a missing transcript into a 404."""
        if not SESSION_ID.match(session_id or ""):
            return None, {"error": "not a session id"}
        got = transcript_read(session_id, cwd)
        if got is None:
            return None, {"error": "no transcript on disk for that session"}
        return got, None

    def attachable(self, query=None):
        """Sessions Claude Code has on disk that this engine doesn't already
        know about — conversations that started in a terminal, or in Claude
        Desktop, rather than from this app. For a host offering "attach a
        session that started elsewhere". query narrows the list before the
        cap in list_sessions(), for a host with a search box above the
        rows."""
        return {"sessions": self.engine.list_sessions(query=query)}

    # ---- POSTs ----

    def forget(self, owner, session_id):
        if not OWNER_KEY.match(owner or "") or not SESSION_ID.match(session_id or ""):
            return None, {"error": "bad owner or session id"}
        return {"ok": self.engine.sessions.forget(owner, session_id)}, None

    def assign(self, owner, session_id, to_owner):
        """Re-files one conversation under a different owner. For a host that
        lets filing be decided after the fact — a card dragged onto something,
        a session picked up from a list and pointed at a task."""
        if not OWNER_KEY.match(owner or "") or not OWNER_KEY.match(to_owner or ""):
            return None, {"error": "bad owner key"}
        if not SESSION_ID.match(session_id or ""):
            return None, {"error": "not a session id"}
        return {"ok": self.engine.sessions.assign(owner, session_id, to_owner)}, None

    def attach(self, owner, session_id, cwd, title):
        """Files a session Claude Code already has on disk under an owner
        here, the same as if it had been started from this app — the filing
        itself is record(), the one that already runs at the end of a normal
        run. cwd is required: a row with no working directory is one this
        engine could never resume, since that is how it finds the transcript
        again."""
        if not OWNER_KEY.match(owner or "") or not SESSION_ID.match(session_id or ""):
            return None, {"error": "bad owner or session id"}
        cwd = str(cwd or "")
        if not cwd:
            return None, {"error": "no working directory for that session"}
        title = str(title or "Untitled conversation")[:MAX_TITLE]
        self.engine.sessions.record(owner, session_id, title, "ask", cwd)
        return {"ok": True}, None

    def note(self, owner, session_id, prompt):
        """Records the prompt a conversation was started to run, once the
        host has learned its id — see SessionStore.set_prompt for why."""
        if not OWNER_KEY.match(owner or "") or not SESSION_ID.match(session_id or ""):
            return None, {"error": "bad owner or session id"}
        prompt = str(prompt or "")[:MAX_PROMPT]
        return {"ok": self.engine.sessions.set_prompt(owner, session_id, prompt)}, None

    def stream(self, handler, payload):
        """Runs a prompt and writes the NDJSON response straight onto
        `handler`. Returns nothing on success — the response is already sent.
        On a gating failure (no CLI, work mode off, too many runs, bad
        payload) returns `(status_code, error_dict)` instead, and the host is
        expected to answer with `handler._json(status, error_dict)` since
        nothing has been written to the wire yet."""
        prompt = str(payload.get("prompt") or "").strip()
        if not prompt:
            return 400, {"error": "no prompt"}
        if len(prompt) > MAX_PROMPT:
            return 413, {"error": "prompt too long"}

        mode = payload.get("mode") if payload.get("mode") in ("write", "work") else "ask"
        session = str(payload.get("session") or "")
        session = session if SESSION_ID.match(session) else ""
        owner = str(payload.get("owner") or payload.get("chat") or "")
        owner = owner if OWNER_KEY.match(owner) else ""
        title = str(payload.get("title") or prompt).strip().replace("\n", " ")

        try:
            gen = self.engine.run(prompt, mode, session, owner, title)
        except RunLimitError as err:
            return 429, {"error": str(err)}
        except PermissionError as err:
            return 403, {"error": str(err)}
        except RuntimeError as err:
            return 501, {"error": str(err)}

        handler.send_response(200)
        handler.send_header("Content-Type", "application/x-ndjson")
        handler.end_headers()
        try:
            for line in gen:
                handler.wfile.write((line + "\n").encode())
                handler.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # The tab was closed, or Stop was pressed. Either way nobody is
            # reading any more; dropping the generator runs its cleanup.
            gen.close()
        return None
