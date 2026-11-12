// The hook installer changes a person's own settings: what it adds, and above all what it
// refuses to touch.

import assert from "node:assert/strict";
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EVENTS, Refusal, commandsFor, install, main, merge } from "../tools/install-hooks.mjs";

const commands = commandsFor("/opt/pixel party/tools/bee-hook.sh");
const dir = () => mkdtempSync(join(tmpdir(), "pp-hooks-"));
const json = (value, indent = 2) => `${JSON.stringify(value, null, indent)}\n`;

/** Runs `body` with one node:fs function replaced, as the installer sees it. */
function withFs(name, fake, body) {
  const real = fs[name];
  fs[name] = fake(real);
  syncBuiltinESMExports();
  try {
    return body();
  } finally {
    fs[name] = real;
    syncBuiltinESMExports();
  }
}

/** A disk that fills up after 20 bytes of a write. */
const diskFull = (real) => (fd, data) => {
  real(fd, data.slice(0, 20));
  throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", syscall: "write" });
};

// Settings like a real person's: other keys, other hooks on the same events, odd text.
const SETTINGS = {
  cleanupPeriodDays: 90,
  env: { GREETING: "héllo 🔔 \"quoted\" \\ back/slash", EMPTY: "" },
  permissions: { allow: ["Bash(git status:*)"], deny: [] },
  hooks: {
    SessionStart: [
      { matcher: "^(startup|resume)$", hooks: [{ type: "command", command: "bash '/home/me/state.sh' session", timeout: 10 }] },
      { hooks: [{ type: "command", command: "/bin/sh -c 'true'" }] },
    ],
    SubagentStart: [{ matcher: "", hooks: [{ type: "command", command: "memory hook --event subagent-start" }] }],
    Stop: [{ hooks: [{ type: "command", command: "notify done" }] }],
  },
  nested: { deep: [1, 2.5, -3, 1e21, true, null, { a: [] }] },
};

/** The settings with every bee hook taken out again, empty lists and all. */
function without(data) {
  const out = structuredClone(data);
  for (const event of Object.keys(EVENTS)) {
    out.hooks[event] = (out.hooks[event] ?? []).filter((g) => !g.hooks.some((h) => /bee-hook\.sh/.test(h.command)));
    if (!out.hooks[event].length) delete out.hooks[event];
  }
  return out;
}

test("the hooks are added after the ones already there, and nothing else changes", () => {
  const before = json(SETTINGS);
  const { text, changes } = merge(before, commands);
  const after = JSON.parse(text);
  assert.equal(changes.length, 3);
  assert.deepEqual(without(after), SETTINGS);
  assert.deepEqual(Object.keys(after), Object.keys(SETTINGS), "top-level keys keep their order");
  for (const [event, action] of Object.entries(EVENTS)) {
    const was = SETTINGS.hooks[event] ?? [];
    assert.deepEqual(after.hooks[event].slice(0, was.length), was, `${event}: the old hooks keep their places`);
    assert.deepEqual(after.hooks[event].slice(was.length), [{ hooks: [{ type: "command", command: `'/opt/pixel party/tools/bee-hook.sh' ${action}`, timeout: 5 }] }]);
  }
  // Every line of the old file is still there, in order: the change only adds lines.
  const lines = text.split("\n");
  let at = 0;
  for (const line of before.split("\n")) {
    const tidy = line.replace(/,$/, "");
    at = lines.findIndex((l, i) => i >= at && l.replace(/,$/, "") === tidy) + 1;
    assert.ok(at > 0, `kept: ${line}`);
  }
});

test("a second run changes nothing, and gives back the very same text", () => {
  const once = merge(json(SETTINGS), commands).text;
  assert.deepEqual(merge(once, commands), { text: once, changes: [], notes: [] });
});

test("a person's own hook is never changed, even one that runs a bee-hook.sh", () => {
  const theirs = {
    SubagentStart: ["cd ~/dotfiles && HC_DEBUG=1 ./bee-hook.sh start", "echo bee-hook.sh start", "BEE_LOG=1 nice -n 19 /home/me/old-clone/tools/bee-hook.sh start"],
    SubagentStop: ["/home/me/bin/bee-hook.sh stop"],
    SessionStart: [`${commandsFor("/old/clone/tools/bee-hook.sh").SessionStart}`],
  };
  for (const [event, list] of Object.entries(theirs)) {
    for (const command of list) {
      const before = json({ hooks: { [event]: [{ hooks: [{ type: "command", command }] }] } });
      const { text, changes, notes } = merge(before, commands);
      const after = JSON.parse(text);
      assert.deepEqual(after.hooks[event][0], { hooks: [{ type: "command", command }] }, `kept as it was: ${command}`);
      assert.equal(after.hooks[event][1].hooks[0].command, commands[event], `ours added after it: ${command}`);
      assert.equal(changes.length, 3, command);
      assert.equal(notes.length, 1, `a note says a second bee hook is there: ${command}`);
      assert.ok(notes[0].startsWith(`${event}:`) && notes[0].includes(command), notes[0]);
      assert.deepEqual(merge(text, commands), { text, changes: [], notes }, `a second run changes nothing: ${command}`);
    }
  }
});

test("the hook as the installer writes it, or as README.md writes it by hand, is already there", () => {
  for (const script of ["/opt/pixel party/tools/bee-hook.sh", "/home/it's me/tools/bee-hook.sh", "/home/me/herdr-mod-pixel-art/tools/bee-hook.sh"]) {
    const ours = commandsFor(script);
    for (const form of [(c) => c, (c) => `  ${c} `, (c) => c.replace(/^'(.*)' (\w+)$/, (_, path, action) => `${path.replaceAll("'\\''", "'")} ${action}`)]) {
      const hooks = Object.fromEntries(Object.entries(ours).map(([event, command]) => [event, [{ hooks: [{ type: "command", command: form(command), timeout: 5 }] }]]));
      const text = json({ hooks });
      assert.deepEqual(merge(text, ours), { text, changes: [], notes: [] }, form(ours.SubagentStart));
    }
  }
});

test("install leaves a person's own bee hook alone, says so, and a second run writes nothing", () => {
  const d = dir();
  const env = { CLAUDE_CONFIG_DIR: d, CODEX_HOME: join(d, "no-codex") };
  const file = join(d, "settings.json");
  const mine = "cd ~/dotfiles && HC_DEBUG=1 ./bee-hook.sh start";
  writeFileSync(file, json({ hooks: { SubagentStart: [{ hooks: [{ type: "command", command: mine }] }] } }));
  const lines = [];
  assert.equal(main(["claude"], env, (line) => lines.push(line)), 0);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).hooks.SubagentStart[0].hooks[0].command, mine);
  assert.match(lines.join("\n"), /SubagentStart: .*names bee-hook\.sh/);
  const text = readFileSync(file, "utf8");
  const files = readdirSync(d).sort();
  lines.length = 0;
  assert.equal(main(["claude"], env, (line) => lines.push(line)), 0);
  assert.match(lines.join("\n"), /already in/);
  assert.equal(readFileSync(file, "utf8"), text);
  assert.deepEqual(readdirSync(d).sort(), files, "no second backup");
});

test("only the missing hooks are added", () => {
  const some = JSON.parse(merge(json(SETTINGS), commands).text);
  some.hooks.SubagentStop = [];
  const { text, changes } = merge(json(some), commands);
  assert.deepEqual(changes.map((c) => c.split(":")[0]), ["SubagentStop"]);
  assert.equal(JSON.parse(text).hooks.SubagentStop.length, 1);
});

test("a file without hooks gets them; an empty object too", () => {
  assert.deepEqual(Object.keys(JSON.parse(merge("{}", commands).text).hooks), Object.keys(EVENTS));
  const after = JSON.parse(merge(json({ model: "x" }), commands).text);
  assert.equal(after.model, "x");
  assert.equal(after.hooks.SessionStart.length, 1);
});

test("the file's own indent, line ends and last line are kept", () => {
  for (const indent of [2, 4, "\t"]) {
    const { text } = merge(json(SETTINGS, indent), commands);
    assert.equal(text, json(JSON.parse(text), indent));
  }
  assert.ok(!merge(JSON.stringify(SETTINGS, null, 2), commands).text.endsWith("\n"), "no newline is added at the end");
  const crlf = merge(json(SETTINGS).replaceAll("\n", "\r\n"), commands).text;
  assert.ok(!/[^\r]\n/.test(crlf) && crlf.endsWith("}\r\n"));
  assert.deepEqual(without(JSON.parse(crlf)), SETTINGS);
});

test("a file that would not survive a rewrite is refused", () => {
  const refused = {
    "not JSON": "{ hooks: {} }",
    "empty": "",
    "a comment": '{\n  // mine\n  "hooks": {}\n}',
    "a trailing comma": '{ "hooks": {}, }',
    "a byte order mark": '﻿{ "hooks": {} }',
    "a duplicate key": '{ "a": 1, "hooks": {}, "a": 2 }',
    "a number too long to keep": '{ "id": 12345678901234567890, "hooks": {} }',
    "a number written another way": '{ "n": 1.0 }',
    "an escape written another way": '{ "s": "\\u0041" }',
    "a key that would move": '{ "b": 1, "2": 2 }',
    "an array": "[]",
    "a string": '"hooks"',
    "hooks that is a list": '{ "hooks": [] }',
    "hooks that is text": '{ "hooks": "none" }',
    "an event that is not a list": '{ "hooks": { "SessionStart": {} } }',
    "an event that is null": '{ "hooks": { "SubagentStop": null } }',
  };
  for (const [what, text] of Object.entries(refused)) assert.throws(() => merge(text, commands), Refusal, what);
});

test("odd but harmless hook entries are left as they are", () => {
  const odd = { hooks: { SessionStart: [null, "x", { hooks: "none" }, { hooks: [null, { command: 7 }] }] } };
  const after = JSON.parse(merge(json(odd), commands).text);
  assert.deepEqual(after.hooks.SessionStart.slice(0, 4), odd.hooks.SessionStart);
  assert.equal(after.hooks.SessionStart.length, 5);
});

test("a command that only mentions bee-hook.sh is not taken for the hook", () => {
  const near = { hooks: { SubagentStart: [{ hooks: [{ type: "command", command: "echo bee-hook.sh start again" }, { type: "command", command: "/x/not-bee-hook.sh start" }] }] } };
  const after = JSON.parse(merge(json(near), commands).text);
  assert.deepEqual(after.hooks.SubagentStart[0], near.hooks.SubagentStart[0]);
  assert.equal(after.hooks.SubagentStart.length, 2);
});

test("install rewrites the file in place, keeps its mode, and leaves the old one beside it", () => {
  const d = dir();
  const file = join(d, "settings.json");
  writeFileSync(file, json(SETTINGS));
  chmodSync(file, 0o640);
  const done = install(file, commands, { now: 42 });
  assert.equal(done.backup, `${done.file}.bak-pixel-party-42`);
  assert.equal(readFileSync(done.backup, "utf8"), json(SETTINGS));
  assert.deepEqual(without(JSON.parse(readFileSync(file, "utf8"))), SETTINGS);
  assert.equal(statSync(file).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(d).sort(), ["settings.json", "settings.json.bak-pixel-party-42"], "no temporary file is left");

  // Again: nothing to do, so no second backup and not a byte written.
  const text = readFileSync(file, "utf8");
  assert.deepEqual(install(file, commands, { now: 43 }).changes, []);
  assert.equal(readFileSync(file, "utf8"), text);
  assert.equal(readdirSync(d).length, 2);
});

test("a refused file is not touched, and nothing is left beside it", () => {
  const d = dir();
  const file = join(d, "settings.json");
  for (const text of ['{\n  // a comment\n  "hooks": {}\n}\n', '{ "a": 1, "a": 2 }', ""]) {
    writeFileSync(file, text);
    assert.throws(() => install(file, commands), Refusal);
    assert.equal(readFileSync(file, "utf8"), text);
    assert.deepEqual(readdirSync(d), ["settings.json"]);
  }
  writeFileSync(file, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
  assert.throws(() => install(file, commands), Refusal, "not UTF-8");
  assert.equal(readFileSync(file).length, 7);
});

test("a dry run says what it would do and writes nothing", () => {
  const d = dir();
  const file = join(d, "settings.json");
  writeFileSync(file, json(SETTINGS));
  assert.equal(install(file, commands, { dryRun: true }).changes.length, 3);
  assert.equal(readFileSync(file, "utf8"), json(SETTINGS));
  assert.equal(install(join(d, "hooks.json"), commands, { dryRun: true }).created, true);
  assert.deepEqual(readdirSync(d), ["settings.json"]);
});

test("a linked settings file stays a link: the file it points at is the one changed", () => {
  const d = dir();
  mkdirSync(join(d, "dotfiles"));
  const target = join(d, "dotfiles", "settings.json");
  const link = join(d, "settings.json");
  writeFileSync(target, json(SETTINGS));
  symlinkSync(target, link);
  const done = install(link, commands, { now: 7 });
  assert.equal(readFileSync(link, "utf8"), readFileSync(target, "utf8"));
  assert.deepEqual(without(JSON.parse(readFileSync(target, "utf8"))), SETTINGS);
  assert.ok(existsSync(join(d, "dotfiles", "settings.json.bak-pixel-party-7")));
  assert.deepEqual(readdirSync(d).sort(), ["dotfiles", "settings.json"]);
  assert.equal(done.file.endsWith(join("dotfiles", "settings.json")), true);
});

test("a missing file is made when its folder is there; a folder is never taken for one", () => {
  const d = dir();
  const file = join(d, "hooks.json");
  assert.equal(install(file, commands).created, true);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))), ["hooks"]);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  mkdirSync(join(d, "settings.json"));
  assert.throws(() => install(join(d, "settings.json"), commands), Refusal);
});

test("a first write that fails part-way leaves nothing behind, and the next run works", () => {
  const d = dir();
  const file = join(d, "hooks.json");
  let error;
  try {
    withFs("writeSync", diskFull, () => install(file, commands));
  } catch (e) {
    error = e;
  }
  assert.deepEqual(readdirSync(d), [], "no half-written file, no temporary file");
  assert.ok(error instanceof Refusal, `refused, not thrown: ${error}`);
  assert.equal(install(file, commands).created, true);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")).hooks), Object.keys(EVENTS));
});

test("a rewrite that fails part-way leaves the file as it was, and nothing beside it", () => {
  const d = dir();
  const file = join(d, "settings.json");
  writeFileSync(file, json(SETTINGS));
  assert.throws(() => withFs("writeSync", diskFull, () => install(file, commands)), Refusal);
  assert.equal(readFileSync(file, "utf8"), json(SETTINGS));
  assert.deepEqual(readdirSync(d), ["settings.json"]);
});

test("a file that appears while the first one is written is never replaced", () => {
  const d = dir();
  const file = join(d, "hooks.json");
  const theirs = (real) => (fd) => {
    real(fd);
    if (!existsSync(file)) writeFileSync(file, "theirs");
  };
  assert.throws(() => withFs("fsyncSync", theirs, () => install(file, commands)), Refusal);
  assert.equal(readFileSync(file, "utf8"), "theirs");
  assert.deepEqual(readdirSync(d), ["hooks.json"]);
});

test("a hard-linked file is refused: changing one name would split it from the other", () => {
  const d = dir();
  mkdirSync(join(d, "dotfiles"));
  const other = join(d, "dotfiles", "settings.json");
  const file = join(d, "settings.json");
  writeFileSync(other, json(SETTINGS));
  linkSync(other, file);
  assert.throws(() => install(file, commands), (e) => e instanceof Refusal && /hard link/.test(e.message));
  assert.equal(statSync(file).ino, statSync(other).ino);
  assert.equal(readFileSync(other, "utf8"), json(SETTINGS));
  assert.deepEqual(readdirSync(d).sort(), ["dotfiles", "settings.json"]);
  assert.deepEqual(readdirSync(join(d, "dotfiles")), ["settings.json"]);
  // With the hooks already there nothing would be written, so there is nothing to refuse.
  writeFileSync(other, merge(json(SETTINGS), commands).text);
  assert.deepEqual(install(file, commands).changes, []);
});

test("a link to nothing is refused and left as it is", () => {
  const d = dir();
  const file = join(d, "settings.json");
  const gone = join(d, "dotfiles", "settings.json");
  symlinkSync(gone, file);
  for (const dryRun of [true, false]) assert.throws(() => install(file, commands, { dryRun }), Refusal);
  assert.ok(lstatSync(file).isSymbolicLink());
  assert.equal(readlinkSync(file), gone);
  assert.deepEqual(readdirSync(d), ["settings.json"]);
});

test("a folder it may not write in is refused, untouched", { skip: process.getuid?.() === 0 && "root writes anywhere" }, () => {
  const d = dir();
  const file = join(d, "settings.json");
  writeFileSync(file, json(SETTINGS));
  chmodSync(d, 0o555);
  try {
    assert.throws(() => install(file, commands), (e) => e instanceof Refusal && /EACCES/.test(e.message));
    assert.equal(readFileSync(file, "utf8"), json(SETTINGS));
    assert.deepEqual(readdirSync(d), ["settings.json"]);
  } finally {
    chmodSync(d, 0o755);
  }
});

test("the file keeps its exact mode whatever the umask; a new one is 0600", () => {
  const d = dir();
  const file = join(d, "settings.json");
  writeFileSync(file, json(SETTINGS));
  chmodSync(file, 0o664);
  const umask = process.umask(0o022);
  try {
    install(file, commands);
    assert.equal((statSync(file).mode & 0o777).toString(8), "664");
    process.umask(0o277);
    install(join(d, "hooks.json"), commands);
    assert.equal((statSync(join(d, "hooks.json")).mode & 0o777).toString(8), "600");
  } finally {
    process.umask(umask);
  }
});

test("main does both programs, skips one that is not installed, and fails on a refusal", () => {
  const d = dir();
  const env = { CLAUDE_CONFIG_DIR: join(d, "claude"), CODEX_HOME: join(d, "codex") };
  const run = (...argv) => {
    const lines = [];
    return { code: main(argv, env, (line) => lines.push(line)), out: lines.join("\n") };
  };
  let r = run();
  assert.equal(r.code, 0);
  assert.match(r.out, /Claude Code: skipped/);
  assert.match(r.out, /Codex: skipped/);
  assert.deepEqual(readdirSync(d), [], "no folder is made for a program that is not installed");

  mkdirSync(env.CLAUDE_CONFIG_DIR);
  mkdirSync(env.CODEX_HOME);
  writeFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), json(SETTINGS));
  r = run("--dry-run");
  assert.match(r.out, /would change/);
  assert.equal(readFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), "utf8"), json(SETTINGS));
  assert.ok(!existsSync(join(env.CODEX_HOME, "hooks.json")));

  r = run();
  assert.equal(r.code, 0);
  const script = /'[^']*\/tools\/bee-hook\.sh' clear/;
  assert.match(JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), "utf8")).hooks.SessionStart.at(-1).hooks[0].command, script);
  assert.match(JSON.parse(readFileSync(join(env.CODEX_HOME, "hooks.json"), "utf8")).hooks.SessionStart[0].hooks[0].command, script);
  assert.match(r.out, /hooks = true/, "says what Codex needs when its config doesn't turn hooks on");

  writeFileSync(join(env.CODEX_HOME, "config.toml"), "[features]\nhooks = true\n");
  r = run();
  assert.equal(r.code, 0);
  assert.equal((r.out.match(/already in/g) ?? []).length, 2);
  assert.doesNotMatch(r.out, /hooks = true/);

  writeFileSync(join(env.CODEX_HOME, "hooks.json"), "{ // mine\n}");
  r = run("codex");
  assert.equal(r.code, 1);
  assert.match(r.out, /untouched/);
  assert.equal(readFileSync(join(env.CODEX_HOME, "hooks.json"), "utf8"), "{ // mine\n}");
  assert.equal(run("gemini").code, 2);
});

test("main never stops at the first program: each error is reported and the next is still done", { skip: process.getuid?.() === 0 && "root writes anywhere" }, () => {
  const d = dir();
  const env = { CLAUDE_CONFIG_DIR: join(d, "claude"), CODEX_HOME: join(d, "codex") };
  const run = (...argv) => {
    const lines = [];
    return { code: main(argv, env, (line) => lines.push(line)), out: lines.join("\n") };
  };
  mkdirSync(env.CLAUDE_CONFIG_DIR);
  mkdirSync(env.CODEX_HOME);
  writeFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), json(SETTINGS));
  chmodSync(env.CLAUDE_CONFIG_DIR, 0o555);
  try {
    // Claude Code's folder can't be written in: a refusal, then Codex.
    let r = run("claude", "codex");
    assert.equal(r.code, 1);
    assert.match(r.out, /Claude Code: left .* untouched: .*EACCES/);
    assert.ok(existsSync(join(env.CODEX_HOME, "hooks.json")), "Codex is still done");
    assert.equal(readFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), "utf8"), json(SETTINGS));

    // Codex fails after its change (its config.toml can't be read): Claude Code is still tried.
    mkdirSync(join(env.CODEX_HOME, "config.toml"));
    r = run("codex", "claude");
    assert.equal(r.code, 1);
    assert.match(r.out, /Codex: .*EISDIR/);
    assert.match(r.out, /Claude Code: left/);
  } finally {
    chmodSync(env.CLAUDE_CONFIG_DIR, 0o755);
  }
});
