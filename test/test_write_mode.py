"""The permission rules a write run is started with.

    python3 test/test_write_mode.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from engine import Engine  # noqa: E402

failed = 0


def ok(name, cond):
    global failed
    print(("  ok   " if cond else "  FAIL ") + name)
    failed += not cond


tmp = tempfile.mkdtemp()
cfg = {"cwd": "/home/me/Code", "model": ""}


def rules(engine):
    argv = engine.argv("hi", "write", None, cfg, "claude")
    allowed = argv[argv.index("--allowedTools") + 1:argv.index("--disallowedTools")]
    denied = argv[argv.index("--disallowedTools") + 1:]
    return allowed, denied


plain = Engine(tmp, os.path.join(tmp, "c.json"), os.path.join(tmp, "s.json"))
allowed, _ = rules(plain)
ok("with no write_allows, writing is held to the cwd",
   allowed == ["Edit(//home/me/Code/**)", "Write(//home/me/Code/**)"])

held = Engine(tmp, os.path.join(tmp, "c.json"), os.path.join(tmp, "s.json"),
              write_denies=["**/data/*/todo.md"],
              write_allows=["/home/me/Code/to-dos/data/work/projects"])
allowed, denied = rules(held)
ok("with write_allows, writing is held to those folders instead",
   allowed == ["Edit(//home/me/Code/to-dos/data/work/projects/**)",
               "Write(//home/me/Code/to-dos/data/work/projects/**)"])
ok("the cwd itself is no longer allowed", not any("//home/me/Code/**" in a for a in allowed))
ok("write_denies still apply", "Edit(**/data/*/todo.md)" in denied and "Write(**/data/*/todo.md)" in denied)

print("\n%d failed" % failed if failed else "\nall checks passed")
sys.exit(1 if failed else 0)
