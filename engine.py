"""Run Claude Code as a chat engine any local app can embed.

This is the half of ai_chat that talks to the CLI. It spawns `claude`, streams
its stream-json output back a line at a time, and keeps an index of which
sessions belong to which "owner" — a task id, a ticket number, a note path,
whatever the host app organises its own work by. It never stores a transcript
of its own: Claude Code already writes every session to
`~/.claude/projects/<cwd>/<id>.jsonl`, and that file is what the CLI resumes
from and what Claude Desktop imports, so this only ever reads it back.

No web framework here on purpose. A host wires this into whatever server it
already runs — see `http_glue.py` for the piece that does that over
`http.server`, which is what `to-dos` uses.

Two modes, and the difference between them is the whole of the safety story:

  ask    the default. Bash, Edit, Write, NotebookEdit and Task are removed
         from the run outright — not asked about, not present. It can read
         and answer; it cannot change anything. Stronger than a permission
         setting, because a disallowed tool never appears in Claude's tool
         list at all, so there is nothing to be talked into using.

  work   does the job in full, permissions bypassed. Only exists if the
         host's config turns it on — a button that edits files across the
         disk should be switched on deliberately rather than shipped on.
"""

import datetime
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading

SESSION_ID = re.compile(r"^[0-9a-fA-F-]{36}$")
# What an owner key may look like. The default matches to-dos's `chat:xxxxxx`
# tags (base36, 4-12 chars) but any short slug-shaped id fits it.
OWNER_KEY = re.compile(r"^[a-z0-9_-]{1,64}$")

MAX_PROMPT = 20000
MAX_TITLE = 120
MAX_RUNS = 2             # concurrent, at once — two is a follow-up while the first still talks
DEFAULT_TIMEOUT = 900    # 15 minutes, then the run is killed and says so
MAX_REPLAY = 20 * 1024 * 1024   # a transcript larger than this is not replayed
MAX_TURNS = 60                  # ...and only the last of these are

# Taken away from an ask run. Not a permission rule: the tools are not there.
ASK_DENIES = ["Bash", "Edit", "Write", "NotebookEdit", "Task"]


class RunLimitError(Exception):
    """Too many runs already going. The caller turns this into a 429."""


class SessionStore:
    """Which sessions sit under which owner. A JSON file, `{"chats": {owner:
    [{id, title, started, updated, mode, cwd}, ...]}}` — the key stayed
    `chats` for compatibility with the first app this module was pulled out
    of; nothing here cares that it says "chats" rather than "sessions"."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()

    def read(self):
        try:
            with open(self.path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        chats = data.get("chats")
        return chats if isinstance(chats, dict) else {}

    def _write(self, chats):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="") as fh:
            json.dump({"version": 1, "chats": chats}, fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self.path)

    def record(self, owner, session_id, title, mode, cwd):
        """Note that this session belongs to this owner. Called once the CLI
        has told us its id, which is the first thing it says — so a run that
        is stopped or crashes ten seconds in is still filed, with whatever
        was said in it readable from the transcript."""
        now = datetime.datetime.now().isoformat(timespec="seconds")
        with self.lock:
            chats = self.read()
            rows = chats.setdefault(owner, [])
            for row in rows:
                if row.get("id") == session_id:
                    row["updated"] = now
                    return
            rows.append({
                "id": session_id, "title": title[:MAX_TITLE],
                "started": now, "updated": now, "mode": mode, "cwd": cwd,
            })
            self._write(chats)

    def touch(self, owner, session_id):
        with self.lock:
            chats = self.read()
            for row in chats.get(owner, []):
                if row.get("id") == session_id:
                    row["updated"] = datetime.datetime.now().isoformat(timespec="seconds")
                    self._write(chats)
                    return

    def forget(self, owner, session_id):
        """Drops it off this owner's list. The transcript itself is Claude
        Code's file and is left alone — this is the store forgetting a
        conversation, not the machine losing one."""
        with self.lock:
            chats = self.read()
            rows = chats.get(owner, [])
            kept = [r for r in rows if r.get("id") != session_id]
            if len(kept) == len(rows):
                return False
            if kept:
                chats[owner] = kept
            else:
                chats.pop(owner, None)
            self._write(chats)
            return True


def _text_blocks(content):
    """The human's words out of one row, or '' when the row is a tool result
    wearing a user's clothes — Claude Code files those under "user" too."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    out = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "tool_result":
            return ""
        if block.get("type") == "text":
            out.append(block.get("text") or "")
    return "\n\n".join(t for t in out if t)


def transcript_path(session_id, cwd, config_dir=None):
    """Where Claude Code put the session. The folder name is the working
    directory with every separator turned into a dash, which is what the CLI
    does; the search is a fallback for a session whose cwd has since moved."""
    root = os.path.expanduser(config_dir or os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude")
    root = os.path.join(root, "projects")
    if cwd:
        slug = cwd.replace(os.sep, "-").replace(".", "-")
        direct = os.path.join(root, slug, session_id + ".jsonl")
        if os.path.exists(direct):
            return direct
    try:
        for name in os.listdir(root):
            guess = os.path.join(root, name, session_id + ".jsonl")
            if os.path.exists(guess):
                return guess
    except OSError:
        pass
    return None


def transcript_read(session_id, cwd, config_dir=None):
    """Replay a session as the turns a chat widget draws. Reads the file
    Claude Code keeps rather than any copy of our own, so a conversation
    carried on in the terminal or in Claude Desktop comes back complete."""
    path = transcript_path(session_id, cwd, config_dir)
    if not path:
        return None
    try:
        if os.path.getsize(path) > MAX_REPLAY:
            return {"turns": [], "toobig": True, "path": path}
    except OSError:
        return None

    turns = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                # Subagent traffic is a conversation Claude had with itself.
                if row.get("isSidechain") or row.get("isMeta"):
                    continue
                msg = row.get("message") or {}
                if row.get("type") == "user":
                    said = _text_blocks(msg.get("content"))
                    if said.strip():
                        turns.append({"ask": said, "reply": "", "tools": [],
                                      "at": row.get("timestamp") or ""})
                elif row.get("type") == "assistant" and turns:
                    turn = turns[-1]
                    for block in (msg.get("content") or []):
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") == "text" and block.get("text"):
                            turn["reply"] += ("\n\n" if turn["reply"] else "") + block["text"]
                        elif block.get("type") == "tool_use":
                            turn["tools"].append({"name": block.get("name") or "",
                                                  "input": block.get("input") or {}})
    except OSError:
        return None
    return {"turns": turns[-MAX_TURNS:], "toobig": False, "path": path}


class Engine:
    """One of these per host app. `config_path` and `sessions_path` are the
    two files on disk it owns; everything else is a default the host can
    override per call."""

    def __init__(self, default_cwd, config_path, sessions_path,
                 ask_denies=None, max_runs=MAX_RUNS, default_timeout=DEFAULT_TIMEOUT):
        self.default_cwd = default_cwd
        self.config_path = config_path
        self.ask_denies = list(ask_denies or ASK_DENIES)
        self.max_runs = max_runs
        self.default_timeout = default_timeout
        self.sessions = SessionStore(sessions_path)
        self.runs_lock = threading.Lock()
        self.runs_now = 0

    def binary(self):
        """Where the CLI is, or None. None is an ordinary state: no CLI, no
        button anywhere in the host's UI."""
        return shutil.which("claude")

    def config(self):
        """The host's config file, or the defaults. Read per call, so editing
        the file takes effect without restarting the host's server.

        Absent is the normal case — a fresh clone has no file and gets ask
        mode running in `default_cwd`, which is the harmless half of this."""
        raw = {}
        try:
            with open(self.config_path, encoding="utf-8") as fh:
                raw = json.load(fh) or {}
        except (OSError, ValueError):
            raw = {}
        if not isinstance(raw, dict):
            raw = {}
        cwd = os.path.abspath(os.path.expanduser(str(raw.get("cwd") or self.default_cwd)))
        if not os.path.isdir(cwd):
            cwd = self.default_cwd
        try:
            timeout = max(30, min(3600, int(raw.get("timeout") or self.default_timeout)))
        except (TypeError, ValueError):
            timeout = self.default_timeout
        return {
            "cwd": cwd,
            "work": raw.get("work") is True,
            "model": str(raw["model"]) if raw.get("model") else None,
            "timeout": timeout,
        }

    def status(self):
        cfg = self.config()
        return {
            "available": bool(self.binary()),
            "work": cfg["work"],
            "cwd": cfg["cwd"],
            "home": os.path.basename(cfg["cwd"]) or cfg["cwd"],
            "model": cfg["model"],
            "timeout": cfg["timeout"],
            "config": os.path.exists(self.config_path),
        }

    def argv(self, prompt, mode, session, cfg, binary):
        out = [binary, "-p", prompt, "--output-format", "stream-json", "--verbose"]
        if cfg["model"]:
            out += ["--model", cfg["model"]]
        if session:
            # A follow-up carries the conversation on rather than starting one
            # that has to be told everything again.
            out += ["--resume", session]
        if mode == "work":
            out += ["--dangerously-skip-permissions"]
        else:
            out += ["--permission-mode", "dontAsk", "--disallowedTools"] + self.ask_denies
        return out

    def run(self, prompt, mode, session, owner, title):
        """Returns a generator of NDJSON-line strings: the CLI's own
        stream-json lines, plus a synthetic `board_start` first and a
        synthetic `board_error` if the run ended without ever producing a
        `result` line. The caller writes each line straight to its own
        response stream.

        This method itself is not a generator — the gating checks below run
        the moment it is called, not on first iteration, so `RuntimeError`
        (no CLI), `PermissionError` (work mode off) and `RunLimitError` (too
        many runs already going) all raise before the caller has opened its
        response and needs to turn them into a status code.
        """
        binary = self.binary()
        if not binary:
            raise RuntimeError("the claude CLI is not on PATH")

        cfg = self.config()
        if mode == "work" and not cfg["work"]:
            raise PermissionError("work mode is off")

        with self.runs_lock:
            if self.runs_now >= self.max_runs:
                raise RunLimitError("two runs already going — wait for one to finish")
            self.runs_now += 1

        return self._stream(prompt, mode, session, owner, title, cfg, binary)

    def _stream(self, prompt, mode, session, owner, title, cfg, binary):
        argv = self.argv(prompt, mode, session, cfg, binary)
        proc = None
        killer = None
        errs = []
        try:
            try:
                proc = subprocess.Popen(
                    argv, cwd=cfg["cwd"],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, bufsize=1,
                    # Its own process group, so stopping the run stops whatever
                    # Claude itself started rather than orphaning it.
                    start_new_session=True,
                )
            except OSError as err:
                yield json.dumps({"type": "board_error", "text": "could not start claude: %s" % err})
                return

            def stop(why):
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except (OSError, ProcessLookupError):
                    pass
                errs.append(why)

            killer = threading.Timer(cfg["timeout"], stop,
                                      args=("timed out after %d minutes" % (cfg["timeout"] // 60),))
            killer.daemon = True
            killer.start()

            # stderr on its own thread: a full pipe nobody is draining is how a
            # subprocess ends up blocked forever with the host waiting on it.
            tail = []

            def drain():
                for line in proc.stderr:
                    tail.append(line.rstrip("\n"))
                    del tail[:-20]
            drainer = threading.Thread(target=drain, daemon=True)
            drainer.start()

            sys.stdout.write("claude (%s) in %s\n" % (mode, cfg["cwd"]))
            sys.stdout.flush()

            yield json.dumps({"type": "board_start", "mode": mode, "cwd": cfg["cwd"],
                              "home": os.path.basename(cfg["cwd"]) or cfg["cwd"],
                              "resumed": bool(session)})

            saw_result = False
            filed = ""
            for line in proc.stdout:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                if '"type":"result"' in line:
                    saw_result = True
                # The init line carries the session id, and it is the first
                # thing the CLI says — so a run that is stopped or crashes
                # ten seconds in is still in the owner's list afterwards, with
                # whatever was said in it readable from the transcript.
                if owner and not filed and '"subtype":"init"' in line:
                    try:
                        sid = json.loads(line).get("session_id") or ""
                    except ValueError:
                        sid = ""
                    if SESSION_ID.match(sid):
                        filed = sid
                        self.sessions.record(owner, sid, title, mode, cfg["cwd"])
                yield line

            if owner and filed:
                self.sessions.touch(owner, filed)
            code = proc.wait()
            if killer:
                killer.cancel()
            if not saw_result:
                why = errs[0] if errs else ("claude exited %d" % code)
                yield json.dumps({"type": "board_error", "text": why,
                                  "detail": "\n".join(tail[-6:])})
        finally:
            if killer:
                killer.cancel()
            if proc and proc.poll() is None:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (OSError, ProcessLookupError):
                    pass
            with self.runs_lock:
                self.runs_now -= 1
