#!/bin/sh
# Tells Pixel Party what an agent does inside its own program, which Herdr can't see, with
# labels on the agent's terminal:
# - one `pixel.bee.<id>` per running sub-agent. The drawer draws a bee per label.
# - `pixel.work`, what the agent is doing: one of sprite-view.js's WORKS. The drawer's
#   creature works that way; without the label it works its own way.
#
#   bee-hook.sh start   a sub-agent started: add its label        (Claude Code: SubagentStart)
#   bee-hook.sh stop    a sub-agent ended: remove its label       (Claude Code: SubagentStop)
#   bee-hook.sh clear   a new session: remove what a killed one left (Claude Code: SessionStart)
#   bee-hook.sh tool    a tool is about to run: what it does      (Claude Code: PreToolUse)
#   bee-hook.sh think   a prompt came in: it thinks               (Claude Code: UserPromptSubmit)
#
# What a tool does holds until the next tool or prompt, not only while the tool runs: a
# read or an edit is over in a moment, and the creature would never be seen doing it.
#
# Reads the hook's JSON on stdin. Outside an hc terminal, or without hc, it does nothing.
# It never fails or stalls its agent: every path exits 0, prints nothing, and every hc call
# gets 2 seconds.

action="${1:-}"
# Bytes, whatever the locale: a cut can end inside a character.
LC_ALL=C
export LC_ALL
case "$action" in
  tool | think)
    # These run before every tool and prompt, so they parse only the head of the hook's
    # JSON, up to the tool's own input: an input can be megabytes (a Write), with keys of
    # its own named like the hook's. Claude Code puts `agent_id` and `tool_name` before it,
    # after short fields only. The rest is read and thrown away unparsed, so the agent's
    # write never finds the pipe closed.
    input="$(head -c 8192 2>/dev/null || true)"
    cat >/dev/null 2>&1 || true
    input="${input%%\"tool_input\"*}"
    ;;
  # The others are rare, and no order of their fields is promised: all of it.
  *) input="$(cat 2>/dev/null || true)" ;;
esac
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

# What the agent is doing, by the tool it is about to run: Claude Code's names and Codex's.
# A tool not named here is no clue: the label goes, and the creature works its own way.
work_of() {
  case "$1" in
    Read | NotebookRead | view_image) echo reading ;;
    Edit | MultiEdit | Write | NotebookEdit | apply_patch) echo typing ;;
    Bash | BashOutput | KillShell | shell | local_shell | exec_command) echo hammering ;;
    Grep | Glob | LS) echo searching ;;
    WebFetch | WebSearch | web_search) echo signal ;;
  esac
}

id="$(field agent_id)"
[ -n "$id" ] || id="$(field agentId)"
case "$action" in
  start) [ -n "$id" ] && hc2 label "$HC_TERMINAL_ID" "pixel.bee.$id=1" ;;
  stop) [ -n "$id" ] && hc2 label "$HC_TERMINAL_ID" "pixel.bee.$id=" ;;
  tool)
    # A sub-agent's tools are its bee's business, not the creature's.
    [ -z "$id" ] || exit 0
    hc2 label "$HC_TERMINAL_ID" "pixel.work=$(work_of "$(field tool_name)")"
    ;;
  think)
    [ -z "$id" ] || exit 0
    hc2 label "$HC_TERMINAL_ID" "pixel.work=thinking"
    ;;
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
    hc2 label "$HC_TERMINAL_ID" "$@" "pixel.work=" "pixel.hive=$PPID"
    ;;
esac >/dev/null 2>&1
exit 0
