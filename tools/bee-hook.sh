#!/bin/sh
# Tells Pixel Party what an agent does inside its own program, which Herdr can't see, with
# labels on the agent's terminal:
# - one `pixel.bee.<id>` per running sub-agent. The drawer draws a bee per label.
# - `pixel.work`, what the agent is doing: one of sprite-view.js's WORKS. The drawer's
#   creature works that way; without the label it works its own way.
# - `pixel.result`, the last result a tool had: `<kind>.<nonce>`, new for each one, so the
#   drawer plays it once however many come in a row: `failed`, a failed command, or a test
#   command's own result, `tests-passed` or `tests-failed`.
#
#   bee-hook.sh start   a sub-agent started: add its label        (Claude Code: SubagentStart)
#   bee-hook.sh stop    a sub-agent ended: remove its label       (Claude Code: SubagentStop)
#   bee-hook.sh clear   a new session: remove what a killed one left (Claude Code: SessionStart)
#   bee-hook.sh tool    a tool is about to run: what it does      (Claude Code: PreToolUse)
#                       A shell command says more: testing, building, installing or git.
#   bee-hook.sh think   a prompt came in: it thinks               (Claude Code: UserPromptSubmit)
#   bee-hook.sh fail    a tool failed: a failed command coughs smoke, failed tests drop
#                       their tube                                (Claude Code: PostToolUseFailure)
#   bee-hook.sh pass    a tool ran to the end: passed tests, a thumbs up (Claude Code: PostToolUse)
#   bee-hook.sh compact the context is about to be compacted        (Claude Code: PreCompact)
#                       It ends at the compaction's session start: `clear` takes the way away.
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
  tool | think | pass)
    # These run around every tool and prompt, so they parse only the head of the hook's
    # JSON, up to the tool's own input: an input can be megabytes (a Write), with keys of
    # its own named like the hook's. Claude Code puts `agent_id` and `tool_name` before it,
    # after short fields only. A shell tool's command is the one thing read from the input,
    # from its first 512 bytes, and after a tool whether it went to the background. The rest
    # is read and thrown away unparsed, so the agent's write never finds the pipe closed.
    input="$(head -c 8192 2>/dev/null || true)"
    cat >/dev/null 2>&1 || true
    # What comes after is the tool's own input: only a shell tool's command is read from it.
    case "$input" in
      *'"tool_input"'*) tool_input="${input#*\"tool_input\"}" ;;
      *) tool_input="" ;;
    esac
    input="${input%%\"tool_input\"*}"
    ;;
  fail)
    # A failure holds the tool's input, then up to about 10 KB of its output in `error`, then
    # `is_interrupt`: the head as `tool` reads it, and the end. A failure is rare, so all of
    # it is read: `head` reads ahead on a pipe, and would leave `tail` nothing.
    all="$(cat 2>/dev/null || true)"
    case "$(printf '%s' "$all" | tail -c 64)" in *'"is_interrupt":true'* | *'"is_interrupt": true'*) interrupted=1 ;; esac
    input="$(printf '%s' "$all" | head -c 8192)"
    case "$input" in
      *'"tool_input"'*) tool_input="${input#*\"tool_input\"}" ;;
      *) tool_input="" ;;
    esac
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

# The command a shell tool is about to run, as the JSON writes it (`\"` and `\n` left in),
# from its input's first 512 bytes only: a long script is cut there. The input's first
# `"command"` key; nothing when there is none.
command_of() {
  rest="$(printf '%.512s' "$tool_input")"
  case "$rest" in *'"command"'*) ;; *) return ;; esac
  rest="${rest#*\"command\"}"
  while :; do
    case "$rest" in [' :	']*) rest="${rest#?}" ;; *) break ;; esac
  done
  case "$rest" in \"*) rest="${rest#?}" ;; *) return ;; esac
  # Up to the quote that ends the string: a quote after a backslash is inside it.
  cmd=""
  while :; do
    piece="${rest%%\"*}"
    cmd="$cmd$piece"
    [ "$piece" != "$rest" ] || break
    rest="${rest#*\"}"
    case "$piece" in *\\) cmd="$cmd\"" ;; *) break ;; esac
  done
  printf '%s' "$cmd"
}

# The way a shell command works, by the first of its commands that runs a program named
# here: `cd app && npm test` is testing, `git commit -m "fix build"` is git. A tool that does
# many things (npm, cargo, go, make, ...) is told by its subcommand, `npm run`'s script
# included. Nothing for any other command: it hammers. Never expands the command: `set -f`.
command_work() {
  set -f
  cmd="$1"
  # JSON writes a newline in the command as `\n`: it ends a command, as `;` does.
  lines=""
  while :; do
    case "$cmd" in
      *'\n'*)
        lines="$lines${cmd%%\\n*};"
        cmd="${cmd#*\\n}"
        ;;
      *)
        cmd="$lines$cmd"
        break
        ;;
    esac
  done
  IFS=';&|()`'
  for part in $cmd; do
    IFS=' 	'
    # shellcheck disable=SC2086
    set -- $part
    # Settings and wrappers before the program.
    while [ $# -gt 0 ]; do
      case "$1" in *=* | sudo | env | time | command | exec | nohup | nice | npx | bunx | pnpx) shift ;; *) break ;; esac
    done
    [ $# -gt 0 ] || continue
    program="${1##*/}"
    shift
    # A program run by another: `uv run pytest`, `python -m pip install`, `uv pip install`.
    case "$program ${1:-}" in
      "uv run" | "poetry run" | "pdm run" | "pnpm exec" | "npm exec" | "yarn dlx" | "bun x" | "python -m" | "python3 -m")
        shift
        [ $# -gt 0 ] || continue
        program="${1##*/}"
        shift
        ;;
      "uv pip") program=pip && shift ;;
    esac
    case "$program ${1:-}" in "npm run" | "pnpm run" | "yarn run" | "bun run") shift ;; esac
    sub="${1:-}"
    case "$program" in
      git) echo git && return ;;
      pytest | jest | vitest | mocha | ava | rspec | phpunit | ctest | tox | nox | bats) echo testing && return ;;
      node) case " $* " in *" --test "*) echo testing && return ;; esac ;;
      npm | pnpm | yarn | bun | deno | go | cargo | just | make | mix | dotnet | swift | zig | bazel | gradle | gradlew | mvn | \
        playwright | uv | poetry | pdm | pip | pip3 | pipx | gem | bundle | brew | apt | apt-get | composer | docker | rake | turbo | nx)
        case "$sub" in
          test | test[:._-]* | tests | spec | e2e) echo testing && return ;;
          build | build[:._-]* | compile | bundle | package | assemble) echo building && return ;;
          install | add | ci | i | sync | get | require | restore | fetch | update | upgrade) echo installing && return ;;
        esac
        ;;
    esac
    case "$program" in
      tsc | make | cmake | ninja | gcc | g++ | cc | clang | clang++ | rustc | javac | swiftc | webpack | rollup | esbuild | xcodebuild | msbuild)
        echo building && return
        ;;
    esac
  done
}

# The shell command ran tests, and its exit code, which `$1` says how it ended (pass or
# fail), is theirs. The tests are its last command and its only test run: `npm test && npm
# run lint` ends as the lint does, and in `npm test; npm run test:e2e` the first run's result
# is lost. Not with a pipe or `||`: `npm test | tail` ends as `tail` does, and `npm test ||
# true` always passes. A failure counts only when nothing but a `cd` comes before the tests
# with `&&`, as `npm run build && npm test` fails when the build does. Not a command cut at
# 512 bytes, whose end is unknown, nor one the shell sends to the background (`npm test &`).
# A quoted string is one word, whatever it holds (`git commit -m "wip; npm test"`), and a
# quote with no end shows nothing. A subshell: its settings and words stay its own.
tests_ran() (
  set -f
  cmd="$(command_of)"
  # The command's closing quote is in what was read: it was not cut.
  case "$(printf '%.512s' "$tool_input")" in *"\"$cmd\""*) ;; *) return 1 ;; esac
  # JSON writes a `"` as `\"`.
  cmd="$(printf '%s' "$cmd" | sed -e 's/\\"[^"]*\\"/Q/g' -e "s/'[^']*'/Q/g")"
  case "$cmd" in *[\"\']* | *'|'*) return 1 ;; esac
  # A newline (`\n` in JSON) ends a command as `;` does, unless a backslash or `&&` goes on
  # past it, and a redirect's `&` (`2>&1`, `&>`) ends none. A subshell's brackets keep no
  # result of their own.
  cmd="$(printf '%s' "$cmd" | sed -e 's/\\\\\\n/ /g' -e 's/&&[[:space:]]*\\n/\&\& /g' -e 's/\\n/;/g' \
    -e 's/[<>]&/>/g' -e 's/&>/>/g' -e 's/[()`]/ /g' -e 's/[[:space:];]*$//')"
  case "$cmd" in *'&') return 1 ;; esac
  last="${cmd##*[;&]}"
  [ "$(command_work "$last")" = testing ] || return 1
  before="${cmd%"$last"}"
  IFS=';&'
  for part in $before; do
    [ "$(command_work "$part")" != testing ] || return 1
  done
  [ "$1" = fail ] || return 0
  IFS='&'
  for part in ${before##*;}; do
    IFS=' 	'
    # shellcheck disable=SC2086
    set -- $part
    [ "${1:-cd}" = cd ] || return 1
  done
)

# What the agent is doing, by the tool it is about to run: Claude Code's names and Codex's.
# A tool not named here is no clue: the label goes, and the creature works its own way.
work_of() {
  case "$1" in
    Read | NotebookRead | view_image) echo reading ;;
    Edit | MultiEdit | Write | NotebookEdit | apply_patch) echo typing ;;
    Bash | shell | local_shell | exec_command)
      work="$(command_work "$(command_of)")"
      echo "${work:-hammering}"
      ;;
    BashOutput | KillShell) echo hammering ;;
    Grep | Glob | LS) echo searching ;;
    WebFetch | WebSearch | web_search) echo signal ;;
    # Starting a sub-agent. Older Claude Code names the tool Task; TaskCreate, TaskStop and
    # the like are other tools.
    Agent | Task) echo delegating ;;
    # Writing its todo list or a plan. Claude Code 2.1 writes its todo list with TaskCreate
    # and TaskUpdate, older versions with TodoWrite. Reading it back (TaskList, TaskGet) is
    # no clue.
    TodoWrite | TaskCreate | TaskUpdate | EnterPlanMode | ExitPlanMode) echo planning ;;
    # Calling a tool of an MCP server: Claude Code names it mcp__<server>__<tool>. One way
    # for every server.
    mcp__*) echo mcp ;;
    # Loading a skill.
    Skill) echo skill ;;
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
  fail)
    # Claude Code sends this, not PostToolUse, for a command that exits other than 0. A
    # sub-agent's failure is its bee's business; one the person interrupted is no failure.
    [ -z "$id" ] && [ -z "${interrupted:-}" ] || exit 0
    case "$(field tool_name)" in
      Bash | shell | local_shell | exec_command)
        if tests_ran fail; then kind=tests-failed; else kind=failed; fi
        # This hook's pid makes the value new for each failure.
        hc2 label "$HC_TERMINAL_ID" "pixel.result=$kind.$$"
        ;;
    esac
    ;;
  pass)
    # Claude Code sends this for every tool that ran to the end, so it calls hc only for
    # tests of the agent's own that passed. A command in the background has only started:
    # one sent there, or one that outlived its timeout, gets this with a `backgroundTaskId`
    # after its empty output, and its end gets no hook.
    [ -z "$id" ] || exit 0
    case "$(field tool_name)" in Bash | shell | local_shell | exec_command) ;; *) exit 0 ;; esac
    case "$tool_input" in *'"backgroundTaskId"'*) exit 0 ;; esac
    tests_ran pass && hc2 label "$HC_TERMINAL_ID" "pixel.result=tests-passed.$$"
    ;;
  compact)
    [ -z "$id" ] || exit 0
    hc2 label "$HC_TERMINAL_ID" "pixel.work=compacting"
    ;;
  clear)
    # A sub-agent's own session start: nothing is stale.
    [ -z "$id" ] || exit 0
    # A compaction's own session start, when it is done: its sub-agents outlive it, but the
    # compacting way ends.
    if [ "$(field source)" = "compact" ]; then
      hc2 label "$HC_TERMINAL_ID" "pixel.work="
      exit 0
    fi
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
    hc2 label "$HC_TERMINAL_ID" "$@" "pixel.work=" "pixel.result=" "pixel.hive=$PPID"
    ;;
esac >/dev/null 2>&1
exit 0
