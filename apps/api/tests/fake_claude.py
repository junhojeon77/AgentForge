"""Stand-in for `claude -p --output-format stream-json`, replaying a recorded live run.

FAKE_CLAUDE_MODE picks the behavior; FAKE_CLAUDE_LOG receives the latest call's argv, cwd, stdin
and pid as JSON, and FAKE_CLAUDE_LOG + ".all" collects every call, one JSON line each. In "script"
mode the Nth call replies with the Nth structured output from the JSON list in FAKE_CLAUDE_SCRIPT.
"""

import json
import os
import pathlib
import sys
import time

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "claude_stream.jsonl"

argv = sys.argv[1:]
resuming = "--resume" in argv
session_id = argv[argv.index("--resume" if resuming else "--session-id") + 1]
if os.environ.get("FAKE_CLAUDE_MODE") == "unread":  # dies before it reads the prompt
    print("fatal: not logged in", file=sys.stderr, flush=True)
    sys.exit(1)
prompt = sys.stdin.read()
log = json.dumps({"argv": argv, "cwd": os.getcwd(), "stdin": prompt, "pid": os.getpid()})
pathlib.Path(os.environ["FAKE_CLAUDE_LOG"]).write_text(log, encoding="utf-8")
with open(os.environ["FAKE_CLAUDE_LOG"] + ".all", "a", encoding="utf-8") as calls:
    calls.write(log + "\n")

events = FIXTURE.read_text(encoding="utf-8").replace("SESSION_ID", session_id).splitlines()
mode = os.environ.get("FAKE_CLAUDE_MODE", "ok")
if mode == "no_session" and resuming:
    # What CLI 2.1.323 does when asked to resume a session it never saved (seen live).
    error = {"type": "result", "subtype": "error_during_execution", "is_error": True}
    print(json.dumps(error | {"session_id": session_id, "total_cost_usd": 0}), flush=True)
    print(f"No conversation found with session ID: {session_id}", file=sys.stderr, flush=True)
    sys.exit(1)
if mode == "edit":
    pathlib.Path("fake_edit.txt").write_text("edited by fake claude\n", encoding="utf-8")
if mode == "noise":
    print("Notice: SECRET-TOKEN is not JSON", flush=True)
    print("[1, 2]", flush=True)  # JSON, but not an event
if mode in ("ok", "edit", "no_session", "noise"):
    print("\n".join(events), flush=True)
elif mode == "error_result":
    print(events[0], flush=True)
    error = {"type": "result", "subtype": "error_max_budget_usd", "is_error": True}
    print(json.dumps(error | {"session_id": session_id}), flush=True)
elif mode == "crash":
    print(events[0], flush=True)
    print("fatal: not logged in", file=sys.stderr, flush=True)
    sys.exit(1)
elif mode == "script":
    script = pathlib.Path(os.environ["FAKE_CLAUDE_SCRIPT"])
    turn = len(pathlib.Path(os.environ["FAKE_CLAUDE_LOG"] + ".all").read_text().splitlines())
    output = json.loads(script.read_text(encoding="utf-8"))[turn - 1]
    print(events[0], flush=True)
    reply = {"type": "result", "subtype": "success", "is_error": False}
    print(json.dumps(reply | {"session_id": session_id, "structured_output": output}), flush=True)
elif mode == "hang":
    print(events[0], flush=True)
    time.sleep(60)
