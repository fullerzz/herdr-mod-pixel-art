#!/usr/bin/env node
// Adds the bee hooks (tools/bee-hook.sh) to Claude Code's and Codex's own hook files, so
// their sub-agents show as bees. Both keep hooks as JSON, in the same shape:
//
//   Claude Code   ~/.claude/settings.json   (or $CLAUDE_CONFIG_DIR)
//   Codex         ~/.codex/hooks.json       (or $CODEX_HOME)
//
//   node tools/install-hooks.mjs [claude] [codex] [--dry-run]
//
// With no name it does both. Safe to run again: an event already has the hook when one of
// its commands is exactly the one this writes, or the same with the path unquoted (the
// by-hand form in README.md). Any other hook is the person's own and is never changed, even
// one that runs a bee-hook.sh: ours is added after it, and a note says a second one is there.
//
// These are a person's own settings, so it changes a file only when that is provably safe:
// - A file is rewritten only if parsing it loses nothing. One with comments, a duplicate
//   key, a number or an escape that would be written back differently is refused, untouched.
// - A hook is added at the end of its list, never before another: Codex remembers which
//   hooks a person trusted by their place in the list.
// - The untouched file is kept beside it as `<file>.bak-pixel-party-<time>`.
// - The new text goes to a temporary file in the same folder, with the old file's mode, and
//   takes the old one's place in one step, only if the old one is still what was read. A new
//   file is put in place only if none appeared meanwhile. On any failure before that step the
//   file is untouched and nothing is left beside it.
// - A symbolic link is followed, never replaced; one that leads to nothing is refused. A file
//   with a second name (a hard link) is refused: the swap would part the two names.
// - A program that is not installed is skipped: its folder is never created.

import { closeSync, constants, copyFileSync, existsSync, fchmodSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The hook event of each program, and what bee-hook.sh is told when it fires. */
export const EVENTS = /** @type {const} */ ({ SubagentStart: "start", SubagentStop: "stop", SessionStart: "clear" });

/** A file this won't change, and why. Nothing was written. */
export class Refusal extends Error {}

/** @type {(value: unknown) => value is Record<string, any>} */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @type {(path: string) => string} A path as one word of a shell command. */
const quote = (path) => `'${path.replaceAll("'", `'\\''`)}'`;

/**
 * The command of each event's hook.
 * @param {string} script The absolute path of bee-hook.sh.
 * @returns {Record<keyof typeof EVENTS, string>}
 */
export const commandsFor = (script) =>
  /** @type {any} */ (Object.fromEntries(Object.entries(EVENTS).map(([event, action]) => [event, `${quote(script)} ${action}`])));

/** @type {(command: string) => string} The command with its first word, quoted by `quote`, unquoted. */
const unquoted = (command) => command.replace(/^'((?:[^']|'\\'')*)'(?= )/, (_, word) => word.replaceAll("'\\''", "'"));

/** A command that names some bee-hook.sh. */
const namesBeeHook = /(^|[/\s'"])bee-hook\.sh(?=['"\s]|$)/;

/**
 * JSON text without the whitespace between its tokens. Strings are kept as written.
 * @param {string} text
 * @returns {string}
 */
function compact(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    if (ch !== '"') {
      out += ch;
      continue;
    }
    let end = i + 1;
    while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
    out += text.slice(i, end + 1);
    i = end;
  }
  return out;
}

/**
 * A hooks file's text with the bee hooks in it.
 * @param {string} text The file as it is.
 * @param {Record<string, string>} commands The command of each event's hook.
 * @returns {{ text: string, changes: string[], notes: string[] }} The same text and no changes
 *   when the hooks are there. A note is about a hook left as it is, never a change.
 * @throws {Refusal} When the file can't be changed without risk to what is in it.
 */
export function merge(text, commands) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Refusal(`it is not plain JSON (${e instanceof Error ? e.message : e})`);
  }
  if (!isObject(data)) throw new Refusal("it does not hold a JSON object");
  // What was read must be all there is: if writing it back differs by more than spacing,
  // something in it (a duplicate key, a long number, an escape) would not survive.
  if (JSON.stringify(data) !== compact(text)) throw new Refusal("rewriting it would change more than its hooks (a duplicate key, an unusual number or escape)");
  if (data.hooks !== undefined && !isObject(data.hooks)) throw new Refusal('its "hooks" is not an object');

  const changes = [];
  const notes = [];
  const hooks = data.hooks ?? {};
  for (const [event, command] of Object.entries(commands)) {
    const groups = Object.hasOwn(hooks, event) ? hooks[event] : [];
    if (!Array.isArray(groups)) throw new Refusal(`its "hooks.${event}" is not a list`);
    const same = [command, unquoted(command)];
    const existing = groups.flatMap((g) => (isObject(g) && Array.isArray(g.hooks) ? g.hooks : [])).flatMap((h) => (isObject(h) && typeof h.command === "string" ? [h.command] : []));
    for (const other of existing.filter((c) => !same.includes(c.trim()) && namesBeeHook.test(c))) {
      notes.push(`${event}: left your hook as it is, though it also names bee-hook.sh: ${other}`);
    }
    if (existing.some((c) => same.includes(c.trim()))) continue;
    hooks[event] = [...groups, { hooks: [{ type: "command", command, timeout: 5 }] }];
    changes.push(`${event}: add ${command}`);
  }
  if (!changes.length) return { text, changes, notes };
  data.hooks = hooks;

  // Written the way the file is written: its indent, its line ends, its last line's end.
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
  const tail = text.slice(text.trimEnd().length);
  let next = JSON.stringify(data, null, indent) + tail;
  if (text.includes("\r\n")) next = next.replace(/\r?\n/g, "\r\n");
  return { text: next, changes, notes };
}

/**
 * Adds the hooks to one file. Creates it when its folder is there and it is not.
 * @param {string} file
 * @param {Record<string, string>} commands
 * @param {{ dryRun?: boolean, now?: number }} [options]
 * @returns {{ file: string, changes: string[], notes: string[], backup: string | null, created: boolean }}
 * @throws {Refusal} When the file is left as it was. Any other error came after the change.
 */
export function install(file, commands, { dryRun = false, now = Date.now() } = {}) {
  /** @type {string[]} What this made beside the file, removed again if the change fails. */
  const made = [];
  let changed = false;
  try {
    const link = lstatSync(file, { throwIfNoEntry: false });
    if (link?.isSymbolicLink() && !existsSync(file)) throw new Refusal(`it is a link to ${readlinkSync(file)}, which is not there`);
    if (!link) {
      const { text, changes, notes } = merge("{}\n", commands);
      if (dryRun) return { file, changes, notes, backup: null, created: true };
      const tmp = write(file, text, 0o600, made);
      // Never over a file that appeared meanwhile: a link fails if the name is taken.
      linkSync(tmp, file);
      changed = true;
      rmSync(tmp);
      return { file, changes, notes, backup: null, created: true };
    }
    const real = realpathSync(file); // a symbolic link (dotfiles) is followed, not replaced
    const stat = statSync(real);
    if (!stat.isFile()) throw new Refusal("it is not a file");
    const bytes = readFileSync(real);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Refusal("it is not UTF-8 text");
    }
    const merged = merge(text, commands);
    const result = { file: real, changes: merged.changes, notes: merged.notes, backup: null, created: false };
    if (!merged.changes.length) return result;
    if (stat.nlink > 1) throw new Refusal(`it is a hard link (${stat.nlink} names for one file), and a rewrite would part the names: make it a symbolic link instead`);
    if (dryRun) return result;

    const backup = `${real}.bak-pixel-party-${now}`;
    copyFileSync(real, backup, constants.COPYFILE_EXCL);
    made.push(backup);
    const tmp = write(real, merged.text, stat.mode & 0o777, made);
    // The program may have saved its settings meanwhile: never write over that.
    if (!readFileSync(real).equals(bytes)) throw new Refusal("it changed while being read: run this again");
    renameSync(tmp, real);
    changed = true;
    if (readFileSync(real, "utf8") !== merged.text) {
      copyFileSync(backup, real);
      throw new Error(`${real} did not read back as written: restored from ${backup}`);
    }
    return { ...result, backup };
  } catch (e) {
    if (changed) throw e;
    // Before the change the file is untouched: an error here is a refusal, once cleaned up.
    for (const path of made) rmSync(path, { force: true });
    if (e instanceof Refusal) throw e;
    throw new Refusal(`${e instanceof Error ? e.message : e}`, { cause: e });
  }
}

/**
 * Writes the text to a new temporary file beside `path`, all of it on disk, with exactly
 * this mode whatever the umask.
 * @param {string} path
 * @param {string} text
 * @param {number} mode
 * @param {string[]} made The temporary file is added here once it exists.
 * @returns {string} The temporary file.
 */
function write(path, text, mode, made) {
  const tmp = `${path}.pixel-party-${process.pid}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  made.push(tmp);
  try {
    fchmodSync(fd, mode);
    const bytes = Buffer.from(text);
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return tmp;
}

/**
 * The programs whose hooks this knows, and where each keeps them.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, { name: string, dir: string, file: string }>}
 */
export const targets = (env) => ({
  claude: { name: "Claude Code", dir: env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), file: "settings.json" },
  codex: { name: "Codex", dir: env.CODEX_HOME || join(homedir(), ".codex"), file: "hooks.json" },
});

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {(line: string) => void} say
 * @returns {number} The exit code: 1 when a file was refused or anything else failed, 2 for a
 *   bad argument.
 */
export function main(argv, env, say) {
  const all = targets(env);
  const dryRun = argv.includes("--dry-run");
  const names = argv.filter((a) => a !== "--dry-run");
  if (names.some((n) => !all[n])) {
    say(`usage: install-hooks.mjs [${Object.keys(all).join("] [")}] [--dry-run]`);
    return 2;
  }
  const script = join(dirname(fileURLToPath(import.meta.url)), "bee-hook.sh");
  const commands = commandsFor(script);
  let code = 0;
  for (const key of names.length ? names : Object.keys(all)) {
    const { name, dir, file } = all[key];
    if (!existsSync(dir)) {
      say(`${name}: skipped, no ${dir}`);
      continue;
    }
    const path = join(dir, file);
    try {
      const done = install(path, commands, { dryRun });
      if (!done.changes.length) say(`${name}: bee hooks already in ${done.file}`);
      else {
        say(`${name}: ${dryRun ? "would change" : done.created ? "created" : "changed"} ${done.file}`);
        for (const change of done.changes) say(`  ${change}`);
        if (done.backup) say(`  the file as it was: ${done.backup}`);
      }
      for (const note of done.notes) say(`  note: ${note}`);
      if (key === "codex") {
        const config = join(dir, "config.toml");
        const on = existsSync(config) && /^\s*hooks\s*=\s*true\b/m.test(readFileSync(config, "utf8"));
        if (!on) say(`  Codex runs hooks only with \`hooks = true\` under [features] in ${config}`);
        if (done.changes.length) say("  Codex may ask you to review and trust the new hooks when it next starts");
      }
    } catch (e) {
      // One program's trouble never stops the next from being handled.
      code = 1;
      if (e instanceof Refusal) {
        say(`${name}: left ${path} untouched: ${e.message}`);
        say(`  add the hooks by hand: README.md, "Worker bees"`);
      } else say(`${name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return code;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2), process.env, console.log));
}
