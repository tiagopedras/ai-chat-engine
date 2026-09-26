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

Three modes, and the difference between them is the whole of the safety story:

  ask    the default. Bash, Edit, Write, NotebookEdit and Task are removed
         from the run outright — not asked about, not present. It can read
         and answer; it cannot change anything. Stronger than a permission
         setting, because a disallowed tool never appears in Claude's tool
         list at all, so there is nothing to be talked into using.

  write  ask, plus file edits inside the run's working directory and
         nowhere else. Bash, NotebookEdit and Task stay removed, so the only
         way to change anything is Edit/Write, and an allow rule scoped to
         the cwd is what lets those through; anything outside it has no rule
         and `dontAsk` refuses it. The host's `write_denies` (see
         WRITE_DENIES) are refused even inside the cwd. Gated by the same
         `"work": true` as work mode.

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

# Taken away from a write run, the same way. Edit and Write stay, held to the
# cwd by the allow rule argv() adds.
WRITE_TOOL_DENIES = ["Bash", "NotebookEdit", "Task"]

# Files a write run may not edit even inside its cwd, as permission-rule path
# patterns (gitignore-style, relative to the cwd). Empty by default: a host
# names its own through `write_denies`, as to-dos does for data/*/todo.md.
WRITE_DENIES = []

MODES = ("ask", "write", "work")


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

    def assign(self, owner, session_id, to_owner):
        """Moves one session from one owner to another, keeping everything
        recorded about it.

        Filing is a decision made after the fact as often as before it. A
        conversation starts loose, or under the wrong thing, and turns out to
        belong somewhere: this is that move, and it is a move rather than a
        forget plus a fresh record because the row carries a title, a mode, a
        working directory and the date it started, none of which the caller
        making the decision necessarily still has to hand.

        A session already filed under the destination is left alone rather
        than duplicated. Returns whether anything changed.
        """
        with self.lock:
            chats = self.read()
            rows = chats.get(owner, [])
            moving = None
            for row in rows:
                if row.get("id") == session_id:
                    moving = row
                    break
            if moving is None:
                return False
            if owner == to_owner:
                return False

            chats[owner] = [r for r in rows if r.get("id") != session_id]
            if not chats[owner]:
                chats.pop(owner, None)

            target = chats.setdefault(to_owner, [])
            if not any(r.get("id") == session_id for r in target):
                moving["updated"] = datetime.datetime.now().isoformat(timespec="seconds")
                target.append(moving)
            self._write(chats)
            return True

    def set_prompt(self, owner, session_id, prompt):
        """Records the prompt suggestion a conversation was started to run.

        Called once, right after the line it came from is deleted off the
        task — from then on this row is the only place the text survives, so
        a host can show what the conversation was started to do, or offer to
        put the prompt back on the task if it turns out to have been started
        by mistake. Silently does nothing if the row isn't there yet; the
        caller is expected to have just learned this session's id from the
        same sessions index this reads from.
        """
        with self.lock:
            chats = self.read()
            for row in chats.get(owner, []):
                if row.get("id") == session_id:
                    row["prompt"] = prompt[:MAX_PROMPT]
                    self._write(chats)
                    return True
            return False

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


CMD_NAME = re.compile(r"<command-name>\s*(\S.*?)\s*</command-name>", re.S)
CMD_WRAP = re.compile(r"<command-(?:name|message|args)>.*?</command-(?:name|message|args)>\s*", re.S)


def _opening_line(raw):
    """The first thing actually asked, out of one row's text — the slash
    command name in place of Claude Code's own wrapper markup, when the row
    is one of those and nothing else was typed alongside it. The three tags
    a slash command wraps a message in don't come in a fixed order — /clear
    puts command-name first, a skill invocation puts command-message first —
    so this strips all three as a set rather than assuming one runs after
    another."""
    raw = raw.strip()
    m = CMD_NAME.search(raw)
    rest = CMD_WRAP.sub("", raw).strip()
    if not m:
        return rest or raw
    return (m.group(1) + (" " + rest if rest else "")).strip()


def _session_head(path):
    """The working directory and opening line out of a transcript, reading
    only as far as it takes to find both rather than the whole file. None on
    a file this cannot make sense of at all."""
    cwd = ""
    title = ""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if cwd and title:
                    break
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if not cwd and row.get("cwd"):
                    cwd = row["cwd"]
                if title or row.get("type") != "user" or row.get("isSidechain") or row.get("isMeta"):
                    continue
                said = _opening_line(_text_blocks((row.get("message") or {}).get("content")))
                if said:
                    title = said
    except OSError:
        return None
    return {"cwd": cwd, "title": title}


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
                        turns.append({"ask": said, "reply": "", "tools": [], "parts": [],
                                      "at": row.get("timestamp") or ""})
                elif row.get("type") == "assistant" and turns:
                    turn = turns[-1]
                    for block in (msg.get("content") or []):
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") == "text" and block.get("text"):
                            turn["reply"] += ("\n\n" if turn["reply"] else "") + block["text"]
                            # `parts` is `reply`/`tools` again, but in the
                            # order Claude actually produced them instead of
                            # text-then-tools — a widget wants this to show
                            # a tool call where it happened rather than
                            # gathered before or after the text. `reply` and
                            # `tools` stay populated too, so a reader that
                            # only knows those two keeps working.
                            turn["parts"].append({"type": "text", "text": block["text"]})
                        elif block.get("type") == "tool_use":
                            name = block.get("name") or ""
                            tool_input = block.get("input") or {}
                            turn["tools"].append({"name": name, "input": tool_input})
                            turn["parts"].append({"type": "tool", "name": name, "input": tool_input})
    except OSError:
        return None
    return {"turns": turns[-MAX_TURNS:], "toobig": False, "path": path}


class Engine:
    """One of these per host app. `config_path` and `sessions_path` are the
    two files on disk it owns; everything else is a default the host can
    override per call."""

    def __init__(self, default_cwd, config_path, sessions_path,
                 ask_denies=None, max_runs=MAX_RUNS, default_timeout=DEFAULT_TIMEOUT,
                 write_denies=None):
        self.default_cwd = default_cwd
        self.config_path = config_path
        self.ask_denies = list(ask_denies or ASK_DENIES)
        self.write_denies = list(write_denies or WRITE_DENIES)
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

    def list_sessions(self, limit=60, query=None):
        """Every session Claude Code has on disk, across every project it has
        ever run in, newest first — a conversation that started in the
        terminal rather than from this app, and never got filed under this
        engine's own sessions.json. The Node engine already has an
        equivalent, `pastSessions()`; this is the Python side of the same
        thing, for a host that wants to offer "attach a session that started
        elsewhere" — see AI-CANVAS.md in to-dos for why that exists.

        Reads only as much of each transcript as it takes to find the
        working directory and the first thing that was actually asked, never
        the whole file — the same discipline transcript_read()'s size guard
        applies elsewhere, just done by stopping early instead. A session
        already filed under some owner is left out: there is nothing to
        attach that is already attached.

        query, if given, narrows to sessions whose title or working
        directory contains it (case-insensitive) before limit is applied —
        so a search never misses something older than the newest 60.
        """
        q = (query or "").strip().lower()
        root = os.path.expanduser(os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude")
        root = os.path.join(root, "projects")
        filed = set()
        for rows in self.sessions.read().values():
            for row in rows:
                if row.get("id"):
                    filed.add(row["id"])

        try:
            project_names = os.listdir(root)
        except OSError:
            return []

        out = []
        for name in project_names:
            project_dir = os.path.join(root, name)
            try:
                files = os.listdir(project_dir)
            except OSError:
                continue
            for fname in files:
                if not fname.endswith(".jsonl"):
                    continue
                session_id = fname[:-len(".jsonl")]
                if not SESSION_ID.match(session_id) or session_id in filed:
                    continue
                path = os.path.join(project_dir, fname)
                try:
                    mtime = os.path.getmtime(path)
                except OSError:
                    continue
                row = _session_head(path)
                if not row or not row["cwd"]:
                    continue
                title = (row["title"] or "Untitled conversation")[:MAX_TITLE]
                if q and q not in title.lower() and q not in row["cwd"].lower():
                    continue
                out.append({
                    "id": session_id, "cwd": row["cwd"],
                    "title": title,
                    "updated": datetime.datetime.fromtimestamp(mtime).isoformat(timespec="seconds"),
                })
        out.sort(key=lambda r: r["updated"], reverse=True)
        return out[:limit]

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
        elif mode == "write":
            # `//` makes the path absolute in a permission rule; a lone `/`
            # would be read relative to the settings file.
            inside = "/" + cfg["cwd"].rstrip("/") + "/**"
            out += ["--permission-mode", "dontAsk",
                    "--allowedTools", "Edit(%s)" % inside, "Write(%s)" % inside,
                    "--disallowedTools"] + WRITE_TOOL_DENIES
            for pattern in self.write_denies:
                out += ["Edit(%s)" % pattern, "Write(%s)" % pattern]
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
        if mode not in MODES:
            mode = "ask"
        if mode != "ask" and not cfg["work"]:
            raise PermissionError("%s mode is off" % mode)

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
