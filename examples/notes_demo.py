#!/usr/bin/env python3
"""A second app on top of ai_chat, unrelated to to-dos on purpose.

Proof that the module is actually reusable rather than merely factored out:
no task board, no drawer, no `chat:` tag on a markdown line — just a handful
of notes, each able to carry its own Claude chat thread, in an app that has
never heard of to-dos. It even uses a different guard header name
(`X-Notes-Demo` instead of `X-Board`) to prove that part is configurable too,
on both the JS side (see notes.html) and here.

Run it with:  python3 examples/notes_demo.py
"""

import http.server
import json
import mimetypes
import os
import sys
import threading
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # ai_chat/
DATA = os.path.join(HERE, "data")     # gitignored — this demo's own state
NOTES_FILE = os.path.join(DATA, "notes.json")
PORT = 8766

sys.path.insert(0, ROOT)
from engine import Engine              # noqa: E402  (path set just above)
from http_glue import ChatEndpoints    # noqa: E402

engine = Engine(
    default_cwd=HERE,
    config_path=os.path.join(DATA, "claude.json"),
    sessions_path=os.path.join(DATA, "sessions.json"),
)
chat = ChatEndpoints(engine, guard_header="X-Notes-Demo", guard_value="1")

DEFAULT_NOTES = [
    {"id": "n1", "title": "Recipe ideas", "body": "Things to cook this month.", "chat": ""},
    {"id": "n2", "title": "Book notes", "body": "What I'm reading and what stuck.", "chat": ""},
    {"id": "n3", "title": "Trip planning", "body": "Loose plans for the next trip.", "chat": ""},
]


def notes_read():
    try:
        with open(NOTES_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return [dict(n) for n in DEFAULT_NOTES]


def notes_write(notes):
    os.makedirs(DATA, exist_ok=True)
    tmp = NOTES_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(notes, fh, indent=2)
    os.replace(tmp, NOTES_FILE)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def log_message(self, fmt, *args):
        pass  # this is a demo, not a tool to watch a terminal for

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(length) if length else b"{}"

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/notes.json":
            return self._json(200, {"notes": notes_read()})
        if path == "/claude.json":
            return self._json(200, chat.status())
        if path == "/claude/sessions.json":
            return self._json(200, chat.sessions())
        if path == "/claude/transcript.json":
            from urllib.parse import parse_qs, urlparse
            q = parse_qs(urlparse(self.path).query)
            got, err = chat.transcript((q.get("session") or [""])[0], (q.get("cwd") or [""])[0])
            return self._json(404 if err else 200, err or got)
        # The widget's own JS and CSS — same live-from-the-folder approach
        # to-dos uses, so both hosts stay proof that nothing here needs
        # copying in.
        if path.startswith("/ai-chat/"):
            rel = path[len("/ai-chat/"):]
            if ".." in rel.split("/"):
                return self._json(404, {"error": "not found"})
            full = os.path.join(ROOT, "dist", rel)
            if not os.path.isfile(full):
                return self._json(404, {"error": "not found"})
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as fh:
                body = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/claude":
            if not chat.guard_ok(self):
                return self._json(403, {"error": "not from this page"})
            try:
                payload = json.loads(self._body().decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                return self._json(400, {"error": "body was not valid JSON"})
            err = chat.stream(self, payload)
            if err:
                return self._json(err[0], err[1])
            return
        if path == "/claude/forget":
            if not chat.guard_ok(self):
                return self._json(403, {"error": "not from this page"})
            try:
                payload = json.loads(self._body().decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                return self._json(400, {"error": "body was not valid JSON"})
            got, err = chat.forget(payload.get("owner"), payload.get("session"))
            return self._json(400 if err else 200, err or got)
        if path == "/notes/key":
            # Mints a chat key for a note that doesn't have one yet, and
            # persists it — this demo's equivalent of to-dos writing a
            # `chat:` tag onto a task line. Every host does this bit itself;
            # ai_chat only mints the key, never where it gets stored.
            if not chat.guard_ok(self):
                return self._json(403, {"error": "not from this page"})
            try:
                payload = json.loads(self._body().decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                return self._json(400, {"error": "body was not valid JSON"})
            notes = notes_read()
            note = next((n for n in notes if n.get("id") == payload.get("id")), None)
            if not note:
                return self._json(404, {"error": "no such note"})
            if not note.get("chat"):
                note["chat"] = str(payload.get("key") or "")
                notes_write(notes)
            return self._json(200, {"chat": note["chat"]})
        return self._json(404, {"error": "nothing to post there"})


def main():
    os.makedirs(DATA, exist_ok=True)
    if not os.path.exists(NOTES_FILE):
        notes_write(DEFAULT_NOTES)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = "http://127.0.0.1:%d/notes.html" % PORT
    print("ai_chat demo running at %s" % url)
    print("Press Ctrl-C to stop.")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
