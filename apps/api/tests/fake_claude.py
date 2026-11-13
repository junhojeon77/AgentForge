"""Stand-in for `claude -p --output-format stream-json`, replaying a recorded live run.

FAKE_CLAUDE_MODE picks the behavior; FAKE_CLAUDE_LOG receives argv, cwd, stdin and pid as JSON.
"""

import json
import os
import pathlib
import sys
import time

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "claude_stream.jsonl"

argv = sys.argv[1:]
session_id = argv[argv.index("--session-id") + 1]
prompt = sys.stdin.read()
log = {"argv": argv, "cwd": os.getcwd(), "stdin": prompt, "pid": os.getpid()}
pathlib.Path(os.environ["FAKE_CLAUDE_LOG"]).write_text(json.dumps(log), encoding="utf-8")

events = FIXTURE.read_text(encoding="utf-8").replace("SESSION_ID", session_id).splitlines()
mode = os.environ.get("FAKE_CLAUDE_MODE", "ok")
if mode == "edit":
    pathlib.Path("fake_edit.txt").write_text("edited by fake claude\n", encoding="utf-8")
if mode in ("ok", "edit"):
    print("\n".join(events), flush=True)
elif mode == "error_result":
    print(events[0], flush=True)
    error = {"type": "result", "subtype": "error_max_budget_usd", "is_error": True}
    print(json.dumps(error | {"session_id": session_id}), flush=True)
elif mode == "crash":
    print(events[0], flush=True)
    print("fatal: not logged in", file=sys.stderr, flush=True)
    sys.exit(1)
elif mode == "hang":
    print(events[0], flush=True)
    time.sleep(60)
