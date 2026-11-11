// Lines added and removed in the agents' repositories: the hits the drawer shows.
// Contract: docs/DESIGN.md, "Contract: edits.js".
//
// Herdr reports no edits, so they come from git. Each repository an agent works in is
// watched with `watchFolder`. After each batch of changes, the repository's diff against
// HEAD (untracked files counted as added lines) is read again and compared with the last
// read. Growth in a file's added lines is a green hit, growth in its removed lines a red
// one. A commit, a stash or a revert shrinks the diff, and shows nothing.

import { exec, readTextFile, watchFolder } from "herdr";

/** @import { AsyncContext, Task } from "gpui-kit" */

/** @typedef {{ added: number, removed: number }} Lines */
/** @typedef {Map<string, Lines>} Diff Lines per file, by its path in the repository. */

const UNTRACKED_MAX = 50; // new files read per look, so an unignored build folder stays cheap
const SETTLE = 250; // ms for a burst of writes to land before the diff is read

/**
 * `git diff --numstat` output as a Diff. Binary files ("-\t-\tpath") are left out.
 * @param {string} stdout
 * @returns {Diff}
 */
export function parseNumstat(stdout) {
  /** @type {Diff} */
  const diff = new Map();
  for (const line of stdout.split("\n")) {
    const m = /^(\d+)\t(\d+)\t(.+)$/.exec(line);
    if (m) diff.set(m[3], { added: Number(m[1]), removed: Number(m[2]) });
  }
  return diff;
}

/** @type {(text: string) => number} Lines in a file's text, a last line without "\n" included. */
export const countLines = (text) => (text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0);

/**
 * What grew from one diff to the next: per file, only growth counts, so lines that leave
 * the diff (a commit, a revert) never read as a hit.
 * @param {Diff} before
 * @param {Diff} after
 * @returns {Lines}
 */
export function growth(before, after) {
  let added = 0;
  let removed = 0;
  for (const [path, now] of after) {
    const was = before.get(path);
    added += Math.max(0, now.added - (was?.added ?? 0));
    removed += Math.max(0, now.removed - (was?.removed ?? 0));
  }
  return { added, removed };
}

/** @type {(cwd: string, args: string[]) => ReturnType<typeof exec>} Git that never writes the index. */
const git = (cwd, args) => exec("git", ["--no-optional-locks", ...args], { cwd });

/**
 * The repository a folder is in, or null when it is in none.
 * @param {string} dir
 * @returns {Promise<string | null>}
 */
async function repoRoot(dir) {
  try {
    const r = await git(dir, ["rev-parse", "--show-toplevel"]);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The repository's changes against HEAD, untracked files included, or null when git can't
 * tell. A repository without commits is compared with nothing.
 * @param {string} root
 * @returns {Promise<Diff | null>}
 */
export async function readDiff(root) {
  try {
    let r = await git(root, ["diff", "HEAD", "--numstat"]);
    if (r.code !== 0) r = await git(root, ["diff", "--cached", "--numstat"]);
    if (r.code !== 0) return null;
    const diff = parseNumstat(r.stdout);
    const u = await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const fresh = u.code === 0 ? u.stdout.split("\0").filter(Boolean).slice(0, UNTRACKED_MAX) : [];
    const texts = await Promise.all(fresh.map((path) => readTextFile(`${root}/${path}`).catch(() => /** @type {string | null} */ (null))));
    fresh.forEach((path, i) => diff.set(path, { added: countLines(texts[i] ?? ""), removed: 0 }));
    return diff;
  } catch {
    return null;
  }
}

/** Watches the repositories of the folders it is given, and reports what grows in them. */
export class EditWatcher {
  /** @param {(root: string, lines: Lines, cx: AsyncContext) => void} onGrowth */
  constructor(onGrowth) {
    this.onGrowth = onGrowth;
    /** @type {Map<string, string | null>} Folder to repository root; null: none, or still asking. */
    this.roots = new Map();
    /** @type {Map<string, Task>} Watched repository roots. */
    this.watched = new Map();
    /** @type {Set<string>} The folders last given. */
    this.dirs = new Set();
  }

  /**
   * The repository root of a folder, once known.
   * @param {string} dir
   * @returns {string | null}
   */
  rootOf(dir) {
    return this.roots.get(dir) ?? null;
  }

  /**
   * Watches the repositories these folders are in, and stops watching any other. Cheap to
   * call again with the same folders.
   * @param {Iterable<string>} dirs
   * @param {AsyncContext} cx
   */
  follow(dirs, cx) {
    this.dirs = new Set(dirs);
    for (const dir of this.roots.keys()) if (!this.dirs.has(dir)) this.roots.delete(dir);
    for (const dir of this.dirs) {
      if (this.roots.has(dir)) continue;
      this.roots.set(dir, null);
      cx.spawn(async (cx) => {
        const root = await repoRoot(dir);
        if (!this.dirs.has(dir)) return;
        this.roots.set(dir, root);
        if (root) this.follow(this.dirs, cx);
      });
    }
    const wanted = new Set([...this.dirs].map((dir) => this.rootOf(dir)).filter(Boolean));
    for (const [root, task] of this.watched) {
      if (wanted.has(root)) continue;
      this.watched.delete(root);
      task.cancel();
    }
    for (const root of wanted) if (!this.watched.has(root)) this.watch(root, cx);
  }

  /**
   * @param {string} root
   * @param {AsyncContext} cx
   */
  watch(root, cx) {
    const task = cx.spawn(async (cx) => {
      const live = () => this.watched.get(root) === task;
      let last = await readDiff(root);
      while (live()) {
        try {
          await watchFolder(root);
        } catch (e) {
          // Too big to watch (Linux): no hits from this repository.
          console.log(`pixel-party: not watching ${root}: ${e instanceof Error ? e.message : e}`);
          return;
        }
        await cx.sleep(SETTLE);
        const next = await readDiff(root);
        if (!live() || !next) continue;
        const lines = last ? growth(last, next) : null;
        last = next;
        if (lines && (lines.added || lines.removed)) this.onGrowth(root, lines, cx);
      }
    });
    this.watched.set(root, task);
  }
}
