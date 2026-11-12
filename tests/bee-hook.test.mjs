// tools/bee-hook.sh, run for real against a stand-in `hc` that records its calls and keeps
// the terminal's labels in a file. The hook's parent, the "agent program", is this process.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("outside an hc terminal, a sub-agent's own start, and a compaction change nothing", async () => {
  seed(["pixel.bee.a1=1"]);
  ok(await hook("start", { agent_id: "a2" }, { HC_TERMINAL_ID: "" }));
  ok(await hook("clear", { ...session(), agent_id: "a2" }));
  ok(await hook("clear", session("compact")));
  assert.deepEqual(calls(), []);
  assert.deepEqual(labels(), ["pixel.bee.a1=1"]);
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
    seed(["pixel.avatar=knight7", "pixel.bee.a1=1", "pixel.bee.b2=1", ...owner]);
    rmSync(join(dir, "calls"), { force: true });
    ok(await hook("clear", session()));
    assert.deepEqual(labels(), ["pixel.avatar=knight7", `pixel.hive=${process.pid}`], String(owner));
    assert.deepEqual(calls(), ["get t9 --json", `label t9 pixel.bee.a1= pixel.bee.b2= pixel.hive=${process.pid}`]);
  }
});

test("a stalled hc gives up within the hook's 5 s timeout, quietly, on every action", async () => {
  const runs = await Promise.all([
    hook("start", { agent_id: "a1" }, { FAKE_STALL: "1" }),
    hook("stop", { agent_id: "a1" }, { FAKE_STALL: "1" }),
    hook("clear", session(), { FAKE_STALL: "1" }),
  ]);
  for (const r of runs) {
    ok(r);
    assert.ok(r.ms < 3000, `took ${r.ms} ms`);
  }
});
