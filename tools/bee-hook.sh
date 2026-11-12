#!/bin/sh
# Tells Pixel Party about the sub-agents an agent runs inside its own program, which Herdr
# can't see: one `pixel.bee.<id>` label on the agent's terminal per running sub-agent.
# The drawer draws a bee per label.
#
#   bee-hook.sh start   a sub-agent started: add its label        (Claude Code: SubagentStart)
#   bee-hook.sh stop    a sub-agent ended: remove its label       (Claude Code: SubagentStop)
#   bee-hook.sh clear   a new session: remove what a killed one left (Claude Code: SessionStart)
#
# Reads the hook's JSON on stdin. Outside an hc terminal, or without hc, it does nothing.
# It never fails or stalls its agent: every path exits 0, and every hc call gets 2 seconds.

action="${1:-}"
input="$(cat 2>/dev/null || true)"
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
command -v hc >/dev/null 2>&1 || exit 0

# A string field of the hook's JSON, cut down to what a label key can safely hold.
field() {
  printf '%s' "$input" | tr -d '\n' | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | tr -cd 'A-Za-z0-9_-' | cut -c1-48
}

# hc, killed after 2 seconds. macOS has no `timeout`. The watchdog holds none of the
# hook's streams, so a command substitution around this call never waits for it.
hc2() {
  hc "$@" </dev/null &
  hc_pid=$!
  (sleep 2 && kill "$hc_pid") </dev/null >/dev/null 2>&1 &
  dog=$!
  wait "$hc_pid"
  hc_status=$?
  kill "$dog" 2>/dev/null
  return "$hc_status"
}

id="$(field agent_id)"
[ -n "$id" ] || id="$(field agentId)"
case "$action" in
  start) [ -n "$id" ] && hc2 label "$HC_TERMINAL_ID" "pixel.bee.$id=1" ;;
  stop) [ -n "$id" ] && hc2 label "$HC_TERMINAL_ID" "pixel.bee.$id=" ;;
  clear)
    # A sub-agent's own session start, or a compaction its sub-agents outlive: nothing is stale.
    [ -z "$id" ] || exit 0
    [ "$(field source)" != "compact" ] || exit 0
    # `pixel.hive` holds the pid of the agent program whose sub-agents the labels are. The
    # hook's parent is that program. A second live program on this terminal (an agent's
    # `claude -p`) starts a session too: its owner's labels are not stale.
    terminal="$(hc2 get "$HC_TERMINAL_ID" --json 2>/dev/null)" || exit 0
    owner="$(printf '%s' "$terminal" | sed -n 's/.*"pixel\.hive"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\)".*/\1/p')"
    if [ -n "$owner" ] && [ "$owner" != "$PPID" ] && kill -0 "$owner" 2>/dev/null; then exit 0; fi
    for key in $(printf '%s' "$terminal" | grep -o '"pixel\.bee\.[A-Za-z0-9_-]*"' | tr -d '"'); do
      set -- "$@" "$key="
    done
    shift
    hc2 label "$HC_TERMINAL_ID" "$@" "pixel.hive=$PPID"
    ;;
esac >/dev/null 2>&1
exit 0
