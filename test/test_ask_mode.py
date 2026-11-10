"""The permission rules an ask run is started with.

    python3 test/test_ask_mode.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from engine import ASK_DENIES, Engine  # noqa: E402

failed = 0


def ok(name, cond):
    global failed
    print(("  ok   " if cond else "  FAIL ") + name)
    failed += not cond


tmp = tempfile.mkdtemp()
cfg = {"cwd": "/home/me/app/data/work", "model": ""}


def engine(**kw):
    return Engine(tmp, os.path.join(tmp, "c.json"), os.path.join(tmp, "s.json"), **kw)


plain = engine().argv("hi", "ask", None, cfg, "claude")
ok("with no ask_allows, an ask run has no allow rules", "--allowedTools" not in plain)
ok("and the default denials", plain[plain.index("--disallowedTools") + 1:] == ASK_DENIES)

allows = ["Read(//home/me/app/agents/pa_agent/**)"]
held = engine(ask_allows=allows, ask_denies=ASK_DENIES + ["WebFetch"])
argv = held.argv("hi", "ask", None, cfg, "claude")
ok("ask_allows reach an ask run as --allowedTools",
   argv[argv.index("--allowedTools") + 1:argv.index("--disallowedTools")] == allows)
ok("still in dontAsk", argv[argv.index("--permission-mode") + 1] == "dontAsk")
ok("and the denials follow", argv[argv.index("--disallowedTools") + 1:] == ASK_DENIES + ["WebFetch"])

write = held.argv("hi", "write", None, cfg, "claude")
ok("ask_allows never reach a write run", not any(a in write for a in allows))
work = held.argv("hi", "work", None, cfg, "claude")
ok("or a work run", not any(a in work for a in allows))

print("\n%d failed" % failed if failed else "\nall checks passed")
sys.exit(1 if failed else 0)
