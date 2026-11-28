// tools/bee-hook.sh, run for real against a stand-in `hc` that records its calls and keeps
// the terminal's labels in a file. The hook's parent, the "agent program", is this process.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const HOOK = new URL("../tools/bee-hook.sh", import.meta.url).pathname;

// Logs each call to `calls`; `labels` holds key=value lines; `get` prints them the way
// `hc get --json` does. With FAKE_STALL set it hangs instead.
const FAKE_HC = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DIR/calls"
[ -z "\${FAKE_STALL:-}" ] || exec /bin/sleep 30
store="$FAKE_DIR/labels"
touch "$store"
case "$1" in
  get)
    printf '{"address":"%s","labels":{' "$2"
    sep=""
    while IFS= read -r line; do printf '%s"%s":"%s"' "$sep" "\${line%%=*}" "\${line#*=}"; sep=","; done < "$store"
    printf '},"state":"live"}\\n'
    ;;
  label)
    shift 2
    for kv in "$@"; do
      grep -v "^\${kv%%=*}=" "$store" > "$store.tmp"
      mv "$store.tmp" "$store"
      [ -z "\${kv#*=}" ] || printf '%s\\n' "$kv" >> "$store"
    done
    ;;
esac
`;

/** @type {string} */
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bee-hook-"));
  writeFileSync(join(dir, "hc"), FAKE_HC, { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const seed = (/** @type {string[]} */ lines) => writeFileSync(join(dir, "labels"), lines.map((l) => `${l}\n`).join(""));
const labels = () => (existsSync(join(dir, "labels")) ? readFileSync(join(dir, "labels"), "utf8").split("\n").filter(Boolean).sort() : []);
const calls = () => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean) : []);

/**
 * Runs the hook to the end of its streams, or kills it after `limit` ms.
 * @param {string} action
 * @param {object} input The hook's JSON.
 * @param {Record<string, string>} [env]
 * @returns {Promise<{ code: number | null, out: string, ms: number, hung: boolean }>}
 */
const hook = (action, input, env = {}, limit = 4000) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("/bin/sh", [HOOK, action], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, HC_TERMINAL_ID: "t9", FAKE_DIR: dir, ...env },
      detached: true,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    let hung = false;
    const timer = setTimeout(() => {
      hung = true;
      process.kill(-(child.pid ?? 0), "SIGKILL");
    }, limit);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, ms: Date.now() - started, hung });
    });
    child.stdin.end(JSON.stringify(input));
  });

const session = (source = "startup") => ({ session_id: "s", hook_event_name: "SessionStart", source });
const ok = (/** @type {{ code: number | null, out: string, hung: boolean }} */ r) => assert.deepEqual([r.code, r.out, r.hung], [0, "", false]);

test("a sub-agent's start adds its label and its stop removes it, quietly", async () => {
  ok(await hook("start", { hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "Explore" }));
  assert.deepEqual(labels(), ["pixel.bee.a1=1"]);
  ok(await hook("stop", { hook_event_name: "SubagentStop", agent_id: "a1" }));
  assert.deepEqual(labels(), []);
  assert.deepEqual(calls(), ["label t9 pixel.bee.a1=1", "label t9 pixel.bee.a1="]);
});

test("a sub-agent's start and stop read all of the hook's JSON: its id can come after long fields", async () => {
  const long = "x".repeat(20_000);
  ok(await hook("start", { hook_event_name: "SubagentStart", agent_type: long, agent_id: "a1" }));
  assert.deepEqual(labels(), ["pixel.bee.a1=1"]);
  ok(await hook("stop", { hook_event_name: "SubagentStop", last_assistant_message: long, agent_id: "a1" }));
  assert.deepEqual(labels(), []);
});

test("outside an hc terminal, and a sub-agent's own start, change nothing", async () => {
  seed(["pixel.bee.a1=1"]);
  ok(await hook("start", { agent_id: "a2" }, { HC_TERMINAL_ID: "" }));
  ok(await hook("clear", { ...session(), agent_id: "a2" }));
  ok(await hook("clear", session("compact"), { HC_TERMINAL_ID: "" }));
  assert.deepEqual(calls(), []);
  assert.deepEqual(labels(), ["pixel.bee.a1=1"]);
});

// PreCompact's JSON as Claude Code 2.1.332 sends it for `/compact` in `claude -p`. Its
// SessionStart with source "compact" follows when the summary is written, before PostCompact.
const preCompact = (more = {}) => ({
  session_id: "s",
  transcript_path: "/tmp/s.jsonl",
  cwd: "/tmp",
  prompt_id: "p",
  hook_event_name: "PreCompact",
  trigger: "manual",
  custom_instructions: null,
  ...more,
});

test("a compaction squishes the creature until its session start, which keeps the bees and their owner", async () => {
  seed(["pixel.avatar=knight7", "pixel.bee.a1=1", "pixel.hive=99999999", "pixel.work=reading"]);
  ok(await hook("compact", preCompact()));
  assert.deepEqual(labels(), ["pixel.avatar=knight7", "pixel.bee.a1=1", "pixel.hive=99999999", "pixel.work=compacting"]);
  ok(await hook("clear", session("compact")));
  assert.deepEqual(labels(), ["pixel.avatar=knight7", "pixel.bee.a1=1", "pixel.hive=99999999"]);
  assert.deepEqual(calls(), ["label t9 pixel.work=compacting", "label t9 pixel.work="]);
});

test("a compaction reads all of its JSON, and a sub-agent's leaves the label alone", async () => {
  ok(await hook("compact", preCompact({ custom_instructions: "x".repeat(20_000), trigger: "auto" })));
  assert.deepEqual(labels(), ["pixel.work=compacting"]);
  seed(["pixel.work=reading"]);
  rmSync(join(dir, "calls"), { force: true });
  ok(await hook("compact", preCompact({ agent_id: "a1" })));
  ok(await hook("compact", preCompact(), { HC_TERMINAL_ID: "" }));
  assert.deepEqual(calls(), []);
  assert.deepEqual(labels(), ["pixel.work=reading"]);
});

test("a second program's session on the same terminal leaves the live owner's bees", async () => {
  // The owner is alive and is not this hook's parent: an agent ran `claude -p` from its tool.
  seed(["pixel.avatar=knight7", "pixel.bee.a1=1", `pixel.hive=${process.ppid}`]);
  ok(await hook("clear", session()));
  assert.deepEqual(labels(), ["pixel.avatar=knight7", "pixel.bee.a1=1", `pixel.hive=${process.ppid}`]);
  assert.deepEqual(calls(), ["get t9 --json"]);
});

test("a new session clears what a dead, missing or same owner left, and owns the bees", async () => {
  for (const owner of [["pixel.hive=99999999"], [], [`pixel.hive=${process.pid}`]]) {
    seed(["pixel.avatar=knight7", "pixel.bee.a1=1", "pixel.bee.b2=1", "pixel.work=reading", "pixel.result=failed.7", ...owner]);
    rmSync(join(dir, "calls"), { force: true });
    ok(await hook("clear", session()));
    assert.deepEqual(labels(), ["pixel.avatar=knight7", `pixel.hive=${process.pid}`], String(owner));
    assert.deepEqual(calls(), ["get t9 --json", `label t9 pixel.bee.a1= pixel.bee.b2= pixel.work= pixel.result= pixel.hive=${process.pid}`]);
  }
});

test("a tool about to run says what the agent is doing, in Claude Code's names and Codex's", async () => {
  const cases = {
    Read: "reading",
    Edit: "typing",
    Write: "typing",
    MultiEdit: "typing",
    NotebookEdit: "typing",
    apply_patch: "typing",
    Bash: "hammering",
    shell: "hammering",
    Grep: "searching",
    Glob: "searching",
    WebFetch: "signal",
    WebSearch: "signal",
    web_search: "signal",
  };
  for (const [tool, work] of Object.entries(cases)) {
    ok(await hook("tool", { hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command: "\"tool_name\": \"Read\"" } }));
    assert.deepEqual(labels(), [`pixel.work=${work}`], tool);
  }
});

test("only the fields before the tool's own input count, and a huge input is read quickly", async () => {
  // A tool's input can hold keys named like the hook's own, and a Write can be megabytes.
  ok(await hook("tool", { session_id: "s", hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { query: { agent_id: "zz", tool_name: "Bash" } } }));
  assert.deepEqual(labels(), ["pixel.work=reading"]);
  ok(await hook("tool", { session_id: "s", hook_event_name: "PreToolUse", tool_name: "mcp__x__y", tool_input: { tool_name: "Read" } }));
  assert.deepEqual(labels(), []);
  const r = await hook("tool", { session_id: "s", hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/a", content: "x".repeat(4_000_000) } });
  ok(r);
  assert.ok(r.ms < 1000, `took ${r.ms} ms`);
  assert.deepEqual(labels(), ["pixel.work=typing"]);
});

test("a shell command says whether the agent is testing, building, installing or using git; any other hammers", async () => {
  const cases = {
    "npm test": "testing",
    "cd app && pnpm test": "testing",
    "pnpm run test:unit -- --watch=false": "testing",
    "cargo test --workspace": "testing",
    "go test ./...": "testing",
    "just test": "testing",
    "uv run pytest -q": "testing",
    "python3 -m pytest": "testing",
    "npx vitest run": "testing",
    "node --import ./tests/mocks/register.mjs --test 'tests/*.test.mjs'": "testing",
    "make test 2>&1 | tail -5": "testing",
    "FOO=1 npm run build": "building",
    "cargo build --release": "building",
    "./node_modules/.bin/tsc -p tsconfig.json": "building",
    "make": "building",
    "docker build -t app .": "building",
    "pnpm install --frozen-lockfile": "installing",
    "npm ci": "installing",
    "uv pip install -r requirements.txt": "installing",
    "sudo apt-get install -y jq": "installing",
    "go get example.com/x": "installing",
    "git status": "git",
    'git commit -m "fix build"': "git",
    "/usr/bin/git log --oneline -3": "git",
    "cd /tmp && git push -u origin main": "git",
    "ls -la": "hammering",
    "echo npm test": "hammering",
    "grep -rn test src": "hammering",
    "rm -rf 'dist/*'": "hammering",
    "": "hammering",
  };
  for (const [command, work] of Object.entries(cases)) {
    ok(await hook("tool", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command, description: "x" } }));
    assert.deepEqual(labels(), [`pixel.work=${work}`], command);
  }
  // Codex's shell tools are read the same way, on the same unverified guess at their input.
  ok(await hook("tool", { hook_event_name: "PreToolUse", tool_name: "shell", tool_input: { command: "cargo test" } }));
  assert.deepEqual(labels(), ["pixel.work=testing"]);
});

test("a shell command's first command that says decides, a line at a time, and a glob in it stays unexpanded", async () => {
  // The JSON writes the command's newlines as `\n`.
  for (const [command, work] of [
    ["cd app\nnpm install\nnpm test", "installing"],
    ["echo start; git add -A && git commit -m wip", "git"],
    ["(cd web && yarn build) && pnpm test", "building"],
    ["VAR=1 env time nice * && cargo test", "testing"],
  ]) {
    ok(await hook("tool", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }));
    assert.deepEqual(labels(), [`pixel.work=${work}`], command);
  }
  // Expanded in the agent's folder, `*` would read as the name of the file there: git.
  const cwd = join(dir, "repo");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "git"), "");
  const r = await new Promise((resolve) => {
    const child = spawn("/bin/sh", [HOOK, "tool"], { cwd, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, HC_TERMINAL_ID: "t9", FAKE_DIR: dir } });
    child.on("close", resolve);
    child.stdin.end(JSON.stringify({ tool_name: "Bash", tool_input: { command: "* status" } }));
  });
  assert.equal(r, 0);
  assert.deepEqual(labels(), ["pixel.work=hammering"]);
});

test("only a shell tool's command is read, from its input's first 512 bytes, and a huge command is read quickly", async () => {
  // Another tool's input can hold a command.
  for (const tool of ["Read", "Write", "BashOutput"]) {
    ok(await hook("tool", { hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command: "git status", file_path: "/a" } }));
    assert.deepEqual(labels(), [`pixel.work=${tool === "BashOutput" ? "hammering" : tool === "Read" ? "reading" : "typing"}`], tool);
  }
  // Within the budget, after other keys of the input, and past it.
  ok(await hook("tool", { tool_name: "Bash", tool_input: { description: "d".repeat(400), command: "npm test" } }));
  assert.deepEqual(labels(), ["pixel.work=testing"]);
  ok(await hook("tool", { tool_name: "Bash", tool_input: { description: "d".repeat(600), command: "npm test" } }));
  assert.deepEqual(labels(), ["pixel.work=hammering"]);
  // A command cut by the budget still says what its start says.
  ok(await hook("tool", { tool_name: "Bash", tool_input: { command: `git apply <<'EOF'\n${"+x\n".repeat(2_000_000)}EOF` } }));
  assert.deepEqual(labels(), ["pixel.work=git"]);
  const r = await hook("tool", { tool_name: "Bash", tool_input: { command: `echo ${"x ".repeat(2_000_000)}; npm test` } });
  ok(r);
  assert.ok(r.ms < 1000, `took ${r.ms} ms`);
  assert.deepEqual(labels(), ["pixel.work=hammering"]);
});

test("a tool that says nothing about the work takes the label away: the creature works its own way", async () => {
  seed(["pixel.avatar=knight7", "pixel.work=typing"]);
  for (const tool of ["TodoWrite", "Agent", "mcp__linear__get_issue", "Skill", ""]) {
    seed(["pixel.avatar=knight7", "pixel.work=typing"]);
    ok(await hook("tool", { hook_event_name: "PreToolUse", tool_name: tool }));
    assert.deepEqual(labels(), ["pixel.avatar=knight7"], tool);
  }
  seed(["pixel.work=typing"]);
  ok(await hook("tool", { hook_event_name: "PreToolUse" }));
  assert.deepEqual(labels(), []);
});

test("a prompt sets the agent thinking; a sub-agent's tools and prompts leave the label alone", async () => {
  ok(await hook("think", { hook_event_name: "UserPromptSubmit", prompt: "go" }));
  assert.deepEqual(labels(), ["pixel.work=thinking"]);
  rmSync(join(dir, "calls"), { force: true });
  ok(await hook("tool", { hook_event_name: "PreToolUse", tool_name: "Read", agent_id: "a1", agent_type: "Explore" }));
  ok(await hook("think", { hook_event_name: "UserPromptSubmit", agent_id: "a1" }));
  assert.deepEqual(calls(), []);
  assert.deepEqual(labels(), ["pixel.work=thinking"]);
  ok(await hook("tool", { tool_name: "Read" }, { HC_TERMINAL_ID: "" }));
  assert.deepEqual(calls(), []);
});

// Claude Code's PostToolUseFailure, as 2.1.332 sends it for a Bash command that exits 2: the
// exit code is only text at the start of `error`, which holds up to about 10 KB of output.
const failure = (fields = {}, error = "Exit code 2\nls: /nope: No such file or directory") => ({
  session_id: "s",
  transcript_path: "/t.jsonl",
  cwd: "/repo",
  prompt_id: "p",
  permission_mode: "default",
  effort: { level: "medium" },
  hook_event_name: "PostToolUseFailure",
  tool_name: "Bash",
  ...fields,
  tool_input: { command: "ls /nope", description: "List it" },
  tool_use_id: "toolu_01",
  error,
  is_interrupt: false,
  duration_ms: 103,
});
const result = () => labels().filter((l) => l.startsWith("pixel.result="));

test("a failed command sets pixel.result to a new failed value each time, and leaves pixel.work alone", async () => {
  seed(["pixel.work=hammering"]);
  ok(await hook("fail", failure()));
  const [first] = result();
  assert.match(first ?? "", /^pixel\.result=failed\.\d+$/);
  ok(await hook("fail", failure({ tool_name: "shell" })));
  const [second] = result();
  assert.match(second ?? "", /^pixel\.result=failed\.\d+$/, "Codex's name for its shell too");
  assert.notEqual(second, first, "two failures in a row are two results");
  assert.ok(labels().includes("pixel.work=hammering"));
  assert.equal(calls().length, 2, "one hc call each");
});

test("a failure only counts for a command of the agent's own, not interrupted, and only from its own fields", async () => {
  ok(await hook("fail", failure({ tool_name: "Read" })));
  ok(await hook("fail", failure({ agent_id: "a1", agent_type: "Explore" })));
  ok(await hook("fail", { ...failure(), is_interrupt: true }));
  ok(await hook("fail", { ...failure({}, `Exit code 1\n${"x".repeat(10_000)}`), is_interrupt: true }));
  ok(await hook("fail", failure(), { HC_TERMINAL_ID: "" }));
  // The command's input and output can hold the hook's own keys: only the head's count.
  ok(await hook("fail", { ...failure({ tool_name: "mcp__x__y" }), tool_input: { tool_name: "Bash", is_interrupt: false } }));
  assert.deepEqual(calls(), []);
  const r = await hook("fail", { ...failure(), tool_input: { command: "x".repeat(4_000_000) }, error: `Exit code 1\n"is_interrupt":true ${"y".repeat(10_000)}` });
  ok(r);
  assert.ok(r.ms < 1000, `took ${r.ms} ms`);
  assert.equal(result().length, 1, "a huge failure is read quickly, and its output's words are not the hook's");
});

// Claude Code's PostToolUse, as 2.1.332 sends it for a Bash command that exits 0: no exit
// code, only the output in `tool_response`, after the input.
const success = (command, fields = {}, input = {}) => ({
  session_id: "s",
  transcript_path: "/t.jsonl",
  cwd: "/repo",
  prompt_id: "p",
  permission_mode: "default",
  effort: { level: "medium" },
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  ...fields,
  tool_input: { command, description: "Run it", ...input },
  tool_response: { stdout: "ℹ pass 1\nℹ fail 0", stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
  tool_use_id: "toolu_01",
  duration_ms: 1149,
});

test("a failed test command reports failed tests, not a failed command", async () => {
  const commands = [
    "npm test",
    "cd app && pnpm test",
    "(cd app && npm test)",
    "node --test 'tests/*.test.mjs'",
    "uv run pytest -x",
    // A redirect's `&` ends no command.
    "npm test 2>&1",
    "npm test > out.log 2>&1",
    "npm test &> out.log",
    // After a `;` or a newline, an earlier command's result is lost: the tests' is the one.
    "npm run lint; npm test",
    "npm test;",
    "npm run lint\nnpm test\n",
    "cd app &&\nnpm test",
    // A quoted string's `;` or `|` is no command's end.
    'pytest -k "a or b; c"',
    "npm test -- -t 'a | b'",
  ];
  for (const command of commands) {
    rmSync(join(dir, "labels"), { force: true });
    ok(await hook("fail", { ...failure(), tool_input: { command, description: "Test it" } }));
    assert.match(result()[0] ?? "", /^pixel\.result=tests-failed\.\d+$/, command);
  }
  // The command's exit code is another program's: it failed, but maybe not its tests. A pipe
  // or `||` gives it, a command after the tests does, and so does one before them with `&&`.
  for (const command of [
    "npm test | tail -20",
    "npm test 2>&1 | grep -q FAIL",
    "pytest || exit 3",
    "npm run build",
    "npm test && npm run lint",
    "cargo test && cargo clippy -- -D warnings",
    "npm test; npm run lint",
    "npm test\nnpm run lint",
    "npm run build && npm test",
    // An `&&` at a line's end, or a line that goes on after a backslash, joins the next line.
    "npm run build &&\nnpm test",
    "npm run build && \\\nnpm test",
    "npm test; npm run test:e2e",
    `npm run lint; npm test ${"x".repeat(600)}`,
    // Tests named in a quoted string are not run.
    'git commit -m "wip; npm test later"',
    'git commit -m "wip\n\nnpm test passes"',
    'echo "x; npm test y',
  ]) {
    rmSync(join(dir, "labels"), { force: true });
    ok(await hook("fail", { ...failure(), tool_input: { command, description: "Run it" } }));
    assert.match(result()[0] ?? "", /^pixel\.result=failed\.\d+$/, command);
  }
});

test("a test command that passed sets pixel.result to a new tests-passed value each time", async () => {
  seed(["pixel.work=testing"]);
  ok(await hook("pass", success("npm test")));
  const [first] = result();
  assert.match(first ?? "", /^pixel\.result=tests-passed\.\d+$/);
  ok(await hook("pass", success("cargo test --workspace", { tool_name: "shell" })));
  const [second] = result();
  assert.match(second ?? "", /^pixel\.result=tests-passed\.\d+$/, "Codex's name for its shell too");
  assert.notEqual(second, first, "two passes in a row are two results");
  assert.ok(labels().includes("pixel.work=testing"), "what the agent does is the next tool's to say");
  assert.equal(calls().length, 2, "one hc call each");
  // A chain that passed ran every command in it to a good end, so commands before the tests
  // with `&&` are no matter.
  for (const command of ["npm run build && npm test", "cd app && pnpm test 2>&1", "npm run lint; npm test"]) {
    rmSync(join(dir, "labels"), { force: true });
    ok(await hook("pass", success(command)));
    assert.match(result()[0] ?? "", /^pixel\.result=tests-passed\.\d+$/, command);
  }
});

test("only the agent's own test commands that ran to the end pass; any other tool calls no hc", async () => {
  const runs = [
    success("npm run build"),
    success("ls -la"),
    success("git commit -m 'npm test'"),
    // Its exit code is another program's: `npm test | tail` ends as `tail` does.
    success("npm test 2>&1 | tail -20"),
    success("npm test || true"),
    // So is a command's after the tests, and the tests' own may be lost after a `;`.
    success("npm test; echo exit=$?"),
    success("npm test && npm run lint"),
    success("npm test; npm run test:e2e"),
    // Sent to the background by the shell, it has only started.
    success("npm test &"),
    // Tests named in a quoted string are not run.
    success('git commit -m "wip; npm test later"'),
    success("git commit -m 'wip\n\nnpm test passes'"),
    success('echo "x; npm test y"'),
    // Cut at 512 bytes, what comes after the cut is unknown.
    success(`npm test ${"x".repeat(600)}; echo done`),
    // In the background, it has only started: sent there, or moved there when it outlived
    // its timeout. Claude Code 2.1.332 says so in `tool_response`, and its end fires no hook.
    { ...success("npm test", {}, { run_in_background: true }), tool_response: { stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: "bx2zl1tmp" } },
    { ...success("npm test", {}, { timeout: 2000 }), tool_response: { stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: "b75svf0fj", timedOutAfterMs: 2000 } },
    success("npm test", { agent_id: "a1", agent_type: "general-purpose" }),
    { ...success("npm test"), tool_name: "Read", tool_input: { file_path: "/repo/package.json" } },
    // The input can hold the hook's own keys: only the head's count.
    { ...success("x"), tool_name: "mcp__x__y", tool_input: { tool_name: "Bash", command: "npm test" } },
    { ...success("x"), tool_name: "Write", tool_input: { file_path: "/a", content: `"command":"npm test" ${"x".repeat(2_000_000)}` } },
  ];
  for (const input of runs) ok(await hook("pass", input));
  ok(await hook("pass", success("npm test"), { HC_TERMINAL_ID: "" }));
  assert.deepEqual(calls(), []);
  assert.deepEqual(labels(), []);
});

test("a stalled hc gives up within the hook's 5 s timeout, quietly, on every action", async () => {
  const runs = await Promise.all([
    hook("start", { agent_id: "a1" }, { FAKE_STALL: "1" }),
    hook("stop", { agent_id: "a1" }, { FAKE_STALL: "1" }),
    hook("clear", session(), { FAKE_STALL: "1" }),
    hook("tool", { tool_name: "Read" }, { FAKE_STALL: "1" }),
    hook("think", {}, { FAKE_STALL: "1" }),
    hook("fail", failure(), { FAKE_STALL: "1" }),
    hook("compact", preCompact(), { FAKE_STALL: "1" }),
    hook("clear", session("compact"), { FAKE_STALL: "1" }),
    hook("pass", success("npm test"), { FAKE_STALL: "1" }),
  ]);
  for (const r of runs) {
    ok(r);
    assert.ok(r.ms < 3000, `took ${r.ms} ms`);
  }
});
