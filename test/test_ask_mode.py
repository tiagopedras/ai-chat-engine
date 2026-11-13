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

tools = ["Read", "Glob", "Grep"]
ok("with no ask_tools, an ask run has no --tools", "--tools" not in plain)
ok("and the command line is unchanged",
   plain == ["claude", "-p", "hi", "--output-format", "stream-json", "--verbose",
             "--permission-mode", "dontAsk", "--disallowedTools"] + ASK_DENIES)
listed = engine(ask_tools=tools).argv("hi", "ask", None, cfg, "claude")
ok("ask_tools reach an ask run as --tools, exactly that list",
   listed[listed.index("--tools") + 1] == "Read,Glob,Grep")
ok("the denials still follow", listed[listed.index("--disallowedTools") + 1:] == ASK_DENIES)
ok("and MCP servers are off, with none named",
   "--strict-mcp-config" in listed and "--mcp-config" not in listed)
ok("with no ask_tools, MCP servers are left alone", "--strict-mcp-config" not in plain)
both = engine(ask_tools=tools, ask_allows=allows).argv("hi", "ask", "x" * 8, cfg, "claude")
ok("with ask_allows too, both are passed",
   both[both.index("--tools") + 1] == "Read,Glob,Grep"
   and both[both.index("--allowedTools") + 1:both.index("--disallowedTools")] == allows)
none = engine(ask_tools=[]).argv("hi", "ask", None, cfg, "claude")
ok("an empty ask_tools leaves no tools", none[none.index("--tools") + 1] == ""
   and "--strict-mcp-config" in none)
for mode in ("write", "work"):
    ok("ask_tools never reach a %s run" % mode,
       not {"--tools", "--strict-mcp-config"} & set(engine(ask_tools=tools).argv("hi", mode, None, cfg, "claude")))

print("\n%d failed" % failed if failed else "\nall checks passed")
sys.exit(1 if failed else 0)
